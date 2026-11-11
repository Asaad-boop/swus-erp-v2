import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import "./index.css";
import { SessionProvider, useSession } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import Login from "@/pages/Login";
import ComingSoon from "@/pages/ComingSoon";
import { Skeleton } from "@/components/ui";

const Dashboard = lazy(() => import("@/pages/Dashboard"));
const OrderList = lazy(() => import("@/pages/orders/OrderList"));
const OrderNew = lazy(() => import("@/pages/orders/OrderNew"));
const Dispatch = lazy(() => import("@/pages/orders/Dispatch"));
const Inventory = lazy(() => import("@/pages/Inventory"));
const Customers = lazy(() => import("@/pages/Customers"));
const Returns = lazy(() => import("@/pages/Returns"));
const Reconciliation = lazy(() => import("@/pages/Reconciliation"));

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 } },
});

// Apply saved theme before first paint.
try {
  const t = localStorage.getItem("swus.v2.theme");
  const dark = t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", dark);
} catch { /* ignore */ }

function Gate() {
  const { session, loading, isStaff } = useSession();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="h-6 w-40" />
      </div>
    );
  }
  if (!session) return <Login />;
  if (!isStaff) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
        এই account-এর ERP access নেই। Admin-কে role দিতে বলুন।
      </div>
    );
  }
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-8 w-60" /></div>}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="orders" element={<OrderList />} />
          <Route path="orders/new" element={<OrderNew />} />
          <Route path="dispatch" element={<Dispatch />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="customers" element={<Customers />} />
          <Route path="returns" element={<Returns />} />
          <Route path="reconciliation" element={<Reconciliation />} />
          <Route path="login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<ComingSoon />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <SessionProvider>
          <Gate />
          <Toaster position="bottom-right" richColors />
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
