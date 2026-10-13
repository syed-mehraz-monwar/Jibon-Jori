import { env } from "./env";
import { ApiError } from "./http";
import { getSupabase, isSupabaseConfigured, toApiError } from "./supabase";

/**
 * GraphQL transport for the reads that benefit from flexible querying.
 *
 * Supabase exposes PostgREST as the REST API and `pg_graphql` as the GraphQL API,
 * on the same project and behind the same row level security. `AGENTS.md` asks for
 * GraphQL "where flexible querying provides meaningful value" and the course
 * requirement lists GraphQL explicitly, so the reference-data read — whose shape
 * the UI wants as an ordered, nested selection — is issued here.
 *
 * `pg_graphql` is a Supabase extension and is not present in the local PostgreSQL
 * used by the test harness, so the live endpoint cannot be exercised off-Supabase.
 * Every caller therefore treats GraphQL as an optimization with a PostgREST
 * fallback rather than as the only path, which keeps the app working even if a
 * project has `pg_graphql` disabled. The transport itself is unit-tested.
 */
export const GRAPHQL_PATH = "/graphql/v1";

export type GraphQLError = { message: string; extensions?: Record<string, unknown> };
export type GraphQLResponse<T> = { data?: T | null; errors?: GraphQLError[] | null };

/**
 * POSTs a document to `pg_graphql` with the caller's token, so RLS applies exactly
 * as it does for REST: an anonymous visitor sees only reference data, a member sees
 * what their policies allow.
 */
export async function graphqlRequest<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  if (!isSupabaseConfigured()) {
    throw new ApiError(
      503,
      "SUPABASE_NOT_CONFIGURED",
      "This deployment is not connected to Supabase."
    );
  }

  let token = env.supabaseAnonKey;
  try {
    const { data } = await getSupabase().auth.getSession();
    if (data.session?.access_token) token = data.session.access_token;
  } catch {
    /* fall back to the anon key */
  }

  let response: Response;
  try {
    response = await fetch(`${env.supabaseUrl}${GRAPHQL_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new ApiError(500, "REQUEST_FAILED", "The request could not be completed.");
  }

  if (!response.ok) {
    throw toApiError({ message: `GraphQL request failed with status ${response.status}`, status: response.status });
  }

  let payload: GraphQLResponse<T>;
  try {
    payload = (await response.json()) as GraphQLResponse<T>;
  } catch {
    throw new ApiError(500, "EMPTY_RESPONSE", "The GraphQL endpoint returned an unreadable response.");
  }

  const firstError = payload.errors?.[0];
  if (firstError) {
    throw toApiError({
      message: firstError.message,
      code: typeof firstError.extensions?.code === "string" ? firstError.extensions.code : undefined,
    });
  }
  if (payload.data === null || payload.data === undefined) {
    throw new ApiError(500, "EMPTY_RESPONSE", "The GraphQL endpoint returned no data.");
  }
  return payload.data;
}

/** Ordered reference rows, using `pg_graphql`'s default camelCase inflection. */
export const REFERENCE_DATA_QUERY = `
  query ReferenceData {
    educationLevelsCollection(orderBy: { tier: AscNullsLast }) {
      edges { node { id slug label tier } }
    }
    professionsCollection(orderBy: { tier: AscNullsLast }) {
      edges { node { id slug label tier } }
    }
  }
`;

export type ReferenceNode = { id: string; slug: string; label: string; tier?: number | null };
export type ReferenceDataGraphQL = {
  educationLevelsCollection?: { edges: { node: ReferenceNode }[] } | null;
  professionsCollection?: { edges: { node: ReferenceNode }[] } | null;
};
