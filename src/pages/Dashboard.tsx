import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowRight, PackageOpen } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { fetchAll, getDashboardSummary } from "@/lib/queries";
import { addDays, cn, dhakaDay, dhakaEndISO, dhakaStartISO, money, num, pct } from "@/lib/utils";
import { GROUP, LIVE_LEAD_FILTER, isLiveOrder, statusMeta } from "@/lib/order-status";
import { Badge, Card, CardHeader, Empty, ErrorBox, PageHeader, Skeleton, Stat } from "@/components/ui";

const RANGES = [
  { key: "today", label: "আজ", days: 1 },
  { key: "7d", label: "৭ দিন", days: 7 },
  { key: "30d", label: "৩০ দিন", days: 30 },
  { key: "90d", label: "৯০ দিন", days: 90 },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

export default function Dashboard() {
  const { activeBrandIds, activeBrand, displayName } = useSession();
  const [range, setRange] = useState<RangeKey>("30d");
  const days = RANGES.find((r) => r.key === range)!.days;
  const today = dhakaDay();
  const fromDay = addDays(today, -(days - 1));
  const fromISO = dhakaStartISO(fromDay);
  const toISO = dhakaEndISO(today);

  const summary = useQuery({
    queryKey: ["dash", "summary", activeBrandIds, fromISO],
    enabled: activeBrandIds.length > 0,
    queryFn: () => getDashboardSummary(activeBrandIds, fromISO, toISO),
  });

  // All orders in the window, bucketed in Dhaka time and grouped with the
  // correct outcome groups (the legacy RPC counted `paid` as not delivered).
  const rowsQ = useQuery({
    queryKey: ["dash", "rows", activeBrandIds, fromISO],
    enabled: activeBrandIds.length > 0,
    queryFn: () =>
      fetchAll<{ created_at: string; total: number; advance_amount: number; status: string; web_status: string | null; courier_name: string | null }>((a, b) =>
        supabase
          .from("orders")
          .select("created_at,total,advance_amount,status,web_status,courier_name")
          .in("brand_id", activeBrandIds)
          .gte("created_at", fromISO)
          .lt("created_at", toISO)
          .order("created_at")
          .range(a, b),
      ),
  });

  const calc = useMemo(() => {
    if (!rowsQ.data) return null;
    const live = rowsQ.data.filter(isLiveOrder);
    const inG = (st: string, g: keyof typeof GROUP) => (GROUP[g] as string[]).includes(st);
    const sum = (xs: typeof live, f: (o: (typeof live)[number]) => number) => xs.reduce((a, o) => a + f(o), 0);
    const delivered = live.filter((o) => inG(o.status, "delivered"));
    const returned = live.filter((o) => inG(o.status, "returned"));
    const cancelled = live.filter((o) => inG(o.status, "cancelled"));
    const courier = live.filter((o) => inG(o.status, "withCourier"));
    const settled = delivered.length + returned.length;

    const byDay = new Map<string, { d: string; label: string; orders: number; value: number }>();
    for (let i = 0; i < days; i++) {
      const d = addDays(fromDay, i);
      byDay.set(d, { d, label: d.slice(5), orders: 0, value: 0 });
    }
    const byStatus = new Map<string, number>();
    const byCourier = new Map<string, { courier: string; orders: number; delivered: number; returned: number }>();
    for (const o of live) {
      const m = byDay.get(dhakaDay(new Date(o.created_at)));
      if (m) { m.orders++; m.value += Number(o.total) || 0; }
      byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
      if (o.courier_name) {
        const c = byCourier.get(o.courier_name) ?? { courier: o.courier_name, orders: 0, delivered: 0, returned: 0 };
        c.orders++;
        if (inG(o.status, "delivered")) c.delivered++;
        if (inG(o.status, "returned")) c.returned++;
        byCourier.set(o.courier_name, c);
      }
    }
    return {
      total: live.length,
      totalValue: sum(live, (o) => Number(o.total) || 0),
      delivered: delivered.length,
      deliveredValue: sum(delivered, (o) => Number(o.total) || 0),
      returned: returned.length,
      cancelled: cancelled.length,
      deliveryRate: settled ? (delivered.length / settled) * 100 : null,
      withCourier: courier.length,
      codWithCourier: sum(courier, (o) => Math.max(0, Number(o.total) - Number(o.advance_amount || 0))),
      avg: live.length ? sum(live, (o) => Number(o.total) || 0) / live.length : 0,
      daily: [...byDay.values()],
      statuses: [...byStatus.entries()].map(([status, orders]) => ({ status, orders })).sort((a, b) => b.orders - a.orders),
      couriers: [...byCourier.values()].sort((a, b) => b.orders - a.orders),
    };
  }, [rowsQ.data, days, fromDay]);

  // Work waiting right now (not date-filtered).
  const queue = useQuery({
    queryKey: ["dash", "queue", activeBrandIds],
    enabled: activeBrandIds.length > 0,
    refetchInterval: 60_000,
    queryFn: async () => {
      const count = async (statuses: string[]) => {
        const { count, error } = await supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .in("brand_id", activeBrandIds)
          .in("status", statuses as never);
        if (error) throw error;
        return count ?? 0;
      };
      const [fresh, confirmed, packed, hold, lowStock] = await Promise.all([
        supabase.from("orders").select("id", { count: "exact", head: true }).in("brand_id", activeBrandIds).eq("status", "new").or(LIVE_LEAD_FILTER).then((r) => r.count ?? 0),
        count(["confirmed", "ready_to_pack"]),
        count(["packed", "ready_to_ship"]),
        count(["on_hold", "advance_payment_pending"]),
        supabase
          .from("products")
          .select("id,stock,low_stock_threshold")
          .in("brand_id", activeBrandIds)
          .eq("is_active", true)
          .then(({ data }) => (data ?? []).filter((p) => p.stock <= (p.low_stock_threshold ?? 0)).length),
      ]);
      return { fresh, confirmed, packed, hold, lowStock };
    },
  });

  const k = calc;

  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Dhaka" }).format(new Date()));
  const greet = hour < 12 ? "শুভ সকাল" : hour < 17 ? "শুভ দুপুর" : "শুভ সন্ধ্যা";

  return (
    <div>
      <PageHeader
        title={`${greet}, ${displayName}`}
        sub={`${activeBrand?.name ?? "সব Brand"} · ${fromDay === today ? "আজ" : `${fromDay} থেকে আজ`}`}
        actions={
          <div className="flex rounded-lg border border-border bg-surface p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  range === r.key ? "bg-accent text-accent-fg" : "text-muted hover:text-fg",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {/* Work queue */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <QueueCard to="/orders?stage=intake&status=new" label="Confirm করতে হবে" value={queue.data?.fresh} urgent />
        <QueueCard to="/orders?stage=intake&status=confirmed" label="Pack করতে হবে" value={queue.data?.confirmed} />
        <QueueCard to="/dispatch" label="Courier-এ দিতে হবে" value={queue.data?.packed} />
        <QueueCard to="/orders?stage=closed&status=on_hold" label="Hold / Advance" value={queue.data?.hold} />
        <QueueCard to="/inventory?filter=low" label="Low stock product" value={queue.data?.lowStock} warn />
      </div>

      {(summary.error || rowsQ.error) && <ErrorBox error={summary.error || rowsQ.error} />}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {k ? (
          <>
            <Stat label="মোট Order" value={num(k.total)} hint={`${money(k.totalValue)} · avg ${money(k.avg)}`} />
            <Stat label="Delivered (paid সহ)" value={num(k.delivered)} hint={money(k.deliveredValue)} tone="good" />
            <Stat
              label="Delivery rate"
              value={pct(k.deliveryRate)}
              hint={`${num(k.returned)} return · ${num(k.cancelled)} cancel`}
              tone={k.deliveryRate != null && k.deliveryRate < 75 ? "warn" : "neutral"}
            />
            <Stat label="Courier-এর হাতে COD" value={money(k.codWithCourier)} hint={`${num(k.withCourier)}টা order রাস্তায়`} />
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[86px]" />)
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="প্রতিদিনের Order" sub="Dhaka সময় অনুযায়ী দিন ধরা · fake, incomplete আর মৃত web lead বাদে" />
          <div className="h-64 px-2 py-3">
            {days === 1 ? (
              <Empty title="আজকের জন্য daily chart দরকার নেই" sub="৭/৩০/৯০ দিন বেছে নিন" />
            ) : calc ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={calc.daily} margin={{ left: -18, right: 8 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: "var(--surface-2)" }}
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    formatter={(v, name) => [name === "orders" ? num(Number(v)) : money(Number(v)), name === "orders" ? "Orders" : "Value"]}
                    labelFormatter={(l) => `তারিখ ${l}`}
                  />
                  <Bar dataKey="orders" fill="var(--accent)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton className="h-full" />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Status অনুযায়ী" />
          <div className="max-h-64 overflow-y-auto px-4 py-2 scroll-thin">
            {calc?.statuses.length ? (
              calc.statuses
                .map((s) => {
                  const m = statusMeta(s.status);
                  return (
                    <Link
                      key={s.status}
                      to={`/orders?status=${s.status}`}
                      className="flex items-center justify-between border-b border-border/60 py-1.5 text-sm last:border-0 hover:text-accent"
                    >
                      <Badge tone={m.tone}>{m.label}</Badge>
                      <span className="num text-muted">{num(s.orders)}</span>
                    </Link>
                  );
                })
            ) : rowsQ.isLoading ? (
              <Skeleton className="h-40" />
            ) : (
              <Empty title="কোনো order নেই" />
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Top products" sub="এই সময়ে সবচেয়ে বেশি বিক্রি (qty)" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-2 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {(summary.data?.products ?? []).slice(0, 8).map((p) => (
                  <tr key={p.name} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2.5">
                        {p.image ? (
                          <img src={p.image} alt="" className="h-8 w-8 rounded-md border border-border object-cover" loading="lazy" />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-2"><PackageOpen className="h-4 w-4 text-muted" /></div>
                        )}
                        <span className="line-clamp-1">{p.name}</span>
                      </div>
                    </td>
                    <td className="num px-2 py-2 text-right">{num(p.qty)}</td>
                    <td className="num px-4 py-2 text-right">{money(p.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {summary.data && !summary.data.products?.length && <Empty title="কোনো বিক্রি নেই" />}
          </div>
        </Card>

        <Card>
          <CardHeader title="Courier performance" sub="Delivered বনাম returned" />
          <div className="space-y-3 px-4 py-3">
            {(calc?.couriers ?? []).map((c) => {
              const settled = c.delivered + c.returned;
              const rate = settled ? (c.delivered / settled) * 100 : 0;
              return (
                <div key={c.courier}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="capitalize">{c.courier}</span>
                    <span className="num text-muted">{num(c.orders)} · {pct(settled ? rate : null, 0)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className={cn("h-full rounded-full", rate >= 80 ? "bg-good" : rate >= 65 ? "bg-warn" : "bg-bad")} style={{ width: `${rate}%` }} />
                  </div>
                </div>
              );
            })}
            {calc && calc.couriers.length === 0 && <Empty title="এখনো courier data নেই" />}
          </div>
        </Card>
      </div>
    </div>
  );
}

function QueueCard({ to, label, value, urgent, warn }: { to: string; label: string; value?: number; urgent?: boolean; warn?: boolean }) {
  const hot = !!value && (urgent || warn);
  return (
    <Link
      to={to}
      className={cn(
        "group flex items-center justify-between rounded-xl border px-4 py-3 transition-colors",
        hot ? (urgent ? "border-accent/40 bg-accent-soft" : "border-warn/40 bg-warn-soft") : "border-border bg-surface hover:bg-surface-2",
      )}
    >
      <div>
        <div className="flex items-center gap-1 text-xs text-muted">
          {warn && !!value && <AlertTriangle className="h-3 w-3 text-warn" />}
          {label}
        </div>
        <div className="num mt-0.5 text-2xl font-semibold">{value ?? "·"}</div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
