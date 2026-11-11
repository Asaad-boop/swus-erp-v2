import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { cn, date, money, num } from "@/lib/utils";
import { Badge, Button, Card, Empty, ErrorBox, Input, PageHeader, Select, Skeleton } from "@/components/ui";

const PAGE = 50;
const SORTS = {
  recent: { col: "last_order_at", label: "সাম্প্রতিক" },
  value: { col: "lifetime_value", label: "সবচেয়ে বেশি কেনা" },
  orders: { col: "orders_count", label: "সবচেয়ে বেশি order" },
} as const;

export default function Customers() {
  const { activeBrandIds } = useSession();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<keyof typeof SORTS>("recent");
  const [page, setPage] = useState(0);

  const list = useQuery({
    queryKey: ["customers", activeBrandIds, q, sort, page],
    enabled: activeBrandIds.length > 0,
    placeholderData: (p) => p,
    queryFn: async () => {
      let query = supabase
        .from("crm_customers_mv")
        .select("customer_key,name,email,orders_count,valid_orders_count,cancelled_orders_count,lifetime_value,avg_order_value,first_order_at,last_order_at,profile_segment,meta_status", { count: "exact" })
        .overlaps("brand_ids", activeBrandIds);
      const s = q.trim().replace(/[%,()]/g, "");
      if (s) query = query.or(`name.ilike.%${s}%,customer_key.ilike.%${s}%`);
      const { data, error, count } = await query
        .order(SORTS[sort].col, { ascending: false, nullsFirst: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: data ?? [], total: count ?? 0 };
    },
  });

  const total = list.data?.total ?? 0;

  return (
    <div>
      <PageHeader title="Customers" sub={`${num(total)} জন customer · প্রতি ৬ ঘণ্টায় update হয়`} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="নাম বা phone…" className="pl-9" />
          </div>
          <Select value={sort} onChange={(e) => { setSort(e.target.value as keyof typeof SORTS); setPage(0); }} className="w-auto">
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </div>
        {list.error && <div className="p-3"><ErrorBox error={list.error} /></div>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-2 py-2 text-right font-medium">Orders</th>
                <th className="px-2 py-2 text-right font-medium">Success</th>
                <th className="px-2 py-2 text-right font-medium">মোট কেনা</th>
                <th className="px-2 py-2 font-medium">Segment</th>
                <th className="px-4 py-2 font-medium">শেষ order</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading && <tr><td colSpan={6} className="p-4"><Skeleton className="h-40" /></td></tr>}
              {(list.data?.rows ?? []).map((c) => {
                const ok = c.valid_orders_count ?? 0;
                const all = c.orders_count ?? 0;
                const rate = all ? (ok / all) * 100 : 0;
                return (
                  <tr key={c.customer_key} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2">
                      <div className="font-medium">{c.name || "—"}</div>
                      <div className="num text-xs text-muted">{c.customer_key}</div>
                    </td>
                    <td className="num px-2 py-2 text-right">{num(all)}</td>
                    <td className={cn("num px-2 py-2 text-right", rate < 50 && all > 1 ? "text-bad" : "text-muted")}>{all ? `${rate.toFixed(0)}%` : "—"}</td>
                    <td className="num px-2 py-2 text-right">{money(c.lifetime_value)}</td>
                    <td className="px-2 py-2">{c.profile_segment ? <Badge tone="info">{c.profile_segment}</Badge> : <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-2 text-muted">{date(c.last_order_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!list.isLoading && !list.data?.rows.length && <Empty title="কোনো customer পাওয়া যায়নি" />}
        </div>
        {total > PAGE && (
          <div className="flex items-center justify-end gap-1 border-t border-border px-3 py-2 text-xs text-muted">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="num px-2">{page + 1} / {Math.ceil(total / PAGE)}</span>
            <Button size="sm" variant="ghost" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        )}
      </Card>
    </div>
  );
}
