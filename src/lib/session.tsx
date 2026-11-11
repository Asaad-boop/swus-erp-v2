import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase, type Enums, type Tables } from "@/lib/supabase";

type Role = Enums<"app_role">;
type Brand = Pick<Tables<"brands">, "id" | "name" | "slug" | "logo_url" | "is_active">;

type Ctx = {
  session: Session | null;
  loading: boolean;
  roles: Role[];
  isAdmin: boolean;
  isStaff: boolean;
  displayName: string;
  brands: Brand[];
  /** Brand ids currently in view. Empty array never happens once brands load. */
  activeBrandIds: string[];
  activeBrand: Brand | null; // null = "All brands"
  setActiveBrand: (id: string | null) => void;
  signOut: () => Promise<void>;
};

const SessionCtx = createContext<Ctx | null>(null);
const BRAND_KEY = "swus.v2.brand";
const STAFF_ROLES: Role[] = [
  "owner", "admin", "moderator", "customer_service", "operations", "packer", "accountant",
  "marketing_manager", "warehouse_staff", "hr_admin", "hr_manager", "employee",
];

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [brandId, setBrandId] = useState<string | null>(() => {
    try { return localStorage.getItem(BRAND_KEY); } catch { return null; }
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id;

  const rolesQ = useQuery({
    queryKey: ["me", "roles", uid],
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", uid!);
      if (error) throw error;
      return (data ?? []).map((r) => r.role);
    },
  });

  const profileQ = useQuery({
    queryKey: ["me", "profile", uid],
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("display_name, username, email").eq("id", uid!).maybeSingle();
      return data;
    },
  });

  const roles = rolesQ.data ?? [];
  const isAdmin = roles.includes("admin") || roles.includes("owner");
  const isStaff = roles.some((r) => STAFF_ROLES.includes(r));

  const brandsQ = useQuery({
    queryKey: ["me", "brands", uid, isAdmin],
    enabled: !!uid && rolesQ.isSuccess,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, name, slug, logo_url, is_active")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      const all = data ?? [];
      if (isAdmin) return all;
      // Non-admins: restrict to explicit brand grants when any exist.
      const { data: grants } = await supabase.from("user_brand_access").select("brand_id").eq("user_id", uid!);
      const allowed = new Set((grants ?? []).map((g) => g.brand_id));
      return allowed.size ? all.filter((b) => allowed.has(b.id)) : all;
    },
  });

  const brands = brandsQ.data ?? [];
  const activeBrand = brands.find((b) => b.id === brandId) ?? null;
  const activeBrandIds = activeBrand ? [activeBrand.id] : brands.map((b) => b.id);

  const setActiveBrand = useCallback((id: string | null) => {
    setBrandId(id);
    try {
      if (id) localStorage.setItem(BRAND_KEY, id);
      else localStorage.removeItem(BRAND_KEY);
    } catch { /* ignore */ }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      session,
      loading: loading || (!!uid && (rolesQ.isLoading || brandsQ.isLoading)),
      roles,
      isAdmin,
      isStaff,
      displayName:
        profileQ.data?.display_name || profileQ.data?.username || session?.user.email?.split("@")[0] || "User",
      brands,
      activeBrandIds,
      activeBrand,
      setActiveBrand,
      signOut,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, loading, uid, rolesQ.isLoading, brandsQ.isLoading, roles.join(","), brands, activeBrand?.id, profileQ.data],
  );

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession outside SessionProvider");
  return c;
}
