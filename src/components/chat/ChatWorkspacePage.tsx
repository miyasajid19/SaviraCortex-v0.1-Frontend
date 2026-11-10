"use client";

import Link from "next/link";
import BrandLockup from "../BrandLockup";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { auth, firebaseConfigError } from "../../app/firebase";

const API = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

type Organization = {
  organization_id: string;
  organization_name: string;
  role: string;
};

type Profile = {
  user_id: string;
  display_name: string | null;
  organizations: Organization[];
};

type Citation = {
  evidence_id: string;
  document_id: string | null;
  document_version_id: string | null;
  document_title: string | null;
  page: number | string | null;
  section: string | null;
};

type PIIConsentChallenge = {
  query: string;
  requestId: string;
  userMessageId: string;
  redactedPreview: string;
  entities: string[];
  allowedActions: Array<"redact" | "send_as_is" | "reject">;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "answered" | "partial" | "insufficient_evidence";
  citations?: Citation[];
  warnings?: string[];
  missingInformation?: string[];
  generationId?: string;
  feedbackStatus?: "relevant" | "not_relevant";
  feedbackSaving?: boolean;
  feedbackError?: string;
  error?: string;
  guardrailDecision?: "blocked" | "redirected" | "redacted";
  guardrailCategories?: string[];
  conversationId?: string;
};

type SaviraMessageMetadata = Omit<ChatMessage, "id" | "role" | "content">;
type SaviraDataParts = {
  status: { stage: string; message: string };
  piiConsent: PIIConsentChallenge;
  generationError: { code?: string; message: string; conversationId?: string; userMessageId?: string };
  userMessageUpdate: { messageId: string; content: string; guardrailDecision?: "redacted" };
};
type SaviraUIMessage = UIMessage<SaviraMessageMetadata, SaviraDataParts>;

