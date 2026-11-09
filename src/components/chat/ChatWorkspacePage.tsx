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
  const [conversationSearch, setConversationSearch] = useState("");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
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
  const filteredConversations = conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(conversationSearch.trim().toLowerCase()),
  );

  function startNewChat() {
    if (sending) return;
    abortController.current?.abort();
    setMessages([]);
    setHistoryOffset(0);
    setHasOlderMessages(false);
    setError("");
    setMobileSidebarOpen(false);
    router.replace("/chat");
  }

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
    <main className="flex min-h-screen bg-white text-neutral-900">
      <button type="button" aria-label="Close navigation" onClick={() => setMobileSidebarOpen(false)} className={"fixed inset-0 z-30 bg-black/20 lg:hidden " + (mobileSidebarOpen ? "block" : "hidden")} />
      <aside className={"fixed inset-y-0 left-0 z-40 flex w-[260px] shrink-0 flex-col border-r border-neutral-200 bg-[#f9f9f9] transition-transform duration-200 lg:static lg:translate-x-0 " + (mobileSidebarOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center justify-between px-4 pb-4 pt-5">
          <Link href="/chat" className="text-[15px] font-semibold tracking-tight text-neutral-900">SaviraCortex</Link>
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
                        {message.status && (
                          <span className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] font-normal tracking-normal text-neutral-600">
                            {message.status.replaceAll("_", " ")}
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
