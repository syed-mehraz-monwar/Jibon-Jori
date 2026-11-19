import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeFunctionMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/supabase", () => ({
  invokeFunction: (...args: unknown[]) => invokeFunctionMock(...args),
}));

import { demoApi } from "../api/demo.api";

describe("demoApi", () => {
  beforeEach(() => {
    invokeFunctionMock.mockReset();
  });

  it("lists demo profiles through the admin-gated GET handler and maps the response", async () => {
    invokeFunctionMock.mockResolvedValue({
      profiles: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          username: "demo_arif",
          display_name: "Arif Rahman",
          city: "Dhaka",
          country: "Bangladesh",
        },
        { id: "not-a-uuid", username: "demo_bad", display_name: null, city: null, country: null },
      ],
    });

    const profiles = await demoApi.plan();

    expect(invokeFunctionMock).toHaveBeenCalledWith("demo-reset", undefined, "", "GET");
    expect(profiles).toEqual([
      {
        id: "11111111-1111-1111-1111-111111111111",
        username: "demo_arif",
        displayName: "Arif Rahman",
        city: "Dhaka",
        country: "Bangladesh",
      },
    ]);
  });

  it("resets demo content only when the caller confirms", async () => {
    invokeFunctionMock.mockResolvedValue({
      deleted: { comments: 0, interactions: 0, ratings: 0, feedback: 0, notifications: 0, chat_conversations: 0 },
    });

    const result = await demoApi.reset();

    expect(invokeFunctionMock).toHaveBeenCalledWith("demo-reset", { confirm: true });
    expect(result.deleted.comments).toBe(0);
  });
});
