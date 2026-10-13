import { getSupabase, invokeFunction, requireUserId, toApiError } from "../lib/supabase";
import { ApiError } from "../lib/http";
import {
  mapChatConversation,
  mapChatMessage,
  paginationFor,
  rangeFor,
  type ChatConversationRow,
  type ChatMessageRow,
} from "../lib/mappers";
import type { ChatConversation, ChatMessage, ChatReplyResult, Explanation, Pagination } from "../lib/types";

export type ConversationListResult = { conversations: ChatConversation[]; pagination: Pagination };
export type ConversationDetail = { conversation: ChatConversation; messages: ChatMessage[] };

export type ChatMessageResult = {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage | null;
  reply: Explanation;
  fallback: { used: boolean; reason: string };
};

const CONVERSATION_SELECT = "id, title, created_at, updated_at";
const MESSAGE_SELECT = "id, role, content, model, created_at";

type AiChatResponse = {
  userMessage: ChatMessageRow;
  assistantMessage: ChatMessageRow;
  reply: string;
  fallback: boolean;
  model: string | null;
};

/**
 * `/api/chat` — the LLM chatbot, served by the `ai-chat` Edge Function.
 *
 * The user's message is always persisted first (RLS-scoped to the caller's own
 * conversation) and the assistant turn is written by the function with the service
 * role, so a member can never forge a model reply. When no provider key is
 * configured the function still saves a truthful fallback message and reports
 * `fallback: true`, which is surfaced as `fallback.reason` rather than hidden.
 */
export const chatApi = {
  createConversation: async (title?: string): Promise<{ conversation: ChatConversation }> => {
    const userId = await requireUserId();
    const { data, error } = await getSupabase()
      .from("chat_conversations")
      .insert({ profile_id: userId, ...(title ? { title } : {}) })
      .select(CONVERSATION_SELECT)
      .single();
    if (error) throw toApiError(error);
    return { conversation: mapChatConversation(data as ChatConversationRow) };
  },

  listConversations: async (
    params: { page?: number; limit?: number } = {},
    _signal?: AbortSignal
  ): Promise<ConversationListResult> => {
    const userId = await requireUserId();
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const [from, to] = rangeFor(page, limit);

    const { data, error, count } = await getSupabase()
      .from("chat_conversations")
      .select(CONVERSATION_SELECT, { count: "exact" })
      .eq("profile_id", userId)
      .order("updated_at", { ascending: false })
      .range(from, to);
    if (error) throw toApiError(error);
    return {
      conversations: ((data ?? []) as ChatConversationRow[]).map(mapChatConversation),
      pagination: paginationFor(page, limit, count ?? 0),
    };
  },

  getConversation: async (
    conversationId: string,
    params: { limit?: number } = {},
    _signal?: AbortSignal
  ): Promise<ConversationDetail> => {
    const limit = params.limit ?? 100;

    const conversation = await getSupabase()
      .from("chat_conversations")
      .select(CONVERSATION_SELECT)
      .eq("id", conversationId)
      .maybeSingle();
    if (conversation.error) throw toApiError(conversation.error);
    if (!conversation.data) {
      throw new ApiError(404, "NOT_FOUND", "That conversation does not exist for this account.");
    }

    const messages = await getSupabase()
      .from("chat_messages")
      .select(MESSAGE_SELECT)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (messages.error) throw toApiError(messages.error);

    return {
      conversation: mapChatConversation(conversation.data as ChatConversationRow),
      messages: ((messages.data ?? []) as ChatMessageRow[]).map(mapChatMessage),
    };
  },

  sendMessage: async (conversationId: string, content: string): Promise<ChatReplyResult> => {
    const response = await invokeFunction<AiChatResponse>("ai-chat", { conversationId, content });
    const fallbackUsed = response.fallback === true;

    return {
      userMessage: mapChatMessage(response.userMessage),
      assistantMessage: response.assistantMessage ? mapChatMessage(response.assistantMessage) : null,
      reply: {
        available: !fallbackUsed,
        text: response.reply,
        providerVersion: response.model,
        promptVersion: "ai-chat-v1",
        generatedAt: fallbackUsed ? null : new Date().toISOString(),
      },
      fallback: { used: fallbackUsed, reason: fallbackUsed ? "LLM_UNAVAILABLE" : "" },
    };
  },
};
