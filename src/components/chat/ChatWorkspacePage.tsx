"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { FormEvent, useEffect, useRef, useState } from "react";
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
};

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
  metadata?: Partial<GenerationPayload> & { feedback_status?: "relevant" | "not_relevant" | null };
};

type GenerationPayload = {
  generation_id: string;
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
    generationId: metadata.generation_id,
    feedbackStatus: metadata.feedback_status || undefined,
  };
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
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
  const abortController = useRef<AbortController | null>(null);
  const pdfRequestId = useRef(0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [loadingProfile, setLoadingProfile] = useState(Boolean(auth));
  const [sending, setSending] = useState(false);
  const [streamingStage, setStreamingStage] = useState("");
  const [error, setError] = useState(firebaseConfigError);
  const [pdfViewer, setPdfViewer] = useState<{ url: string; title: string; page: number | null } | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfLoadingTitle, setPdfLoadingTitle] = useState("Source document");

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

  useEffect(() => () => abortController.current?.abort(), []);

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
  }, [routeConversationId, selectedOrganizationId]);

  const selectedOrganization = profile?.organizations.find(
    (organization) => organization.organization_id === selectedOrganizationId,
  );

  async function sendMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const query = draft.trim();
    if (!query || sending || !selectedOrganizationId) return;

    const currentUser = auth?.currentUser;
    if (!currentUser) {
      router.replace("/login");
      return;
    }

    const requestId = crypto.randomUUID();
    const userMessage: ChatMessage = { id: makeId(), role: "user", content: query };
    const assistantId = makeId();
    const controller = new AbortController();
    abortController.current = controller;

    setMessages((current) => [...current, userMessage, {
      id: assistantId, role: "assistant", content: "", citations: [],
    }]);
    setDraft("");
    setError("");
    setStreamingStage("Connecting to SaviraCortex…");
    setSending(true);

    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(
        `${API}/api/v1/organizations/${selectedOrganizationId}/generation/stream`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            query,
            conversation_id: routeConversationId,
            request_id: requestId,
          }),
          signal: controller.signal,
          cache: "no-store",
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || `Generation failed (HTTP ${response.status}).`);
      }
      if (!response.body) throw new Error("The server did not open a response stream.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;

      const processFrame = (frame: string) => {
        if (!frame.trim()) return;
        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }
        if (!dataLines.length) return;
        const payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;

        if (eventName === "status") {
          setStreamingStage(String(payload.message || "Preparing your answer…"));
        } else if (eventName === "delta") {
          const delta = typeof payload.delta === "string" ? payload.delta : "";
          if (delta) {
            setMessages((current) => current.map((message) =>
              message.id === assistantId ? { ...message, content: message.content + delta } : message,
            ));
          }
          setStreamingStage("Writing answer…");
        } else if (eventName === "completed") {
          const result = payload.result as GenerationPayload | undefined;
          if (!result) throw new Error("The server completed without a validated answer.");
          completed = true;
          void refreshConversationList();
          window.setTimeout(() => void refreshConversationList(), 3000);
          if (result.conversation_id && !routeConversationId) {
            router.replace(`/chat/${result.conversation_id}`);
          }
          setMessages((current) => current.map((message) => message.id === assistantId ? {
            ...message,
            content: result.answer,
            generationId: result.generation_id,
            status: result.status,
            citations: result.citations || [],
            warnings: result.warnings || [],
            missingInformation: result.missing_information || [],
          } : message));
          setStreamingStage("");
        } else if (eventName === "error") {
          if (typeof payload.conversation_id === "string" && !routeConversationId) {
            router.replace(`/chat/${payload.conversation_id}`);
            void refreshConversationList();
          }
          throw new Error(String(payload.message || "Generation failed. Please retry."));
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || "";
        for (const frame of frames) processFrame(frame);
        if (done) break;
      }
      if (buffer.trim()) processFrame(buffer);
      if (!completed) throw new Error("The response stream ended before citation validation completed.");
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      setMessages((current) => current.filter((message) => message.id !== assistantId));
      if (!aborted) setError((err as Error).message || "Something went wrong. Please try again.");
    } finally {
      abortController.current = null;
      setSending(false);
      setStreamingStage("");
    }
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

  function stopGeneration() {
    abortController.current?.abort();
  }

  function changeOrganization(value: string) {
    abortController.current?.abort();
    setSelectedOrganizationId(value);
    window.localStorage.setItem("savira.selectedOrganizationId", value);
    setMessages([]);
    setConversations([]);
    setError("");
    router.replace("/chat");
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#07101a] text-slate-100">
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#08121d]/90 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/dashboard" aria-label="Back to dashboard" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-cyan-300/40 hover:text-cyan-200">
              <span aria-hidden="true">←</span>
            </Link>
            <div className="min-w-0">
              <Link href="/dashboard" className="text-xs font-semibold tracking-wide text-slate-400 hover:text-cyan-200">
                SAVIRA<span className="text-cyan-300">CORTEX</span>
              </Link>
              <h1 className="truncate text-base font-semibold text-white sm:text-lg">Knowledge assistant</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {sending && <button type="button" onClick={stopGeneration} className="rounded-xl border border-rose-300/20 px-3 py-2.5 text-xs text-rose-200 transition hover:bg-rose-300/10">Stop</button>}
            <label htmlFor="chat-organization" className="hidden text-xs text-slate-500 sm:block">Workspace</label>
            <select
              id="chat-organization"
              value={selectedOrganizationId}
              onChange={(event) => changeOrganization(event.target.value)}
              disabled={loadingProfile || !profile?.organizations.length || sending}
              className="max-w-[190px] rounded-xl border border-white/10 bg-[#0c1b29] px-3 py-2.5 text-xs text-slate-200 outline-none transition focus:border-cyan-300/50 sm:max-w-[250px] sm:text-sm"
            >
              {profile?.organizations.map((organization) => (
                <option key={organization.organization_id} value={organization.organization_id}>
                  {organization.organization_name}
                </option>
              ))}
            </select>
            <select
              aria-label="Open a previous conversation"
              value={routeConversationId || ""}
              onChange={(event) => {
                const value = event.target.value;
                router.push(value ? `/chat/${value}` : "/chat");
              }}
              disabled={sending || !selectedOrganizationId}
              className="max-w-[170px] rounded-xl border border-white/10 bg-[#0c1b29] px-2 py-2.5 text-[11px] text-slate-200 outline-none sm:max-w-[220px] sm:text-xs"
            >
              <option value="">Recent conversations</option>
              {conversations.map((conversation) => (
                <option key={conversation.conversation_id} value={conversation.conversation_id}>
                  {conversation.title}
                </option>
              ))}
            </select>
            {routeConversationId && (
              <>
                <button type="button" onClick={() => void renameCurrentConversation()} disabled={sending} className="rounded-xl border border-white/10 px-2.5 py-2.5 text-[11px] text-slate-400 transition hover:border-cyan-200/30 hover:text-cyan-100 disabled:opacity-40">Rename</button>
                <button type="button" onClick={() => void deleteCurrentConversation()} disabled={sending} className="rounded-xl border border-rose-300/20 px-2.5 py-2.5 text-[11px] text-rose-200 transition hover:bg-rose-300/10 disabled:opacity-40">Delete</button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                abortController.current?.abort();
                setMessages([]);
                setHistoryOffset(0);
                setHasOlderMessages(false);
                setError("");
                router.replace("/chat");
              }}
              disabled={sending}
              className="rounded-xl border border-white/10 px-2.5 py-2.5 text-[11px] text-slate-400 transition hover:border-white/20 hover:text-white disabled:opacity-40 sm:px-3 sm:text-xs"
            >
              New chat
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 sm:px-6">
        <div className="flex items-center justify-between gap-3 py-5">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.65)]" />
            Answers grounded in authorized organization documents
          </div>
          {selectedOrganization && (
            <span className="hidden max-w-[45%] truncate rounded-full border border-cyan-300/15 bg-cyan-300/[0.06] px-3 py-1 text-[11px] text-cyan-100/80 sm:inline">
              {selectedOrganization.organization_name}
            </span>
          )}
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-xl border border-rose-400/25 bg-rose-400/[0.07] px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        {loadingProfile ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
            Loading your workspace…
          </div>
        ) : !profile?.organizations.length ? (
          <div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.07] text-2xl text-cyan-200">⌘</div>
            <h2 className="mt-6 text-xl font-semibold text-white">No organization yet</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">
              Create an organization or accept an invitation before asking questions about its knowledge base.
            </p>
            <Link href="/dashboard" className="mt-6 rounded-xl bg-cyan-200 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100">
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
              className="min-h-[45vh] max-h-[calc(100vh-290px)] overflow-y-auto space-y-6 pb-8 pt-4 pr-2"
            >
              {loadingOlder && <p className="py-2 text-center text-xs text-slate-500">Loading older messages…</p>}
              {loadingConversation && <p className="py-2 text-center text-xs text-slate-500">Loading conversation…</p>}
              {!messages.length && !loadingConversation && (
                <div className="flex min-h-[48vh] flex-col items-center justify-center py-12 text-center">
                  <div className="relative grid h-20 w-20 place-items-center rounded-[26px] border border-cyan-200/25 bg-gradient-to-br from-cyan-300/15 to-blue-400/[0.06] shadow-[0_0_65px_rgba(34,211,238,.10)]">
                    <span className="text-3xl font-semibold text-cyan-100">S</span>
                    <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[#07101a] bg-emerald-400" />
                  </div>
                  <p className="mt-7 text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-300/80">Your organization’s knowledge</p>
                  <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                    What would you like to understand?
                  </h2>
                  <p className="mt-3 max-w-xl text-sm leading-7 text-slate-400">
                    Ask a question. SaviraCortex searches the documents you’re authorized to access and returns an answer with source references.
                  </p>
                  <div className="mt-8 grid w-full max-w-3xl gap-3 sm:grid-cols-3">
                    {starterPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => setDraft(prompt)}
                        className="rounded-2xl border border-white/[0.09] bg-white/[0.025] p-4 text-left text-xs leading-5 text-slate-300 transition hover:-translate-y-0.5 hover:border-cyan-200/30 hover:bg-cyan-200/[0.04] hover:text-white"
                      >
                        {prompt}
                        <span className="mt-3 block text-cyan-300">Use prompt ↗</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((message) => (
                <article key={message.id} className={message.role === "user" ? "ml-auto max-w-3xl" : "mr-auto max-w-4xl"}>
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {message.role === "assistant" ? (
                      <>
                        <span className="grid h-6 w-6 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-300/[0.08] text-[11px] text-cyan-100">S</span>
                        SaviraCortex
                        {message.status && (
                          <span className={message.status === "insufficient_evidence" ? "rounded-full border border-amber-300/20 bg-amber-300/[0.07] px-2 py-1 text-[9px] tracking-normal text-amber-200" : "rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-2 py-1 text-[9px] tracking-normal text-emerald-200"}>
                            {message.status.replaceAll("_", " ")}
                          </span>
                        )}
                      </>
                    ) : (
                      <>You</>
                    )}
                  </div>
                  <div className={message.role === "user" ? "rounded-2xl rounded-tr-md border border-cyan-200/15 bg-cyan-200/[0.08] px-5 py-4 text-sm leading-7 text-slate-100" : "rounded-2xl rounded-tl-md border border-white/[0.08] bg-[#0c1a28] px-5 py-5 text-sm leading-7 text-slate-200 shadow-xl shadow-black/10"}>
                    {message.role === "assistant" ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          h1: ({ children }) => <h1 className="mb-4 mt-2 text-2xl font-semibold tracking-tight text-white">{children}</h1>,
                          h2: ({ children }) => (
                            <h2 id={String(children).trim().toLowerCase() === "references" ? "references" : undefined} className="mb-3 mt-6 border-b border-white/[0.07] pb-2 text-lg font-semibold text-white first:mt-0">{children}</h2>
                          ),
                          h3: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold text-slate-100">{children}</h3>,
                          p: ({ children }) => <p className="mb-3 whitespace-pre-wrap leading-7 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="mb-4 list-disc space-y-1 pl-6 marker:text-cyan-300">{children}</ul>,
                          ol: ({ children }) => <ol className="mb-4 list-decimal space-y-1 pl-6 marker:text-cyan-300">{children}</ol>,
                          li: ({ children }) => <li className="pl-1 leading-7">{children}</li>,
                          strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                          blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-cyan-300/50 pl-4 text-slate-400">{children}</blockquote>,
                          a: ({ href, children }) => {
                            const citationNumber = href === "#references" ? Number(String(children).trim()) : 0;
                            const citation = citationNumber > 0
                              ? message.citations?.find((item) => item.evidence_id === "E" + citationNumber)
                              : undefined;
                            if (citation) {
                              return (
                                <span className="mx-0.5 inline-flex whitespace-nowrap" key={citation.evidence_id}>
                                  <span aria-hidden="true">[</span>
                                  <button type="button" onClick={() => void openCitation(citation)} aria-label={"Open source " + citationNumber} title={"Open " + (citation.document_title || "source document") + (citation.page ? ", page " + citation.page : "")} className="font-semibold text-cyan-200 underline decoration-cyan-200/30 underline-offset-4 hover:text-cyan-100">{children}</button>
                                  <span aria-hidden="true">]</span>
                                </span>
                              );
                            }
                            return <a href={href} className="font-semibold text-cyan-200 underline decoration-cyan-200/30 underline-offset-4 hover:text-cyan-100">{children}</a>;
                          },
                          table: ({ children }) => <div className="my-4 overflow-x-auto"><table className="w-full border-collapse text-left text-xs">{children}</table></div>,
                          th: ({ children }) => <th className="border border-white/10 bg-white/[0.04] px-3 py-2 font-semibold text-white">{children}</th>,
                          td: ({ children }) => <td className="border border-white/10 px-3 py-2 align-top">{children}</td>,
                          pre: ({ children }) => <pre className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-[#07101a] p-4 text-xs leading-6">{children}</pre>,
                          code: ({ children }) => <code className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[0.9em] text-cyan-100">{children}</code>,
                          hr: () => <hr className="my-5 border-white/10" />,
                        }}
                      >
                        {linkCitationMarkers(message.content)}
                      </ReactMarkdown>
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}
                    {!!message.missingInformation?.length && (
                      <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-200">Evidence still missing</p>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-400">
                          {message.missingInformation.map((item, index) => <li key={index}>{item}</li>)}
                        </ul>
                      </div>
                    )}
                    {!!message.warnings?.length && (
                      <ul className="mt-3 space-y-1 text-[11px] leading-5 text-amber-200/70">
                        {message.warnings.map((warning, index) => <li key={index}>Note: {warning}</li>)}
                      </ul>
                    )}
                  </div>
                  {message.role === "assistant" && message.generationId && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 px-1 text-xs">
                      <span className="mr-1 text-slate-500">Was this answer relevant?</span>
                      <button
                        type="button"
                        onClick={() => void submitFeedback(message.id, message.generationId!, "relevant")}
                        disabled={message.feedbackSaving}
                        aria-label="Mark answer as relevant"
                        aria-pressed={message.feedbackStatus === "relevant"}
                        className={"rounded-lg border px-3 py-1.5 transition disabled:opacity-50 " + (
                          message.feedbackStatus === "relevant"
                            ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-200"
                            : "border-white/10 text-slate-400 hover:border-emerald-300/30 hover:text-emerald-200"
                        )}
                      >
                        &#128077; Relevant
                      </button>
                      <button
                        type="button"
                        onClick={() => void submitFeedback(message.id, message.generationId!, "not_relevant")}
                        disabled={message.feedbackSaving}
                        aria-label="Mark answer as not relevant"
                        aria-pressed={message.feedbackStatus === "not_relevant"}
                        className={"rounded-lg border px-3 py-1.5 transition disabled:opacity-50 " + (
                          message.feedbackStatus === "not_relevant"
                            ? "border-rose-300/40 bg-rose-300/10 text-rose-200"
                            : "border-white/10 text-slate-400 hover:border-rose-300/30 hover:text-rose-200"
                        )}
                      >
                        &#128078; Not relevant
                      </button>
                      {message.feedbackSaving && <span className="text-slate-500">Saving...</span>}
                      {message.feedbackError && <span role="alert" className="text-rose-300">{message.feedbackError}</span>}
                    </div>
                  )}
                </article>
              ))}

              {sending && (
                <div className="mr-auto flex max-w-4xl items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#0c1a28] px-5 py-4 text-xs text-slate-400" role="status" aria-live="polite">
                  <span className="flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300 [animation-delay:-.2s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300 [animation-delay:-.1s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300" />
                  </span>
                  {streamingStage || "Working on your answer…"}
                </div>
              )}
              <div ref={scrollAnchor} />
            </div>

            <div className="sticky bottom-0 -mx-4 border-t border-white/[0.07] bg-[#07101a]/95 px-4 pb-5 pt-4 backdrop-blur-xl sm:-mx-6 sm:px-6">
              <form onSubmit={sendMessage} className="mx-auto max-w-4xl">
                <div className="rounded-2xl border border-white/10 bg-[#0c1b29] p-2 shadow-2xl shadow-black/20 transition focus-within:border-cyan-200/30">
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
                    placeholder="Ask a question about your organization’s documents…"
                    disabled={sending}
                    className="max-h-40 min-h-[58px] w-full resize-y bg-transparent px-3 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-600 disabled:opacity-60"
                  />
                  <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-2 pt-2">
                    <p className="text-[10px] text-slate-600">Enter to send · Shift + Enter for a new line</p>
                    <button
                      type="submit"
                      disabled={sending || !draft.trim()}
                      className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-200 to-sky-300 px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {sending ? "Working…" : "Send"}
                      <span aria-hidden="true">↗</span>
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-center text-[10px] text-slate-600">
                  Conversations are saved to your workspace. Sources are limited to documents you are authorized to access.
                </p>
              </form>
            </div>
          </>
        )}
      </section>
      {(pdfViewer || pdfLoading) && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/70 p-2 backdrop-blur-sm sm:p-5"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePdfViewer();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="PDF source viewer"
            className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#081522] shadow-2xl shadow-black/50"
          >
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300">Source document</p>
                <h2 className="truncate text-sm font-semibold text-white">{pdfViewer?.title || pdfLoadingTitle}</h2>
                {pdfViewer?.page && <p className="text-[11px] text-slate-400">Opened at page {pdfViewer.page}</p>}
              </div>
              <button
                type="button"
                onClick={closePdfViewer}
                aria-label="Close PDF viewer"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 text-lg text-slate-300 transition hover:border-white/25 hover:bg-white/[0.06] hover:text-white"
              >
                ×
              </button>
            </header>
            {pdfLoading ? (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-300" role="status">Loading PDF…</div>
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
    </main>
  );
}
