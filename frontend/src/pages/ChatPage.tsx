import { useEffect, useState, type FormEvent } from "react";
import { chatApi, type ConversationDetail } from "../api/chat.api";
import { useToast } from "../context/ToastContext";
import { relativeTime } from "../lib/format";
import { ApiError } from "../lib/http";
import type { ChatConversation, ChatMessage } from "../lib/types";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Spinner } from "../components/ui/Spinner";
import { Textarea } from "../components/ui/Textarea";

const CONTENT_MAX = 4000;

/**
 * AI chatbot (Spec §2).
 *
 * The assistant is environment-gated on the backend (`LLM_CHAT_ENABLED=false` by
 * default). The user's message is always persisted; when no provider is
 * configured the API returns `fallback.reason` and this page shows that reason
 * verbatim instead of inventing an answer. That is intentional: a fabricated
 * "AI" reply would be worse than an honest "disabled".
 */
export function ChatPage() {
  const toast = useToast();

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);

  async function refreshConversations() {
    setLoadingList(true);
    try {
      const result = await chatApi.listConversations({ limit: 30 });
      setConversations(result.conversations);
    } catch (caught) {
      toast.error("Could not load conversations", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setLoadingList(false);
    }
  }

  // Load the conversation list once on mount.
  useEffect(() => {
    void refreshConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createConversation() {
    try {
      const result = await chatApi.createConversation("Profile help");
      setConversations((current) => [result.conversation, ...current]);
      await openConversation(result.conversation.id);
    } catch (caught) {
      toast.error("Could not start a conversation", caught instanceof ApiError ? caught.message : undefined);
    }
  }

  async function openConversation(conversationId: string) {
    setLoadingDetail(true);
    setFallbackReason(null);
    try {
      setDetail(await chatApi.getConversation(conversationId));
    } catch (caught) {
      toast.error("Could not open the conversation", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;

    const content = draft.trim();
    if (!content) return;
    if (content.length > CONTENT_MAX) {
      toast.error(`Messages are limited to ${CONTENT_MAX} characters.`);
      return;
    }

    setSending(true);
    try {
      const result = await chatApi.sendMessage(detail.conversation.id, content);
      const appended: ChatMessage[] = [result.userMessage];
      if (result.assistantMessage) appended.push(result.assistantMessage);
      setDetail((current) =>
        current ? { ...current, messages: [...current.messages, ...appended] } : current
      );
      setDraft("");
      setFallbackReason(result.fallback.used ? result.fallback.reason : null);
    } catch (caught) {
      toast.error("Could not send the message", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Profile assistant"
        description="Ask for help improving your profile or defining partner preferences."
        actions={
          <Button size="sm" onClick={() => void createConversation()}>
            New conversation
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Conversations">
          {loadingList ? (
            <div className="flex justify-center py-6">
              <Spinner className="h-5 w-5 text-brand-600" />
            </div>
          ) : conversations.length === 0 ? (
            <EmptyState title="No conversations" description="Start one to ask the assistant a question." />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {conversations.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => void openConversation(conversation.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                      detail?.conversation.id === conversation.id
                        ? "bg-brand-50 text-brand-800"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    <span className="block truncate font-medium">{conversation.title ?? "Untitled"}</span>
                    <span className="text-xs text-slate-400">{relativeTime(conversation.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2" title={detail?.conversation.title ?? "Messages"}>
          {!detail ? (
            <EmptyState
              title="No conversation selected"
              description="Choose a conversation on the left, or create a new one."
            />
          ) : loadingDetail ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-6 w-6 text-brand-600" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <ul className="flex max-h-96 flex-col gap-3 overflow-y-auto pr-1">
                {detail.messages.length === 0 ? (
                  <li className="text-sm text-slate-500">No messages yet. Say hello.</li>
                ) : (
                  detail.messages.map((message) => (
                    <li
                      key={message.id}
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
                        message.role === "user"
                          ? "self-end bg-brand-600 text-white"
                          : "self-start bg-slate-100 text-slate-800"
                      }`}
                    >
                      <p className="whitespace-pre-line">{message.content}</p>
                      <p className="mt-1 text-xs opacity-70">
                        {message.role}
                        {message.model ? ` \u00b7 ${message.model}` : ""} &middot; {relativeTime(message.createdAt)}
                      </p>
                    </li>
                  ))
                )}
              </ul>

              {fallbackReason ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  The assistant did not answer. Backend reason: <Badge tone="warning">{fallbackReason}</Badge>.
                  Your message was saved. A provider must be configured server-side for generated replies.
                </p>
              ) : null}

              <form className="flex items-end gap-2" onSubmit={onSubmit}>
                <Textarea
                  rows={2}
                  maxLength={CONTENT_MAX}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="How can I improve my profile?"
                  aria-label="Message"
                />
                <Button type="submit" loading={sending} disabled={!draft.trim()}>
                  Send
                </Button>
              </form>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
