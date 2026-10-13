// =============================================================================
// ai-explanation - plain-language explanation of a compatibility score.
// =============================================================================
// Contract: POST { targetProfileId: uuid }
//   -> { targetProfileId, compatibility, explanation, model, fallback }
//
// The score is NOT produced here. It comes from the deterministic
// `compatibility_for` SQL function, which caches a canonical pair and returns
// the six component scores. The LLM's only job is to phrase those numbers for a
// human, and it is given nothing else: no names, no contact details, no fields
// that are not already visible to the caller through RLS.
//
// If no model is configured the endpoint still succeeds, using a deterministic
// template built from the same numbers. A missing key degrades the wording, not
// the feature.
// =============================================================================

import { handler, HttpError, json, readJson } from "../_shared/http.ts";
import { requireUser } from "../_shared/supabase.ts";
import { chatCompletion, isLlmConfigured, llmModel, type ChatMessage } from "../_shared/llm.ts";

type Body = { targetProfileId?: unknown };

type CompatibilityRow = {
  interests_score: number;
  education_score: number;
  profession_score: number;
  location_score: number;
  preference_score: number;
  overall_score: number;
};

const SYSTEM_PROMPT = [
  "You explain a matrimony compatibility score to a member in two or three short sentences.",
  "You are given only aggregate scores and coarse, non-identifying facts.",
  "Use ONLY the numbers you are given. Do not invent facts, do not mention anyone's name,",
  "do not promise outcomes, and do not give advice about marriage itself.",
  "Say plainly which components are strong and which are weak.",
].join(" ");

function templateExplanation(row: CompatibilityRow, sharedInterests: number): string {
  const ranked: Array<[string, number]> = [
    ["shared interests", row.interests_score],
    ["partner preferences", row.preference_score],
    ["location", row.location_score],
    ["education", row.education_score],
    ["profession", row.profession_score],
  ];
  ranked.sort((a, b) => b[1] - a[1]);

  const strongest = ranked.slice(0, 2).map(([label]) => label);
  const weakest = ranked[ranked.length - 1][0];

  const interestNote =
    sharedInterests > 0
      ? `You share ${sharedInterests} recorded interest${sharedInterests === 1 ? "" : "s"}. `
      : "";

  return (
    `This match scores ${row.overall_score} out of 100. ` +
    interestNote +
    `It is strongest on ${strongest.join(" and ")}, and weakest on ${weakest}. ` +
    `The score is calculated from your profile data only, never from a judgement about either person.`
  );
}

Deno.serve(
  handler(async (request) => {
    if (request.method !== "POST") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint.");
    }

    const { client } = await requireUser(request);
    const body = await readJson<Body>(request);
    const targetProfileId = typeof body.targetProfileId === "string" ? body.targetProfileId : "";

    if (!/^[0-9a-f-]{36}$/i.test(targetProfileId)) {
      throw new HttpError(400, "INVALID_TARGET", "targetProfileId must be a UUID.");
    }

    // The function itself refuses a profile the caller may not see, so an
    // invisible profile cannot be used to infer that it exists.
    const { data: compatibility, error: compatibilityError } = await client
      .rpc("compatibility_for", { p_other: targetProfileId })
      .maybeSingle();

    if (compatibilityError) {
      const message = compatibilityError.message ?? "";
      if (message.includes("PROFILE_NOT_VISIBLE") || message.includes("insufficient_privilege")) {
        throw new HttpError(403, "PROFILE_NOT_VISIBLE", "That profile is not visible to you.");
      }
      if (message.includes("PROFILE_NOT_FOUND") || message.includes("no_data_found")) {
        throw new HttpError(404, "PROFILE_NOT_FOUND", "That profile does not exist.");
      }
      if (message.includes("INVALID_TARGET")) {
        throw new HttpError(400, "INVALID_TARGET", "You cannot score yourself.");
      }
      throw new HttpError(500, "SCORE_FAILED", "The compatibility score could not be computed.");
    }

    if (!compatibility) {
      throw new HttpError(404, "PROFILE_NOT_FOUND", "That profile does not exist.");
    }

    const row = compatibility as unknown as CompatibilityRow;

    // Coarse, non-identifying context only, read through RLS.
    const { data: target } = await client
      .from("profiles")
      .select("city, country, education_id, profession_id")
      .eq("id", targetProfileId)
      .maybeSingle();

    const { count: sharedInterests } = await client
      .from("profile_interests")
      .select("interest_id", { count: "exact", head: true })
      .eq("profile_id", targetProfileId);

    let explanation = templateExplanation(row, sharedInterests ?? 0);
    let fallback = true;
    let model = llmModel();

    if (isLlmConfigured()) {
      const facts = [
        `overall: ${row.overall_score}/100`,
        `shared interests: ${row.interests_score}/100`,
        `partner preferences: ${row.preference_score}/100`,
        `location: ${row.location_score}/100`,
        `education: ${row.education_score}/100`,
        `profession: ${row.profession_score}/100`,
        target?.city ? `candidate region: ${target.city}` : null,
        target?.country ? `candidate country: ${target.country}` : null,
      ]
        .filter((line): line is string => line !== null)
        .join("\n");

      const messages: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Compatibility components:\n${facts}\n\nExplain this match.` },
      ];

      try {
        const completion = await chatCompletion(messages, { maxTokens: 220, temperature: 0.3 });
        explanation = completion.content;
        model = completion.model;
        fallback = false;
      } catch {
        console.error("ai-explanation: falling back to the deterministic template");
      }
    }

    return json(request, {
      targetProfileId,
      compatibility: row,
      explanation,
      model: fallback ? null : model,
      fallback,
    });
  }),
);
