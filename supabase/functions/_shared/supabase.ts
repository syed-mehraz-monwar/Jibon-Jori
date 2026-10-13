// =============================================================================
// Supabase client helpers shared by the Edge Functions.
// =============================================================================
// Two clients, deliberately distinct:
//
//   callerClient(request)  - carries the CALLER's JWT, so every read and write
//                            goes through RLS exactly as it would from the app.
//                            Use it for anything touching user data.
//   serviceClient()        - the service role, which BYPASSES RLS. Only for the
//                            narrow operations that genuinely cannot be done by
//                            a client: deleting an auth user, reading
//                            auth.sessions, and writing the assistant turns of
//                            an AI transcript.
//
// Principle applied throughout: reach for the service client only when the
// operation is impossible without it, and never to read data the caller could
// not have read themselves.
// =============================================================================

import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured for this Edge Function`);
  return value;
}

export function callerClient(request: Request): SupabaseClient {
  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    throw new HttpError(401, "UNAUTHENTICATED", "An Authorization header is required.");
  }

  return createClient(required("SUPABASE_URL"), required("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function serviceClient(): SupabaseClient {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Resolves the caller from their JWT. The gateway verifies the signature; this
 * establishes *who* the caller is, which is what the admin checks need.
 */
export async function requireUser(request: Request): Promise<{ client: SupabaseClient; user: User }> {
  const client = callerClient(request);
  const { data, error } = await client.auth.getUser();

  if (error || !data.user) {
    throw new HttpError(401, "UNAUTHENTICATED", "The access token is missing or invalid.");
  }
  return { client, user: data.user };
}

/**
 * Resolves the caller and confirms they are an administrator.
 *
 * The `role` column is protected by a database trigger that only lets an admin
 * change it, so this read is authoritative: a member cannot have promoted
 * themselves. The check is still repeated here because the service client used
 * by some functions would otherwise be an admin bypass.
 */
export async function requireAdmin(request: Request): Promise<{ client: SupabaseClient; user: User }> {
  const { client, user } = await requireUser(request);

  const { data, error } = await client
    .from("profiles")
    .select("role, is_suspended, deleted_at")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new HttpError(500, "PROFILE_LOOKUP_FAILED", "The caller profile could not be read.");

  const isAdmin = data?.role === "admin" && !data.is_suspended && data.deleted_at === null;
  if (!isAdmin) throw new HttpError(403, "FORBIDDEN", "This operation is restricted to administrators.");

  return { client, user };
}
