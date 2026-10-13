// =============================================================================
// LLM access for the Edge Functions.
// =============================================================================
// The provider is selected by configuration, not hard-coded, and the key is read
// from the function environment so it never reaches the client bundle.
//
// The division of labour matters and is enforced by the callers:
//   * every SCORE is computed by deterministic SQL (`compute_compatibility`);
//   * the LLM only PHRASES an explanation, or answers a matched user's question
//     in the chatbot.
// This helper therefore has no authority over any number the app displays.
//
// `isLlmConfigured()` exists so a deployment without a provider key degrades to
// a deterministic template instead of pretending a model answered.
// =============================================================================

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 20_000;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmResult = {
  content: string;
  model: string;
  usage: { promptTokens: number | null; completionTokens: number | null };
};

export class LlmError extends Error {}

export function isLlmConfigured(): boolean {
  return (Deno.env.get("LLM_API_KEY") ?? "").length > 0;
}

export function llmModel(): string {
  return Deno.env.get("LLM_MODEL") ?? DEFAULT_MODEL;
}

/**
 * Sends a chat completion request to an OpenAI-compatible endpoint.
 *
 * Failure is surfaced as an error rather than an empty string, so the caller can
 * decide between a deterministic fallback and an HTTP error. A provider error
 * body is logged but never returned to the client: it can contain request
 * identifiers and prompt echoes.
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options: { maxTokens?: number; temperature?: number } = {},
): Promise<LlmResult> {
  const apiKey = Deno.env.get("LLM_API_KEY");
  if (!apiKey) throw new LlmError("LLM_API_KEY is not configured");

  const baseUrl = (Deno.env.get("LLM_BASE_URL") ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = llmModel();
  const timeout = Number(Deno.env.get("LLM_TIMEOUT_MS") ?? DEFAULT_TIMEOUT_MS);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens ?? 500,
        temperature: options.temperature ?? 0.4,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error(`LLM provider returned ${response.status}: ${detail.slice(0, 500)}`);
      throw new LlmError(`provider responded with ${response.status}`);
    }

    const payload = (await response.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) throw new LlmError("provider returned an empty completion");

    return {
      content,
      model: payload.model ?? model,
      usage: {
        promptTokens: payload.usage?.prompt_tokens ?? null,
        completionTokens: payload.usage?.completion_tokens ?? null,
      },
    };
  } catch (error) {
    if (error instanceof LlmError) throw error;
    console.error("LLM request failed:", error instanceof Error ? error.message : error);
    throw new LlmError("the model provider could not be reached");
  } finally {
    clearTimeout(timer);
  }
}
