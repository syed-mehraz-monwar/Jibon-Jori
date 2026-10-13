import { afterEach, describe, expect, it, vi } from "vitest";
import { GRAPHQL_PATH, graphqlRequest, REFERENCE_DATA_QUERY } from "../lib/graphql";
import { ApiError } from "../lib/http";

/**
 * The `pg_graphql` transport.
 *
 * `pg_graphql` is a Supabase extension and is not available in the local
 * PostgreSQL, so the live endpoint cannot be exercised off-Supabase. This suite
 * covers the transport contract instead: the request shape (POST to `/graphql/v1`
 * with the anon key and a bearer token) and every response branch the caller
 * depends on — data, GraphQL `errors`, HTTP failure and an unreadable body.
 */
function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    ...response,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("graphqlRequest", () => {
  it("POSTs the document to the pg_graphql endpoint with the anon key", async () => {
    const fetchMock = mockFetch({
      json: async () => ({ data: { educationLevelsCollection: { edges: [] } } }),
    });

    const data = await graphqlRequest<{ educationLevelsCollection: { edges: unknown[] } }>(
      REFERENCE_DATA_QUERY
    );

    expect(data.educationLevelsCollection.edges).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(GRAPHQL_PATH);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(init.headers.apikey).toBeTruthy();
    expect(String(init.headers.Authorization)).toMatch(/^Bearer /);
    expect(JSON.parse(init.body).query).toContain("educationLevelsCollection");
  });

  it("turns a GraphQL errors array into an ApiError rather than returning partial data", async () => {
    mockFetch({ json: async () => ({ data: null, errors: [{ message: "permission denied" }] }) });

    await expect(graphqlRequest("query { x }")).rejects.toBeInstanceOf(ApiError);
  });

  it("maps a non-2xx response to an ApiError", async () => {
    mockFetch({ ok: false, status: 403, json: async () => ({}) });

    await expect(graphqlRequest("query { x }")).rejects.toMatchObject({ status: 403 });
  });

  it("rejects when the body carries no data", async () => {
    mockFetch({ json: async () => ({}) });

    await expect(graphqlRequest("query { x }")).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });
  });
});
