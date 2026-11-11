import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, PackageOpen, Search, Truck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { cn, money, num } from "@/lib/utils";
import { fetchAll } from "@/lib/queries";
import { Badge, Card, Empty, ErrorBox, Input, PageHeader, Skeleton, Stat } from "@/components/ui";

type P = {
  id: string; title: string; sku: string | null; image: string; price: number; stock: number; reserved_stock: number;
  low_stock_threshold: number; weighted_avg_cost: number; brand_id: string | null; is_active: boolean;
  product_variants: { id: string; color_name: string | null; stock: number; reserved_stock: number; is_active: boolean }[];
};

export default function Inventory() {
  const { activeBrandIds } = useSession();
  const [params, setParams] = useSearchParams();
  const filter = params.get("filter") ?? "all";
  const [q, setQ] = useState("");

  const data = useQuery({
    queryKey: ["inventory", activeBrandIds],
    enabled: activeBrandIds.length > 0,
    queryFn: async () => {
      // Products a brand sells = owned by it OR listed for it.
      const [owned, listed, incoming] = await Promise.all([
        fetchAll<P>((a, b) =>
          supabase.from("products")
            .select("id,title,sku,image,price,stock,reserved_stock,low_stock_threshold,weighted_avg_cost,brand_id,is_active,product_variants(id,color_name,stock,reserved_stock,is_active)")
            .in("brand_id", activeBrandIds).range(a, b) as never),
        supabase.from("product_brand_listings").select("product_id").in("brand_id", activeBrandIds).eq("is_active", true),
        supabase.from("v_product_incoming").select("product_id,incoming"),
      ]);
      const ownedIds = new Set(owned.map((p) => p.id));
      const extraIds = [...new Set((listed.data ?? []).map((l) => l.product_id))].filter((id) => !ownedIds.has(id));
      let extra: P[] = [];
      if (extraIds.length) {
        const { data } = await supabase.from("products")
          .select("id,title,sku,image,price,stock,reserved_stock,low_stock_threshold,weighted_avg_cost,brand_id,is_active,product_variants(id,color_name,stock,reserved_stock,is_active)")
          .in("id", extraIds);
        extra = (data ?? []) as unknown as P[];
      }
      const inc = new Map((incoming.data ?? []).map((r) => [r.product_id, Number(r.incoming) || 0]));
      return [...owned, ...extra].map((p) => ({ ...p, incoming: inc.get(p.id) ?? 0 }));
    },
  });

  const all = useMemo(() => (data.data ?? []).filter((p) => p.is_active), [data.data]);
  const low = (p: P) => p.stock - p.reserved_stock <= (p.low_stock_threshold ?? 0);
  const stats = useMemo(() => {
    const value = all.reduce((s, p) => s + Math.max(0, p.stock) * (p.weighted_avg_cost || 0), 0);
    return {
      products: all.length,
      units: all.reduce((s, p) => s + Math.max(0, p.stock), 0),
      reserved: all.reduce((s, p) => s + Math.max(0, p.reserved_stock), 0),
      value,
      low: all.filter(low).length,
      out: all.filter((p) => p.stock - p.reserved_stock <= 0).length,
    };
  }, [all]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all
      .filter((p) => (filter === "low" ? low(p) : filter === "out" ? p.stock - p.reserved_stock <= 0 : true))
      .filter((p) => !s || p.title.toLowerCase().includes(s) || (p.sku ?? "").toLowerCase().includes(s))
      .sort((a, b) => (a.stock - a.reserved_stock) - (b.stock - b.reserved_stock));
  }, [all, filter, q]);

  const setFilter = (f: string) => { const n = new URLSearchParams(params); if (f === "all") n.delete("filter"); else n.set("filter", f); setParams(n, { replace: true }); };

  return (
    <div>
      <PageHeader title="Products & Stock" sub="Available = stock − order-এ আটকে থাকা (reserved)" />
      {data.error && <ErrorBox error={data.error} />}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {data.data ? (
          <>
            <Stat label="Active products" value={num(stats.products)} hint={`${num(stats.units)} pcs হাতে`} />
            <Stat label="Order-এ reserved" value={num(stats.reserved)} hint="pack/ship বাকি" />
            <Stat label="Stock value (WAC)" value={money(stats.value)} />
            <Stat label="Low / শেষ" value={`${num(stats.low)} / ${num(stats.out)}`} tone={stats.out ? "bad" : stats.low ? "warn" : "good"} />
          </>
        ) : Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[86px]" />)}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="নাম বা SKU…" className="pl-9" />
          </div>
          {[["all", "সব"], ["low", "Low stock"], ["out", "শেষ"]].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={cn("rounded-full border px-3 py-1 text-xs", filter === k ? "border-accent bg-accent-soft text-accent" : "border-border text-muted")}>
              {l}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-2 py-2 text-right font-medium">Stock</th>
                <th className="px-2 py-2 text-right font-medium">Reserved</th>
                <th className="px-2 py-2 text-right font-medium">Available</th>
                <th className="px-2 py-2 text-right font-medium">আসছে</th>
                <th className="px-2 py-2 text-right font-medium">দাম</th>
                <th className="px-4 py-2 text-right font-medium">Cost (WAC)</th>
              </tr>
            </thead>
            <tbody>
              {data.isLoading && <tr><td colSpan={7} className="p-4"><Skeleton className="h-40" /></td></tr>}
              {rows.map((p) => {
                const avail = p.stock - p.reserved_stock;
                const margin = p.price ? ((p.price - (p.weighted_avg_cost || 0)) / p.price) * 100 : 0;
                const vs = p.product_variants.filter((v) => v.is_active);
                return (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2.5">
                        {p.image ? <img src={p.image} alt="" className="h-9 w-9 rounded-md border border-border object-cover" loading="lazy" /> : <div className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-2"><PackageOpen className="h-4 w-4 text-muted" /></div>}
                        <div className="min-w-0">
                          <div className="line-clamp-1">{p.title}</div>
                          <div className="text-xs text-muted">
                            {p.sku ?? "—"}
                            {vs.length > 0 && <> · {vs.map((v) => `${v.color_name ?? "?"} ${v.stock - v.reserved_stock}`).join(", ")}</>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="num px-2 py-2 text-right">{num(p.stock)}</td>
                    <td className="num px-2 py-2 text-right text-muted">{num(p.reserved_stock)}</td>
                    <td className="px-2 py-2 text-right">
                      <span className={cn("num font-medium", avail <= 0 ? "text-bad" : low(p) ? "text-warn" : "")}>{num(avail)}</span>
                      {avail <= 0 ? <Badge tone="bad" className="ml-1.5">শেষ</Badge> : low(p) ? <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-warn" /> : null}
                    </td>
                    <td className="num px-2 py-2 text-right text-muted">{p.incoming ? <span className="inline-flex items-center gap-1 text-info"><Truck className="h-3 w-3" />{num(p.incoming)}</span> : "—"}</td>
                    <td className="num px-2 py-2 text-right">{money(p.price)}</td>
                    <td className="num px-4 py-2 text-right text-muted">{money(p.weighted_avg_cost)} <span className={cn("text-xs", margin < 30 ? "text-warn" : "text-good")}>{p.weighted_avg_cost ? `${margin.toFixed(0)}%` : ""}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!data.isLoading && rows.length === 0 && <Empty title="কোনো product নেই" />}
        </div>
      </Card>
    </div>
  );
}
