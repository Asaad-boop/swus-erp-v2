import { useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Printer, ScanLine } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { cn, money, num, timeAgo } from "@/lib/utils";
import { statusMeta, type OrderStatus } from "@/lib/order-status";
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Input, PageHeader, Skeleton } from "@/components/ui";
import { customerName, customerPhone } from "./OrderList";

type Row = {
  id: string; invoice_no: string | null; status: string; created_at: string; total: number; advance_amount: number;
  shipping_name: string | null; guest_name: string | null; shipping_phone: string | null; guest_phone: string | null;
  courier_name: string | null; tracking_number: string | null; pathao_city_name: string | null; shipping_city: string | null;
  order_items: { name: string; quantity: number; variant_label: string | null; image: string | null }[];
};

const MODES = {
  pack: { label: "Pack করতে হবে", from: ["confirmed", "ready_to_pack", "packaging"] as OrderStatus[], to: "packed" as OrderStatus, verb: "Packed" },
  ship: { label: "Courier-এ দিতে হবে", from: ["packed", "ready_to_ship", "courier_entry"] as OrderStatus[], to: "shipped" as OrderStatus, verb: "Shipped" },
};
type Mode = keyof typeof MODES;

export default function Dispatch() {
  const { activeBrandIds } = useSession();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("pack");
  const [scan, setScan] = useState("");
  const [lastScan, setLastScan] = useState<{ ok: boolean; text: string } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const cfg = MODES[mode];

  const list = useQuery({
    queryKey: ["dispatch", mode, activeBrandIds],
    enabled: activeBrandIds.length > 0,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id,invoice_no,status,created_at,total,advance_amount,shipping_name,guest_name,shipping_phone,guest_phone,courier_name,tracking_number,pathao_city_name,shipping_city,order_items(name,quantity,variant_label,image)")
        .in("brand_id", activeBrandIds)
        .in("status", cfg.from)
        .order("created_at")
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  // Pick list: total pieces per product+variant across every order waiting to pack.
  const pick = useMemo(() => {
    const m = new Map<string, { name: string; variant: string | null; image: string | null; qty: number; orders: number }>();
    for (const o of list.data ?? []) {
      for (const it of o.order_items) {
        const k = `${it.name}|${it.variant_label ?? ""}`;
        const cur = m.get(k) ?? { name: it.name, variant: it.variant_label, image: it.image, qty: 0, orders: 0 };
        cur.qty += it.quantity;
        cur.orders += 1;
        m.set(k, cur);
      }
    }
    return [...m.values()].sort((a, b) => b.qty - a.qty);
  }, [list.data]);

  const move = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 1) {
        const { error } = await supabase.rpc("transition_order_status", { _order_id: ids[0], _new_status: cfg.to, _note: "v2 dispatch" });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("bulk_transition_order_status", { _order_ids: ids, _new_status: cfg.to, _note: "v2 dispatch" });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dispatch"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dash"] });
    },
  });

  function onScan(e: FormEvent) {
    e.preventDefault();
    const code = scan.trim().toLowerCase();
    if (!code) return;
    const hit = (list.data ?? []).find(
      (o) => o.invoice_no?.toLowerCase() === code || o.tracking_number?.toLowerCase() === code || o.id.startsWith(code),
    );
    setScan("");
    if (!hit) {
      setLastScan({ ok: false, text: `"${code}" এই list-এ নেই` });
      return;
    }
    move.mutate([hit.id], {
      onSuccess: () => setLastScan({ ok: true, text: `${hit.invoice_no} → ${cfg.verb} ✓` }),
      onError: (err) => setLastScan({ ok: false, text: err instanceof Error ? err.message : "Failed" }),
    });
    scanRef.current?.focus();
  }

  const rows = list.data ?? [];

  return (
    <div>
      <PageHeader
        title="Dispatch"
        sub="Pick list দেখে pack করুন, তারপর invoice/tracking scan করে এগিয়ে দিন"
        actions={
          <div className="flex rounded-lg border border-border bg-surface p-0.5">
            {(Object.keys(MODES) as Mode[]).map((k) => (
              <button
                key={k}
                onClick={() => { setMode(k); setLastScan(null); }}
                className={cn("rounded-md px-3 py-1.5 text-sm", mode === k ? "bg-accent font-medium text-accent-fg" : "text-muted")}
              >
                {MODES[k].label}
              </button>
            ))}
          </div>
        }
      />

      <Card className="mb-4 p-4">
        <form onSubmit={onScan} className="flex items-center gap-3">
          <ScanLine className="h-5 w-5 shrink-0 text-accent" />
          <Input
            ref={scanRef}
            autoFocus
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            placeholder={`Invoice বা tracking scan করুন → ${cfg.verb}`}
            className="num h-11 text-base"
          />
          <Button variant="primary" type="submit" loading={move.isPending}>Mark</Button>
        </form>
        {lastScan && (
          <div className={cn("mt-3 rounded-lg px-3 py-2 text-sm font-medium", lastScan.ok ? "bg-good-soft text-good" : "bg-bad-soft text-bad")}>
            {lastScan.text}
          </div>
        )}
      </Card>

      {list.error && <ErrorBox error={list.error} />}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Pick list"
            sub={`${num(rows.length)}টা order · ${num(pick.reduce((a, p) => a + p.qty, 0))} pcs`}
            right={<Button size="sm" variant="ghost" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" /> Print</Button>}
          />
          <div className="max-h-[560px] overflow-y-auto scroll-thin">
            {list.isLoading && <div className="p-4"><Skeleton className="h-40" /></div>}
            {pick.map((p) => (
              <div key={`${p.name}|${p.variant}`} className="flex items-center gap-3 border-b border-border/60 px-4 py-2 last:border-0">
                {p.image ? <img src={p.image} alt="" className="h-9 w-9 rounded-md object-cover" loading="lazy" /> : <div className="h-9 w-9 rounded-md bg-surface-2" />}
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-1 text-sm">{p.name}</div>
                  <div className="text-xs text-muted">{p.variant ?? "—"} · {p.orders} order</div>
                </div>
                <div className="num text-lg font-semibold">{p.qty}</div>
              </div>
            ))}
            {!list.isLoading && pick.length === 0 && <Empty title="কিছু pack করার নেই 🎉" />}
          </div>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Orders"
            sub="পুরানো order আগে"
            right={
              rows.length > 0 && (
                <Button
                  size="sm"
                  loading={move.isPending}
                  onClick={() => {
                    if (!confirm(`সব ${rows.length}টা order → ${cfg.verb}?`)) return;
                    move.mutate(rows.map((r) => r.id), {
                      onSuccess: () => toast.success(`${rows.length}টা order ${cfg.verb}`),
                      onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
                    });
                  }}
                >
                  সব {cfg.verb}
                </Button>
              )
            }
          />
          <div className="max-h-[560px] overflow-y-auto scroll-thin">
            {rows.map((o) => {
              const m = statusMeta(o.status);
              const cod = Math.max(0, o.total - (o.advance_amount || 0));
              return (
                <div key={o.id} className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="num font-medium">{o.invoice_no}</span>
                      <Badge tone={m.tone}>{m.label}</Badge>
                      <span className="text-xs text-muted">{timeAgo(o.created_at)}</span>
                    </div>
                    <div className="line-clamp-1 text-xs text-muted">
                      {customerName(o)} · <span className="num">{customerPhone(o)}</span> · {o.pathao_city_name || o.shipping_city || "—"}
                    </div>
                    <div className="line-clamp-1 text-xs">{o.order_items.map((i) => `${i.name}${i.variant_label ? ` (${i.variant_label})` : ""} ×${i.quantity}`).join(", ")}</div>
                  </div>
                  <div className="text-right">
                    <div className="num text-sm font-medium">{money(cod)}</div>
                    <div className="text-[11px] capitalize text-muted">{o.courier_name ?? "—"}</div>
                  </div>
                  <Button size="icon" variant="ghost" title={cfg.verb} onClick={() => move.mutate([o.id], { onError: (e) => toast.error(e instanceof Error ? e.message : "Failed") })}>
                    <CheckCircle2 className="h-5 w-5 text-good" />
                  </Button>
                </div>
              );
            })}
            {!list.isLoading && rows.length === 0 && <Empty title="এই ধাপে কোনো order নেই" />}
          </div>
        </Card>
      </div>
    </div>
  );
}
