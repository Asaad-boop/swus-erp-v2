import { useLocation } from "react-router-dom";
import { ExternalLink, Hammer } from "lucide-react";
import { LEGACY_PATH, NAV } from "@/nav";
import { Card } from "@/components/ui";

const LEGACY_BASE = (import.meta.env.VITE_LEGACY_ERP_URL as string | undefined) ??
  "https://id-preview--ed6f058b-a815-45d2-bb71-e1fc12a02390.lovable.app";

export default function ComingSoon() {
  const { pathname } = useLocation();
  const item = NAV.flatMap((s) => s.items).find((i) => i.to === pathname);
  const legacy = LEGACY_PATH[pathname];
  return (
    <Card className="mx-auto mt-10 max-w-lg p-8 text-center">
      <Hammer className="mx-auto mb-3 h-8 w-8 text-muted" />
      <h1 className="text-lg font-semibold">{item?.label ?? "এই page"} — v2-তে এখনো বানানো হচ্ছে</h1>
      <p className="mt-2 text-sm text-muted">
        ততক্ষণ পুরানো ERP-তে কাজ চালিয়ে যান। Data একই, তাই সেখানে যা করবেন এখানেও দেখা যাবে।
      </p>
      {legacy && (
        <a
          href={`${LEGACY_BASE}${legacy}`}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium hover:bg-surface-2"
        >
          পুরানো ERP-তে খুলুন <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </Card>
  );
}
