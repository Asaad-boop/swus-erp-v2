import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, PlusCircle, RefreshCw, Search, X } from "lucide-react";
import { supabase, type Tables } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { addDays, cn, dateTime, dhakaDay, dhakaEndISO, dhakaStartISO, money, num, timeAgo } from "@/lib/utils";
import { ALL_STATUSES, LIVE_LEAD_FILTER, STAGES, statusMeta, statusesInStage, type OrderStatus, type Stage } from "@/lib/order-status";
import { Badge, Button, Card, Empty, ErrorBox, Input, PageHeader, Select, Skeleton } from "@/components/ui";
import { OrderDrawer } from "./OrderDrawer";

const PAGE = 50;

export type OrderRow = Pick<
  Tables<"orders">,
  | "id" | "invoice_no" | "created_at" | "status" | "total" | "advance_amount" | "shipping_fee" | "discount_amount"
  | "shipping_name" | "shipping_phone" | "guest_name" | "guest_phone" | "shipping_city" | "pathao_city_name"
  | "courier_name" | "tracking_number" | "source" | "brand_id" | "payment_status" | "call_status"
  | "risk_flag" | "duplicate_flag" | "order_tags" | "printed_at" | "latest_note" | "is_preorder" | "web_status"
> & { order_items: { name: string; quantity: number }[] };

const ORDER_SELECT =
  "id,invoice_no,created_at,status,total,advance_amount,shipping_fee,discount_amount,shipping_name,shipping_phone,guest_name,guest_phone,shipping_city,pathao_city_name,courier_name,tracking_number,source,brand_id,payment_status,call_status,risk_flag,duplicate_flag,order_tags,printed_at,latest_note,is_preorder,web_status,order_items(name,quantity)";

const DATE_PRESETS = [
  { key: "", label: "সব সময়" },
  { key: "today", label: "আজ" },
  { key: "yesterday", label: "গতকাল" },
  { key: "7d", label: "৭ দিন" },
  { key: "30d", label: "৩০ দিন" },
];

function dateWindow(key: string): [string, string] | null {
  const t = dhakaDay();
  switch (key) {
    case "today": return [dhakaStartISO(t), dhakaEndISO(t)];
    case "yesterday": { const y = addDays(t, -1); return [dhakaStartISO(y), dhakaEndISO(y)]; }
    case "7d": return [dhakaStartISO(addDays(t, -6)), dhakaEndISO(t)];
    case "30d": return [dhakaStartISO(addDays(t, -29)), dhakaEndISO(t)];
    default: return null;
  }
}

export function customerName(o: { shipping_name: string | null; guest_name: string | null }) {
  return o.shipping_name || o.guest_name || "—";
}
export function customerPhone(o: { shipping_phone: string | null; guest_phone: string | null }) {
  return o.shipping_phone || o.guest_phone || "";
}

