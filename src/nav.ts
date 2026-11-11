import {
  LayoutDashboard, ClipboardList, PlusCircle, Truck, RotateCcw, FileSpreadsheet, Package, PackageSearch,
  ClipboardCheck, Container, Users, Wallet, BookOpen, Megaphone, Heart, BarChart3, FileBarChart, UserCog,
  Settings, Clock, type LucideIcon,
} from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon; ready?: boolean; badge?: "orders-new" };
export type NavSection = { label: string; items: NavItem[] };

/**
 * Grouped by the job people are doing, not by database module.
 * `ready: true` = built in v2. Others show a "coming" page and a link
 * back to the same screen in the current ERP, so nobody is blocked.
 */
export const NAV: NavSection[] = [
  {
    label: "আজকের কাজ",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, ready: true },
      { to: "/orders", label: "Orders", icon: ClipboardList, ready: true, badge: "orders-new" },
      { to: "/orders/new", label: "নতুন Order", icon: PlusCircle, ready: true },
      { to: "/dispatch", label: "Dispatch", icon: Truck, ready: true },
    ],
  },
  {
    label: "Delivery ও টাকা",
    items: [
      { to: "/returns", label: "Returns", icon: RotateCcw, ready: true },
      { to: "/reconciliation", label: "COD Reconciliation", icon: FileSpreadsheet, ready: true },
      { to: "/finance", label: "Finance", icon: Wallet },
      { to: "/finance/journal", label: "Journal", icon: BookOpen },
    ],
  },
  {
    label: "Stock ও Supply",
    items: [
      { to: "/inventory", label: "Products & Stock", icon: Package, ready: true },
      { to: "/reorder", label: "Reorder", icon: PackageSearch },
      { to: "/stocktake", label: "Stocktake", icon: ClipboardCheck },
      { to: "/imports", label: "Imports & PO", icon: Container },
      { to: "/preorders", label: "Pre-orders", icon: Clock },
    ],
  },
  {
    label: "Growth",
    items: [
      { to: "/marketing", label: "Marketing", icon: Megaphone },
      { to: "/customers", label: "Customers", icon: Heart, ready: true },
      { to: "/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/reports", label: "Reports", icon: FileBarChart },
    ],
  },
  {
    label: "Team ও System",
    items: [
      { to: "/team", label: "HR & Team", icon: UserCog },
      { to: "/suppliers", label: "Suppliers", icon: Users },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

/** Where each v2 page lives in the current ERP, for the "open in current ERP" fallback. */
export const LEGACY_PATH: Record<string, string> = {
  "/returns": "/erp/returns",
  "/reconciliation": "/erp/reconciliation",
  "/finance": "/erp/finance",
  "/finance/journal": "/erp/finance/journal",
  "/reorder": "/erp/reorder-queue",
  "/stocktake": "/erp/stocktake",
  "/imports": "/erp/imports",
  "/preorders": "/erp/orders/pre-orders",
  "/marketing": "/erp/marketing",
  "/analytics": "/erp/analytics",
  "/reports": "/erp/reports",
  "/team": "/erp/hr",
  "/suppliers": "/erp/suppliers",
  "/settings": "/erp/settings",
};
