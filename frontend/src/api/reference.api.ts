import { getSupabase, toApiError } from "../lib/supabase";
import { graphqlRequest, REFERENCE_DATA_QUERY, type ReferenceDataGraphQL } from "../lib/graphql";
import { mapReference, type ReferenceRow } from "../lib/mappers";
import { GENDER_LABELS, MARITAL_STATUS_LABELS, NOTIFICATION_TYPE_LABELS } from "../lib/format";
import type { Gender, MaritalStatus, NotificationType, Reference, ReferenceData } from "../lib/types";
import { searchApi, type SearchFilters } from "./search.api";
import type { Pagination, SearchProfile } from "../lib/types";

function options<T extends string>(labels: Record<T, string>) {
  return (Object.entries(labels) as [T, string][]).map(([slug, label]) => ({ slug, label }));
}

async function referenceTable(
  table: "education_levels" | "professions" | "interests",
  orderBy: string
): Promise<Reference[]> {
  const { data, error } = await getSupabase()
    .from(table)
    .select("id, slug, label, tier")
    .order(orderBy, { ascending: true });
  if (error) throw toApiError(error);
  return ((data ?? []) as ReferenceRow[]).map(mapReference);
}

function fromEdges(collection: { edges: { node: ReferenceRow }[] } | null | undefined): Reference[] {
  return (collection?.edges ?? []).map((edge) => mapReference(edge.node));
}

/**
 * Education and profession options over GraphQL.
 *
 * This is the "flexible querying" read the course requirement and `AGENTS.md`
 * point at: both ordered option sets are fetched in one document instead of two
 * REST round trips. It returns `null` on any failure so the caller can fall back to
 * PostgREST — `pg_graphql` is a Supabase extension that may be disabled on a given
 * project, and the dropdowns must not depend on it.
 */
async function referenceViaGraphQL(): Promise<{ educationLevels: Reference[]; professions: Reference[] } | null> {
  try {
    const data = await graphqlRequest<ReferenceDataGraphQL>(REFERENCE_DATA_QUERY);
    return {
      educationLevels: fromEdges(data.educationLevelsCollection),
      professions: fromEdges(data.professionsCollection),
    };
  } catch {
    return null;
  }
}

/**
 * Reference + search reads.
 *
 * The reference dropdown option sets and the flexible profile search are the two
 * places the project uses flexible querying, per `AGENTS.md` ("GraphQL should be
 * introduced where flexible querying provides meaningful value"). Education and
 * profession options are read over GraphQL (`pg_graphql`) with a PostgREST
 * fallback; the profile search is served by the `search_profiles` RPC, which
 * enforces the same visibility RLS does. The public shape is unchanged, so
 * `ReferenceDataContext` and the search pages need no edits.
 */
export const referenceApi = {
  get: async (_signal?: AbortSignal): Promise<{ referenceData: ReferenceData }> => {
    const viaGraphQL = await referenceViaGraphQL();
    const [educationLevels, professions, interests] = await Promise.all([
      viaGraphQL ? Promise.resolve(viaGraphQL.educationLevels) : referenceTable("education_levels", "tier"),
      viaGraphQL ? Promise.resolve(viaGraphQL.professions) : referenceTable("professions", "tier"),
      referenceTable("interests", "label"),
    ]);

    return {
      referenceData: {
        educationLevels,
        professions,
        interests,
        genderOptions: options<Gender>(GENDER_LABELS),
        maritalStatusOptions: options<MaritalStatus>(MARITAL_STATUS_LABELS),
        notificationTypeOptions: options<NotificationType>(NOTIFICATION_TYPE_LABELS),
      },
    };
  },

  searchProfiles: async (
    filters: SearchFilters,
    signal?: AbortSignal
  ): Promise<{ searchProfiles: { profiles: SearchProfile[]; pagination: Pagination } }> => ({
    searchProfiles: await searchApi.profiles(filters, signal),
  }),
};
