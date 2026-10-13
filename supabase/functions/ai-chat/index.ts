// =============================================================================
// ai-chat - the LLM assistant transcript endpoint.
// =============================================================================
// Contract: POST { conversationId: uuid, content: string }
//   -> { userMessage, assistantMessage, reply, fallback, model }
//
// Split of privilege, which is the whole reason this is a function and not a
// client call:
//   * the USER turn is written with the caller's own client, so RLS decides
//     whether it is allowed (policy: role = 'user' inside your own conversation);
//   * the ASSISTANT turn is written with the service role, because no client
//     policy permits writing an assistant turn - a user must not be able to forge
//     the model's replies into their own history.
//
// The assistant is given only the conversation itself. It has no database
// access and is never handed another member's data.
// =============================================================================

import { handler, HttpError, json, readJson } from "../_shared/http.ts";
import { requireUser, serviceClient } from "../_shared/supabase.ts";
import { chatCompletion, isLlmConfigured, llmModel, type ChatMessage } from "../_shared/llm.ts";

const HISTORY_LIMIT = 20;
const MAX_CONTENT = 4000;

type Body = { conversationId?: unknown; content?: unknown };

const SYSTEM_PROMPT = [
  "You are the JibonJori assistant, helping members with a matrimony platform.",
  "Be warm, concise and practical. Reply in the language the member used.",
  "You cannot see other members' private data, and you must not claim to.",
  "Never invent profile details, match scores, prices, or policies. If you do not",
  "know something, say so and suggest where in the app the member can find it.",
  "You are not a lawyer and must not give legal advice about marriage or divorce.",
].join(" ");

const FALLBACK_REPLY =
  "I can't reach the assistant service right now, so I can't answer that properly. " +
  "Please try again shortly. Your message has been saved to this conversation.";

Deno.serve(
  handler(async (request) => {
    if (request.method !== "POST") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint.");
    }

    const { client, user } = await requireUser(request);
    const body = await readJson<Body>(request);

    const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";

    if (!/^[0-9a-f-]{36}$/i.test(conversationId)) {
      throw new HttpError(400, "INVALID_CONVERSATION", "conversationId must be a UUID.");
    }
    if (content.length === 0 || content.length > MAX_CONTENT) {
      throw new HttpError(400, "INVALID_CONTENT", `content must be between 1 and ${MAX_CONTENT} characters.`);
    }

    // RLS makes this return null for a conversation the caller does not own, so
    // the ownership check and the read are the same operation.
    const { data: conversation, error: conversationError } = await client
      .from("chat_conversations")
      .select("id, title")
      .eq("id", conversationId)
      .maybeSingle();

    if (conversationError) {
      throw new HttpError(500, "CONVERSATION_LOOKUP_FAILED", "The conversation could not be read.");
    }
    if (!conversation) {
      throw new HttpError(404, "CONVERSATION_NOT_FOUND", "That conversation does not exist for this account.");
    }

    const { data: history, error: historyError } = await client
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);

    if (historyError) {
      throw new HttpError(500, "HISTORY_LOOKUP_FAILED", "The conversation history could not be read.");
    }

    const { data: userMessage, error: insertUserError } = await client
      .from("chat_messages")
      .insert({ conversation_id: conversationId, role: "user", content })
      .select("id, conversation_id, role, content, created_at")
      .single();

    if (insertUserError || !userMessage) {
      throw new HttpError(500, "MESSAGE_NOT_SAVED", "Your message could not be saved.");
    }

    let reply = FALLBACK_REPLY;
    let fallback = true;
    let model = llmModel();
    let usage = { promptTokens: null as number | null, completionTokens: null as number | null };

    if (isLlmConfigured()) {
      const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
      for (const message of (history ?? []).slice().reverse()) {
        if (message.role === "user" || message.role === "assistant") {
          messages.push({ role: message.role, content: message.content });
        }
      }
      messages.push({ role: "user", content });

      try {
        const completion = await chatCompletion(messages);
        reply = completion.content;
        model = completion.model;
        usage = completion.usage;
        fallback = false;
      } catch {
        // Deliberately degraded, never fabricated: the member is told the
        // assistant was unreachable rather than shown an invented answer.
        console.error(`ai-chat: falling back for user ${user.id}`);
      }
    }

    const { data: assistantMessage, error: insertAssistantError } = await serviceClient()
      .from("chat_messages")
      .insert({
        conversation_id: conversationId,
        role: "assistant",
        content: reply,
        model: fallback ? null : model,
        tokens: usage.completionTokens,
      })
      .select("id, conversation_id, role, content, model, created_at")
      .single();

    if (insertAssistantError || !assistantMessage) {
      throw new HttpError(500, "REPLY_NOT_SAVED", "The assistant reply could not be saved.");
    }

    // Bump the conversation so the list orders by recent activity, and name an
    // untitled conversation from its first question.
    await client
      .from("chat_conversations")
      .update({
        title: conversation.title ?? content.slice(0, 60),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);

    return json(request, {
      userMessage,
      assistantMessage,
      reply,
      fallback,
      model: fallback ? null : model,
    });
  }),
);
