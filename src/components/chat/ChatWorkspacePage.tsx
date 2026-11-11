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
  checkpointId?: string;
  pathGroupId?: string;
  pathId?: string;
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
  parent_conversation_id?: string | null;
  branch_action?: string | null;
};

type StoredConversationMessage = {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: Partial<GenerationPayload> & {
    feedback_status?: "relevant" | "not_relevant" | null;
    guardrail_decision?: "blocked" | "redirected" | "redacted" | null;
    guardrail_categories?: string[];
    checkpoint_id?: string | null;
    path_group_id?: string | null;
    path_id?: string | null;
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
  checkpoint_id?: string | null;
};


type MessageActionIconName = "copy" | "edit" | "refresh" | "fork" | "thumb-up" | "thumb-down";

function MessageActionIcon({ name, className = "h-4 w-4" }: { name: MessageActionIconName; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<MessageActionIconName, React.ReactNode> = {
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    edit: <><path d="m15 5 4 4" /><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3" /></>,
    fork: <><circle cx="6" cy="4" r="2" /><circle cx="18" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M6 6v8a4 4 0 0 0 4 4h6M14 6h2" /></>,
    "thumb-up": <path d="M7 10v10H4a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h3Zm0 0 5-8c2 0 3 2 2 4l-1 4h6a2 2 0 0 1 2 2l-2 7a2 2 0 0 1-2 1H7" />,
    "thumb-down": <path d="M7 14V4H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h3Zm0 0 5 8c2 0 3-2 2-4l-1-4h6a2 2 0 0 0 2-2l-2-7a2 2 0 0 0-2-1H7" />,
  };
  return <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...common}>{paths[name]}</svg>;
}

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
    checkpointId: metadata.checkpoint_id || undefined,
    pathGroupId: metadata.path_group_id || undefined,
    pathId: metadata.path_id || undefined,
    guardrailCategories: metadata.guardrail_categories || [],
  };
}

