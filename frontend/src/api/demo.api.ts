import { invokeFunction } from "../lib/supabase";

export type DemoProfile = {
  id: string;
  username: string;
  displayName?: string | null;
  city?: string | null;
  country?: string | null;
};

export type DemoResetResult = {
  deleted: {
    comments: number;
    interactions: number;
    ratings: number;
    feedback: number;
    notifications: number;
    chat_conversations: number;
  };
};

type DemoProfileRow = {
  id: string;
  username: string;
  display_name?: string | null;
  city?: string | null;
  country?: string | null;
};

const DEMO_ID = /^[0-9a-f-]{36}$/i;

/**
 * Demo Mode backend operations.
 *
 * The demo reset is marker-scoped: the `demo-reset` Edge Function resolves the
 * caller's demo profiles from the dedicated `demo_` username marker and deletes
 * only content that references them. Real members are never touched because the
 * marker matches no real account, and every delete goes through the admin gate
 * inside the function. The confirmation flag is required server-side as well, so
 * a client cannot reset without asking for it.
 */
export const demoApi = {
  /**
   * Lists the fictional demo personas through the admin-gated GET handler. The
   * function answers `{ profiles: [...] }`, so the rows are mapped onto the
   * caller-facing shape here.
   */
  plan: async (): Promise<DemoProfile[]> => {
    const response = await invokeFunction<{ profiles?: DemoProfileRow[] }>("demo-reset", undefined, "", "GET");
    const rows = response?.profiles ?? [];
    return rows
      .filter((row) => DEMO_ID.test(row.id))
      .map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name ?? null,
        city: row.city ?? null,
        country: row.country ?? null,
      }));
  },

  reset: async (): Promise<DemoResetResult> =>
    invokeFunction<DemoResetResult>("demo-reset", { confirm: true }),
};
