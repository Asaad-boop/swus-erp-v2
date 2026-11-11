import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const bdt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** ৳ formatting with Indian/BD digit grouping (1,23,456). */
export function money(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return `৳${bdt.format(Math.round(n))}`;
}

export function num(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return bdt.format(n);
}

export function pct(n: number | null | undefined, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

/* ── Dhaka time ────────────────────────────────────────────────
 * The business runs on Asia/Dhaka (UTC+6, no DST). Every "day"
 * boundary in this app is computed in Dhaka time, never UTC — the
 * old ERP had a bug where ~11% of items landed on the wrong day.
 */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

/** YYYY-MM-DD for the Dhaka calendar day containing `d`. */
export function dhakaDay(d: Date = new Date()) {
  return new Date(d.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

/** ISO timestamp for 00:00 Dhaka on the given YYYY-MM-DD. */
export function dhakaStartISO(day: string) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - DHAKA_OFFSET_MS).toISOString();
}

/** ISO timestamp for 00:00 Dhaka on the day AFTER the given YYYY-MM-DD (exclusive end). */
export function dhakaEndISO(day: string) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - DHAKA_OFFSET_MS + 86_400_000).toISOString();
}

export function addDays(day: string, n: number) {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

const dtFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dhaka",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});
const dFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dhaka",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function dateTime(iso: string | null | undefined) {
  return iso ? dtFmt.format(new Date(iso)) : "—";
}
export function date(iso: string | null | undefined) {
  return iso ? dFmt.format(new Date(iso)) : "—";
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "এইমাত্র";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} মি আগে`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ঘণ্টা আগে`;
  const d = Math.round(h / 24);
  return `${d} দিন আগে`;
}

export function titleCase(s: string | null | undefined) {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
