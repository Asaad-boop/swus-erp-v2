import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Minus, Plus, Search, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { cn, money, num } from "@/lib/utils";
import { Button, Card, CardHeader, Input, Label, PageHeader, Select, Textarea } from "@/components/ui";

type Variant = { id: string; color_name: string | null; sku: string | null; stock: number; reserved_stock: number; image: string | null; price_override: number | null; is_active: boolean };
type Product = {
  id: string; title: string; sku: string | null; image: string; price: number; stock: number; reserved_stock: number;
  shipping_fee_inside: number | null; shipping_fee_outside: number | null; product_variants: Variant[];
};
type Line = {
  key: string; product_id: string; variant_id: string | null; variant_label: string | null;
  name: string; image: string | null; unit_price: number; quantity: number; available: number;
};

const PRODUCT_SELECT =
  "id,title,sku,image,price,stock,reserved_stock,shipping_fee_inside,shipping_fee_outside,product_variants(id,color_name,sku,stock,reserved_stock,image,price_override,is_active)";

export default function OrderNew() {
  const { brands, activeBrand } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [brandId, setBrandId] = useState(activeBrand?.id ?? (brands.length === 1 ? brands[0].id : ""));
  useEffect(() => { if (activeBrand) setBrandId(activeBrand.id); }, [activeBrand]);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [altPhone, setAltPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [zone, setZone] = useState<"inside" | "outside">("outside");
  const [lines, setLines] = useState<Line[]>([]);
  const [shippingFee, setShippingFee] = useState<number>(0);
  const [feeTouched, setFeeTouched] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [advance, setAdvance] = useState(0);
  const [advanceSource, setAdvanceSource] = useState("bkash");
  const [advanceNumber, setAdvanceNumber] = useState("");
  const [advanceTxn, setAdvanceTxn] = useState("");
  const [courier, setCourier] = useState("pathao");
  const [sourcePlatform, setSourcePlatform] = useState("facebook");
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");

  const cleanPhone = phone.replace(/\D/g, "").replace(/^88/, "");
  const phoneValid = /^01[3-9]\d{8}$/.test(cleanPhone);

  // Past record as soon as the phone is typed — catches repeat returners before confirming.
  const record = useQuery({
    queryKey: ["new-order", "record", cleanPhone],
    enabled: phoneValid,
    queryFn: async () => {
      const tail = cleanPhone.slice(-10);
      const { data } = await supabase
        .from("orders")
        .select("status,shipping_name,shipping_address,pathao_city_name,shipping_city,created_at")
        .or(`shipping_phone.ilike.%${tail},guest_phone.ilike.%${tail}`)
        .order("created_at", { ascending: false })
        .limit(50);
      const rows = data ?? [];
      return {
        total: rows.length,
        delivered: rows.filter((r) => ["delivered", "partial_delivered", "completed", "paid"].includes(r.status)).length,
        bad: rows.filter((r) => ["returned", "partial_return", "unpaid_return", "cancelled", "fake"].includes(r.status)).length,
        last: rows[0],
      };
    },
  });

  // Prefill name/address from the customer's last order (only into empty fields).
  useEffect(() => {
    const l = record.data?.last;
    if (!l) return;
    if (!name && l.shipping_name) setName(l.shipping_name);
    if (!address && l.shipping_address) setAddress(l.shipping_address);
    if (!city && (l.pathao_city_name || l.shipping_city)) setCity(l.pathao_city_name || l.shipping_city || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.data?.last]);

  useEffect(() => {
    if (/dhaka|ঢাকা/i.test(city)) setZone("inside");
  }, [city]);

  const products = useQuery({
    queryKey: ["new-order", "products", brandId, q],
    enabled: !!brandId,
    queryFn: async () => {
      const s = q.replace(/[%,()]/g, "").trim();
      const own = supabase.from("products").select(PRODUCT_SELECT).eq("is_active", true).eq("brand_id", brandId).limit(30);
      const listed = supabase.from("product_brand_listings").select(`price, products!inner(${PRODUCT_SELECT})`).eq("brand_id", brandId).eq("is_active", true).limit(30);
      const [a, b] = await Promise.all([
        s ? own.or(`title.ilike.%${s}%,sku.ilike.%${s}%`) : own.order("updated_at", { ascending: false }),
        s ? listed.or(`title.ilike.%${s}%,sku.ilike.%${s}%`, { referencedTable: "products" }) : listed,
      ]);
      const map = new Map<string, Product>();
      for (const p of (a.data ?? []) as unknown as Product[]) map.set(p.id, p);
      for (const r of (b.data ?? []) as unknown as { price: number | null; products: Product }[]) {
        if (!map.has(r.products.id)) map.set(r.products.id, { ...r.products, price: r.price ?? r.products.price });
      }
      return [...map.values()].slice(0, 30);
    },
  });

  function addProduct(p: Product, v?: Variant) {
    const key = `${p.id}:${v?.id ?? ""}`;
    setLines((prev) => {
      const i = prev.findIndex((l) => l.key === key);
      if (i >= 0) {
        const n = [...prev];
        n[i] = { ...n[i], quantity: n[i].quantity + 1 };
        return n;
      }
      return [
        ...prev,
        {
          key,
          product_id: p.id,
          variant_id: v?.id ?? null,
          variant_label: v ? [v.color_name, v.sku].filter(Boolean).join(" · ") : null,
          name: p.title,
          image: v?.image || p.image || null,
          unit_price: Number(v?.price_override ?? p.price),
          quantity: 1,
          available: v ? v.stock - v.reserved_stock : p.stock - p.reserved_stock,
        },
      ];
    });
  }

  const productFees = useMemo(() => {
    const ps = (products.data ?? []).filter((p) => lines.some((l) => l.product_id === p.id));
    const pick = (k: "shipping_fee_inside" | "shipping_fee_outside") =>
      ps.reduce((m, p) => Math.max(m, Number(p[k] ?? 0)), 0);
    return { inside: pick("shipping_fee_inside"), outside: pick("shipping_fee_outside") };
  }, [products.data, lines]);

  useEffect(() => {
    if (feeTouched) return;
    const f = zone === "inside" ? productFees.inside : productFees.outside;
    if (f) setShippingFee(f);
  }, [zone, productFees, feeTouched]);

  const subtotal = lines.reduce((s, l) => s + l.unit_price * l.quantity, 0);
  const total = Math.max(0, subtotal + Number(shippingFee || 0) - Number(discount || 0));
  const cod = Math.max(0, total - Number(advance || 0));
  const pieces = lines.reduce((s, l) => s + l.quantity, 0);

  const problems: string[] = [];
  if (!brandId) problems.push("Brand বেছে নিন");
  if (!name.trim()) problems.push("নাম দিন");
  if (!phoneValid) problems.push("সঠিক mobile number দিন (01XXXXXXXXX)");
  if (address.trim().length < 6) problems.push("পুরো address দিন");
  if (lines.length === 0) problems.push("অন্তত ১টা product যোগ করুন");
  if (advance > 0 && advanceNumber.replace(/\D/g, "").length < 4) problems.push("Advance number দিন");
  if (advance > total) problems.push("Advance total-এর বেশি হতে পারে না");

  const create = useMutation({
    mutationFn: async () => {
      if (problems.length) throw new Error(problems[0]);
      const { data: u } = await supabase.auth.getUser();
      const now = new Date().toISOString();
      // Same insert shape as the current ERP so every DB trigger
      // (stock reservation, Telegram notify, finance) behaves identically.
      const { data: order, error } = await supabase
        .from("orders")
        .insert({
          brand_id: brandId,
          status: "confirmed",
          confirmation_status: "confirmed",
          confirmed_by: u.user?.id ?? null,
          confirmed_at: now,
          source: "manual",
          source_platform: sourcePlatform || null,
          is_guest_order: true,
          guest_name: name.trim(),
          guest_phone: cleanPhone,
          shipping_name: name.trim(),
          shipping_phone: cleanPhone,
          alternate_phone: altPhone.trim() || null,
          shipping_address: address.trim(),
          shipping_city: city.trim() || null,
          payment_method: "COD",
          subtotal,
          shipping_fee: Number(shippingFee || 0),
          discount_amount: Number(discount || 0),
          advance_amount: Number(advance || 0),
          advance_source: advance > 0 ? advanceSource : null,
          advance_payment_number: advance > 0 ? advanceNumber.trim() : null,
          advance_txn_id: advance > 0 && advanceTxn.trim() ? advanceTxn.trim() : null,
          total,
          shipping_note: note.trim() || null,
          is_preorder: false,
          courier_name: courier === "manual" ? null : courier,
        })
        .select("id, invoice_no")
        .single();
      if (error) throw error;

      const { error: itemErr } = await supabase.from("order_items").insert(
        lines.map((l) => ({
          order_id: order.id,
          product_id: l.product_id,
          name: l.name,
          image: l.image,
          price: l.unit_price,
          unit_price: l.unit_price,
          quantity: l.quantity,
          line_total: l.unit_price * l.quantity,
          variant_id: l.variant_id,
          variant_label: l.variant_label,
        })),
      );
      if (itemErr) {
        // Don't leave an empty order behind.
        await supabase.rpc("transition_order_status", { _order_id: order.id, _new_status: "cancelled", _reason: "v2: item save failed" });
        throw new Error(`Items save হয়নি, order cancel করা হয়েছে: ${itemErr.message}`);
      }
      return order;
    },
    onSuccess: (o) => {
      toast.success(`Order তৈরি হয়েছে · ${o.invoice_no ?? ""}`);
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["dash"] });
      navigate(`/orders?stage=intake&status=confirmed&open=${o.id}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Order তৈরি হয়নি"),
  });

  return (
    <div className="pb-28">
      <PageHeader
        title={<span className="flex items-center gap-2"><Link to="/orders" className="rounded-md p-1 hover:bg-surface-2"><ArrowLeft className="h-4 w-4" /></Link>নতুন Order</span>}
        sub="Phone দিলেই customer-এর আগের record আর address চলে আসবে"
        actions={
          brands.length > 1 && (
            <Select value={brandId} onChange={(e) => { setBrandId(e.target.value); setLines([]); }} className="w-48">
              <option value="">Brand বেছে নিন *</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardHeader title="Customer" />
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <div>
                <Label>Mobile *</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" inputMode="tel" autoFocus className="num" />
                {phoneValid && record.data && (
                  <div className={cn("mt-1.5 rounded-md px-2 py-1 text-xs", record.data.bad > record.data.delivered ? "bg-bad-soft text-bad" : record.data.total ? "bg-good-soft text-good" : "bg-surface-2 text-muted")}>
                    {record.data.total === 0
                      ? "নতুন customer"
                      : `আগে ${record.data.total}টা order · ${record.data.delivered} delivered · ${record.data.bad} return/cancel`}
                  </div>
                )}
              </div>
              <div><Label>নাম *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="sm:col-span-2"><Label>Address *</Label><Textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="বাসা, রোড, এলাকা, থানা" /></div>
              <div><Label>City / District</Label><Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Dhaka, Cumilla…" /></div>
              <div><Label>Alternate phone</Label><Input value={altPhone} onChange={(e) => setAltPhone(e.target.value)} className="num" /></div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Products" sub={brandId ? "নাম বা SKU দিয়ে খুঁজুন" : "আগে brand বেছে নিন"} />
            <div className="p-4">
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product খুঁজুন…" className="pl-9" disabled={!brandId} />
              </div>
              <div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2 scroll-thin">
                {(products.data ?? []).map((p) => {
                  const vs = (p.product_variants ?? []).filter((v) => v.is_active);
                  const avail = p.stock - p.reserved_stock;
                  return (
                    <div key={p.id} className="rounded-lg border border-border p-2">
                      <button className="flex w-full items-center gap-2.5 text-left" onClick={() => !vs.length && addProduct(p)} disabled={vs.length > 0}>
                        {p.image ? <img src={p.image} alt="" className="h-10 w-10 rounded-md object-cover" loading="lazy" /> : <div className="h-10 w-10 rounded-md bg-surface-2" />}
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-1 text-sm">{p.title}</div>
                          <div className="num text-xs text-muted">{money(p.price)} · <span className={cn(avail <= 0 && "text-bad")}>stock {num(avail)}</span></div>
                        </div>
                        {!vs.length && <Plus className="h-4 w-4 text-accent" />}
                      </button>
                      {vs.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {vs.map((v) => (
                            <button
                              key={v.id}
                              onClick={() => addProduct(p, v)}
                              className={cn("rounded-md border border-border px-2 py-0.5 text-xs hover:border-accent hover:text-accent", v.stock - v.reserved_stock <= 0 && "opacity-50")}
                              title={`stock ${v.stock - v.reserved_stock}`}
                            >
                              {v.color_name ?? v.sku ?? "Variant"}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {brandId && products.data?.length === 0 && <div className="py-6 text-center text-sm text-muted sm:col-span-2">কিছু পাওয়া যায়নি</div>}
              </div>
            </div>

            {lines.length > 0 && (
              <div className="border-t border-border">
                {lines.map((l, i) => (
                  <div key={l.key} className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-0">
                    {l.image ? <img src={l.image} alt="" className="h-10 w-10 rounded-md object-cover" /> : <div className="h-10 w-10 rounded-md bg-surface-2" />}
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-1 text-sm">{l.name}</div>
                      <div className="text-xs text-muted">
                        {l.variant_label && <>{l.variant_label} · </>}
                        <span className={cn(l.quantity > l.available && "font-medium text-bad")}>stock {num(l.available)}</span>
                      </div>
                    </div>
                    <div className="flex items-center rounded-lg border border-border">
                      <button className="p-1.5" onClick={() => setLines((p) => p.map((x, j) => j === i ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))}><Minus className="h-3.5 w-3.5" /></button>
                      <span className="num w-7 text-center text-sm">{l.quantity}</span>
                      <button className="p-1.5" onClick={() => setLines((p) => p.map((x, j) => j === i ? { ...x, quantity: x.quantity + 1 } : x))}><Plus className="h-3.5 w-3.5" /></button>
                    </div>
                    <Input
                      type="number" min={0} value={l.unit_price}
                      onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, unit_price: Number(e.target.value) } : x))}
                      className="num h-8 w-24 text-right"
                    />
                    <button className="rounded-md p-1.5 text-muted hover:text-bad" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Delivery ও Payment" />
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2">
                {(["inside", "outside"] as const).map((z) => (
                  <button
                    key={z}
                    onClick={() => { setZone(z); setFeeTouched(false); }}
                    className={cn("rounded-lg border px-3 py-2 text-sm", zone === z ? "border-accent bg-accent-soft text-accent" : "border-border")}
                  >
                    {z === "inside" ? "ঢাকার ভিতরে" : "ঢাকার বাইরে"}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Delivery charge</Label><Input type="number" min={0} value={shippingFee} onChange={(e) => { setFeeTouched(true); setShippingFee(Number(e.target.value)); }} className="num" /></div>
                <div><Label>Discount</Label><Input type="number" min={0} value={discount || ""} onChange={(e) => setDiscount(Number(e.target.value))} className="num" /></div>
                <div>
                  <Label>Courier</Label>
                  <Select value={courier} onChange={(e) => setCourier(e.target.value)}>
                    <option value="pathao">Pathao</option>
                    <option value="steadfast">Steadfast</option>
                    <option value="manual">Manual / Hand delivery</option>
                  </Select>
                </div>
                <div>
                  <Label>Order এসেছে</Label>
                  <Select value={sourcePlatform} onChange={(e) => setSourcePlatform(e.target.value)}>
                    <option value="facebook">Facebook</option>
                    <option value="instagram">Instagram</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="phone">Phone call</option>
                    <option value="website">Website</option>
                    <option value="other">Other</option>
                  </Select>
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <Label>Advance (যদি নিয়ে থাকেন)</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input type="number" min={0} value={advance || ""} onChange={(e) => setAdvance(Number(e.target.value))} placeholder="৳0" className="num" />
                  <Select value={advanceSource} onChange={(e) => setAdvanceSource(e.target.value)} disabled={!advance}>
                    <option value="bkash">bKash</option>
                    <option value="nagad">Nagad</option>
                    <option value="rocket">Rocket</option>
                    <option value="bank">Bank</option>
                    <option value="cash">Cash</option>
                  </Select>
                  {advance > 0 && (
                    <>
                      <Input value={advanceNumber} onChange={(e) => setAdvanceNumber(e.target.value)} placeholder="যে number থেকে এসেছে" className="num" />
                      <Input value={advanceTxn} onChange={(e) => setAdvanceTxn(e.target.value)} placeholder="TrxID" className="num" />
                    </>
                  )}
                </div>
              </div>
              <div><Label>Delivery note</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="যেমন: বিকেলে দিবেন" className="min-h-14" /></div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted">Products ({pieces} pcs)</span><span className="num">{money(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Delivery</span><span className="num">{money(shippingFee)}</span></div>
              {discount > 0 && <div className="flex justify-between"><span className="text-muted">Discount</span><span className="num">− {money(discount)}</span></div>}
              <div className="flex justify-between border-t border-border pt-1.5 font-semibold"><span>Total</span><span className="num">{money(total)}</span></div>
              {advance > 0 && <div className="flex justify-between text-good"><span>Advance</span><span className="num">− {money(advance)}</span></div>}
              <div className="flex justify-between text-base font-semibold text-accent"><span>COD</span><span className="num">{money(cod)}</span></div>
            </div>
          </Card>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur md:left-60">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div className="text-sm text-muted">{problems.length ? `⚠ ${problems[0]}` : <>সব ঠিক আছে · COD <span className="num font-semibold text-fg">{money(cod)}</span></>}</div>
          <Button variant="primary" size="md" loading={create.isPending} disabled={problems.length > 0} onClick={() => create.mutate()}>
            Order confirm করুন
          </Button>
        </div>
      </div>
    </div>
  );
}
