import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { cn, date, money, num, timeAgo, titleCase } from "@/lib/utils";
import { statusMeta } from "@/lib/order-status";
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, PageHeader, Skeleton, Stat } from "@/components/ui";

const DAY = 86_400_000;

export default function Returns() {
  const { activeBrandIds } = useSession();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"incoming" | "cases">("incoming");

  // Returns still out there: customer refused, parcel coming back.
  const incoming = useQuery({
    queryKey: ["returns", "incoming", activeBrandIds],
    enabled: activeBrandIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("orders")
        .select("id,invoice_no,status,total,courier_name,tracking_number,shipping_name,guest_name,updated_at,shipped_at,order_items(name,quantity)")
        .in("brand_id", activeBrandIds)
        .in("status", ["pending_return", "return_in_transit"])
        .order("updated_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const cases = useQuery({
    queryKey: ["returns", "cases", activeBrandIds],
    enabled: activeBrandIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("erp_return_cases")
        .select("id,case_number,order_id,created_at,return_type,status,return_status,item_condition,qty,sku,courier_name,refund_amount,return_delivery_cost,outbound_delivery_cost,product_cost_loss,packaging_loss,stock_restored")
        .in("brand_id", activeBrandIds)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  const receive = useMutation({
    // Same DB function the current ERP uses: only "good" puts stock back.
    mutationFn: async ({ id, condition }: { id: string; condition: "good" | "damaged" | "lost" }) => {
      const { error } = await supabase.rpc("confirm_return_received", {
        _order_id: id, _condition: condition, _final_status: "returned", _note: "v2",
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.condition === "good" ? "Return হাতে পাওয়া গেছে · stock-এ ফেরত গেছে" : `Return mark হয়েছে (${v.condition}) · stock বাড়েনি`);
      qc.invalidateQueries({ queryKey: ["returns"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const loss = useMemo(() => {
    const cs = cases.data ?? [];
    const sum = (f: (c: (typeof cs)[number]) => number) => cs.reduce((a, c) => a + (Number(f(c)) || 0), 0);
    return {
      shipping: sum((c) => c.return_delivery_cost + c.outbound_delivery_cost),
      product: sum((c) => c.product_cost_loss + c.packaging_loss),
      refunds: sum((c) => c.refund_amount),
      notRestocked: cs.filter((c) => !c.stock_restored && c.return_type !== "exchange").length,
    };
  }, [cases.data]);

  const stuck = (incoming.data ?? []).filter((o) => Date.now() - new Date(o.updated_at).getTime() > 10 * DAY).length;

  return (
    <div>
      <PageHeader
        title="Returns"
        sub="ফেরত আসা parcel ট্র্যাক করুন, যাতে কোনো product হারিয়ে না যায়"
        actions={
          <div className="flex rounded-lg border border-border bg-surface p-0.5">
            {([["incoming", "ফেরত আসছে"], ["cases", "Return cases"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={cn("rounded-md px-3 py-1.5 text-sm", tab === k ? "bg-accent font-medium text-accent-fg" : "text-muted")}>{l}</button>
            ))}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="রাস্তায় ফেরত" value={num(incoming.data?.length)} hint="এখনো warehouse-এ আসেনি" />
        <Stat label="১০ দিনের বেশি আটকে" value={num(stuck)} tone={stuck ? "bad" : "good"} hint="courier-কে follow up" />
        <Stat label="Return-এ shipping ক্ষতি" value={money(loss.shipping)} hint="শেষ ৩০০ case" />
        <Stat label="Stock-এ ফেরত হয়নি" value={num(loss.notRestocked)} tone={loss.notRestocked ? "warn" : "neutral"} hint="case আছে কিন্তু restock বাকি" />
      </div>

      {(incoming.error || cases.error) && <ErrorBox error={incoming.error || cases.error} />}

      {tab === "incoming" ? (
        <Card>
          <CardHeader title="ফেরত আসছে" sub="পুরানোটা আগে · parcel হাতে পেলে অবস্থা অনুযায়ী চাপুন (শুধু 'ভালো' দিলে stock ফেরত যাবে)" />
          {incoming.isLoading && <div className="p-4"><Skeleton className="h-40" /></div>}
          {(incoming.data ?? []).map((o) => {
            const age = Math.floor((Date.now() - new Date(o.updated_at).getTime()) / DAY);
            const m = statusMeta(o.status);
            return (
              <div key={o.id} className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="num font-medium">{o.invoice_no}</span>
                    <Badge tone={m.tone}>{m.label}</Badge>
                    <Badge tone={age > 10 ? "bad" : age > 5 ? "warn" : "neutral"}>{age} দিন</Badge>
                  </div>
                  <div className="line-clamp-1 text-xs text-muted">
                    {o.shipping_name || o.guest_name} · <span className="capitalize">{o.courier_name}</span> <span className="num">{o.tracking_number}</span>
                  </div>
                  <div className="line-clamp-1 text-xs">{o.order_items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}</div>
                </div>
                <div className="num text-sm text-muted">{money(o.total)}</div>
                <div className="flex gap-1">
                  <Button size="sm" loading={receive.isPending && receive.variables?.id === o.id && receive.variables.condition === "good"} onClick={() => receive.mutate({ id: o.id, condition: "good" })} title="ঠিক আছে, stock-এ ফেরত">ভালো ✓</Button>
                  <Button size="sm" variant="ghost" onClick={() => confirm("Product নষ্ট? Stock বাড়বে না।") && receive.mutate({ id: o.id, condition: "damaged" })}>নষ্ট</Button>
                  <Button size="sm" variant="ghost" onClick={() => confirm("Parcel হারিয়ে গেছে? Stock বাড়বে না।") && receive.mutate({ id: o.id, condition: "lost" })}>হারিয়েছে</Button>
                </div>
              </div>
            );
          })}
          {incoming.data?.length === 0 && <Empty title="কোনো return রাস্তায় নেই ✓" />}
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">Case</th>
                  <th className="px-2 py-2 font-medium">ধরন</th>
                  <th className="px-2 py-2 font-medium">অবস্থা</th>
                  <th className="px-2 py-2 font-medium">Item</th>
                  <th className="px-2 py-2 text-right font-medium">Shipping ক্ষতি</th>
                  <th className="px-4 py-2 text-right font-medium">Product ক্ষতি</th>
                </tr>
              </thead>
              <tbody>
                {cases.isLoading && <tr><td colSpan={6} className="p-4"><Skeleton className="h-40" /></td></tr>}
                {(cases.data ?? []).map((c) => (
                  <tr key={c.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2"><div className="num font-medium">{c.case_number ?? c.id.slice(0, 8)}</div><div className="text-xs text-muted">{date(c.created_at)} · {timeAgo(c.created_at)}</div></td>
                    <td className="px-2 py-2">{titleCase(c.return_type)}</td>
                    <td className="px-2 py-2"><Badge tone={c.status === "resolved" || c.status === "closed" ? "good" : "warn"}>{titleCase(c.status)}</Badge>{c.stock_restored && <span className="ml-1.5 text-xs text-good">restocked</span>}</td>
                    <td className="px-2 py-2 text-xs"><span className="num">{c.qty}×</span> {c.sku ?? "—"} <span className="text-muted">({titleCase(c.item_condition)})</span></td>
                    <td className="num px-2 py-2 text-right">{money(c.return_delivery_cost + c.outbound_delivery_cost)}</td>
                    <td className="num px-4 py-2 text-right">{money(c.product_cost_loss + c.packaging_loss)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cases.data?.length === 0 && <Empty title="কোনো return case নেই" />}
          </div>
        </Card>
      )}
    </div>
  );
}
