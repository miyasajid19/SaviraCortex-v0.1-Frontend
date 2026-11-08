"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { auth } from "./firebase";

type Organization = { organization_id: string; organization_name: string };
type Department = { id: string; name: string };
type OpenDetail = { organization: Organization; uploaderId: string; departments: Department[]; targetDocumentId?: string; targetDocumentTitle?: string };
type Analysis = {
  status: "ready_for_review" | "duplicate";
  ingestion_session_id: string | null;
  original_filename: string;
  file_size: number;
  file_hash: string;
  content_hash: string;
  page_count: number;
  title: string | null;
  document_type: string | null;
  description: string | null;
  summary: string | null;
  matching_classification: string;
  matching_candidates: Array<{ document_id: string; title: string; version_number: number; similarity_score: number | null }>;
  validation_warnings: string[];
};
type BatchItem = {
  item_id: number;
  filename: string;
  status: "queued" | "processing" | "ready_for_review" | "duplicate" | "failed" | "indexed" | "indexing_failed" | "rejected";
  stage?: string;
  message?: string;
  analysis?: Analysis;
  error?: string;
  finalizeStatus?: string;
};
type BatchEvent =
  | { type: "batch_started"; batch_id: string; total: number; max_workers: number; max_queued: number }
  | { type: "progress"; item_id: number; filename: string; stage: string; state: string; message?: string }
  | { type: "item_result"; data: { item_id: number; filename: string; status: string; data?: Analysis; error?: string } }
  | { type: "completed"; total: number };

const API = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
const MAX_FILES = 50;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_BATCH_SIZE = 250 * 1024 * 1024;

