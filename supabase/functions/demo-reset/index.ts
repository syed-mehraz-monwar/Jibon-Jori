// =============================================================================
// demo-reset - admin-only cleanup of marker-scoped demo content.
// =============================================================================
// Contract:
//   GET  -> { profiles: [{ id, username, displayName, city, country }] }
//          Lists the fictional demo personas (username prefix `demo_`) that the
//          Demo Mode walkthrough uses, so the operator can see exactly what the
//          reset would touch before confirming.
//   POST -> { deleted: { comments, interactions, ratings, feedback, notifications, chat_conversations } }
//          Requires { confirm: true } AND an administrator session. Deletes only
//          rows that reference a `demo_`-marked profile, never real members.
//
// Safety rules enforced here and nowhere else:
//   1. The caller must pass `confirm: true`; the operation refuses to run
//      otherwise, so a stray client cannot reset content by accident.
//   2. The caller must be an administrator; the same `is_admin()` guard the RLS
//      layer uses is re-checked server-side before any delete runs.
//   3. Every delete is scoped to the demo marker resolved from the database, so
//      real users' content can never be selected by a guess or an id.

import postgres from "npm:postgres@3";
import { handler, HttpError, json, readJson } from "../_shared/http.ts";
import { requireAdmin } from "../_shared/supabase.ts";

const DEMO_MARKER = "demo_";

type DemoProfileRow = {
  id: string;
  username: string;
  display_name?: string | null;
  city?: string | null;
  country?: string | null;
};

type DeleteReport = {
  comments: number;
  interactions: number;
  ratings: number;
  feedback: number;
  notifications: number;
  chat_conversations: number;
};

function databaseUrl(): string {
  const url = Deno.env.get("SUPABASE_DB_URL");
  if (!url) throw new HttpError(503, "DATABASE_NOT_CONFIGURED", "Demo reset is not configured on this deployment.");
  return url;
}

Deno.serve(
  handler(async (request) => {
    if (request.method !== "GET" && request.method !== "POST") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use GET to list demo content or POST to reset it.");
    }

    const { client, user } = await requireAdmin(request);

    const sql = postgres(databaseUrl(), { max: 1, prepare: false, idle_timeout: 5 });

    try {
      if (request.method === "GET") {
        const rows = (await client
          .from("profiles")
          .select("id, username, display_name, city, country")
          .ilike("username", `${DEMO_MARKER}%`)
          .order("username", { ascending: true })) as DemoProfileRow[] | null;
        const profiles = ((rows ?? []) ?? [])
          .filter((row) => /^[0-9a-f-]{36}$/i.test(row.id))
          .map((row) => ({
            id: row.id,
            username: row.username,
            displayName: row.display_name ?? null,
            city: row.city ?? null,
            country: row.country ?? null,
          }));
        return json(request, { profiles });
      }

      const body = await readJson<{ confirm?: unknown }>(request).catch(() => ({}) as { confirm?: unknown });
      if (body?.confirm !== true) {
        throw new HttpError(400, "CONFIRMATION_REQUIRED", "Set confirm to true to run the demo reset.");
      }

      const demoRows = (await client
        .from("profiles")
        .select("id")
        .ilike("username", `${DEMO_MARKER}%`)) as Array<{ id: string }> | null;
      const demoIds = (demoRows ?? []).map((row) => row.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));

      if (demoIds.length === 0) {
        // Nothing is marked as demo content; the reset is a no-op, not a success
        // over real data.
        return json(request, { deleted: { comments: 0, interactions: 0, ratings: 0, feedback: 0, notifications: 0, chat_conversations: 0 } });
      }

      const deletedComments = await sql`
        delete from public.comments
         where author_profile_id = any(${demoIds})
            or target_profile_id = any(${demoIds})
         returning id
      `;
      const deletedInteractions = await sql`
        delete from public.interactions
         where actor_profile_id = any(${demoIds})
            or target_profile_id = any(${demoIds})
         returning id
      `;
      const deletedRatings = await sql`
        delete from public.ratings
         where rater_profile_id = any(${demoIds})
            or rated_profile_id = any(${demoIds})
         returning id
      `;
      const deletedFeedback = await sql`
        delete from public.feedback
         where rater_profile_id = any(${demoIds})
         returning id
      `;
      const deletedNotifications = await sql`
        delete from public.notifications
         where profile_id = any(${demoIds})
         returning id
      `;
      const deletedConversations = await sql`
        delete from public.chat_conversations
         where profile_id = any(${demoIds})
         returning id
      `;

      const count = async (rows: Array<{ id: string }>): Promise<number> => rows.length;

      const deleted: DeleteReport = {
        comments: await count(deletedComments),
        interactions: await count(deletedInteractions),
        ratings: await count(deletedRatings),
        feedback: await count(deletedFeedback),
        notifications: await count(deletedNotifications),
        chat_conversations: await count(deletedConversations),
      };

      console.log(
        `demo-reset: admin ${user.id} reset ${demoIds.length} demo profile(s); deleted ${JSON.stringify(deleted)}`,
      );

      return json(request, { deleted });
    } finally {
      await sql.end({ timeout: 5 }).catch(() => {});
    }
  }),
);