type ConversationSummary = {
  conversation_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type StoredConversationMessage = {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: Partial<GenerationPayload> & {
    feedback_status?: "relevant" | "not_relevant" | null;
    guardrail_decision?: "blocked" | "redirected" | "redacted" | null;
    guardrail_categories?: string[];
  };
};

type GenerationPayload = {
  generation_id?: string | null;
  conversation_id: string;
  request_id: string;
  query: string;
  answer: string;
  status: "answered" | "partial" | "insufficient_evidence";
  citations: Citation[];
  warnings: string[];
  missing_information: string[];
  retrieval_attempts: number;
  evidence_count: number;
  guardrail_decision?: "blocked" | "redirected" | "redacted" | null;
  guardrail_categories?: string[];
};

const starterPrompts = [
  "Summarize the key points in our documents.",
  "What policies should every employee know?",
  "Find the requirements relevant to my question.",
];

function mapStoredMessage(item: StoredConversationMessage): ChatMessage {
  const metadata = item.metadata || {};
  return {
    id: item.message_id,
    role: item.role,
    content: item.content,
    status: metadata.status,
    citations: metadata.citations || [],
    warnings: metadata.warnings || [],
    missingInformation: metadata.missing_information || [],
    generationId: metadata.generation_id || undefined,
    feedbackStatus: metadata.feedback_status || undefined,
    guardrailDecision: metadata.guardrail_decision || undefined,
    guardrailCategories: metadata.guardrail_categories || [],
  };
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function toSaviraUIMessage(message: ChatMessage): SaviraUIMessage {
  const { id, role, content, ...metadata } = message;
  return {
    id,
    role,
    parts: content ? [{ type: "text", text: content }] : [],
    metadata,
  } as SaviraUIMessage;
}

function fromSaviraUIMessage(message: SaviraUIMessage): ChatMessage {
  const content = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  return {
    ...(message.metadata || {}),
    id: message.id,
    role: message.role as ChatMessage["role"],
    content,
  };
}

function linkCitationMarkers(markdown: string): string {
  const referencesHeading = /^## References\s*$/im.exec(markdown);
  const splitIndex = referencesHeading?.index ?? markdown.length;
  const answer = markdown.slice(0, splitIndex).replace(
    /\[(\d+)\](?!\()/g,
    (marker, number, offset, original) =>
      original[offset - 1] === "!" ? marker : "[" + number + "](#references)",
  );
  return answer + markdown.slice(splitIndex);
}

export default function ChatWorkspacePage({ conversationId: routeConversationId = null }: { conversationId?: string | null }) {
  const router = useRouter();
  const scrollAnchor = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const suppressAutoScroll = useRef(false);
  const pdfRequestId = useRef(0);
  const routeConversationIdRef = useRef(routeConversationId);
  routeConversationIdRef.current = routeConversationId;
  const refreshConversationListRef = useRef<() => void>(() => {});
  const pendingRequestRef = useRef<{
    requestId: string;
    userMessageId: string;
    assistantMessageId: string;
    query: string;
    piiAction?: "redact" | "send_as_is";
    consentRequired?: boolean;
    failed?: boolean;
  } | null>(null);
  const sdkSetMessagesRef = useRef<((value: SaviraUIMessage[] | ((current: SaviraUIMessage[]) => SaviraUIMessage[])) => void) | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationSearch, setConversationSearch] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [loadingProfile, setLoadingProfile] = useState(Boolean(auth));
  const [streamingStage, setStreamingStage] = useState("");
  const [error, setError] = useState(firebaseConfigError);
  const [piiConsent, setPiiConsent] = useState<PIIConsentChallenge | null>(null);
  const [pdfViewer, setPdfViewer] = useState<{ url: string; title: string; page: number | null } | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfLoadingTitle, setPdfLoadingTitle] = useState("Source document");

  const chatTransport = useMemo(() => new DefaultChatTransport<SaviraUIMessage>({
    api: "/api/chat",
    headers: async () => {
      const currentUser = auth?.currentUser;
      if (!currentUser) throw new Error("Your session has expired. Please sign in again.");
      return { Authorization: `Bearer ${await currentUser.getIdToken()}` };
    },
    prepareSendMessagesRequest: ({ messages: sdkMessages }) => {
      const lastUserMessage = [...sdkMessages].reverse().find((message) => message.role === "user");
      const messageText = lastUserMessage?.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("") || "";
      const pending = pendingRequestRef.current;
      const requestId = pending?.requestId || crypto.randomUUID();
      const assistantMessageId = pending?.assistantMessageId || makeId();
      const userMessageId = lastUserMessage?.id || pending?.userMessageId || "";
      if (pending && userMessageId) pending.userMessageId = userMessageId;
      return {
        body: {
          organization_id: selectedOrganizationId,
          conversation_id: routeConversationId,
          query: pending?.query || messageText,
          request_id: requestId,
          assistant_message_id: assistantMessageId,
          user_message_id: userMessageId,
          ...(pending?.piiAction ? { pii_action: pending.piiAction } : {}),
        },
      };
    },
  }), [selectedOrganizationId, routeConversationId]);

  const {
    messages: sdkMessages,
    setMessages: setSdkMessages,
    sendMessage: sendSdkMessage,
    stop: stopSdkGeneration,
    status: chatStatus,
  } = useChat<SaviraUIMessage>({
    transport: chatTransport,
    onData: (part) => {
      if (part.type === "data-status") {
        setStreamingStage(part.data.message);
      } else if (part.type === "data-piiConsent") {
        const pending = pendingRequestRef.current;
        if (pending) pending.consentRequired = true;
        const challenge = part.data;
        setPiiConsent({
          ...challenge,
          query: pending?.query || challenge.query,
          requestId: pending?.requestId || challenge.requestId,
          userMessageId: pending?.userMessageId || challenge.userMessageId,
        });
        const assistantMessageId = pending?.assistantMessageId;
        if (assistantMessageId) {
          sdkSetMessagesRef.current?.((current) => current.filter((message) => message.id !== assistantMessageId));
        }
      } else if (part.type === "data-generationError") {
        if (pendingRequestRef.current) pendingRequestRef.current.failed = true;
        setError(part.data.message);
        if (part.data.conversationId && !routeConversationIdRef.current) {
          router.replace("/chat/" + part.data.conversationId);
        }
        sdkSetMessagesRef.current?.((current) => current
          .filter((message) => message.id !== pendingRequestRef.current?.assistantMessageId)
          .map((message) => message.id === (part.data.userMessageId || pendingRequestRef.current?.userMessageId)
            ? { ...message, metadata: { ...message.metadata, error: part.data.message } }
            : message));
      } else if (part.type === "data-userMessageUpdate") {
        sdkSetMessagesRef.current?.((current) => current.map((message) => message.id === part.data.messageId
          ? {
              ...message,
              parts: part.data.content ? [{ type: "text", text: part.data.content }] : [],
              metadata: { ...message.metadata, guardrailDecision: part.data.guardrailDecision },
            }
          : message));
      }
    },
    onError: (chatError) => {
      setError(chatError.message || "Something went wrong. Please try again.");
      const pending = pendingRequestRef.current;
      if (pending) {
        pending.failed = true;
        sdkSetMessagesRef.current?.((current) => current
          .filter((message) => message.id !== pending.assistantMessageId)
          .map((message) => message.id === pending.userMessageId
            ? { ...message, metadata: { ...message.metadata, error: chatError.message } }
            : message));
        pendingRequestRef.current = null;
      }
    },
    onFinish: ({ message }) => {
      setStreamingStage("");
      const pending = pendingRequestRef.current;
      if (pending?.consentRequired || pending?.failed) {
        sdkSetMessagesRef.current?.((current) => current.filter((item) => item.id !== pending.assistantMessageId));
      }
      const conversationId = message.metadata?.conversationId;
      if (conversationId && !routeConversationIdRef.current) router.replace("/chat/" + conversationId);
      if (!pendingRequestRef.current?.consentRequired) pendingRequestRef.current = null;
      refreshConversationListRef.current();
      window.setTimeout(() => refreshConversationListRef.current(), 3000);
    },
  });
  sdkSetMessagesRef.current = setSdkMessages;
  refreshConversationListRef.current = refreshConversationList;

  const messages = useMemo(() => sdkMessages.map(fromSaviraUIMessage), [sdkMessages]);
  const sending = chatStatus === "submitted" || chatStatus === "streaming";

  const setMessages = useCallback((update: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[])) => {
    setSdkMessages((current) => {
      const currentMessages = current.map(fromSaviraUIMessage);
      const nextMessages = typeof update === "function" ? update(currentMessages) : update;
      return nextMessages.map(toSaviraUIMessage);
    });
  }, [setSdkMessages]);

  useEffect(() => {
    if (!auth) return;

    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      if (!user) {
        router.replace("/login");
        return;
      }

      try {
        const token = await user.getIdToken();
        const response = await fetch(`${API}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.detail || `Could not load your workspace (HTTP ${response.status}).`);
        }
        if (!active) return;

        const loadedProfile = data as Profile;
        setProfile(loadedProfile);
        const requestedOrganizationId =
          typeof window !== "undefined"
            ? window.localStorage.getItem("savira.selectedOrganizationId")
            : null;
        const requestedOrganization = loadedProfile.organizations.find(
          (organization) => organization.organization_id === requestedOrganizationId,
        );
        setSelectedOrganizationId(
          requestedOrganization?.organization_id ||
            loadedProfile.organizations[0]?.organization_id ||
            "",
        );
      } catch (err) {
        if (active) setError((err as Error).message);
      } finally {
        if (active) setLoadingProfile(false);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (!pdfViewer) return;
    return () => URL.revokeObjectURL(pdfViewer.url);
  }, [pdfViewer]);

  useEffect(() => {
    if (!pdfViewer && !pdfLoading) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        pdfRequestId.current += 1;
        setPdfViewer(null);
        setPdfLoading(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pdfViewer, pdfLoading]);

  useEffect(() => {
    if (suppressAutoScroll.current) {
      suppressAutoScroll.current = false;
      return;
    }
    scrollAnchor.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  useEffect(() => {
    const currentUser = auth?.currentUser;
    if (!selectedOrganizationId || !currentUser) {
      setConversations([]);
      return;
    }
    let active = true;
    const loadConversations = async () => {
      try {
        const token = await currentUser.getIdToken();
        const response = await fetch(
          `${API}/api/v1/organizations/${selectedOrganizationId}/conversations?limit=50&offset=0`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || "Could not load conversations.");
        if (active) setConversations((data.items || []) as ConversationSummary[]);
      } catch (err) {
        if (active) setError((err as Error).message);
      }
    };
    void loadConversations();
    return () => { active = false; };
  }, [selectedOrganizationId, routeConversationId]);

  useEffect(() => {
    const currentUser = auth?.currentUser;
    let active = true;
    setMessages([]);
    setHistoryOffset(0);
    setHasOlderMessages(false);
    if (!routeConversationId || !selectedOrganizationId || !currentUser) {
      setLoadingConversation(false);
      return () => { active = false; };
    }

    const loadConversation = async () => {
      setLoadingConversation(true);
      try {
        const token = await currentUser.getIdToken();
        const response = await fetch(
          `${API}/api/v1/organizations/${selectedOrganizationId}/conversations/${routeConversationId}/messages?limit=20&offset=0`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || "Could not load this conversation.");
        if (!active) return;
        const items = (data.items || []) as StoredConversationMessage[];
        setMessages(items.map(mapStoredMessage));
        setHistoryOffset(items.length);
        setHasOlderMessages(Boolean(data.has_more));
      } catch (err) {
        if (active) setError((err as Error).message);
      } finally {
        if (active) setLoadingConversation(false);
      }
    };
    void loadConversation();
    return () => { active = false; };
  }, [routeConversationId, selectedOrganizationId, setMessages]);

  const selectedOrganization = profile?.organizations.find(
    (organization) => organization.organization_id === selectedOrganizationId,
  );
  const filteredConversations = conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(conversationSearch.trim().toLowerCase()),
  );

  function startNewChat() {
    if (sending) return;
    void stopSdkGeneration();
    pendingRequestRef.current = null;
    setMessages([]);
    setHistoryOffset(0);
    setHasOlderMessages(false);
    setError("");
    setMobileSidebarOpen(false);
    router.replace("/chat");
  }

  async function sendMessage(
    event?: FormEvent<HTMLFormElement>,
    piiAction?: "redact" | "send_as_is",
    retry?: PIIConsentChallenge,
  ) {
    event?.preventDefault();
    const query = retry?.query || draft.trim();
    if (!query || sending || !selectedOrganizationId) return;
    if (!auth?.currentUser) {
      router.replace("/login");
      return;
    }

    const requestId = retry?.requestId || crypto.randomUUID();
    const userMessageId = retry?.userMessageId || makeId();
    const assistantMessageId = makeId();
    pendingRequestRef.current = {
      requestId,
      userMessageId,
      assistantMessageId,
      query,
      piiAction,
      consentRequired: false,
    };
    // A consent retry replaces the original unapproved user message instead of
    // adding a duplicate. The SDK creates and owns the replacement message ID.
    if (retry) {
      setSdkMessages((current) => current.filter((message) => message.id !== retry.userMessageId));
    }
    setDraft("");
    setError("");
    setStreamingStage("Connecting to SaviraCortex…");

    try {
      await sendSdkMessage({ text: query });
    } catch (err) {
      const messageError = (err as Error).message || "Something went wrong. Please try again.";
      setError(messageError);
      const activeUserMessageId = pendingRequestRef.current?.userMessageId || userMessageId;
      setMessages((current) => current
        .filter((message) => message.id !== assistantMessageId)
        .map((message) => message.id === activeUserMessageId ? { ...message, error: messageError } : message));
      pendingRequestRef.current = null;
      setStreamingStage("");
    }
  }

  function resolvePiiConsent(action: "redact" | "send_as_is" | "reject") {
    if (!piiConsent) return;
    const pending = piiConsent;
    setPiiConsent(null);
    if (action === "reject") {
      setMessages((current) => current.filter((message) => message.id !== pending.userMessageId));
      pendingRequestRef.current = null;
      return;
    }
    void sendMessage(undefined, action, pending);
  }

  async function refreshConversationList() {
    const currentUser = auth?.currentUser;
    if (!selectedOrganizationId || !currentUser) return;
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(
        `${API}/api/v1/organizations/${selectedOrganizationId}/conversations?limit=50&offset=0`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const data = await response.json().catch(() => ({}));
      if (response.ok) setConversations((data.items || []) as ConversationSummary[]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function renameCurrentConversation() {
    if (!routeConversationId || !selectedOrganizationId || !auth?.currentUser) return;
    const current = conversations.find((item) => item.conversation_id === routeConversationId);
    const title = window.prompt("Conversation title", current?.title || "");
    if (title === null || !title.trim()) return;
    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetch(
        `${API}/api/v1/organizations/${selectedOrganizationId}/conversations/${routeConversationId}`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Could not rename conversation.");
      setConversations((items) => items.map((item) => item.conversation_id === routeConversationId ? { ...item, title: data.title } : item));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function deleteCurrentConversation() {
    if (!routeConversationId || !selectedOrganizationId || !auth?.currentUser) return;
    if (!window.confirm("Delete this conversation and its saved history? This cannot be undone.")) return;
    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetch(
        `${API}/api/v1/organizations/${selectedOrganizationId}/conversations/${routeConversationId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || "Could not delete conversation.");
      }
      setConversations((items) => items.filter((item) => item.conversation_id !== routeConversationId));
      setMessages([]);
      setHistoryOffset(0);
      setHasOlderMessages(false);
      router.replace("/chat");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function loadOlderMessages() {
    const currentUser = auth?.currentUser;
    if (!routeConversationId || !selectedOrganizationId || !hasOlderMessages || loadingOlder || !currentUser) return;
    const container = messageListRef.current;
    const previousHeight = container?.scrollHeight || 0;
    const previousTop = container?.scrollTop || 0;
    setLoadingOlder(true);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(
        `${API}/api/v1/organizations/${selectedOrganizationId}/conversations/${routeConversationId}/messages?limit=20&offset=${historyOffset}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Could not load older messages.");
      const items = (data.items || []) as StoredConversationMessage[];
      suppressAutoScroll.current = true;
      setMessages((current) => [...items.map(mapStoredMessage), ...current]);
      setHistoryOffset((current) => current + items.length);
      setHasOlderMessages(Boolean(data.has_more));
      requestAnimationFrame(() => {
        if (container) container.scrollTop = previousTop + container.scrollHeight - previousHeight;
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function openCitation(citation: Citation) {
    const currentUser = auth?.currentUser;
    if (!currentUser || !selectedOrganizationId || !citation.document_version_id) {
      setError("This reference does not have an available source document.");
      return;
    }

    const requestId = ++pdfRequestId.current;
    setPdfViewer(null);
    setPdfLoadingTitle(citation.document_title || "Source document");
    setPdfLoading(true);
    setError("");
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(
        API + "/api/v1/organizations/" + selectedOrganizationId + "/generation/citations/" + citation.document_version_id + "/content",
        { headers: { Authorization: "Bearer " + token }, cache: "no-store" },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || "The source document could not be opened.");
      }
      const pdf = await response.blob();
      if (pdf.type && !pdf.type.toLowerCase().includes("pdf")) {
        throw new Error("The source document response was not a PDF.");
      }
      const pageNumber = Number(citation.page);
      const page = Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : null;
      const objectUrl = URL.createObjectURL(pdf);
      if (requestId === pdfRequestId.current) {
        setPdfViewer({
          url: objectUrl,
          title: citation.document_title || "Source document",
          page,
        });
      } else {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (err) {
      if (requestId === pdfRequestId.current) {
        setError((err as Error).message || "The source document could not be opened.");
      }
    } finally {
      if (requestId === pdfRequestId.current) setPdfLoading(false);
    }
  }

  function closePdfViewer() {
    pdfRequestId.current += 1;
    setPdfViewer(null);
    setPdfLoading(false);
  }

  async function submitFeedback(
    messageId: string,
    generationId: string,
    feedbackStatus: "relevant" | "not_relevant",
  ) {
    const currentUser = auth?.currentUser;
    if (!currentUser || !selectedOrganizationId) return;

    setMessages((current) => current.map((message) =>
      message.id === messageId
        ? { ...message, feedbackSaving: true, feedbackError: "" }
        : message,
    ));

    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(
        API + "/api/v1/organizations/" + selectedOrganizationId + "/generation/" + generationId + "/feedback",
        {
          method: "PATCH",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ feedback_status: feedbackStatus }),
          cache: "no-store",
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || "Feedback could not be saved (HTTP " + response.status + ").");
      }
      setMessages((current) => current.map((message) =>
        message.id === messageId
          ? { ...message, feedbackStatus, feedbackSaving: false, feedbackError: "" }
          : message,
      ));
    } catch (err) {
      setMessages((current) => current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              feedbackSaving: false,
              feedbackError: (err as Error).message || "Feedback could not be saved.",
            }
          : message,
      ));
    }
  }

  async function stopGeneration() {
    const pending = pendingRequestRef.current;
    await stopSdkGeneration();
    if (pending) setMessages((current) => current.filter((message) => message.id !== pending.assistantMessageId));
    pendingRequestRef.current = null;
    setStreamingStage("");
  }

  function changeOrganization(value: string) {
    void stopSdkGeneration();
    pendingRequestRef.current = null;
    setSelectedOrganizationId(value);
    window.localStorage.setItem("savira.selectedOrganizationId", value);
    setMessages([]);
    setConversations([]);
    setError("");
    router.replace("/chat");
  }

  return (
    <main className="flex min-h-screen bg-white text-neutral-900">
      <button type="button" aria-label="Close navigation" onClick={() => setMobileSidebarOpen(false)} className={"fixed inset-0 z-30 bg-black/20 lg:hidden " + (mobileSidebarOpen ? "block" : "hidden")} />
      <aside className={"fixed inset-y-0 left-0 z-40 flex w-[260px] shrink-0 flex-col border-r border-neutral-200 bg-[#f9f9f9] transition-transform duration-200 lg:static lg:translate-x-0 " + (mobileSidebarOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center justify-between px-4 pb-4 pt-5">
          <BrandLockup href="/chat" variant="light" size="compact" />
          <button type="button" onClick={startNewChat} disabled={sending} aria-label="New chat" title="New chat" className="grid h-9 w-9 place-items-center rounded-lg border border-neutral-200 bg-white text-lg text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-40">+</button>
        </div>
        <div className="px-3 pb-4">
          <button type="button" onClick={startNewChat} disabled={sending} className="flex w-full items-center gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-neutral-800 transition hover:bg-neutral-100 disabled:opacity-40"><span className="text-lg leading-none">+</span>New chat</button>
        </div>
        <div className="px-4 pb-2">
          <label htmlFor="chat-organization" className="mb-2 block text-[11px] font-medium text-neutral-500">Workspace</label>
          <select id="chat-organization" value={selectedOrganizationId} onChange={(event) => { changeOrganization(event.target.value); setMobileSidebarOpen(false); }} disabled={loadingProfile || !profile?.organizations.length || sending} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-xs text-neutral-800 outline-none focus:border-neutral-400">
            {profile?.organizations.map((organization) => <option key={organization.organization_id} value={organization.organization_id}>{organization.organization_name}</option>)}
          </select>
        </div>
        <div className="px-3 pt-5">
          <p className="px-2 pb-2 text-[11px] font-semibold text-neutral-500">Your chats</p>
          <input type="search" aria-label="Search conversations" value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="Search chats" className="mb-2 w-full rounded-lg border border-transparent bg-neutral-100 px-3 py-2 text-xs text-neutral-800 outline-none placeholder:text-neutral-500 focus:border-neutral-300 focus:bg-white" />
        </div>
        <nav aria-label="Conversation history" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {filteredConversations.map((conversation) => (
            <button key={conversation.conversation_id} type="button" onClick={() => { router.push("/chat/" + conversation.conversation_id); setMobileSidebarOpen(false); }} title={conversation.title} className={"flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs transition " + (routeConversationId === conversation.conversation_id ? "bg-neutral-200/80 text-neutral-900" : "text-neutral-700 hover:bg-neutral-200/60")}>
              <span className="min-w-0 flex-1 truncate">{conversation.title || "New conversation"}</span>
            </button>
          ))}
          {!filteredConversations.length && <p className="px-3 py-3 text-xs leading-5 text-neutral-500">{conversationSearch ? "No matching conversations." : "Your conversations will appear here."}</p>}
        </nav>
        <div className="border-t border-neutral-200 p-3">
          <Link href="/dashboard" className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs text-neutral-600 transition hover:bg-neutral-200/70 hover:text-neutral-900">Back to dashboard</Link>
          {profile?.display_name && <p className="truncate px-3 pt-2 text-[11px] text-neutral-500">{profile.display_name}</p>}
        </div>
      </aside>
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 bg-white/95 px-4 backdrop-blur-sm sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => setMobileSidebarOpen(true)} aria-label="Open navigation" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-neutral-600 hover:bg-neutral-100 lg:hidden">Menu</button>
            <h1 className="truncate text-sm font-medium text-neutral-800">{selectedOrganization?.organization_name || "SaviraCortex"}</h1>
          </div>
          <div className="flex items-center gap-2">
            {sending && <button type="button" onClick={stopGeneration} className="rounded-lg px-3 py-2 text-xs text-neutral-600 hover:bg-neutral-100">Stop generating</button>}
            {routeConversationId && <>
              <button type="button" onClick={() => void renameCurrentConversation()} disabled={sending} className="rounded-lg px-3 py-2 text-xs text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40">Rename</button>
              <button type="button" onClick={() => void deleteCurrentConversation()} disabled={sending} className="rounded-lg px-3 py-2 text-xs text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40">Delete</button>
            </>}
            <button type="button" onClick={startNewChat} disabled={sending} className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-40 sm:hidden">New chat</button>
          </div>
        </header>
        <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 sm:px-6">
        <div className="flex items-center justify-end py-3"><span className="text-[11px] text-neutral-500">Answers use documents you are authorized to access</span></div>

        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loadingProfile ? (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-600">
            Loading your workspace…
          </div>
        ) : !profile?.organizations.length ? (
          <div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl border border-neutral-200 bg-neutral-50 text-2xl text-neutral-700">S</div>
            <h2 className="mt-6 text-xl font-semibold text-neutral-900">No organization yet</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-neutral-600">
              Create an organization or accept an invitation before asking questions about its knowledge base.
            </p>
            <Link href="/dashboard" className="mt-6 rounded-lg bg-neutral-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-700">
              Open dashboard
            </Link>
          </div>
        ) : (
          <>
            <div
              ref={messageListRef}
              onScroll={(event) => {
                if (event.currentTarget.scrollTop < 80) void loadOlderMessages();
              }}
              className="min-h-[45vh] max-h-[calc(100vh-190px)] flex-1 space-y-8 overflow-y-auto pb-8 pt-4 pr-2"
            >
              {loadingOlder && <p className="py-2 text-center text-xs text-neutral-500">Loading older messages…</p>}
              {loadingConversation && <p className="py-2 text-center text-xs text-neutral-500">Loading conversation…</p>}
              {!messages.length && !loadingConversation && (
                <div className="flex min-h-[52vh] flex-col items-center justify-center py-12 text-center">
                  <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight text-neutral-900 sm:text-4xl">What can I help you with?</h2>
                  <p className="mt-3 max-w-xl text-sm leading-7 text-neutral-500">Ask a question about your organization’s knowledge. Answers are grounded in the documents you can access.</p>
                  <div className="mt-8 grid w-full max-w-3xl gap-3 sm:grid-cols-3">
                    {starterPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => setDraft(prompt)}
                        className="rounded-xl border border-neutral-200 bg-white p-4 text-left text-xs leading-5 text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
                      >
                        {prompt}
                        <span className="mt-3 block text-[11px] text-neutral-500">Use prompt</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((message) => (
                <article key={message.id} className={message.role === "user" ? "ml-auto max-w-3xl" : "mr-auto max-w-4xl"}>
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium text-neutral-600">
                    {message.role === "assistant" ? (
                      <>
                        <span>SaviraCortex</span>
                        {(message.guardrailDecision || message.status) && (
                          <span className={message.guardrailDecision === "blocked"
                            ? "rounded-full bg-red-50 px-2 py-1 text-[10px] font-normal tracking-normal text-red-700"
                            : "rounded-full bg-neutral-100 px-2 py-1 text-[10px] font-normal tracking-normal text-neutral-600"}>
                            {message.guardrailDecision === "blocked"
                              ? "blocked by guardrails"
                              : message.guardrailDecision === "redirected"
                                ? "policy redirect"
                                : message.guardrailDecision === "redacted"
                                  ? "redacted by guardrails"
                                  : message.status?.replaceAll("_", " ")}
                          </span>
                        )}
                      </>
                    ) : (
                      <>You</>
                    )}
                  </div>
                  <div className={message.role === "user" ? "ml-auto max-w-[88%] rounded-3xl bg-[#f4f4f4] px-5 py-3 text-sm leading-7 text-neutral-900" : "bg-transparent px-0 py-1 text-[15px] leading-7 text-neutral-800"}>
                    {message.role === "assistant" ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          h1: ({ children }) => <h1 className="mb-4 mt-2 text-2xl font-semibold tracking-tight text-neutral-900">{children}</h1>,
                          h2: ({ children }) => (
                            <h2 id={String(children).trim().toLowerCase() === "references" ? "references" : undefined} className="mb-3 mt-6 border-b border-neutral-200 pb-2 text-lg font-semibold text-neutral-900 first:mt-0">{children}</h2>
                          ),
                          h3: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold text-neutral-900">{children}</h3>,
                          p: ({ children }) => <p className="mb-3 whitespace-pre-wrap leading-7 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="mb-4 list-disc space-y-1 pl-6 marker:text-neutral-700">{children}</ul>,
                          ol: ({ children }) => <ol className="mb-4 list-decimal space-y-1 pl-6 marker:text-neutral-700">{children}</ol>,
                          li: ({ children }) => <li className="pl-1 leading-7">{children}</li>,
                          strong: ({ children }) => <strong className="font-semibold text-neutral-900">{children}</strong>,
                          blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-neutral-300 pl-4 text-neutral-600">{children}</blockquote>,
                          a: ({ href, children }) => {
                            const citationNumber = href === "#references" ? Number(String(children).trim()) : 0;
                            const citation = citationNumber > 0
                              ? message.citations?.find((item) => item.evidence_id === "E" + citationNumber)
                              : undefined;
                            if (citation) {
                              return (
                                <span className="mx-0.5 inline-flex whitespace-nowrap" key={citation.evidence_id}>
                                  <span aria-hidden="true">[</span>
                                  <button type="button" onClick={() => void openCitation(citation)} aria-label={"Open source " + citationNumber} title={"Open " + (citation.document_title || "source document") + (citation.page ? ", page " + citation.page : "")} className="font-semibold text-neutral-800 underline decoration-neutral-400 underline-offset-4 hover:text-black">{children}</button>
                                  <span aria-hidden="true">]</span>
                                </span>
                              );
                            }
                            return <a href={href} className="font-semibold text-neutral-800 underline decoration-neutral-400 underline-offset-4 hover:text-black">{children}</a>;
                          },
                          table: ({ children }) => <div className="my-4 overflow-x-auto"><table className="w-full border-collapse text-left text-xs">{children}</table></div>,
                          th: ({ children }) => <th className="border border-neutral-200 bg-neutral-50 px-3 py-2 font-semibold text-neutral-900">{children}</th>,
                          td: ({ children }) => <td className="border border-neutral-200 px-3 py-2 align-top">{children}</td>,
                          pre: ({ children }) => <pre className="my-4 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-4 text-xs leading-6">{children}</pre>,
                          code: ({ children }) => <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-[0.9em] text-neutral-800">{children}</code>,
                          hr: () => <hr className="my-5 border-neutral-200" />,
                        }}
                      >
                        {linkCitationMarkers(message.content)}
                      </ReactMarkdown>
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}
                    {!!message.missingInformation?.length && (
                      <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-neutral-700">Evidence still missing</p>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-neutral-600">
                          {message.missingInformation.map((item, index) => <li key={index}>{item}</li>)}
                        </ul>
                      </div>
                    )}
                    {!!message.warnings?.length && (
                      <ul className="mt-3 space-y-1 text-[11px] leading-5 text-neutral-700/70">
                        {message.warnings.map((warning, index) => <li key={index}>Note: {warning}</li>)}
                      </ul>
                    )}
                  </div>
                  {message.error && (
                    <div role="alert" className="mt-2 max-w-[88%] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
                      {message.error}
                    </div>
                  )}
                  {message.guardrailDecision === "blocked" && (
                    <div role="status" className="mt-2 max-w-[88%] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
                      This response was blocked by organization guardrails.
                      {!!message.guardrailCategories?.length && (
                        <span className="ml-1 text-red-600">Category: {message.guardrailCategories.join(", ").replaceAll("_", " ")}.</span>
                      )}
                    </div>
                  )}
                  {message.guardrailDecision === "redacted" && (
                    <div role="status" className="mt-2 max-w-[88%] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                      Sensitive information was redacted before this message was processed.
                    </div>
                  )}
                  {message.role === "assistant" && message.generationId && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 px-1 text-xs">
                      <span className="mr-1 text-neutral-500">Was this answer helpful?</span>
                      <button
                        type="button"
                        onClick={() => void submitFeedback(message.id, message.generationId!, "relevant")}
                        disabled={message.feedbackSaving}
                        aria-label="Mark answer as relevant"
                        aria-pressed={message.feedbackStatus === "relevant"}
                        className={"rounded-lg border px-3 py-1.5 transition disabled:opacity-50 " + (
                          message.feedbackStatus === "relevant"
                            ? "border-neutral-500 bg-neutral-100 text-neutral-900"
                            : "border-neutral-200 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                        )}
                      >
                        Helpful
                      </button>
                      <button
                        type="button"
                        onClick={() => void submitFeedback(message.id, message.generationId!, "not_relevant")}
                        disabled={message.feedbackSaving}
                        aria-label="Mark answer as not relevant"
                        aria-pressed={message.feedbackStatus === "not_relevant"}
                        className={"rounded-lg border px-3 py-1.5 transition disabled:opacity-50 " + (
                          message.feedbackStatus === "not_relevant"
                            ? "border-neutral-500 bg-neutral-100 text-neutral-900"
                            : "border-neutral-200 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                        )}
                      >
                        Not helpful
                      </button>
                      {message.feedbackSaving && <span className="text-neutral-500">Saving...</span>}
                      {message.feedbackError && <span role="alert" className="text-red-600">{message.feedbackError}</span>}
                    </div>
                  )}
                </article>
              ))}

              {sending && (
                <div className="mr-auto flex max-w-3xl items-center gap-3 px-1 py-3 text-xs text-neutral-500" role="status" aria-live="polite">
                  <span className="flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-500 [animation-delay:-.2s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-500 [animation-delay:-.1s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-500" />
                  </span>
                  {streamingStage || "Working on your answer…"}
                </div>
              )}
              <div ref={scrollAnchor} />
            </div>

            <div className="sticky bottom-0 -mx-4 bg-white px-4 pb-5 pt-3 sm:-mx-6 sm:px-6">
              <form onSubmit={sendMessage} className="mx-auto max-w-3xl">
                <div className="rounded-3xl border border-neutral-300 bg-white p-2 shadow-[0_2px_10px_rgba(0,0,0,0.06)] transition focus-within:border-neutral-400">
                  <label htmlFor="chat-prompt" className="sr-only">Ask your organization’s knowledge base</label>
                  <textarea
                    id="chat-prompt"
                    rows={2}
                    maxLength={8000}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                    placeholder="Message SaviraCortex"
                    disabled={sending}
                    className="max-h-40 min-h-[58px] w-full resize-y bg-transparent px-3 py-3 text-sm leading-6 text-neutral-900 outline-none placeholder:text-neutral-400 disabled:opacity-60"
                  />
                  <div className="flex items-center justify-between gap-3 px-2 pt-1">
                    <p className="text-[10px] text-neutral-500">Enter to send | Shift + Enter for a new line</p>
                    <button
                      type="submit"
                      disabled={sending || !draft.trim()}
                      className="inline-flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-2.5 text-xs font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {sending ? "Working…" : "Send"}
                      <span aria-hidden="true">+</span>
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-center text-[10px] text-neutral-500">
                  Conversations are saved to your workspace. Sources are limited to documents you are authorized to access.
                </p>
              </form>
            </div>
          </>
        )}
      </section>
      {piiConsent && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-950/55 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="pii-consent-title"
            aria-describedby="pii-consent-description"
            className="w-full max-w-xl rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-lg text-amber-800" aria-hidden="true">!</span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-800">Privacy check</p>
                <h2 id="pii-consent-title" className="mt-1 text-lg font-semibold text-neutral-950">Personal information detected</h2>
                <p id="pii-consent-description" className="mt-2 text-sm leading-6 text-neutral-600">
                  Your message has not been sent to the assistant. Choose whether to redact the detected information, send the original with your consent, or cancel.
                </p>
              </div>
            </div>
            <div className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">Detected types</p>
              <p className="mt-1 text-xs text-neutral-700">{piiConsent.entities.join(", ") || "Personal information"}</p>
              <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">Redacted preview</p>
              <p className="mt-1 break-words text-sm leading-6 text-neutral-800">{piiConsent.redactedPreview}</p>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => resolvePiiConsent("reject")}
                className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-700">Cancel</button>
              {piiConsent.allowedActions.includes("send_as_is") && (
                <button type="button" onClick={() => resolvePiiConsent("send_as_is")}
                  className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-700">Send original</button>
              )}
              {piiConsent.allowedActions.includes("redact") && (
                <button type="button" onClick={() => resolvePiiConsent("redact")}
                  className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-700">Redact and send</button>
              )}
            </div>
          </section>
        </div>
      )}
      {(pdfViewer || pdfLoading) && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40 p-2 sm:p-5"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePdfViewer();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="PDF source viewer"
            className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl"
          >
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-neutral-200 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-700">Source document</p>
                <h2 className="truncate text-sm font-semibold text-neutral-900">{pdfViewer?.title || pdfLoadingTitle}</h2>
                {pdfViewer?.page && <p className="text-[11px] text-neutral-600">Opened at page {pdfViewer.page}</p>}
              </div>
              <button
                type="button"
                onClick={closePdfViewer}
                aria-label="Close PDF viewer"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-neutral-200 text-lg text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-100 hover:text-neutral-900"
              >
                Close
              </button>
            </header>
            {pdfLoading ? (
              <div className="flex flex-1 items-center justify-center text-sm text-neutral-700" role="status">Loading PDF…</div>
            ) : pdfViewer ? (
              <iframe
                key={pdfViewer.url}
                title={pdfViewer.title}
                src={pdfViewer.url + (pdfViewer.page ? "#page=" + pdfViewer.page : "")}
                className="min-h-0 w-full flex-1 bg-white"
              />
            ) : null}
          </section>
        </div>
      )}
      </div>
    </main>
  );
}