function makeId() {
  return crypto.randomUUID();
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
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const pathMessagesCacheRef = useRef<Map<string, { messages: ChatMessage[]; historyOffset: number; hasOlderMessages: boolean }>>(new Map());
  const scrollAnchor = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const suppressAutoScroll = useRef(false);
  const pdfRequestId = useRef(0);
  const routeConversationIdRef = useRef(routeConversationId);
  routeConversationIdRef.current = routeConversationId;
  const refreshConversationListRef = useRef<() => void>(() => {});
  const skipNextPathReloadRef = useRef(false);
  const pendingRequestRef = useRef<{
    requestId: string;
    userMessageId: string;
    assistantMessageId: string;
    conversationId?: string;
    checkpointId?: string;
    pathGroupId?: string;
    pathId?: string;
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
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [branchBusy, setBranchBusy] = useState(false);
  const [pathOptionsByGroup, setPathOptionsByGroup] = useState<Record<string, Array<{ path_id: string | null; label: string }>>>({});
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
      const userMessageId = pending?.userMessageId || lastUserMessage?.id || "";
      if (pending && userMessageId) pending.userMessageId = userMessageId;
      return {
        body: {
          organization_id: selectedOrganizationId,
          conversation_id: pending?.conversationId || routeConversationId,
          ...(pending?.checkpointId ? { checkpoint_id: pending.checkpointId } : {}),
          ...(pending?.pathGroupId ? { path_group_id: pending.pathGroupId } : {}),
          ...(pending?.pathId ? { path_id: pending.pathId } : selectedPathId ? { path_id: selectedPathId } : {}),
          query: pending?.query || messageText,
          request_id: requestId,
          assistant_message_id: assistantMessageId,
          user_message_id: userMessageId,
          ...(pending?.piiAction ? { pii_action: pending.piiAction } : {}),
        },
      };
    },
  }), [selectedOrganizationId, routeConversationId, selectedPathId]);

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
        sdkSetMessagesRef.current?.((current) => {
          const sdkAssistantId = [...current].reverse().find((item) => item.role === "assistant")?.id;
          const sdkUserId = [...current].reverse().find((item) => item.role === "user")?.id;
          return current
            .filter((item) => item.id !== sdkAssistantId)
            .map((item) => item.id === sdkUserId
              ? { ...item, id: pending.userMessageId, metadata: { ...item.metadata, error: chatError.message } }
              : item);
        });
        pendingRequestRef.current = null;
      }
    },
    onFinish: ({ message }) => {
      setStreamingStage("");
      const pending = pendingRequestRef.current;
      if (pending?.consentRequired || pending?.failed) {
        sdkSetMessagesRef.current?.((current) => current.filter((item) => item.id !== message.id));
      }
      const conversationId = message.metadata?.conversationId;
      if (conversationId && !routeConversationIdRef.current) router.replace("/chat/" + conversationId);
      if (pending) {
        sdkSetMessagesRef.current?.((current) => {
          const sdkUserId = [...current].reverse().find((item) => item.role === "user")?.id;
          return current.map((item) => {
            if (item.id === message.id) return { ...item, id: pending.assistantMessageId };
            if (sdkUserId && item.id === sdkUserId) {
              return {
                ...item,
                id: pending.userMessageId,
                metadata: { ...item.metadata, ...(pending.pathGroupId ? { pathGroupId: pending.pathGroupId } : {}) },
              };
            }
            return item;
          });
        });
      }
      if (pending?.pathId) {
        const pathId = pending.pathId;
        const conversationId = pending.conversationId || routeConversationIdRef.current;
        void (async () => {
          const currentUser = auth?.currentUser;
          if (!currentUser || !conversationId) return;
          const token = await currentUser.getIdToken();
          const response = await fetch(
            `${API}/api/v1/organizations/${selectedOrganizationId}/conversations/${conversationId}/messages?limit=100&offset=0&path_id=${encodeURIComponent(pathId)}`,
            { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
          );
          if (!response.ok) return;
          const data = await response.json().catch(() => ({}));
          const items = (data.items || []) as StoredConversationMessage[];
          sdkSetMessagesRef.current?.(items.map((item) => toSaviraUIMessage(mapStoredMessage(item))));
          setHistoryOffset(items.length);
          setHasOlderMessages(Boolean(data.has_more));
        })().catch((err) => setError((err as Error).message));
      }
      if (!pendingRequestRef.current?.consentRequired) pendingRequestRef.current = null;
      refreshConversationListRef.current();
      window.setTimeout(() => refreshConversationListRef.current(), 3000);
    },
  });
  sdkSetMessagesRef.current = setSdkMessages;
  refreshConversationListRef.current = refreshConversationList;

  const messages = useMemo(() => sdkMessages.map(fromSaviraUIMessage), [sdkMessages]);
  const visibleMessages = messages;
  const pathGroupKey = useMemo(
    () => [...new Set(messages.filter((item) => item.role === "assistant" && item.pathGroupId).map((item) => item.pathGroupId!))].join("|"),
    [messages],
  );
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
    const pathId = new URLSearchParams(window.location.search).get("path");
    setSelectedPathId(pathId);
  }, [routeConversationId]);

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
    // Clear only when the conversation or organization changes. A timeline switch
    // must keep the currently rendered messages visible until its replacement loads.
    setMessages([]);
    setHistoryOffset(0);
    setHasOlderMessages(false);
    pathMessagesCacheRef.current.clear();
  }, [routeConversationId, selectedOrganizationId, setMessages]);

  useEffect(() => {
    const currentUser = auth?.currentUser;
    let active = true;
    if (!routeConversationId || !selectedOrganizationId || !currentUser) {
      setLoadingConversation(false);
      return () => { active = false; };
    }

    if (skipNextPathReloadRef.current) {
      skipNextPathReloadRef.current = false;
      return () => { active = false; };
    }
    const cacheKey = `${selectedOrganizationId}:${routeConversationId}:${selectedPathId || "base"}`;
    const cachedPath = pathMessagesCacheRef.current.get(cacheKey);
    if (cachedPath) {
      setMessages(cachedPath.messages);
      setHistoryOffset(cachedPath.historyOffset);
      setHasOlderMessages(cachedPath.hasOlderMessages);
      setLoadingConversation(false);
      return () => { active = false; };
    }
    const loadConversation = async () => {
      setLoadingConversation(true);
      try {
        const token = await currentUser.getIdToken();
        const response = await fetch(
          `${API}/api/v1/organizations/${selectedOrganizationId}/conversations/${routeConversationId}/messages?limit=100&offset=0${selectedPathId ? `&path_id=${encodeURIComponent(selectedPathId)}` : ""}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || "Could not load this conversation.");
        if (!active) return;
        const items = (data.items || []) as StoredConversationMessage[];
        const loadedMessages = items.map(mapStoredMessage);
        pathMessagesCacheRef.current.set(cacheKey, { messages: loadedMessages, historyOffset: items.length, hasOlderMessages: Boolean(data.has_more) });
        setMessages(loadedMessages);
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
  }, [routeConversationId, selectedOrganizationId, selectedPathId, setMessages]);

  useEffect(() => {
    const currentUser = auth?.currentUser;
    if (!routeConversationId || !selectedOrganizationId || !currentUser || !pathGroupKey) {
      setPathOptionsByGroup({});
      return;
    }
    let active = true;
    const loadPathOptions = async () => {
      const groups = pathGroupKey ? pathGroupKey.split("|") : [];
      if (!groups.length) {
        setPathOptionsByGroup({});
        return;
      }
      const token = await currentUser.getIdToken();
      const entries = await Promise.all(groups.map(async (groupId) => {
        const response = await fetch(`${API}/api/v1/organizations/${selectedOrganizationId}/conversations/${routeConversationId}/paths?branch_point_message_id=${encodeURIComponent(groupId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        if (!response.ok) return [groupId, []] as const;
        const data = await response.json().catch(() => ({}));
        return [groupId, (data.items || []) as Array<{ path_id: string | null; label: string }>] as const;
      }));
      if (active) setPathOptionsByGroup(Object.fromEntries(entries));
    };
    void loadPathOptions().catch((err) => { if (active) setError((err as Error).message); });
    return () => { active = false; };
  }, [pathGroupKey, routeConversationId, selectedOrganizationId]);

  async function switchTimeline(pathId: string | null) {
    if (!routeConversationId || !selectedOrganizationId || !auth?.currentUser || sending || branchBusy) return;
    const currentCacheKey = `${selectedOrganizationId}:${routeConversationId}:${selectedPathId || "base"}`;
    pathMessagesCacheRef.current.set(currentCacheKey, { messages, historyOffset, hasOlderMessages });
    setBranchBusy(true);
    try {
      const suffix = pathId ? `?path=${encodeURIComponent(pathId)}` : "";
      setSelectedPathId(pathId);
      router.replace(`/chat/${routeConversationId}${suffix}`);
    } finally {
      setBranchBusy(false);
    }
  }

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
    setSelectedPathId(null);
    setEditingMessageId(null);
    setBranchBusy(false);
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
    branchTarget?: { conversationId: string; query: string; checkpointId?: string; pathGroupId?: string; pathId?: string },
  ) {
    event?.preventDefault();
    const query = retry?.query || branchTarget?.query || draft.trim();
    if (!query || sending || (branchBusy && !branchTarget) || !selectedOrganizationId) return;
    if (!auth?.currentUser) {
      router.replace("/login");
      return;
    }

    let destinationConversationId = branchTarget?.conversationId || routeConversationId || undefined;
    let requestCheckpointId = branchTarget?.checkpointId;
    let requestPathGroupId = branchTarget?.pathGroupId;
    let requestPathId = branchTarget?.pathId || selectedPathId || undefined;
    if (editingMessageId && routeConversationId && !branchTarget && !retry) {
      const editedMessage = messages.find((message) => message.id === editingMessageId);
      if (!editedMessage || editedMessage.role !== "user") {
        setEditingMessageId(null);
        return;
      }
      setBranchBusy(true);
      try {
        const token = await auth.currentUser.getIdToken();
        const response = await fetch(
          `${API}/api/v1/organizations/${selectedOrganizationId}/conversations/${routeConversationId}/branches`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ action: "edit_input", target_message_id: editingMessageId, edited_query: query }),
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || "Could not create an edited conversation branch.");
        destinationConversationId = String(data.conversation_id);
        requestCheckpointId = data.parent_checkpoint_id ? String(data.parent_checkpoint_id) : undefined;
        requestPathGroupId = data.path_group_id ? String(data.path_group_id) : editingMessageId;
        requestPathId = String(data.path_id);
        const targetIndex = messages.findIndex((message) => message.id === editingMessageId);
        setMessages(messages.slice(0, Math.max(0, targetIndex)));
        skipNextPathReloadRef.current = true;
        setSelectedPathId(requestPathId);
        router.replace(`/chat/${routeConversationId}?path=${encodeURIComponent(requestPathId)}`);
        // The edit continues in this conversation; it does not create a sidebar chat.
        setEditingMessageId(null);
      } catch (err) {
        setError((err as Error).message);
        setBranchBusy(false);
        return;
      } finally {
        setBranchBusy(false);
      }
    }

    const requestId = retry?.requestId || crypto.randomUUID();
    const userMessageId = retry?.userMessageId || makeId();
    const assistantMessageId = makeId();
    pendingRequestRef.current = {
      requestId,
      userMessageId,
      assistantMessageId,
      conversationId: destinationConversationId,
      checkpointId: requestCheckpointId,
      pathGroupId: requestPathGroupId,
      pathId: requestPathId,
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
    setStreamingStage("Connecting to SaviraCortex...");

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

  async function createTimeTravelBranch(
    action: "regenerate" | "fork",
    targetMessageId: string,
  ) {
    if (!routeConversationId || !selectedOrganizationId || !auth?.currentUser || sending || branchBusy) return;
    setBranchBusy(true);
    setError("");
    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetch(
        `${API}/api/v1/organizations/${selectedOrganizationId}/conversations/${routeConversationId}/branches`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action, target_message_id: targetMessageId }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Could not create the conversation branch.");
      const destinationId = String(data.conversation_id);
      if (action === "fork") {
        router.push("/chat/" + destinationId);
        await refreshConversationList();
      } else {
        const targetIndex = messages.findIndex((item) => item.id === targetMessageId);
        const userIndex = action === "regenerate"
          ? messages.findIndex((item, index) => index < targetIndex && item.role === "user" && messages.slice(index + 1, targetIndex).every((next) => next.role !== "user"))
          : targetIndex;
        const pathGroupId = String(data.path_group_id || data.parent_message_id);
        const pathId = String(data.path_id);
        setMessages(messages.slice(0, Math.max(0, userIndex)));
        skipNextPathReloadRef.current = true;
        setSelectedPathId(pathId);
        router.replace(`/chat/${destinationId}?path=${encodeURIComponent(pathId)}`);
        setBranchBusy(false);
        void sendMessage(undefined, undefined, undefined, {
          conversationId: destinationId, pathId,
          checkpointId: data.parent_checkpoint_id ? String(data.parent_checkpoint_id) : undefined,
          pathGroupId, query: String(data.query || ""),
        });
        return;
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBranchBusy(false);
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
        `${API}/api/v1/organizations/${selectedOrganizationId}/conversations/${routeConversationId}/messages?limit=20&offset=${historyOffset}${selectedPathId ? `&path_id=${encodeURIComponent(selectedPathId)}` : ""}`,
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

  async function copyMessage(message: ChatMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1600);
    } catch {
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, feedbackError: "Clipboard access was unavailable." } : item));
    }
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
            <button key={conversation.conversation_id} type="button" onClick={() => { setSelectedPathId(null); router.push("/chat/" + conversation.conversation_id); setMobileSidebarOpen(false); }} title={conversation.title} className={"flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs transition " + (routeConversationId === conversation.conversation_id ? "bg-neutral-200/80 text-neutral-900" : "text-neutral-700 hover:bg-neutral-200/60")}>
              {conversation.branch_action && <span aria-label="Branch" title="Conversation branch" className="rounded bg-neutral-100 px-1.5 py-0.5 text-[9px] text-neutral-500">Branch</span>}
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

              {visibleMessages.map((message) => (
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
                  {message.role === "user" && (
                    <div className="mt-2 flex items-center justify-end gap-1 px-1 text-neutral-500">
                      {routeConversationId && !sending && <button type="button" onClick={() => { setEditingMessageId(message.id); setDraft(message.content); }} title="Edit and branch" aria-label="Edit and branch" className="rounded-lg p-2 transition hover:bg-neutral-100 hover:text-neutral-900"><MessageActionIcon name="edit" /></button>}
                      <button type="button" onClick={() => void copyMessage(message)} title="Copy message" aria-label="Copy message" className="rounded-lg p-2 transition hover:bg-neutral-100 hover:text-neutral-900"><MessageActionIcon name="copy" /></button>
                      {copiedMessageId === message.id && <span className="pr-1 text-[11px]">Copied</span>}
                    </div>
                  )}
                  {message.role === "assistant" && (
                    <div className="mt-3 flex items-center gap-1 px-1 text-neutral-500">
                      <button type="button" onClick={() => void copyMessage(message)} title="Copy response" aria-label="Copy response" className="rounded-lg p-2 transition hover:bg-neutral-100 hover:text-neutral-900"><MessageActionIcon name="copy" /></button>
                      {message.generationId && <div className="ml-1 inline-flex items-center rounded-lg border border-neutral-200 bg-white p-0.5">
                        <button type="button" onClick={() => void submitFeedback(message.id, message.generationId!, "relevant")} disabled={message.feedbackSaving} title="Helpful" aria-label="Helpful" aria-pressed={message.feedbackStatus === "relevant"} className={"rounded-md p-1.5 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40 " + (message.feedbackStatus === "relevant" ? "bg-neutral-100 text-neutral-900" : "")}><MessageActionIcon name="thumb-up" /></button>
                        <button type="button" onClick={() => void submitFeedback(message.id, message.generationId!, "not_relevant")} disabled={message.feedbackSaving} title="Not helpful" aria-label="Not helpful" aria-pressed={message.feedbackStatus === "not_relevant"} className={"rounded-md p-1.5 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40 " + (message.feedbackStatus === "not_relevant" ? "bg-neutral-100 text-neutral-900" : "")}><MessageActionIcon name="thumb-down" /></button>
                      </div>}
                      {message.pathGroupId && (pathOptionsByGroup[message.pathGroupId]?.length || 0) > 1 && (() => {
                        // Guard against duplicate IDs in stale API responses: duplicates
                        // make the counter jump and can incorrectly disable Next.
                        const versions = (pathOptionsByGroup[message.pathGroupId!] || [])
                          .filter((version, index, all) =>
                            all.findIndex((candidate) => candidate.path_id === version.path_id) === index
                          );
                        const matchedIndex = versions.findIndex((version) => version.path_id === selectedPathId);
                        const activeIndex = matchedIndex >= 0 ? matchedIndex : 0;
                        return <div className="ml-1 inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-1 py-0.5 text-[11px] text-neutral-600" aria-label="Conversation timeline versions">
                          <button type="button" disabled={branchBusy || loadingConversation || activeIndex <= 0} onClick={() => void switchTimeline(versions[activeIndex - 1]?.path_id ?? null)} title="Previous timeline" aria-label="Previous timeline" className="grid h-6 w-6 place-items-center rounded-full hover:bg-neutral-100 disabled:opacity-30">‹</button>
                          <span className="min-w-[2.5rem] text-center tabular-nums">{Math.max(1, activeIndex + 1)} / {versions.length}</span>
                          <button type="button" disabled={branchBusy || loadingConversation || activeIndex < 0 || activeIndex >= versions.length - 1} onClick={() => void switchTimeline(versions[activeIndex + 1]?.path_id ?? null)} title="Next timeline" aria-label="Next timeline" className="grid h-6 w-6 place-items-center rounded-full hover:bg-neutral-100 disabled:opacity-30">›</button>
                        </div>;
                      })()}
                      {routeConversationId && <button type="button" disabled={sending || branchBusy || !message.checkpointId} onClick={() => void createTimeTravelBranch("regenerate", message.id)} title={message.checkpointId ? "Regenerate answer" : "Checkpoint unavailable for this older message"} aria-label="Regenerate answer" className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700 shadow-sm transition hover:border-neutral-500 hover:bg-neutral-100 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"><MessageActionIcon name="refresh" className="h-[18px] w-[18px]" /></button>}
                      {routeConversationId && <button type="button" disabled={sending || branchBusy || !message.checkpointId} onClick={() => void createTimeTravelBranch("fork", message.id)} title={message.checkpointId ? "Fork from here" : "Checkpoint unavailable for this older message"} aria-label="Fork from here" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-700 shadow-sm transition hover:border-neutral-500 hover:bg-neutral-100 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"><MessageActionIcon name="fork" className="h-[18px] w-[18px]" /></button>}
                      {copiedMessageId === message.id && <span className="pl-1 text-[11px]">Copied</span>}
                      {message.feedbackSaving && <span className="pl-1 text-[11px]">Saving...</span>}
                      {message.feedbackStatus && !message.feedbackSaving && <span className="pl-1 text-[11px]">{message.feedbackStatus === "relevant" ? "Thanks for the feedback" : "Feedback received"}</span>}
                      {message.feedbackError && <span role="alert" className="pl-1 text-[11px] text-red-600">{message.feedbackError}</span>}
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
              {editingMessageId && (
                <div className="mx-auto mb-2 flex max-w-3xl items-center justify-between rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-700">
                  <span>Editing an earlier message. The conversation will continue from that point.</span>
                  <button type="button" onClick={() => { setEditingMessageId(null); setDraft(""); }} className="font-medium text-neutral-600 hover:text-neutral-950">Cancel</button>
                </div>
              )}
              {branchBusy && <p className="mx-auto mb-2 max-w-3xl text-xs text-neutral-500" role="status">Creating a new conversation path...</p>}
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
                      disabled={sending || branchBusy || !draft.trim()}
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
