import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, MessageCircle, Phone, Send, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, dateTime, money, num, timeAgo, titleCase } from "@/lib/utils";
import { NEXT_ACTIONS, statusMeta, type OrderStatus } from "@/lib/order-status";
import { Badge, Button, Card, ErrorBox, Sheet, Skeleton, Textarea } from "@/components/ui";

function bdPhone(p: string) {
  const d = p.replace(/\D/g, "");
  return d.startsWith("88") ? d : `88${d}`;
}

export function OrderDrawer({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  const order = useQuery({
    queryKey: ["order", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*, order_items(id,name,quantity,unit_price,price,line_total,image,variant_label,product_id)")
        .eq("id", orderId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const o = order.data;
  const phone = o ? (o.shipping_phone || o.guest_phone || "") : "";

  const history = useQuery({
    queryKey: ["order", orderId, "history"],
    enabled: !!orderId,
    queryFn: async () => {
      const [h, n] = await Promise.all([
        supabase.from("order_status_history").select("id,from_status,to_status,note,reason,created_at,changed_by").eq("order_id", orderId!).order("created_at", { ascending: false }),
        supabase.from("order_notes").select("id,body,created_at,created_by,is_internal").eq("order_id", orderId!).order("created_at", { ascending: false }),
      ]);
      const ids = [...new Set([...(h.data ?? []).map((x) => x.changed_by), ...(n.data ?? []).map((x) => x.created_by)].filter(Boolean))] as string[];
      const { data: people } = ids.length
        ? await supabase.from("profiles").select("id,display_name,username").in("id", ids)
        : { data: [] };
      const who = Object.fromEntries((people ?? []).map((p) => [p.id, p.display_name || p.username || "—"]));
      const events = [
        ...(h.data ?? []).map((x) => ({ kind: "status" as const, at: x.created_at, by: x.changed_by ? who[x.changed_by] : "System", from: x.from_status, to: x.to_status, text: x.reason || x.note })),
        ...(n.data ?? []).map((x) => ({ kind: "note" as const, at: x.created_at, by: x.created_by ? who[x.created_by] : "—", text: x.body, from: null, to: null })),
      ].sort((a, b) => b.at.localeCompare(a.at));
      return events;
    },
  });

  // Customer track record by phone — the single most useful signal for COD risk.
  const customer = useQuery({
    queryKey: ["customer-record", phone],
    enabled: phone.length >= 10,
    queryFn: async () => {
      const tail = phone.replace(/\D/g, "").slice(-10);
      const { data } = await supabase
        .from("orders")
        .select("id,status,total,created_at")
        .or(`shipping_phone.ilike.%${tail},guest_phone.ilike.%${tail}`)
        .neq("id", orderId!)
        .order("created_at", { ascending: false })
        .limit(50);
      const rows = data ?? [];
      const delivered = rows.filter((r) => ["delivered", "partial_delivered", "completed", "paid"].includes(r.status)).length;
      const returned = rows.filter((r) => ["returned", "partial_return", "unpaid_return", "paid_return"].includes(r.status)).length;
      const cancelled = rows.filter((r) => ["cancelled", "fake"].includes(r.status)).length;
      return { total: rows.length, delivered, returned, cancelled };
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["order", orderId] });
    qc.invalidateQueries({ queryKey: ["orders"] });
    qc.invalidateQueries({ queryKey: ["nav"] });
    qc.invalidateQueries({ queryKey: ["dash"] });
  };

  const move = useMutation({
    mutationFn: async ({ to, reason }: { to: OrderStatus; reason?: string }) => {
      const { error } = await supabase.rpc("transition_order_status", { _order_id: orderId!, _new_status: to, _reason: reason, _note: "v2" });
      if (error) throw error;
    },
    onSuccess: (_d, v) => { toast.success(`Status → ${statusMeta(v.to).label}`); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Status change failed"),
  });

  const addNote = useMutation({
    mutationFn: async (body: string) => {
      const { error } = await supabase.rpc("add_order_note", { _order_id: orderId!, _body: body, _is_internal: true });
      if (error) throw error;
    },
    onSuccess: () => { setNote(""); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Note save হয়নি"),
  });

  const meta = statusMeta(o?.status);
  // Never ship an order that has no courier booking (it would fall out of courier sync).
  const next = o ? (NEXT_ACTIONS[o.status as OrderStatus] ?? []).filter((t) => t !== "shipped" || !!o.tracking_number) : [];
  const due = o ? Math.max(0, Number(o.total) - Number(o.advance_amount || 0)) : 0;
  const address = o ? [o.shipping_address, o.pathao_area_name, o.pathao_zone_name, o.pathao_city_name || o.shipping_city].filter(Boolean).join(", ") : "";

  return (
    <Sheet open={!!orderId} onClose={onClose}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-5 py-3">
        <div>
          <div className="num text-base font-semibold">{o?.invoice_no ?? "Order"}</div>
          <div className="text-xs text-muted">{o && `${dateTime(o.created_at)} · ${titleCase(o.source)}`}</div>
        </div>
        <div className="flex items-center gap-2">
          {o && <Badge tone={meta.tone}>{meta.label}</Badge>}
          <button onClick={onClose} className="rounded-md p-1.5 hover:bg-surface-2"><X className="h-4 w-4" /></button>
        </div>
      </div>

      {order.error && <div className="p-5"><ErrorBox error={order.error} /></div>}
      {!o && !order.error && <div className="space-y-3 p-5"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>}

      {o && (
        <div className="space-y-4 p-5">
          {next.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {next.map((to) => {
                const needsReason = to === "cancelled" || to === "on_hold" || to === "fake";
                return (
                  <Button
                    key={to}
                    size="sm"
                    variant={to === "cancelled" || to === "fake" ? "danger" : NEXT_ACTIONS[o.status as OrderStatus]?.[0] === to ? "primary" : "secondary"}
                    loading={move.isPending && move.variables?.to === to}
                    onClick={() => {
                      let reason: string | undefined;
                      if (needsReason) {
                        const r = prompt(`${statusMeta(to).label} — কারণ লিখুন`);
                        if (r === null) return;
                        reason = r || undefined;
                      }
                      move.mutate({ to, reason });
                    }}
                  >
                    → {statusMeta(to).label}
                  </Button>
                );
              })}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="p-4">
              <div className="mb-2 text-xs font-medium text-muted">Customer</div>
              <div className="font-medium">{o.shipping_name || o.guest_name || "—"}</div>
              <div className="num mt-0.5 text-sm">{phone || "—"}</div>
              {o.alternate_phone && <div className="num text-xs text-muted">Alt: {o.alternate_phone}</div>}
              <div className="mt-2 text-sm text-muted">{address || "—"}</div>
              {phone && (
                <div className="mt-3 flex gap-1.5">
                  <a href={`tel:${phone}`}><Button size="sm"><Phone className="h-3.5 w-3.5" /> Call</Button></a>
                  <a href={`https://wa.me/${bdPhone(phone)}`} target="_blank" rel="noreferrer"><Button size="sm"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</Button></a>
                  <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(`${o.shipping_name ?? ""}\n${phone}\n${address}`); toast.success("Copied"); }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </Card>

            <Card className="p-4">
              <div className="mb-2 text-xs font-medium text-muted">এই customer-এর আগের record</div>
              {customer.data ? (
                customer.data.total === 0 ? (
                  <div className="text-sm">নতুন customer — আগে কোনো order নেই</div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div><div className="num text-lg font-semibold">{customer.data.total}</div><div className="text-[11px] text-muted">আগের order</div></div>
                      <div><div className="num text-lg font-semibold text-good">{customer.data.delivered}</div><div className="text-[11px] text-muted">delivered</div></div>
                      <div><div className={cn("num text-lg font-semibold", customer.data.returned + customer.data.cancelled > 0 && "text-bad")}>{customer.data.returned + customer.data.cancelled}</div><div className="text-[11px] text-muted">return/cancel</div></div>
                    </div>
                    {customer.data.returned + customer.data.cancelled > customer.data.delivered && (
                      <div className="mt-2 rounded-md bg-bad-soft px-2 py-1 text-xs text-bad">⚠ Return/cancel বেশি — confirm করার আগে কল করুন</div>
                    )}
                  </>
                )
              ) : <Skeleton className="h-14" />}
            </Card>
          </div>

          <Card>
            <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-muted">Items</div>
            {o.order_items.map((it) => (
              <div key={it.id} className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-0">
                {it.image ? <img src={it.image} alt="" className="h-10 w-10 rounded-md border border-border object-cover" /> : <div className="h-10 w-10 rounded-md bg-surface-2" />}
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-1 text-sm">{it.name}</div>
                  {it.variant_label && <div className="text-xs text-muted">{it.variant_label}</div>}
                </div>
                <div className="num text-sm text-muted">{it.quantity} × {money(it.unit_price ?? it.price)}</div>
                <div className="num w-20 text-right text-sm font-medium">{money(it.line_total ?? (it.unit_price ?? it.price) * it.quantity)}</div>
              </div>
            ))}
            <div className="space-y-1 bg-surface-2/50 px-4 py-3 text-sm">
              <Row k="Subtotal" v={money(o.subtotal)} />
              {Number(o.discount_amount) > 0 && <Row k="Discount" v={`− ${money(o.discount_amount)}`} />}
              <Row k="Delivery" v={money(o.shipping_fee)} />
              <Row k="Total" v={money(o.total)} strong />
              {Number(o.advance_amount) > 0 && <Row k={`Advance (${o.advance_source ?? "paid"})`} v={`− ${money(o.advance_amount)}`} />}
              <Row k="COD collect করতে হবে" v={money(due)} strong accent />
            </div>
          </Card>

          {(o.courier_name || o.tracking_number) && (
            <Card className="p-4 text-sm">
              <div className="mb-1 text-xs font-medium text-muted">Courier</div>
              <div className="capitalize">{o.courier_name} · <span className="num">{o.tracking_number ?? "—"}</span></div>
              <div className="mt-1 text-xs text-muted">
                {o.shipped_at && <>Shipped {dateTime(o.shipped_at)} · </>}
                {o.delivered_at && <>Delivered {dateTime(o.delivered_at)}</>}
              </div>
            </Card>
          )}

          <Card>
            <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-muted">Notes ও history</div>
            <div className="flex gap-2 border-b border-border p-3">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note লিখুন (যেমন: কাল ১১টায় কল করতে বলেছে)" className="min-h-10" />
              <Button variant="primary" size="icon" disabled={!note.trim()} loading={addNote.isPending} onClick={() => addNote.mutate(note.trim())}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <div className="px-4 py-2">
              {(history.data ?? []).map((e, i) => (
                <div key={i} className="flex gap-3 border-b border-border/60 py-2 text-sm last:border-0">
                  <div className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", e.kind === "note" ? "bg-warn" : "bg-accent")} />
                  <div className="min-w-0 flex-1">
                    {e.kind === "status" ? (
                      <div>{e.from ? `${statusMeta(e.from).label} → ` : ""}<span className="font-medium">{statusMeta(e.to).label}</span></div>
                    ) : null}
                    {e.text && <div className={cn(e.kind === "status" && "text-xs text-muted")}>{e.text}</div>}
                    <div className="text-[11px] text-muted">{e.by} · {timeAgo(e.at)}</div>
                  </div>
                </div>
              ))}
              {history.data?.length === 0 && <div className="py-4 text-center text-xs text-muted">কোনো history নেই</div>}
            </div>
          </Card>

          <div className="text-center text-[11px] text-muted">Order ID {o.id} · {num(o.order_items.length)} line</div>
        </div>
      )}
    </Sheet>
  );
}

function Row({ k, v, strong, accent }: { k: string; v: string; strong?: boolean; accent?: boolean }) {
  return (
    <div className={cn("flex justify-between", strong && "font-semibold", accent && "text-accent")}>
      <span className={cn(!strong && "text-muted")}>{k}</span>
      <span className="num">{v}</span>
    </div>
  );
}
