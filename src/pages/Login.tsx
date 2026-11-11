import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { Button, Input, Label } from "@/components/ui";

export default function Login() {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      // Same login as the current ERP: username or email.
      let email = id.trim();
      if (!email.includes("@")) {
        const { data, error } = await supabase.rpc("resolve_login_email", { p_identifier: email });
        if (error || !data) throw new Error("এই username পাওয়া যায়নি");
        email = data;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error("Username/email বা password ভুল");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-xs font-bold text-accent-fg">SW</div>
          <div>
            <div className="font-semibold">SWUS ERP</div>
            <div className="text-xs text-muted">HobbyShop · Toyora — v2 preview</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-surface p-5">
          <div>
            <Label>Username বা email</Label>
            <Input autoFocus value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" required />
          </div>
          <div>
            <Label>Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          {err && <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{err}</div>}
          <Button variant="primary" className="w-full" loading={busy} type="submit">Sign in</Button>
          <p className="text-center text-xs text-muted">পুরানো ERP-এর একই account দিয়ে login করুন।</p>
        </form>
      </div>
    </div>
  );
}
