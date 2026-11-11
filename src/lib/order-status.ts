import type { Enums } from "@/lib/supabase";

export type OrderStatus = Enums<"order_status">;
export type Tone = "neutral" | "accent" | "good" | "warn" | "bad" | "info";

type Meta = { label: string; tone: Tone; stage: Stage };

/**
 * The DB enum has 27 values (a 27→16 reduction is designed but deferred).
 * The UI groups them into a few pipeline stages so people see a clean flow
 * while every raw status is still shown exactly as stored.
 */
export type Stage = "intake" | "prepare" | "courier" | "done" | "returns" | "closed";

export const STAGES: { key: Stage; label: string }[] = [
  { key: "intake", label: "নতুন / Confirm" },
  { key: "prepare", label: "Packing" },
  { key: "courier", label: "Courier-এ" },
  { key: "done", label: "Delivered" },
  { key: "returns", label: "Return" },
  { key: "closed", label: "Cancel / Hold" },
];

export const STATUS: Record<OrderStatus, Meta> = {
  new: { label: "New", tone: "accent", stage: "intake" },
  incomplete: { label: "Incomplete", tone: "neutral", stage: "intake" },
  advance_payment_pending: { label: "Advance pending", tone: "warn", stage: "intake" },
  pre_order: { label: "Pre-order", tone: "info", stage: "intake" },
  confirmed: { label: "Confirmed", tone: "info", stage: "intake" },

  ready_to_pack: { label: "Ready to pack", tone: "info", stage: "prepare" },
  packaging: { label: "Packaging", tone: "info", stage: "prepare" },
  packed: { label: "Packed", tone: "info", stage: "prepare" },
  ready_to_ship: { label: "Ready to ship", tone: "info", stage: "prepare" },

  courier_entry: { label: "Courier entry", tone: "accent", stage: "courier" },
  shipped: { label: "Shipped", tone: "accent", stage: "courier" },
  in_transit: { label: "In transit", tone: "accent", stage: "courier" },

  delivered: { label: "Delivered", tone: "good", stage: "done" },
  partial_delivered: { label: "Partial delivered", tone: "good", stage: "done" },
  paid: { label: "Paid", tone: "good", stage: "done" },
  completed: { label: "Completed", tone: "good", stage: "done" },

  pending_return: { label: "Pending return", tone: "warn", stage: "returns" },
  return_in_transit: { label: "Return in transit", tone: "warn", stage: "returns" },
  returned: { label: "Returned", tone: "bad", stage: "returns" },
  partial_return: { label: "Partial return", tone: "warn", stage: "returns" },
  paid_return: { label: "Paid return", tone: "warn", stage: "returns" },
  unpaid_return: { label: "Unpaid return", tone: "bad", stage: "returns" },
  exchange: { label: "Exchange", tone: "warn", stage: "returns" },
  exchanged: { label: "Exchanged", tone: "warn", stage: "returns" },
  damaged: { label: "Damaged", tone: "bad", stage: "returns" },

  on_hold: { label: "On hold", tone: "warn", stage: "closed" },
  cancelled: { label: "Cancelled", tone: "bad", stage: "closed" },
  fake: { label: "Fake", tone: "bad", stage: "closed" },
};

export const ALL_STATUSES = Object.keys(STATUS) as OrderStatus[];

/**
 * Business outcome groups. NOTE: most delivered COD orders end as `paid`
 * (delivered + money received). The legacy dashboard RPC forgot `paid`,
 * which made delivery rate and COD-outstanding look badly wrong.
 */
export const GROUP = {
  delivered: ["delivered", "partial_delivered", "completed", "paid"] as OrderStatus[],
  returned: ["returned", "partial_return", "paid_return", "unpaid_return", "pending_return", "return_in_transit"] as OrderStatus[],
  withCourier: ["courier_entry", "shipped", "in_transit"] as OrderStatus[],
  cancelled: ["cancelled", "fake"] as OrderStatus[],
};

/**
 * Website/pixel leads sit in status `new` and are worked through
 * `web_status`. A `new` order whose web_status is cancelled/complete is a
 * dead or already-converted lead and must not show up as work to do.
 * This is a PostgREST `or` filter usable on any orders query.
 */
export const LIVE_LEAD_FILTER = "status.neq.new,web_status.is.null,web_status.not.in.(cancelled,complete)";

export function isLiveOrder(o: { status: string; web_status?: string | null }) {
  if (o.status === "fake" || o.status === "incomplete") return false;
  if (o.status === "new" && (o.web_status === "cancelled" || o.web_status === "complete")) return false;
  return true;
}

export function statusMeta(s: string | null | undefined): Meta {
  return (s && STATUS[s as OrderStatus]) || { label: s ?? "—", tone: "neutral", stage: "closed" };
}

export function statusesInStage(stage: Stage) {
  return ALL_STATUSES.filter((s) => STATUS[s].stage === stage);
}

/**
 * Suggested next moves for the order drawer. The DB function
 * `transition_order_status` is the source of truth and will reject an
 * illegal move — these are only the one-click shortcuts.
 */
export const NEXT_ACTIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  new: ["confirmed", "on_hold", "cancelled", "fake"],
  incomplete: ["new", "confirmed", "cancelled"],
  advance_payment_pending: ["confirmed", "cancelled"],
  pre_order: ["confirmed", "cancelled"],
  confirmed: ["ready_to_pack", "on_hold", "cancelled"],
  ready_to_pack: ["packed", "on_hold"],
  packaging: ["packed"],
  packed: ["ready_to_ship"],
  ready_to_ship: ["shipped"],
  courier_entry: ["shipped"],
  shipped: ["in_transit", "delivered", "pending_return"],
  in_transit: ["delivered", "partial_delivered", "pending_return"],
  pending_return: ["return_in_transit", "returned"],
  return_in_transit: ["returned"],
  on_hold: ["confirmed", "cancelled"],
};
