import { supabase } from "@/lib/supabase";

/** Page through a Supabase query 1000 rows at a time (PostgREST caps each response). */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  max = 20_000,
): Promise<T[]> {
  const out: T[] = [];
  const page = 1000;
  for (let from = 0; from < max; from += page) {
    const { data, error } = await build(from, from + page - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

export type DashboardSummary = {
  kpis: {
    total_orders: number;
    total_value: number;
    delivered_orders: number;
    delivered_value: number;
    returned_orders: number;
    returned_value: number;
    cancelled_orders: number;
    in_transit_orders: number;
    advance_collected: number;
    cod_outstanding: number;
    paid_orders: number;
    avg_order_value: number;
    avg_confirm_to_delivery_hours: number;
  };
  statuses: { status: string; orders: number; value: number }[];
  sources: { source: string; orders: number; value: number }[];
  brands: { brand_id: string; name: string; orders: number; value: number }[];
  products: { name: string; qty: number; value: number; orders: number; delivered_qty: number; image: string | null }[];
  cities: { city: string; orders: number; value: number; delivered: number }[];
  couriers: { courier: string; orders: number; delivered: number; returned: number }[];
  confirmers: { user_id: string; name: string; orders: number; value: number }[];
};

export async function getDashboardSummary(brandIds: string[], fromISO: string, toISO: string) {
  const { data, error } = await supabase.rpc("erp_order_dashboard_summary", {
    p_brand_ids: brandIds,
    p_from: fromISO,
    p_to: toISO,
  });
  if (error) throw error;
  return data as unknown as DashboardSummary;
}