export default function OrderList() {
  const { activeBrandIds, brands } = useSession();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const stage = (params.get("stage") as Stage | null) ?? "intake";
  const status = params.get("status") ?? "";
  const datePreset = params.get("date") ?? "";
  const courier = params.get("courier") ?? "";
  const page = Number(params.get("page") ?? "0");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(params.get("open"));

  // If a status was linked directly (e.g. from the dashboard), jump to its stage.
  useEffect(() => {
    if (status && ALL_STATUSES.includes(status as OrderStatus)) {
      const st = statusMeta(status).stage;
      if (st !== stage) set({ stage: st });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function set(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
    setSelected(new Set());
  }

  // Debounced search → URL
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q.trim()) set({ q: q.trim() || null });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const search = params.get("q") ?? "";
  const win = dateWindow(datePreset);

  const counts = useQuery({
    queryKey: ["orders", "counts", activeBrandIds, search, datePreset, courier],
    enabled: activeBrandIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("erp_order_status_counts", {
        _brand_ids: activeBrandIds,
        _search: search || undefined,
        _date_from: win?.[0],
        _date_to: win?.[1],
        _courier: courier || undefined,
      });
      if (error) throw error;
      const m: Record<string, number> = {};
      for (const r of data ?? []) m[r.status] = Number(r.cnt);
      // The legacy count RPC leaves out `new` (web leads). Count live leads separately.
      let nq = supabase.from("orders").select("id", { count: "exact", head: true })
        .in("brand_id", activeBrandIds).eq("status", "new").or(LIVE_LEAD_FILTER);
      if (win) nq = nq.gte("created_at", win[0]).lt("created_at", win[1]);
      if (courier) nq = nq.eq("courier_name", courier);
      const { count: newCount } = await nq;
      m.new = newCount ?? 0;
      return m;
    },
  });

  const stageCount = (s: Stage) => statusesInStage(s).reduce((a, st) => a + (counts.data?.[st] ?? 0), 0);
  const filterStatuses: OrderStatus[] = status ? [status as OrderStatus] : statusesInStage(stage);

  const list = useQuery({
    queryKey: ["orders", "list", activeBrandIds, filterStatuses.join(","), search, datePreset, courier, page],
    enabled: activeBrandIds.length > 0,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      let query = supabase
        .from("orders")
        .select(ORDER_SELECT, { count: "exact" })
        .in("brand_id", activeBrandIds)
        .in("status", filterStatuses);
      if (filterStatuses.includes("new")) query = query.or(LIVE_LEAD_FILTER);
      if (win) query = query.gte("created_at", win[0]).lt("created_at", win[1]);
      if (courier) query = query.eq("courier_name", courier);
      if (search) {
        const s = search.replace(/[%,()]/g, "").replace(/^\+?88/, "");
        query = query.or(
          ["invoice_no", "shipping_name", "shipping_phone", "guest_name", "guest_phone", "tracking_number"]
            .map((c) => `${c}.ilike.%${s}%`)
            .join(","),
        );
      }
      const { data, error, count } = await query
        .order("created_at", { ascending: stage !== "intake" ? false : true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as OrderRow[], total: count ?? 0 };
    },
  });

  const bulk = useMutation({
    mutationFn: async ({ ids, to }: { ids: string[]; to: OrderStatus }) => {
      const { data, error } = await supabase.rpc("bulk_transition_order_status", {
        _order_ids: ids,
        _new_status: to,
        _note: "v2 bulk action",
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => {
      toast.success(`${v.ids.length}টা order → ${statusMeta(v.to).label}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["nav"] });
      qc.invalidateQueries({ queryKey: ["dash"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Status change failed"),
  });

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const brandName = useMemo(() => Object.fromEntries(brands.map((b) => [b.id, b.name])), [brands]);

  const bulkTargets: OrderStatus[] =
    stage === "intake" ? ["confirmed", "on_hold", "cancelled"]
    : stage === "prepare" ? ["packed", "ready_to_ship"]
    : stage === "courier" ? ["delivered", "pending_return"]
    : stage === "returns" ? ["returned"]
    : ["confirmed", "cancelled"];

  return (
    <div>
      <PageHeader
        title="Orders"
        sub={counts.data ? `${num(Object.values(counts.data).reduce((a, b) => a + b, 0))}টা order এই filter-এ` : " "}
        actions={
          <>
            <Button size="md" variant="ghost" onClick={() => qc.invalidateQueries({ queryKey: ["orders"] })} title="Refresh">
              <RefreshCw className={cn("h-4 w-4", list.isFetching && "animate-spin")} />
            </Button>
            <Link to="/orders/new">
              <Button variant="primary"><PlusCircle className="h-4 w-4" /> নতুন Order</Button>
            </Link>
          </>
        }
      />

      {/* Stage tabs */}
      <div className="mb-3 flex gap-1 overflow-x-auto border-b border-border scroll-thin">
        {STAGES.map((s) => (
          <button
            key={s.key}
            onClick={() => set({ stage: s.key, status: null })}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors",
              stage === s.key ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {s.label}
            <span className={cn("num rounded-full px-1.5 text-[11px]", stage === s.key ? "bg-accent text-accent-fg" : "bg-surface-2")}>
              {counts.data ? num(stageCount(s.key)) : "·"}
            </span>
          </button>
        ))}
      </div>

      {/* Status chips + filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => set({ status: null })}
          className={cn("rounded-full border px-2.5 py-1 text-xs", !status ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-muted")}
        >
          সব
        </button>
        {statusesInStage(stage).map((st) => {
          const c = counts.data?.[st] ?? 0;
          if (!c && status !== st) return null;
          return (
            <button
              key={st}
              onClick={() => set({ status: status === st ? null : st })}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs",
                status === st ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-muted hover:text-fg",
              )}
            >
              {statusMeta(st).label} <span className="num">{num(c)}</span>
            </button>
          );
        })}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Invoice, নাম, phone, tracking…"
              className="pl-9"
            />
            {q && (
              <button onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Select value={datePreset} onChange={(e) => set({ date: e.target.value })} className="w-auto">
            {DATE_PRESETS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </Select>
          <Select value={courier} onChange={(e) => set({ courier: e.target.value })} className="w-auto">
            <option value="">সব courier</option>
            <option value="pathao">Pathao</option>
            <option value="steadfast">Steadfast</option>
          </Select>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent-soft px-3 py-2 text-sm">
            <span className="font-medium">{selected.size}টা select করা</span>
            <span className="text-muted">→</span>
            {bulkTargets.map((t) => (
              <Button
                key={t}
                size="sm"
                variant={t === "cancelled" ? "danger" : "secondary"}
                loading={bulk.isPending && bulk.variables?.to === t}
                onClick={() => {
                  if (t === "cancelled" && !confirm(`${selected.size}টা order cancel করবেন?`)) return;
                  bulk.mutate({ ids: [...selected], to: t });
                }}
              >
                {statusMeta(t).label}
              </Button>
            ))}
            <button className="ml-auto text-xs text-muted hover:text-fg" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}

        {list.error && <div className="p-3"><ErrorBox error={list.error} /></div>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))}
                    className="accent-[var(--accent)]"
                  />
                </th>
                <th className="px-2 py-2 font-medium">Order</th>
                <th className="px-2 py-2 font-medium">Customer</th>
                <th className="px-2 py-2 font-medium">Items</th>
                <th className="px-2 py-2 text-right font-medium">COD</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Courier</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading &&
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/60"><td colSpan={7} className="px-3 py-2.5"><Skeleton className="h-8" /></td></tr>
                ))}
              {rows.map((o) => {
                const m = statusMeta(o.status);
                const due = Math.max(0, Number(o.total) - Number(o.advance_amount || 0));
                const items = o.order_items ?? [];
                const pieces = items.reduce((a, i) => a + i.quantity, 0);
                return (
                  <tr
                    key={o.id}
                    onClick={() => setOpenId(o.id)}
                    className={cn(
                      "cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2",
                      selected.has(o.id) && "bg-accent-soft/60",
                    )}
                  >
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={() => {
                          const n = new Set(selected);
                          if (n.has(o.id)) n.delete(o.id); else n.add(o.id);
                          setSelected(n);
                        }}
                        className="accent-[var(--accent)]"
                      />
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="num font-medium">{o.invoice_no ?? o.id.slice(0, 8)}</div>
                      <div className="text-xs text-muted" title={dateTime(o.created_at)}>
                        {timeAgo(o.created_at)}
                        {brands.length > 1 && o.brand_id && <> · {brandName[o.brand_id]}</>}
                      </div>
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="line-clamp-1 font-medium">{customerName(o)}</span>
                        {o.risk_flag && <Badge tone="bad">Risk</Badge>}
                        {o.duplicate_flag && <Badge tone="warn">Dup</Badge>}
                      </div>
                      <div className="num text-xs text-muted">
                        {customerPhone(o)} {(o.pathao_city_name || o.shipping_city) && <>· {o.pathao_city_name || o.shipping_city}</>}
                      </div>
                    </td>
                    <td className="max-w-[260px] px-2 py-2.5">
                      <div className="line-clamp-1">{items.map((i) => `${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join(", ") || "—"}</div>
                      <div className="text-xs text-muted">{pieces} pcs{o.latest_note && <> · <span title={o.latest_note}>📝 {o.latest_note.slice(0, 30)}</span></>}</div>
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <div className="num font-medium">{money(due)}</div>
                      {Number(o.advance_amount) > 0 && <div className="num text-xs text-good">adv {money(o.advance_amount)}</div>}
                    </td>
                    <td className="px-2 py-2.5">
                      <Badge tone={m.tone}>{m.label}</Badge>
                      {o.status === "new" && o.web_status && <div className="mt-0.5 text-[11px] text-muted">web: {o.web_status.replace(/_/g, " ")}</div>}
                      {o.printed_at && <div className="mt-0.5 text-[11px] text-muted">printed</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      {o.courier_name ? (
                        <>
                          <div className="capitalize">{o.courier_name}</div>
                          <div className="num text-xs text-muted">{o.tracking_number ?? "—"}</div>
                        </>
                      ) : <span className="text-muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!list.isLoading && rows.length === 0 && <Empty title="এই filter-এ কোনো order নেই" sub="Status, তারিখ বা search বদলে দেখুন" />}
        </div>

        {total > PAGE && (
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted">
            <span className="num">{num(page * PAGE + 1)}–{num(Math.min(total, (page + 1) * PAGE))} / {num(total)}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => set({ page: String(page - 1) })}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="num px-2 py-1">{page + 1} / {pages}</span>
              <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => set({ page: String(page + 1) })}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </Card>

      <OrderDrawer orderId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
