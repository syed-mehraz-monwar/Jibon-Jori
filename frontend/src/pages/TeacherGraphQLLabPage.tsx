import { useCallback, useState } from "react";
import { graphqlRequest, REFERENCE_DATA_QUERY, type ReferenceDataGraphQL } from "../lib/graphql";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../context/AuthContext";
import { BackButton } from "../components/layout/BackButton";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ErrorState } from "../components/ui/ErrorState";
import { Spinner } from "../components/ui/Spinner";

const INVALID_QUERY = "query { jibonjoriThisFieldDoesNotExist }";

/**
 * Teacher demonstration for the Supabase-native GraphQL requirement (spec §6).
 *
 * Runs the real `pg_graphql` document against the live project with the signed-in
 * member's session and renders what came back. Nothing here is a mock: the query is
 * the production `REFERENCE_DATA_QUERY`, the response is whatever the endpoint and the
 * caller's row level security returned, and the deliberately invalid document exercises
 * the error branch so the teacher can show both states.
 */
export function TeacherGraphQLLabPage() {
  const { status } = useAuth();
  const [failureDemo, setFailureDemo] = useState(false);
  const [ranFailureDemo, setRanFailureDemo] = useState(false);
  const [failureError, setFailureError] = useState<unknown>(null);

  const load = useCallback(async () => {
    return graphqlRequest<ReferenceDataGraphQL>(REFERENCE_DATA_QUERY);
  }, []);
  const { status: loadStatus, error, reload, data } = useAsync(load, []);

  const runFailureDemo = useCallback(async () => {
    setFailureDemo(true);
    setRanFailureDemo(false);
    setFailureError(null);
    try {
      await graphqlRequest<unknown>(INVALID_QUERY);
      // An invalid document should be rejected; reaching this branch means the
      // endpoint answered with data anyway, which is itself worth showing.
      setRanFailureDemo(true);
    } catch (caught) {
      setFailureError(caught);
      setRanFailureDemo(true);
    }
  }, []);

  if (status !== "authenticated") {
    return (
      <>
        <PageHeader title="Teacher demo · GraphQL" />
        <p className="text-sm text-slate-600">Sign in to run the live query.</p>
      </>
    );
  }

  const educationEdges = data?.educationLevelsCollection?.edges ?? [];
  const professionEdges = data?.professionsCollection?.edges ?? [];

  return (
    <>
      <PageHeader
        title="Teacher demo · GraphQL"
        description="Runs a real pg_graphql query against the Supabase project with the signed-in session and shows the response."
        actions={<BackButton to="/app" label="Back to home" />}
      />

      <div className="mx-auto max-w-3xl space-y-5">
        <Card title="Live query">
          {failureDemo ? (
            ranFailureDemo ? (
              <ErrorState error={failureError} onRetry={() => void runFailureDemo()} title="The invalid query was rejected" />
            ) : (
              <div className="flex justify-center py-8">
                <Spinner className="h-8 w-8 text-brand-600" />
              </div>
            )
          ) : loadStatus === "loading" ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-8 w-8 text-brand-600" />
            </div>
          ) : null}

          {!failureDemo && loadStatus === "error" ? <ErrorState error={error} onRetry={() => void reload()} title="GraphQL request failed" /> : null}

          {!failureDemo && loadStatus === "success" ? (
            <div className="space-y-3">
              <pre className="overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs text-slate-100">{REFERENCE_DATA_QUERY}</pre>
              <dl className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <dt className="text-xs font-medium text-slate-500">Query</dt>
                  <dd className="text-sm font-semibold text-slate-900">ReferenceData</dd>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <dt className="text-xs font-medium text-slate-500">Rows returned</dt>
                  <dd className="text-sm font-semibold text-slate-900">
                    {educationEdges.length + professionEdges.length}
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3">
            <Button loading={loadStatus === "loading"} onClick={() => void reload()}>
              Run live query
            </Button>
            <Button variant="secondary" onClick={() => void runFailureDemo()} disabled={failureDemo}>
              Run failing query
            </Button>
          </div>
        </Card>

        <p className="text-xs leading-relaxed text-slate-500">
          The document is POSTed to the Supabase GraphQL endpoint at <code className="rounded bg-slate-100 px-1">/graphql/v1</code>{" "}
          with the signed-in member&apos;s access token, so row level security applies exactly as it does for the REST calls. An
          unauthenticated request is answered from the anon key and sees reference data only.
        </p>
      </div>
    </>
  );
}
