import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { computePnL, type PnL } from "@/lib/pnl";
import { addDays, cn, dhakaDay, dhakaEndISO, dhakaStartISO, money, num, pct } from "@/lib/utils";
import { Badge, Card, CardHeader, Empty, ErrorBox, PageHeader, Skeleton, Stat } from "@/components/ui";

function ranges() {
  const t = dhakaDay();
  const monthStart = `${t.slice(0, 8)}01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const lastMonthStart = `${lastMonthEnd.slice(0, 8)}01`;
  return [
    { key: "mtd", label: "এই মাস", from: monthStart, to: t },
    { key: "last", label: "গত মাস", from: lastMonthStart, to: lastMonthEnd },
    { key: "30d", label: "৩০ দিন", from: addDays(t, -29), to: t },
    { key: "90d", label: "৯০ দিন", from: addDays(t, -89), to: t },
  ];
}

export default function Finance() {
  const { activeBrandIds, brands, activeBrand } = useSession();
  const R = ranges();
  const [rk, setRk] = useState("mtd");
  const r = R.find((x) => x.key === rk)!;
  const fromISO = dhakaStartISO(r.from), toISO = dhakaEndISO(r.to);

  const pnl = useQuery({
    queryKey: ["finance", "pnl", activeBrandIds, r.from, r.to],
    enabled: activeBrandIds.length > 0,
    queryFn: async () => {
      const per = await Promise.all(
        activeBrandIds.map(async (id) => ({ id, p: await computePnL([id], fromISO, toISO, r.from, r.to) })),
      );
      return per;
    },
  });

  const legacy = useQuery({
    queryKey: ["finance", "legacy", activeBrandIds, r.from, r.to],
    enabled: activeBrandIds.length > 0,
    queryFn: async () => {
      const res = await Promise.all(
        activeBrandIds.map((id) => supabase.rpc("erp_profit_loss", { _brand_id: id, _from: r.from, _to: r.to })),
      );
      return res.reduce(
        (a, x) => {
          const d = (x.data ?? {}) as { revenue?: number; net_profit?: number };
          return { revenue: a.revenue + Number(d.revenue ?? 0), net: a.net + Number(d.net_profit ?? 0) };
        },
        { revenue: 0, net: 0 },
      );
    },
  });

  const wallets = useQuery({
    queryKey: ["finance", "wallets", activeBrandIds],
    enabled: activeBrandIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("erp_accounts")
        .select("id,name,wallet_type,account_type,current_balance,brand_id,is_active")
        .or(`brand_id.in.(${activeBrandIds.join(",")}),brand_id.is.null`)
        .eq("is_active", true)
        .order("current_balance", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const total: PnL | null = pnl.data
    ? pnl.data.reduce<PnL>(
        (a, { p }) => ({
          revenue: a.revenue + p.revenue, orders: a.orders + p.orders, cogs: a.cogs + p.cogs,
          missingCostLines: a.missingCostLines + p.missingCostLines, gross: a.gross + p.gross, ads: a.ads + p.ads,
          adsUsd: a.adsUsd + p.adsUsd, courier: a.courier + p.courier, opex: a.opex + p.opex,
          opexByCategory: [...a.opexByCategory, ...p.opexByCategory], net: a.net + p.net,
          stockPurchases: a.stockPurchases + p.stockPurchases, returnsCount: a.returnsCount + p.returnsCount,
        }),
        { revenue: 0, orders: 0, cogs: 0, missingCostLines: 0, gross: 0, ads: 0, adsUsd: 0, courier: 0, opex: 0, opexByCategory: [], net: 0, stockPurchases: 0, returnsCount: 0 },
      )
    : null;

  const brandName = (id: string) => brands.find((b) => b.id === id)?.name ?? "—";
  const margin = total && total.revenue ? (total.net / total.revenue) * 100 : null;
  const cash = (wallets.data ?? []).filter((w) => w.account_type === "asset" || ["cash", "bank", "mfs", "bkash", "nagad"].includes(w.wallet_type));

  return (
    <div>
      <PageHeader
        title="Finance"
        sub={`${activeBrand?.name ?? "সব Brand"} · ${r.from} → ${r.to} (Dhaka)`}
        actions={
          <div className="flex rounded-lg border border-border bg-surface p-0.5">
            {R.map((x) => (
              <button key={x.key} onClick={() => setRk(x.key)} className={cn("rounded-md px-3 py-1 text-xs font-medium", rk === x.key ? "bg-accent text-accent-fg" : "text-muted")}>{x.label}</button>
            ))}
          </div>
        }
      />
      {(pnl.error || wallets.error) && <ErrorBox error={pnl.error || wallets.error} />}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {total ? (
          <>
            <Stat label="Revenue (delivered)" value={money(total.revenue)} hint={`${num(total.orders)} order`} />
            <Stat label="Gross profit" value={money(total.gross)} hint={`COGS ${money(total.cogs)}`} />
            <Stat label="Meta ads" value={money(total.ads)} hint={`$${num(Math.round(total.adsUsd))} · ROAS ${total.ads ? (total.revenue / total.ads).toFixed(1) : "—"}x`} />
            <Stat label="Net profit" value={money(total.net)} hint={`margin ${pct(margin)}`} tone={total.net < 0 ? "bad" : "good"} />
          </>
        ) : Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[86px]" />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Profit & Loss" sub="প্রতিটা লাইন কোথা থেকে আসছে নিচে লেখা" />
          {!total ? <div className="p-4"><Skeleton className="h-56" /></div> : (
            <div className="px-4 py-3 text-sm">
              <Line k="Revenue" sub="delivered + paid order-এর total, delivered তারিখ ধরে" v={total.revenue} strong />
              <Line k="− পণ্যের খরচ (COGS)" sub="qty × order-এর সময়ের cost (না থাকলে WAC)" v={-total.cogs} />
              <Line k="= Gross profit" v={total.gross} strong divider />
              <Line k="− Meta ads" sub="Meta spend, কেনা ডলারের দামে (FIFO)" v={-total.ads} />
              <Line k="− Courier খরচ" sub={`delivered + ${num(total.returnsCount)}টা return-এর আসল shipping খরচ`} v={-total.courier} />
              <Line k="− অন্যান্য খরচ" sub="manual expense; stock কেনা বাদ" v={-total.opex} />
              <Line k="= Net profit" v={total.net} strong divider accent />
              {total.missingCostLines > 0 && (
                <div className="mt-2 rounded-md bg-warn-soft px-2 py-1 text-xs text-warn">{total.missingCostLines}টা line-এর cost নেই — COGS কম দেখাতে পারে</div>
              )}
              <div className="mt-3 flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-xs">
                <span className="text-muted">এই সময়ে stock কেনা (P&L-এ নয়, inventory-তে যায়)</span>
                <span className="num font-medium">{money(total.stockPurchases)}</span>
              </div>
            </div>
          )}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="পুরানো ERP-এর সাথে তুলনা" right={<Info className="h-4 w-4 text-muted" />} />
            <div className="space-y-2 px-4 py-3 text-sm">
              {legacy.data && total ? (
                <>
                  <div className="flex justify-between"><span className="text-muted">Revenue — পুরানো</span><span className="num">{money(legacy.data.revenue)}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Revenue — v2</span><span className="num font-medium">{money(total.revenue)}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Net — পুরানো</span><span className="num">{money(legacy.data.net)}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Net — v2</span><span className="num font-medium">{money(total.net)}</span></div>
                  <p className="pt-1 text-xs text-muted">
                    পুরানো হিসাব `paid` order বাদ দেয়, stock কেনাকে খরচ ধরে, আর Meta ads ধরে না। তাই পার্থক্য।
                  </p>
                </>
              ) : <Skeleton className="h-28" />}
            </div>
          </Card>

          {pnl.data && pnl.data.length > 1 && (
            <Card>
              <CardHeader title="Brand অনুযায়ী" />
              <div className="px-4 py-2">
                {pnl.data.map(({ id, p }) => (
                  <div key={id} className="flex items-center justify-between border-b border-border/60 py-2 text-sm last:border-0">
                    <span>{brandName(id)}</span>
                    <span className="text-right">
                      <span className="num block">{money(p.revenue)}</span>
                      <span className={cn("num text-xs", p.net < 0 ? "text-bad" : "text-good")}>net {money(p.net)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="টাকা কোথায় আছে" sub="Account balance (এখন)" />
            <div className="max-h-72 overflow-y-auto px-4 py-2 scroll-thin">
              {wallets.isLoading && <Skeleton className="h-24" />}
              {(cash.length ? cash : wallets.data ?? []).map((w) => (
                <div key={w.id} className="flex items-center justify-between border-b border-border/60 py-1.5 text-sm last:border-0">
                  <span className="flex items-center gap-2">{w.name} <Badge>{w.wallet_type}</Badge></span>
                  <span className={cn("num", Number(w.current_balance) < 0 && "text-bad")}>{money(w.current_balance)}</span>
                </div>
              ))}
              {wallets.data?.length === 0 && <Empty title="কোনো account নেই" />}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Line({ k, sub, v, strong, divider, accent }: { k: string; sub?: string; v: number; strong?: boolean; divider?: boolean; accent?: boolean }) {
  return (
    <div className={cn("flex items-start justify-between py-1.5", divider && "border-t border-border pt-2")}>
      <div>
        <div className={cn(strong && "font-semibold", accent && "text-accent")}>{k}</div>
        {sub && <div className="text-[11px] text-muted">{sub}</div>}
      </div>
      <div className={cn("num", strong && "font-semibold", v < 0 && !strong && "text-muted", accent && (v < 0 ? "text-bad" : "text-good"))}>{money(v)}</div>
    </div>
  );
}
