import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Menu, Moon, Sun, X, ChevronDown, Check } from "lucide-react";
import { NAV } from "@/nav";
import { LIVE_LEAD_FILTER } from "@/lib/order-status";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      const s = localStorage.getItem("swus.v2.theme");
      return s ? s === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch { return false; }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("swus.v2.theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  }, [dark]);
  return [dark, setDark] as const;
}

function useNewOrderCount() {
  const { activeBrandIds } = useSession();
  return useQuery({
    queryKey: ["nav", "new-count", activeBrandIds],
    enabled: activeBrandIds.length > 0,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .in("brand_id", activeBrandIds)
        .eq("status", "new")
        .or(LIVE_LEAD_FILTER);
      return count ?? 0;
    },
  }).data;
}

function BrandSwitcher() {
  const { brands, activeBrand, setActiveBrand } = useSession();
  const [open, setOpen] = useState(false);
  if (brands.length === 0) return null;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2"
      >
        <span className={cn("h-2 w-2 rounded-full", activeBrand ? "bg-accent" : "bg-good")} />
        <span className="font-medium">{activeBrand?.name ?? "সব Brand"}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-52 rounded-lg border border-border bg-surface p-1 shadow-lg">
            {[{ id: null as string | null, name: "সব Brand" }, ...brands].map((b) => (
              <button
                key={b.id ?? "all"}
                onClick={() => { setActiveBrand(b.id); setOpen(false); }}
                className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-2"
              >
                {b.name}
                {(activeBrand?.id ?? null) === b.id && <Check className="h-3.5 w-3.5 text-accent" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const newCount = useNewOrderCount();
  const { displayName, roles, signOut } = useSession();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-[11px] font-bold text-accent-fg">SW</div>
        <div>
          <div className="text-sm font-semibold leading-tight">SWUS ERP</div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted">v2 · preview</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 scroll-thin">
        {NAV.map((sec) => (
          <div key={sec.label} className="mb-4">
            <div className="mb-1 px-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted/80">{sec.label}</div>
            {sec.items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.to === "/" || it.to === "/orders" || it.to === "/finance"}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "group flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors",
                    isActive ? "bg-accent-soft font-medium text-accent" : "text-fg/80 hover:bg-surface-2",
                  )
                }
              >
                <it.icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{it.label}</span>
                {it.badge === "orders-new" && !!newCount && (
                  <span className="num rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-fg">{newCount}</span>
                )}
                {!it.ready && <span className="h-1.5 w-1.5 rounded-full bg-border" title="শীঘ্রই আসছে" />}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex items-center gap-2 border-t border-border px-3 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold">
          {displayName.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{displayName}</div>
          <div className="truncate text-[11px] text-muted">{roles.join(", ") || "—"}</div>
        </div>
        <button onClick={signOut} title="Sign out" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function AppShell() {
  const [dark, setDark] = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setMobileOpen(false), [loc.pathname]);

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface md:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-64 bg-surface">
            <button className="absolute right-2 top-3 p-1.5" onClick={() => setMobileOpen(false)}><X className="h-4 w-4" /></button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur">
          <button className="rounded-md p-1.5 md:hidden" onClick={() => setMobileOpen(true)}><Menu className="h-5 w-5" /></button>
          <div className="flex-1" />
          <BrandSwitcher />
          <button onClick={() => setDark(!dark)} className="rounded-lg border border-border bg-surface p-2 hover:bg-surface-2" title="Theme">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto scroll-thin">
          <div className="mx-auto max-w-[1400px] px-4 py-5 md:px-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
