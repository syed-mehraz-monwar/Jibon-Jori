// =============================================================================
// account-delete - closes the caller's own account.
// =============================================================================
// Contract: POST {} -> { closed: true }
//
// CLOSURE IS SOFT, and that is deliberate (archived spec B-72). A hard DELETE of
// the auth user is the wrong shape here: profiles, interactions, ratings and
// comments are referenced by other members' data, so removing the row either
// cascades destructively or fails on a foreign key. The account is instead
// *closed*: `profiles.deleted_at` is stamped, which is exactly the state
// `is_active_member()` and `account_state() = 'deleted'` already test for, so
// every policy stops matching the member at once.
//
// Revoking sessions is what makes closure effective immediately rather than at
// token expiry: a token minted before closure can no longer be refreshed or
// resolved once its session row is gone. Closure and revocation happen in ONE
// transaction, so a token cannot slip through a window between them.
//
// The operation is idempotent: closing an already-closed account is not an error.
//
// The caller can only ever close themselves: the id comes from the verified JWT,
// never from the request body.
// =============================================================================

import postgres from "npm:postgres@3";
import { handler, HttpError, json } from "../_shared/http.ts";
import { requireUser, serviceClient } from "../_shared/supabase.ts";

function databaseUrl(): string {
  const url = Deno.env.get("SUPABASE_DB_URL");
  if (!url) throw new HttpError(503, "DATABASE_NOT_CONFIGURED", "Account closure is not configured on this deployment.");
  return url;
}

Deno.serve(
  handler(async (request) => {
    if (request.method !== "POST") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint.");
    }

    const { user } = await requireUser(request);

    // Audit before the change, with the service client. `actor_user_id` stays
    // populated because the auth user is never removed under soft closure.
    const service = serviceClient();
    const { error: auditError } = await service.from("audit_logs").insert({
      actor_user_id: user.id,
      action: "account.close",
      target: user.id,
      meta: { email: user.email ?? null },
    });
    if (auditError) {
      console.error(`account-delete: audit insert failed for ${user.id}: ${auditError.message}`);
      throw new HttpError(500, "CLOSE_FAILED", "The account could not be closed. Please try again or contact support.");
    }

    const sql = postgres(databaseUrl(), { max: 1, prepare: false, idle_timeout: 5 });
    try {
      await sql.begin(async (tx) => {
        // Idempotent: re-stamping is harmless, but leaving an already-closed
        // account untouched keeps the original closure timestamp honest.
        await tx`
          update public.profiles
             set deleted_at = now()
           where id = ${user.id}
             and deleted_at is null
        `;
        await tx`
          delete from auth.sessions
           where user_id = ${user.id}
        `;
      });
    } catch (error) {
      console.error(`account-delete failed for ${user.id}: ${error instanceof Error ? error.message : error}`);
      throw new HttpError(500, "CLOSE_FAILED", "The account could not be closed. Please try again or contact support.");
    } finally {
      await sql.end({ timeout: 5 }).catch(() => {});
    }

    return json(request, { closed: true });
  }),
);