function messageFrom(data: unknown, fallback: string) {
  return data && typeof data === "object" && "detail" in data && typeof data.detail === "string" ? data.detail : fallback;
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function BatchIngestionWidget() {
  const [context, setContext] = useState<OpenDetail | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const [batchTotal, setBatchTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState("General document");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [targetDocumentId, setTargetDocumentId] = useState("");
  const [archived, setArchived] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenDetail>).detail;
      if (!detail?.organization?.organization_id) return;
      setContext(detail);
      setIsOpen(true);
      setError("");
    };
    window.addEventListener("savira:open-ingestion", onOpen);
    return () => window.removeEventListener("savira:open-ingestion", onOpen);
  }, []);

  const selectedItem = useMemo(() => items.find((item) => item.item_id === selectedId) ?? null, [items, selectedId]);
  const completedCount = items.filter((item) => ["duplicate", "indexed", "rejected"].includes(item.status)).length;
  const reviewCount = items.filter((item) => item.status === "ready_for_review").length;
  const activeCount = items.filter((item) => item.status === "processing" || item.status === "queued").length;
  const progressPercent = batchTotal ? Math.round((completedCount / batchTotal) * 100) : 0;
  const hasBatch = items.length > 0;
  const batchSettled = !isRunning && hasBatch && items.every((item) => ["duplicate", "indexed", "rejected"].includes(item.status));

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files ?? []);
    setError("");
    if (incoming.length > MAX_FILES) {
      setError(`A batch can contain at most ${MAX_FILES} PDF files.`);
      setFiles([]);
      event.target.value = "";
      return;
    }
    const totalSize = incoming.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_BATCH_SIZE) {
      setError("The selected batch exceeds the 250 MB total upload limit.");
      setFiles([]);
      event.target.value = "";
      return;
    }
    const invalid = incoming.find((file) => !file.name.toLowerCase().endsWith(".pdf") || file.size <= 0 || file.size > MAX_FILE_SIZE);
    if (invalid) {
      setError(`${invalid.name}: choose a non-empty PDF no larger than 25 MB.`);
      setFiles([]);
      event.target.value = "";
      return;
    }
    setFiles(incoming);
  }

  async function token(forceRefresh = false) {
    if (!auth?.currentUser) throw new Error("Your sign-in session has expired. Sign in again.");
    return auth.currentUser.getIdToken(forceRefresh);
  }

  async function startBatch() {
    if (!context || !files.length || isRunning) return;
    setError("");
    setItems(files.map((file, index) => ({ item_id: index, filename: file.name, status: "queued" })));
    setBatchTotal(files.length);
    setIsRunning(true);
    setSelectedId(null);
    setTitle("");
    setDescription("");

    try {
      const send = async (bearer: string) => {
        const form = new FormData();
        files.forEach((file) => form.append("files", file));
        return fetch(`${API}/api/v1/organizations/${context.organization.organization_id}/documents/ingestion-batches/stream`, {
          method: "POST",
          headers: { Authorization: `Bearer ${bearer}` },
          body: form,
          cache: "no-store",
        });
      };
      let bearer = await token();
      let response = await send(bearer);
      if (response.status === 401) {
        bearer = await token(true);
        response = await send(bearer);
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(messageFrom(data, `Batch upload failed (HTTP ${response.status}).`));
      }
      if (!response.body) throw new Error("The server did not provide a batch progress stream.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handle = (frame: string) => {
        const line = frame.split(/\r?\n/).find((part) => part.startsWith("data:"));
        if (!line) return;
        const event = JSON.parse(line.slice(5).trim()) as BatchEvent;
        if (event.type === "progress") {
          setItems((current) => current.map((item) => item.item_id === event.item_id
            ? { ...item, status: "processing", stage: event.stage, message: event.message || event.stage }
            : item));
        } else if (event.type === "item_result") {
          setItems((current) => current.map((item) => item.item_id === event.data.item_id
            ? { ...item, status: event.data.status as BatchItem["status"], analysis: event.data.data, error: event.data.error, message: event.data.error || event.data.status }
            : item));
        } else if (event.type === "completed") {
          setBatchTotal(event.total);
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          handle(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
        if (done) break;
      }
      if (buffer.trim()) handle(buffer);
      setItems((current) => current.map((item) => item.status === "queued" || item.status === "processing"
        ? { ...item, status: "failed", error: "The progress stream ended before this document returned a result." }
        : item));
    } catch (cause) {
      setError((cause as Error).message || "The batch could not be processed.");
      setItems((current) => current.map((item) => item.status === "queued" || item.status === "processing"
        ? { ...item, status: "failed", error: (cause as Error).message || "Processing failed." }
        : item));
    } finally {
      setIsRunning(false);
      setFiles([]);
    }
  }

  function openReview(item: BatchItem) {
    if (!item.analysis?.ingestion_session_id) return;
    setSelectedId(item.item_id);
    setTitle(item.analysis.title || item.filename.replace(/\.pdf$/i, ""));
    setDocumentType(item.analysis.document_type || "General document");
    setDescription(item.analysis.description || item.analysis.summary || "");
    setDepartmentId("");
    setTargetDocumentId(context?.targetDocumentId || item.analysis.matching_candidates[0]?.document_id || "");
    setArchived(false);
    setError("");
    setIsOpen(true);
  }

  async function finalizeSelected(action: "new" | "independent" | "supersede" | "reject") {
    if (!context || !selectedItem?.analysis?.ingestion_session_id) return;
    if (action !== "reject" && (!title.trim() || !documentType.trim() || !description.trim())) {
      setError("Title, document type, and description are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const send = async (bearer: string) => fetch(
        `${API}/api/v1/organizations/${context.organization.organization_id}/documents/ingestion-sessions/${selectedItem.analysis!.ingestion_session_id}/complete`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            title: title.trim() || selectedItem.filename,
            document_type: documentType.trim() || "General document",
            description: description.trim() || "Rejected during batch review.",
            department_id: departmentId || null,
            archived: action === "new" || action === "independent" ? archived : false,
            ...(action === "supersede" ? { target_document_id: targetDocumentId } : {}),
          }),
          cache: "no-store",
        },
      );
      let bearer = await token();
      let response = await send(bearer);
      if (response.status === 401) {
        bearer = await token(true);
        response = await send(bearer);
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(messageFrom(data, `Could not save ${selectedItem.filename} (HTTP ${response.status}).`));
      if (data.document_id && context) {
        window.dispatchEvent(new CustomEvent("savira:documents-changed", { detail: { organization_id: context.organization.organization_id } }));
      }
      setItems((current) => current.map((item) => item.item_id === selectedId
        ? { ...item, status: data.status === "rejected" ? "rejected" : data.status as BatchItem["status"], message: data.status.replace(/_/g, " "), finalizeStatus: data.status }
        : item));
      setSelectedId(null);
      setError("");
    } catch (cause) {
      setError((cause as Error).message || "Could not finalize this document.");
    } finally {
      setSaving(false);
    }
  }

  if (!context && !hasBatch) return null;

  return (
    <>
      {(hasBatch || isRunning) && !isOpen && !batchSettled && (
        <button type="button" onClick={() => setIsOpen(true)} className="fixed bottom-5 right-5 z-[900] flex items-center gap-3 rounded-full border border-cyan-300/40 bg-slate-950 px-4 py-3 text-left text-white shadow-2xl shadow-black/40 transition hover:-translate-y-0.5 hover:border-cyan-200" aria-label="Open document ingestion progress">
          <span className="relative grid size-9 place-items-center rounded-full bg-cyan-300 text-sm font-bold text-slate-950">
            {isRunning ? <span className="animate-pulse">↻</span> : "PDF"}
            {isRunning && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-950" />}
          </span>
          <span className="min-w-0"><span className="block text-xs font-semibold">Document ingestion</span><span className="block text-[10px] text-slate-400">{isRunning ? `${completedCount}/${batchTotal} complete · ${activeCount} active` : `${reviewCount} awaiting review · ${progressPercent}% done`}</span></span>
        </button>
      )}

      {isOpen && context && (
        <div className="fixed inset-0 z-[850] flex items-center justify-center bg-slate-950/75 p-3 backdrop-blur-sm sm:p-6">
          <section role="dialog" aria-modal="true" aria-labelledby="batch-ingestion-title" className="flex max-h-[min(92dvh,900px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#0b1724] text-white shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4 sm:px-7">
              <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400">Knowledge ingestion · Batch</p><h2 id="batch-ingestion-title" className="mt-1 text-xl font-semibold">{hasBatch ? "Batch ingestion progress" : "Add documents"}</h2><p className="mt-1 truncate text-xs text-slate-400">{context.organization.organization_name}</p></div>
              <button type="button" onClick={() => setIsOpen(false)} aria-label="Minimize ingestion panel" className="grid size-9 shrink-0 place-items-center rounded-lg border border-cyan-400/40 text-cyan-200 hover:bg-cyan-400/10"><span aria-hidden="true">—</span></button>
            </header>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-7">
              {!hasBatch && (
                <section>
                  <label htmlFor="batch-pdf-files" className="block rounded-2xl border border-dashed border-slate-600 bg-slate-950/40 p-8 text-center hover:border-cyan-400/70">
                    <span className="text-3xl text-cyan-200">↥</span><span className="mt-3 block text-sm font-semibold">Choose multiple PDF documents</span><span className="mt-1 block text-xs text-slate-400">Up to {MAX_FILES} files · 25 MB per file</span>
                    <input id="batch-pdf-files" type="file" accept=".pdf,application/pdf" multiple onChange={chooseFiles} className="sr-only" />
                  </label>
                  {files.length > 0 && <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3"><div className="mb-2 flex justify-between text-xs"><span>{files.length} documents selected</span><span className="text-slate-400">{formatBytes(files.reduce((sum, file) => sum + file.size, 0))}</span></div><ul className="max-h-40 space-y-1 overflow-y-auto">{files.map((file) => <li key={file.name + file.size} className="flex justify-between gap-3 text-xs text-slate-300"><span className="truncate">{file.name}</span><span className="shrink-0 text-slate-500">{formatBytes(file.size)}</span></li>)}</ul></div>}
                  <button type="button" onClick={() => void startBatch()} disabled={!files.length || isRunning} className="mt-4 w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-40">Start batch ingestion · {files.length} files</button>
                </section>
              )}

              {hasBatch && (
                <>
                  <section className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                    <div className="flex items-center justify-between text-xs"><span className="font-semibold">Overall progress</span><span className="font-mono text-cyan-200">{progressPercent}%</span></div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-cyan-300 transition-all" style={{ width: `${progressPercent}%` }} /></div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div><b className="block text-lg">{completedCount}</b><span className="text-slate-500">Completed</span></div><div><b className="block text-lg">{activeCount}</b><span className="text-slate-500">Active / queued</span></div><div><b className="block text-lg">{reviewCount}</b><span className="text-slate-500">Need review</span></div></div>
                  </section>

                  {selectedItem ? (
                    <section className="space-y-3 rounded-xl border border-cyan-400/20 bg-cyan-950/10 p-4">
                      <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-cyan-100">Review document</p><p className="mt-1 truncate text-xs text-slate-400">{selectedItem.filename}</p></div><button type="button" onClick={() => setSelectedId(null)} className="text-xs text-slate-400 hover:text-white">Back to batch</button></div>
                      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-300">Title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={255} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="text-xs text-slate-300">Document type<input value={documentType} onChange={(event) => setDocumentType(event.target.value)} maxLength={100} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="text-xs text-slate-300 sm:col-span-2">Description<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={10000} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="text-xs text-slate-300">Department<select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"><option value="">No department</option>{context.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label><label className="flex items-center gap-2 self-end pb-2 text-xs text-slate-300"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} /> Archived</label></div>
                      {selectedItem.analysis?.summary && <p className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs leading-5 text-slate-300">{selectedItem.analysis.summary}</p>}
                      {(context?.targetDocumentId || selectedItem.analysis?.matching_classification !== "no_match") && <label className="block text-xs text-amber-100">Matching document<select value={targetDocumentId} onChange={(event) => setTargetDocumentId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"><option value="">Choose a document to supersede</option>{context?.targetDocumentId && !selectedItem.analysis?.matching_candidates.some((candidate) => candidate.document_id === context.targetDocumentId) && <option value={context.targetDocumentId}>{context.targetDocumentTitle || "Selected document"}</option>}{(selectedItem.analysis?.matching_candidates || []).map((candidate) => <option key={candidate.document_id} value={candidate.document_id}>{candidate.title || "Untitled document"} · v{candidate.version_number}</option>)}</select><span className="mt-1 block text-[10px] text-slate-500">You can supersede the selected version or ingest this as an independent document.</span></label>}
                      {error && <p role="alert" className="text-xs text-rose-200">{error}</p>}
                      <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={saving} onClick={() => void finalizeSelected("reject")} className="rounded-lg border border-rose-400/30 px-3 py-2 text-xs text-rose-200 disabled:opacity-40">Reject</button>{(context?.targetDocumentId || selectedItem.analysis?.matching_classification !== "no_match") ? <><button type="button" disabled={saving || !targetDocumentId} onClick={() => void finalizeSelected("supersede")} className="rounded-lg bg-cyan-300 px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40">Supersede selected</button><button type="button" disabled={saving} onClick={() => void finalizeSelected(selectedItem.analysis?.matching_classification !== "no_match" ? "independent" : "new")} className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 disabled:opacity-40">Ingest as new document</button></> : <button type="button" disabled={saving} onClick={() => void finalizeSelected("new")} className="rounded-lg bg-cyan-300 px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40">{saving ? "Saving…" : "Ingest as new"}</button>}</div>
                    </section>
                  ) : (
                    <section className="space-y-2">
                      {items.map((item) => <div key={item.item_id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                        <span className={`grid size-8 shrink-0 place-items-center rounded-lg text-[10px] font-bold ${item.status === "failed" ? "bg-rose-400/10 text-rose-200" : item.status === "duplicate" ? "bg-amber-400/10 text-amber-200" : item.status === "indexed" ? "bg-emerald-400/10 text-emerald-200" : "bg-cyan-400/10 text-cyan-200"}`}>PDF</span>
                        <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-100">{item.filename}</p><p className="mt-1 truncate text-[10px] text-slate-500">{item.message || item.stage || item.status}</p></div>
                        <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">{item.status.replace(/_/g, " ")}</span>
                        {item.status === "ready_for_review" && <button type="button" onClick={() => openReview(item)} className="shrink-0 rounded-lg border border-cyan-400/30 px-2.5 py-1.5 text-[10px] text-cyan-200">Review</button>}
                      </div>)}
                    </section>
                  )}
                  {!isRunning && !selectedItem && <button type="button" onClick={() => { setItems([]); setFiles([]); setBatchTotal(0); setError(""); }} className="w-full rounded-xl border border-slate-700 px-4 py-2.5 text-xs text-slate-200 hover:bg-slate-800">Start another batch</button>}
                </>
              )}
              {error && !selectedItem && <p role="alert" className="rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2.5 text-xs text-rose-200">{error}</p>}
            </div>
            <footer className="flex items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/50 px-5 py-3 text-[10px] text-slate-500 sm:px-7"><span>Minimize to continue working elsewhere in SaviraCortex.</span><button type="button" onClick={() => setIsOpen(false)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800">Minimize</button></footer>
          </section>
        </div>
      )}
    </>
  );
}
