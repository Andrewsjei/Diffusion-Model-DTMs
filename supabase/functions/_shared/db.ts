import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// SUPABASE_URL and a full-access key are injected automatically into
// every Edge Function's environment by Supabase — nothing to configure.
// Newer projects issue "secret" keys instead of the legacy
// "service_role" JWT; Supabase's own env var naming for this has moved
// around, so this checks both rather than assuming one. This client
// bypasses RLS, which is why it must never be used anywhere except
// inside these server-side functions.
export function serviceClient() {
  const key =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY") ??
    Deno.env.get("SB_SECRET_KEY");
  if (!key) throw new Error("No service-role/secret key found in the function environment.");
  return createClient(Deno.env.get("SUPABASE_URL")!, key);
}

// Verifies the bearer token from an admin request and checks it against
// admin_users. Returns the user id on success, or null if the request
// should be rejected.
export async function requireAdmin(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const db = serviceClient();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: allowed } = await db
    .from("admin_users")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();

  return allowed ? data.user.id : null;
}
