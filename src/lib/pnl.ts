import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/queries";
import { GROUP } from "@/lib/order-status";

/**
 * v2 Profit & Loss — computed in the app from raw tables, read-only.
 *
 * Why not the DB functions:
 *  - erp_profit_loss() ignores `paid` orders (most delivered COD orders), so
 *    revenue comes out ~2% of reality, and it books import/stock payments
 *    (imp_payment) as operating expense while leaving Meta ad spend out.
 *  - get_brand_profitability_rollup() errors (references columns that no
 *    longer exist).
 * The legacy number is shown next to this one so the owner can compare.
 *
 * Definitions (all days are Asia/Dhaka):
 *  Revenue   = order total of delivered-family orders (incl. `paid`), by delivered date
 *  COGS      = qty × unit_cost_snapshot (fallback: variant WAC → product WAC)
 *  Ads       = Meta spend in BDT (FIFO dollar cost; fallback USD × avg dollar rate)
 *  Courier   = actual shipping cost recorded on delivered + returned orders (fallback courier_fee)
 *  Other opex= manual expense transactions, EXCLUDING stock purchases (imp_payment)
 *              and per-order courier postings (already in Courier)
 */
export type PnL = {
  revenue: number;
  orders: number;
  cogs: number;
  missingCostLines: number;
  gross: number;
  ads: number;
  adsUsd: number;
  courier: number;
  opex: number;
  opexByCategory: { name: string; amount: number }[];
  net: number;
  stockPurchases: number;
  returnsCount: number;
};

const EXCLUDE_FROM_OPEX = new Set(["imp_payment", "order_courier"]);

export async function computePnL(brandIds: string[], fromISO: string, toISO: string, fromDay: string, toDay: string): Promise<PnL> {
  const delivered = await fetchAll<{
    id: string; total: number; actual_shipping_cost: number | null; courier_fee: number;
    order_items: { quantity: number; unit_cost_snapshot: number | null; product_id: string; variant_id: string | null }[];
  }>((a, b) =>
    supabase.from("orders")
      .select("id,total,actual_shipping_cost,courier_fee,order_items(quantity,unit_cost_snapshot,product_id,variant_id)")
      .in("brand_id", brandIds)
      .in("status", GROUP.delivered)
      .gte("delivered_at", fromISO)
      .lt("delivered_at", toISO)
      .range(a, b) as never,
  );

  const returned = await fetchAll<{ actual_shipping_cost: number | null; courier_fee: number }>((a, b) =>
    supabase.from("orders")
      .select("actual_shipping_cost,courier_fee")
      .in("brand_id", brandIds)
      .in("status", GROUP.returned)
      .gte("updated_at", fromISO)
      .lt("updated_at", toISO)
      .range(a, b) as never,
  );

  // Cost fallbacks for lines without a cost snapshot.
  const prodIds = [...new Set(delivered.flatMap((o) => o.order_items.filter((i) => !i.unit_cost_snapshot).map((i) => i.product_id)))];
  const varIds = [...new Set(delivered.flatMap((o) => o.order_items.filter((i) => !i.unit_cost_snapshot && i.variant_id).map((i) => i.variant_id!)))];
  const [prods, vars] = await Promise.all([
    prodIds.length ? supabase.from("products").select("id,weighted_avg_cost,cost_price").in("id", prodIds) : Promise.resolve({ data: [] as { id: string; weighted_avg_cost: number; cost_price: number }[] }),
    varIds.length ? supabase.from("product_variants").select("id,weighted_avg_cost").in("id", varIds) : Promise.resolve({ data: [] as { id: string; weighted_avg_cost: number }[] }),
  ]);
  const pCost = new Map((prods.data ?? []).map((p) => [p.id, Number(p.weighted_avg_cost) || Number(p.cost_price) || 0]));
  const vCost = new Map((vars.data ?? []).map((v) => [v.id, Number(v.weighted_avg_cost) || 0]));

  let revenue = 0, cogs = 0, courier = 0, missingCostLines = 0;
  for (const o of delivered) {
    revenue += Number(o.total) || 0;
    courier += Number(o.actual_shipping_cost ?? o.courier_fee) || 0;
    for (const i of o.order_items) {
      let c = Number(i.unit_cost_snapshot) || 0;
      if (!c && i.variant_id) c = vCost.get(i.variant_id) ?? 0;
      if (!c) c = pCost.get(i.product_id) ?? 0;
      if (!c) missingCostLines++;
      cogs += c * i.quantity;
    }
  }
  for (const r of returned) courier += Number(r.actual_shipping_cost ?? r.courier_fee) || 0;

  // Meta ads
  const [ins, rate] = await Promise.all([
    fetchAll<{ spend: number; spend_bdt_fifo: number | null }>((a, b) =>
      supabase.from("mkt_insights_daily").select("spend,spend_bdt_fifo").in("brand_id", brandIds).gte("date", fromDay).lte("date", toDay).range(a, b) as never),
    supabase.from("meta_dollar_purchases").select("usd_amount,total_bdt").neq("status", "cancelled"),
  ]);
  const usd = (rate.data ?? []).reduce((s, r) => s + (Number(r.usd_amount) || 0), 0);
  const bdt = (rate.data ?? []).reduce((s, r) => s + (Number(r.total_bdt) || 0), 0);
  const avgRate = usd ? bdt / usd : 0;
  let ads = 0, adsUsd = 0;
  for (const r of ins) {
    adsUsd += Number(r.spend) || 0;
    ads += r.spend_bdt_fifo != null ? Number(r.spend_bdt_fifo) : (Number(r.spend) || 0) * avgRate;
  }

  // Other expenses
  const tx = await fetchAll<{ amount: number; reference_type: string | null; erp_expense_categories: { name: string } | null }>((a, b) =>
    supabase.from("erp_transactions")
      .select("amount,reference_type,erp_expense_categories(name)")
      .in("brand_id", brandIds)
      .eq("txn_type", "expense")
      .gte("transaction_date", fromDay)
      .lte("transaction_date", toDay)
      .range(a, b) as never,
  );
  let opex = 0, stockPurchases = 0;
  const cat = new Map<string, number>();
  for (const t of tx) {
    const amt = Number(t.amount) || 0;
    if (t.reference_type === "imp_payment") { stockPurchases += amt; continue; }
    if (t.reference_type && EXCLUDE_FROM_OPEX.has(t.reference_type)) continue;
    opex += amt;
    const n = t.erp_expense_categories?.name ?? "Uncategorized";
    cat.set(n, (cat.get(n) ?? 0) + amt);
  }

  const gross = revenue - cogs;
  return {
    revenue, orders: delivered.length, cogs, missingCostLines, gross, ads, adsUsd, courier, opex,
    opexByCategory: [...cat.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    net: gross - ads - courier - opex,
    stockPurchases,
    returnsCount: returned.length,
  };
}
