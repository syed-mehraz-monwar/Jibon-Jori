import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/http";
import { renderApp, seedAuth, seedReferenceData } from "./test-utils";

const graphql = vi.hoisted(() => ({
  graphqlRequest: vi.fn(),
  REFERENCE_DATA_QUERY: "query ReferenceData { educationLevelsCollection { edges { node { id slug label tier } } } }",
}));

vi.mock("../lib/graphql", () => ({
  GRAPHQL_PATH: "/graphql/v1",
  graphqlRequest: graphql.graphqlRequest,
  REFERENCE_DATA_QUERY: graphql.REFERENCE_DATA_QUERY,
}));

describe("TeacherGraphQLLabPage", () => {
  it("renders the live query result from the real pg_graphql document", async () => {
    seedAuth();
    seedReferenceData();
    graphql.graphqlRequest.mockResolvedValue({
      educationLevelsCollection: { edges: [{ node: { id: "e1", slug: "bsc", label: "BSc", tier: 3 } }] },
      professionsCollection: { edges: [{ node: { id: "pr1", slug: "engineer", label: "Engineer", tier: 3 } }] },
    });

    renderApp("/app/developer/graphql");

    expect(await screen.findByText("Live query")).toBeInTheDocument();
    expect(await screen.findByText("Rows returned")).toBeInTheDocument();
    expect(screen.getByText("Run live query")).toBeInTheDocument();

    await waitFor(() => expect(graphql.graphqlRequest).toHaveBeenCalled());
    expect(graphql.graphqlRequest).toHaveBeenCalledWith(graphql.REFERENCE_DATA_QUERY);
    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
  });

  it("shows the error branch when the query fails", async () => {
    seedAuth();
    seedReferenceData();
    const failure = new ApiError(400, "GRAPHQL_VALIDATION_FAILED", "Field 'jibonjoriThisFieldDoesNotExist' was not found");
    graphql.graphqlRequest.mockRejectedValue(failure);

    renderApp("/app/developer/graphql");

    expect(await screen.findByText("GraphQL request failed")).toBeInTheDocument();
    expect(screen.getByText("Field 'jibonjoriThisFieldDoesNotExist' was not found")).toBeInTheDocument();
  });

  it("recovers to the success state through the retry action after a failure", async () => {
    seedAuth();
    seedReferenceData();
    graphql.graphqlRequest
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ educationLevelsCollection: { edges: [] }, professionsCollection: { edges: [] } });

    renderApp("/app/developer/graphql");

    expect(await screen.findByText("GraphQL request failed")).toBeInTheDocument();

    const actor = userEvent.setup();
    await actor.click(screen.getByRole("button", { name: /Try again/ }));

    await waitFor(() => expect(screen.queryByText("GraphQL request failed")).toBeNull());
  });
});
