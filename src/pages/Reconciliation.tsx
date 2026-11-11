import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { fetchAll } from "@/lib/queries";
import { cn, date, dateTime, money, num } from "@/lib/utils";
import { Badge, Card, CardHeader, Empty, ErrorBox, PageHeader, Skeleton, Stat } from "@/components/ui";

type Unpaid = {
  id: string; invoice_no: string | null; status: string; total: number; advance_amount: number;
  delivered_at: string | null; courier_name: string | null; tracking_number: string | null; shipping_name: string | null; guest_name: string | null;
};

const DAY = 86_400_000;

export default function Reconciliation() {
  const { activeBrandIds } = useSession();

  // Delivered but money not yet marked received (status stays delivered until a settlement marks it paid).
  const unpaid = useQuery({
    queryKey: ["recon", "unpaid", activeBrandIds],
    enabled: activeBrandIds.length > 0,
    queryFn: () =>
      fetchAll<Unpaid>((a, b) =>
        supabase.from("orders")
          .select("id,invoice_no,status,total,advance_amount,delivered_at,courier_name,tracking_number,shipping_name,guest_name")
          .in("brand_id", activeBrandIds)
          .in("status", ["delivered", "partial_delivered"])
          .order("delivered_at", { ascending: true, nullsFirst: true })
          .range(a, b),
      ),
  });

  const runs = useQuery({
    queryKey: ["recon", "runs", activeBrandIds],
    enabled: activeBrandIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("erp_reconciliation_runs")
        .select("id,courier,created_at,applied_at,reverted_at,status,source_filename,total_rows,matched_count,unmatched_count,mismatched_count,total_collected,total_fee,total_payout,brand_id")
        .or(`brand_id.in.(${activeBrandIds.join(",")}),brand_id.is.null`)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return data ?? [];
    },
  });

  const aging = useMemo(() => {
    const rows = unpaid.data ?? [];
    const now = Date.now();
    const b = { fresh: { n: 0, v: 0 }, week: { n: 0, v: 0 }, old: { n: 0, v: 0 } };
    for (const o of rows) {
      const due = Math.max(0, Number(o.total) - Number(o.advance_amount || 0));
      const age = o.delivered_at ? (now - new Date(o.delivered_at).getTime()) / DAY : 999;
      const k = age <= 3 ? "fresh" : age <= 7 ? "week" : "old";
      b[k].n++; b[k].v += due;
    }
    return { ...b, total: rows.reduce((s, o) => s + Math.max(0, Number(o.total) - Number(o.advance_amount || 0)), 0) };
  }, [unpaid.data]);

  return (
    <div>
      <PageHeader title="COD Reconciliation" sub="Courier deliver করেছে কিন্তু টাকা এখনো হিসাবে ওঠেনি এমন order, আর আগের settlement upload-গুলো" />
      {(unpaid.error || runs.error) && <ErrorBox error={unpaid.error || runs.error} />}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {unpaid.data ? (
          <>
            <Stat label="Courier-এর কাছে পাওনা" value={money(aging.total)} hint={`${num(unpaid.data.length)}টা delivered order`} />
            <Stat label="০–৩ দিন" value={money(aging.fresh.v)} hint={`${aging.fresh.n} order · স্বাভাবিক`} />
            <Stat label="৪–৭ দিন" value={money(aging.week.v)} hint={`${aging.week.n} order`} tone={aging.week.n ? "warn" : "neutral"} />
            <Stat label="৭ দিনের বেশি" value={money(aging.old.v)} hint={`${aging.old.n} order · courier-কে জিজ্ঞেস করুন`} tone={aging.old.n ? "bad" : "good"} />
          </>
        ) : Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[86px]" />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="টাকা আসেনি এমন delivered order" sub="পুরানোটা আগে" />
          <div className="max-h-[560px] overflow-y-auto scroll-thin">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">Order</th>
                  <th className="px-2 py-2 font-medium">Courier</th>
                  <th className="px-2 py-2 font-medium">Delivered</th>
                  <th className="px-4 py-2 text-right font-medium">পাওনা</th>
                </tr>
              </thead>
              <tbody>
                {unpaid.isLoading && <tr><td colSpan={4} className="p-4"><Skeleton className="h-40" /></td></tr>}
                {(unpaid.data ?? []).map((o) => {
                  const age = o.delivered_at ? Math.floor((Date.now() - new Date(o.delivered_at).getTime()) / DAY) : null;
                  return (
                    <tr key={o.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2">
                        <div className="num font-medium">{o.invoice_no}</div>
                        <div className="text-xs text-muted">{o.shipping_name || o.guest_name}</div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="capitalize">{o.courier_name ?? "—"}</div>
                        <div className="num text-xs text-muted">{o.tracking_number ?? ""}</div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="text-xs">{date(o.delivered_at)}</div>
                        {age != null && <Badge tone={age > 7 ? "bad" : age > 3 ? "warn" : "neutral"}>{age} দিন</Badge>}
                      </td>
                      <td className="num px-4 py-2 text-right font-medium">{money(Math.max(0, o.total - (o.advance_amount || 0)))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {unpaid.data?.length === 0 && <Empty title="সব delivered order-এর টাকা হিসাবে উঠেছে ✓" />}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Settlement upload history" sub="Courier invoice থেকে মেলানো" />
          <div className="max-h-[560px] overflow-y-auto scroll-thin">
            {runs.isLoading && <div className="p-4"><Skeleton className="h-40" /></div>}
            {(runs.data ?? []).map((r) => {
              const problems = r.unmatched_count + r.mismatched_count;
              return (
                <div key={r.id} className="border-b border-border/60 px-4 py-2.5 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium capitalize">{r.courier}</span>
                    <Badge tone={r.reverted_at ? "neutral" : r.applied_at ? "good" : "warn"}>
                      {r.reverted_at ? "reverted" : r.applied_at ? "applied" : r.status}
                    </Badge>
                  </div>
                  <div className="mt-0.5 flex justify-between text-xs text-muted">
                    <span>{dateTime(r.created_at)}</span>
                    <span className="num">payout {money(r.total_payout)}</span>
                  </div>
                  <div className="mt-0.5 text-xs">
                    <span className="num text-good">{r.matched_count} matched</span>
                    {problems > 0 && <span className={cn("num ml-2", "text-bad")}>{problems} সমস্যা</span>}
                    <span className="num ml-2 text-muted">fee {money(r.total_fee)}</span>
                  </div>
                </div>
              );
            })}
            {runs.data?.length === 0 && <Empty title="এখনো কোনো settlement upload হয়নি" />}
          </div>
        </Card>
      </div>
      <p className="mt-3 text-xs text-muted">Settlement file upload আর apply করা এখনো পুরানো ERP-তে (finance posting একই রাখতে)। এখানে শুধু কী বাকি সেটা পরিষ্কার দেখা যায়।</p>
    </div>
  );
}
