// =============================================================================
// sessions - list and revoke the caller's own authenticated sessions.
// =============================================================================
// Contract:
//   GET                      -> { sessions: [{ id, createdAt, updatedAt, userAgent, ip, isCurrent }] }
//   POST { revokeOthers: true } -> { revoked: number }   (keeps the calling session)
//   POST { sessionId: uuid }    -> { revoked: 1 }        (keeps the calling session)
//
// Why this needs to be a function: the session records live in `auth.sessions`,
// in a schema PostgREST does not expose. There is no client-accessible API for
// enumerating sessions, so this runs SQL directly over `SUPABASE_DB_URL`.
//
// Two rules are enforced here and nowhere else:
//   1. `user_id = <caller>` is part of EVERY statement, so a session id guessed
//      by a caller can never reach another account's row.
//   2. The caller's own current session is never revoked by these operations -
//      "revoke other sessions" that logged you out would be a trap.
//
// The current session is identified from the `session_id` claim in the caller's
// own access token, which the gateway already verified.
// =============================================================================

import postgres from "npm:postgres@3";
import { handler, HttpError, json, readJson } from "../_shared/http.ts";
import { sessionIdFromRequest } from "../_shared/jwt.ts";
import { requireUser } from "../_shared/supabase.ts";

type Body = { sessionId?: unknown; revokeOthers?: unknown };

type SessionRow = {
  id: string;
  created_at: string;
  updated_at: string;
  user_agent: string | null;
  ip: string | null;
};

function databaseUrl(): string {
  const url = Deno.env.get("SUPABASE_DB_URL");
  if (!url) throw new HttpError(503, "DATABASE_NOT_CONFIGURED", "Session management is not configured on this deployment.");
  return url;
}

Deno.serve(
  handler(async (request) => {
    if (request.method !== "GET" && request.method !== "POST") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use GET to list or POST to revoke.");
    }

    const { user } = await requireUser(request);
    const sessionId = sessionIdFromRequest(request);
    const sql = postgres(databaseUrl(), { max: 1, prepare: false, idle_timeout: 5 });

    try {
      if (request.method === "GET") {
        let rows: SessionRow[];
        try {
          rows = await sql<SessionRow[]>`
            select id, created_at, updated_at, user_agent, ip
              from auth.sessions
             where user_id = ${user.id}
             order by updated_at desc
          `;
        } catch (error) {
          // Older GoTrue versions do not populate user_agent/ip.
          console.error("sessions: full select failed, retrying without device columns:", error instanceof Error ? error.message : error);
          const basic = await sql<Array<Pick<SessionRow, "id" | "created_at" | "updated_at">>>`
            select id, created_at, updated_at
              from auth.sessions
             where user_id = ${user.id}
             order by updated_at desc
          `;
          rows = basic.map((row) => ({ ...row, user_agent: null, ip: null }));
        }

        return json(request, {
          sessions: rows.map((row) => ({
            id: row.id,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            userAgent: row.user_agent,
            ip: row.ip,
            isCurrent: sessionId !== null && row.id === sessionId,
          })),
        });
      }

      const body = await readJson<Body>(request).catch(() => ({}) as Body);

      // Fail closed. The current session is normally identifiable from the token
      // claim; if it is not, "revoke all others" has no safe meaning because the
      // guard below would be dropped and the caller's own session would go with
      // the rest. Refusing is better than silently signing the member out.
      if (body.revokeOthers === true && sessionId === null) {
        throw new HttpError(409, "CURRENT_SESSION_UNKNOWN", "Cannot identify the current session. Please sign in again.");
      }

      // Never revoke the session making the request.
      const guard = sessionId ? sql`and id <> ${sessionId}` : sql``;

      if (body.revokeOthers === true) {
        const deleted = await sql`
          delete from auth.sessions
           where user_id = ${user.id}
             ${guard}
          returning id
        `;
        return json(request, { revoked: deleted.length });
      }

      const target = typeof body.sessionId === "string" ? body.sessionId : "";
      if (!/^[0-9a-f-]{36}$/i.test(target)) {
        throw new HttpError(400, "INVALID_SESSION", "Provide revokeOthers, or a sessionId that is a UUID.");
      }
      if (sessionId !== null && target === sessionId) {
        throw new HttpError(400, "CANNOT_REVOKE_CURRENT", "Use sign-out to end the session you are using.");
      }

      const deleted = await sql`
        delete from auth.sessions
         where user_id = ${user.id}
           and id = ${target}
        returning id
      `;
      return json(request, { revoked: deleted.length });
    } finally {
      await sql.end({ timeout: 5 }).catch(() => {});
    }
  }),
);
