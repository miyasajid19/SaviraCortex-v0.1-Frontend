"use client";

import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { auth } from "../firebase";

type Organization = { organization_id: string; organization_name: string };
type Department = { id: string; name: string };
type Stage = "select" | "processing" | "review" | "duplicate" | "saving" | "done";
type StepState = "pending" | "active" | "complete" | "skipped";

type Candidate = {
  document_id: string;
  version_id: string;
  version_number: number;
  title: string;
  status: string;
  similarity_score: number | null;
  matched_by: string | null;
};

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
  matching_classification: "no_match" | "potential_match" | "exact_file_match" | "exact_content_match";
  matching_candidates: Candidate[];
  validation_warnings: string[];
  expires_at: string | null;
};

type FinalizeResult = {
  status: "registered_pending" | "rejected";
  document_id?: string | null;
  document_version_id?: string | null;
  version_number?: number | null;
  version_status?: string | null;
  archived?: boolean | null;
};

type StreamEvent =
  | { type: "progress"; stage: string; state: "started" | "completed"; message?: string | null }
  | { type: "result"; data: Analysis }
  | { type: "error"; detail: string; status_code?: number };

const API = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const PIPELINE_STEPS = [
  { id: "receive_pdf", label: "Receive PDF" },
  { id: "validate_pdf", label: "Validate PDF structure" },
  { id: "hash_pdf", label: "Calculate SHA-256 fingerprint" },
  { id: "parse_pdf", label: "Parse PDF and run configured OCR" },
  { id: "sample_content", label: "Normalize and sample content" },
  { id: "summarize", label: "Generate summary and metadata" },
  { id: "duplicate_check", label: "Check for duplicates and similar documents" },
  { id: "store_original", label: "Store original file in Backblaze B2" },
] as const;

const inputClass =
  "mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3.5 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/10";
const labelClass = "block text-xs font-semibold tracking-wide text-slate-300";

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fileTitle(fileName: string) {
  return fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled document";
}

function errorMessage(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "detail" in data && typeof data.detail === "string") {
    return data.detail;
  }
  return fallback;
}

export default function DocumentIngestionModal({
  organization,
  uploaderId,
  departments,
}: {
  organization: Organization;
  uploaderId: string;
  departments: Department[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("select");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [steps, setSteps] = useState<StepState[]>(PIPELINE_STEPS.map(() => "pending"));
  const [progress, setProgress] = useState(0);
  const [activeMessage, setActiveMessage] = useState("Waiting for a PDF.");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [hash, setHash] = useState("");
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState("General document");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [archived, setArchived] = useState(false);
  const [targetDocumentId, setTargetDocumentId] = useState("");
  const [finalizeResult, setFinalizeResult] = useState<FinalizeResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef(stage);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && stageRef.current !== "processing" && stageRef.current !== "saving") {
        event.preventDefault();
        setIsOpen(false);
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [isOpen]);

  function reset() {
    setStage("select");
    setFile(null);
    setDragging(false);
    setError("");
    setNotice("");
    setSteps(PIPELINE_STEPS.map(() => "pending"));
    setProgress(0);
    setActiveMessage("Waiting for a PDF.");
    setAnalysis(null);
    setHash("");
    setTitle("");
    setDocumentType("General document");
    setDescription("");
    setDepartmentId("");
    setArchived(false);
    setTargetDocumentId("");
    setFinalizeResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function openModal() {
    reset();
    setIsOpen(true);
  }

  function closeModal() {
    if (stage === "processing" || stage === "saving") return;
    setIsOpen(false);
  }

  function acceptFile(candidate: File | undefined) {
    setError("");
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".pdf")) {
      setFile(null);
      setError("Only PDF files are supported.");
      return;
    }
    if (candidate.size === 0) {
      setFile(null);
      setError("This file is empty. Choose a valid PDF.");
      return;
    }
    if (candidate.size > MAX_FILE_SIZE) {
      setFile(null);
      setError("The PDF is larger than the 25 MB upload limit.");
      return;
    }
    setFile(candidate);
  }

  function onFileInput(event: ChangeEvent<HTMLInputElement>) {
    acceptFile(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files?.[0]);
  }

  function applyProgress(event: Extract<StreamEvent, { type: "progress" }>) {
    const index = PIPELINE_STEPS.findIndex((item) => item.id === event.stage);
    if (index < 0) return;
    setSteps((current) => current.map((state, stepIndex) => {
      if (stepIndex < index) return "complete";
      if (stepIndex > index) return state === "complete" ? "complete" : "pending";
      return event.state === "completed" ? "complete" : "active";
    }));
    setProgress((current) => {
      const next = PIPELINE_STEPS.reduce((count, item, stepIndex) => {
        const isEarlier = stepIndex < index;
        const isThisComplete = stepIndex === index && event.state === "completed";
        return count + (isEarlier || isThisComplete ? 1 : 0);
      }, 0);
      return Math.max(current, Math.round((next / PIPELINE_STEPS.length) * 100));
    });
    if (event.message) setActiveMessage(event.message);
  }

  async function getFreshToken(forceRefresh = false) {
    const user = auth?.currentUser;
    if (!user) throw new Error("Your Firebase session has expired. Sign in again and retry.");
    return user.getIdToken(forceRefresh);
  }

  async function runPipeline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Choose a PDF before starting ingestion.");
      return;
    }
    setError("");
    setNotice("");
    setAnalysis(null);
    setSteps(PIPELINE_STEPS.map(() => "pending"));
    setProgress(0);
    setStage("processing");
    setActiveMessage("Uploading your PDF securely.");

    const upload = async (token: string) => {
      const formData = new FormData();
      formData.append("file", file);
      return fetch(
        `${API}/api/v1/organizations/${organization.organization_id}/documents/ingestion-sessions/stream`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
          cache: "no-store",
        },
      );
    };

    try {
      let token = await getFreshToken();
      let response = await upload(token);
      if (response.status === 401) {
        token = await getFreshToken(true);
        response = await upload(token);
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(errorMessage(data, `Upload failed (HTTP ${response.status}).`));
      }
      if (!response.body) throw new Error("The server did not provide a processing-progress stream.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const resultHolder: { value: Analysis | null } = { value: null };
      let streamError: string | null = null;

      const handleFrame = (frame: string) => {
        const dataLine = frame.split(/\r?\n/).find((line) => line.startsWith("data:"));
        if (!dataLine) return;
        const payload = JSON.parse(dataLine.slice(5).trim()) as StreamEvent;
        if (payload.type === "progress") applyProgress(payload);
        if (payload.type === "result") resultHolder.value = payload.data;
        if (payload.type === "error") streamError = payload.detail;
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          handleFrame(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
        if (done) break;
      }
      if (buffer.trim()) handleFrame(buffer);
      if (streamError) throw new Error(streamError);
      const result = resultHolder.value;
      if (!result) throw new Error("The processing stream ended without an analysis result.");

      setAnalysis(result);
      setHash(result.file_hash);
      setTitle(result.title || fileTitle(file.name));
      setDocumentType(result.document_type || "General document");
      setDescription(result.description || "");
      setTargetDocumentId(result.matching_candidates[0]?.document_id || "");
      setNotice(result.validation_warnings.join(" "));
      if (result.status === "duplicate") {
        setSteps(["complete", "complete", "complete", "complete", "complete", "complete", "complete", "skipped"]);
        setProgress(100);
        setStage("duplicate");
        setActiveMessage("An identical document already exists. No additional copy was stored.");
      } else {
        setSteps(PIPELINE_STEPS.map(() => "complete"));
        setProgress(100);
        setStage("review");
        setActiveMessage("Analysis completed. Review the generated metadata.");
      }
    } catch (cause) {
      setError((cause as Error)?.message || "The PDF could not be processed. Please retry.");
      setStage("select");
      setSteps(PIPELINE_STEPS.map(() => "pending"));
      setProgress(0);
    }
  }

  async function finalize(action: "new" | "supersede" | "independent" | "reject") {
    if (!analysis?.ingestion_session_id) {
      setError("The upload session is missing. Upload the PDF again.");
      return;
    }
    if (!title.trim() || !documentType.trim() || !description.trim()) {
      setError("Title, document type, and description are required.");
      return;
    }
    if (action === "supersede" && !targetDocumentId) {
      setError("Choose the existing document that this PDF should supersede.");
      return;
    }

    setError("");
    setStage("saving");
    setActiveMessage(action === "reject" ? "Rejecting the staged upload." : "Saving the document and version records.");
    const payload = {
      action,
      title: title.trim(),
      document_type: documentType.trim(),
      description: description.trim(),
      department_id: departmentId || null,
      archived: action === "new" || action === "independent" ? archived : false,
      ...(action === "supersede" ? { target_document_id: targetDocumentId } : {}),
    };

    try {
      const send = async (token: string) => fetch(
        `${API}/api/v1/organizations/${organization.organization_id}/documents/ingestion-sessions/${analysis.ingestion_session_id}/complete`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          cache: "no-store",
        },
      );
      let token = await getFreshToken();
      let response = await send(token);
      if (response.status === 401) {
        token = await getFreshToken(true);
        response = await send(token);
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(data, `Could not save the document (HTTP ${response.status}).`));
      setFinalizeResult(data as FinalizeResult);
      setStage("done");
      setActiveMessage(data.status === "rejected" ? "The staged PDF was rejected." : "The document and pending version were created.");
    } catch (cause) {
      setError((cause as Error)?.message || "Could not complete document ingestion.");
      setStage("review");
    }
  }

  const selectedDepartment = departments.find((department) => department.id === departmentId);
  const classification = analysis?.matching_classification;
  const isExactDuplicate = classification === "exact_file_match" || classification === "exact_content_match";
  const isPotentialMatch = classification === "potential_match";

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:-translate-y-0.5 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
      >
        <span aria-hidden="true" className="text-base">＋</span>
        Ingest document
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6"
          style={{ zIndex: "var(--z-backdrop, 550)" }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && stage !== "processing" && stage !== "saving") closeModal();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ingestion-dialog-title"
            aria-describedby="ingestion-dialog-description"
            className="relative flex max-h-[min(92dvh,900px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#0b1724] shadow-2xl shadow-black/50"
            style={{ zIndex: "var(--z-dialog, 600)" }}
          >
            <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-5 sm:px-7">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-400">Knowledge ingestion · Live</p>
                <h2 id="ingestion-dialog-title" className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">
                  {stage === "select" ? "Add a document" : stage === "processing" ? "Processing your document" : stage === "review" ? "Review extracted metadata" : stage === "duplicate" ? "Duplicate document found" : stage === "saving" ? "Saving document" : "Ingestion result"}
                </h2>
                <p id="ingestion-dialog-description" className="mt-1 text-xs leading-5 text-slate-400">
                  {organization.organization_name} <span className="text-slate-600">·</span> One PDF per ingestion
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={closeModal}
                disabled={stage === "processing" || stage === "saving"}
                aria-label="Close document ingestion"
                className="grid size-9 shrink-0 place-items-center rounded-lg border border-slate-700 text-slate-400 transition hover:border-slate-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ×
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
              {stage !== "select" && (
                <div className="mb-6 flex items-center gap-2">
                  {["Select PDF", "Process", "Review", "Save"].map((item, index) => {
                    const activeIndex = stage === "processing" ? 1 : stage === "review" || stage === "duplicate" ? 2 : 3;
                    const complete = index < activeIndex;
                    return (
                      <div key={item} className="flex min-w-0 flex-1 items-center gap-2">
                        <span className={`grid size-6 shrink-0 place-items-center rounded-full border text-[10px] font-bold ${complete ? "border-cyan-300 bg-cyan-300 text-slate-950" : index === activeIndex ? "border-cyan-300 text-cyan-200" : "border-slate-700 text-slate-500"}`}>
                          {complete ? "✓" : index + 1}
                        </span>
                        <span className={`hidden truncate text-[11px] sm:block ${index === activeIndex ? "font-semibold text-slate-100" : "text-slate-500"}`}>{item}</span>
                        {index < 3 && <span className="h-px min-w-2 flex-1 bg-slate-800" />}
                      </div>
                    );
                  })}
                </div>
              )}

              {stage === "select" && (
                <form onSubmit={runPipeline} noValidate>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label="Choose a PDF file or drop it here"
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                    className={`group flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-5 py-8 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${dragging ? "border-cyan-300 bg-cyan-300/10" : "border-slate-600 bg-slate-950/40 hover:border-cyan-500/70 hover:bg-cyan-950/20"}`}
                  >
                    <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" onClick={(event) => event.stopPropagation()} onChange={onFileInput} className="sr-only" aria-label="Select PDF file" />
                    <span className="grid size-14 place-items-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-2xl text-cyan-200">↥</span>
                    <p className="mt-4 text-sm font-semibold text-slate-100">Drop your PDF here</p>
                    <p className="mt-1 text-xs text-slate-400">or <span className="text-cyan-300 underline underline-offset-4">browse files</span></p>
                    <p className="mt-4 text-[11px] text-slate-500">PDF only · Maximum 25 MB · One file at a time</p>
                  </div>

                  {file && (
                    <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/70 p-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-rose-400/10 text-xs font-bold text-rose-300">PDF</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-100">{file.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{formatBytes(file.size)} · Ready to upload</p>
                      </div>
                      <button type="button" onClick={() => { setFile(null); setError(""); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-white">Remove</button>
                    </div>
                  )}

                  {error && <p role="alert" className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2.5 text-xs text-rose-200">{error}</p>}

                  <div className="mt-6 grid gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:grid-cols-2">
                    <div><p className="text-[10px] uppercase tracking-wider text-slate-500">Organization ID · session</p><p className="mt-1 break-all font-mono text-[11px] text-slate-300">{organization.organization_id}</p></div>
                    <div><p className="text-[10px] uppercase tracking-wider text-slate-500">Uploaded by · authenticated user</p><p className="mt-1 break-all font-mono text-[11px] text-slate-300">{uploaderId}</p></div>
                  </div>

                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                    <p className="max-w-sm text-[11px] leading-5 text-slate-500">Your PDF is sent to the authenticated SaviraCortex backend, validated, analyzed, and staged in private Backblaze B2 storage.</p>
                    <button type="submit" disabled={!file} className="rounded-xl bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40">Upload and process <span aria-hidden="true">→</span></button>
                  </div>
                </form>
              )}

              {stage === "processing" && (
                <section aria-live="polite" aria-busy="true">
                  <div className="flex items-end justify-between gap-3">
                    <div><p className="text-sm font-semibold text-white">Live backend processing</p><p className="mt-1 text-xs text-slate-400">{activeMessage}</p></div>
                    <span className="font-mono text-sm tabular-nums text-cyan-300">{progress}%</span>
                  </div>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-cyan-300 transition-all duration-300" style={{ width: `${progress}%` }} /></div>
                  <ol className="mt-6 space-y-3">
                    {PIPELINE_STEPS.map((item, index) => (
                      <li key={item.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-3.5 py-3">
                        <span className={`grid size-7 shrink-0 place-items-center rounded-full border text-xs ${steps[index] === "complete" ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : steps[index] === "active" ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-200" : "border-slate-700 text-slate-600"}`}>
                          {steps[index] === "complete" ? "✓" : steps[index] === "active" ? "…" : index + 1}
                        </span>
                        <div className="min-w-0 flex-1"><p className={`text-sm ${steps[index] === "pending" ? "text-slate-500" : "text-slate-200"}`}>{item.label}</p></div>
                        <span className="text-[10px] uppercase tracking-wider text-slate-500">{steps[index] === "complete" ? "Done" : steps[index] === "active" ? "Running" : "Waiting"}</span>
                      </li>
                    ))}
                  </ol>
                  {error && <p role="alert" className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2.5 text-xs text-rose-200">{error}</p>}
                </section>
              )}

              {stage === "review" && analysis && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><p className="text-sm font-semibold text-white">Metadata generated by the backend</p><p className="mt-1 text-xs text-slate-400">Review and edit these values before saving the document.</p></div>
                    <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-200">REAL ANALYSIS</span>
                  </div>

                  {notice && <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-xs text-amber-100">{notice}</p>}
                  {error && <p role="alert" className="rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2.5 text-xs text-rose-200">{error}</p>}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className={labelClass} htmlFor="ingest-title">Document title · LLM suggestion</label><input id="ingest-title" value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} maxLength={255} required /></div>
                    <div><label className={labelClass} htmlFor="ingest-type">Document type · LLM classification</label><input id="ingest-type" value={documentType} onChange={(event) => setDocumentType(event.target.value)} className={inputClass} maxLength={100} required /></div>
                    <div className="sm:col-span-2"><label className={labelClass} htmlFor="ingest-description">Description · LLM summary</label><textarea id="ingest-description" rows={4} value={description} onChange={(event) => setDescription(event.target.value)} className={`${inputClass} resize-none leading-6`} maxLength={10000} required /></div>
                    <div><label className={labelClass} htmlFor="ingest-department">Department · user selected</label><select id="ingest-department" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className={inputClass}><option value="">No department</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></div>
                    <div className="flex items-end"><label className="flex min-h-[46px] w-full cursor-pointer items-center justify-between rounded-xl border border-slate-700 bg-slate-950/70 px-3.5 py-2.5"><span><span className="block text-xs font-semibold text-slate-200">Archived</span><span className="mt-0.5 block text-[10px] text-slate-500">Default: off</span></span><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} className="size-4 accent-cyan-300" /></label></div>
                  </div>

                  <section className="rounded-xl border border-cyan-900/40 bg-cyan-950/10 p-4">
                    <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-semibold uppercase tracking-wider text-cyan-100">Backend extraction summary</h3><span className="text-[10px] text-emerald-200">{analysis.page_count} pages</span></div>
                    <p className="mt-3 whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs leading-6 text-slate-300">{analysis.summary || "No summary was returned."}</p>
                  </section>

                  <section className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">Verified file and system metadata</h3>
                    <dl className="mt-4 grid gap-x-5 gap-y-3 sm:grid-cols-2">
                      <div><dt className="text-[10px] text-slate-500">Original file name</dt><dd className="mt-1 break-all text-xs text-slate-200">{analysis.original_filename}</dd></div>
                      <div><dt className="text-[10px] text-slate-500">File size · backend</dt><dd className="mt-1 text-xs text-slate-200">{formatBytes(analysis.file_size)}</dd></div>
                      <div className="sm:col-span-2"><dt className="text-[10px] text-slate-500">Original file SHA-256 · backend</dt><dd className="mt-1 break-all font-mono text-[10px] text-cyan-200">{hash}</dd></div>
                      <div className="sm:col-span-2"><dt className="text-[10px] text-slate-500">Normalized content SHA-256 · backend</dt><dd className="mt-1 break-all font-mono text-[10px] text-slate-300">{analysis.content_hash}</dd></div>
                      <div><dt className="text-[10px] text-slate-500">Organization ID</dt><dd className="mt-1 break-all font-mono text-[10px] text-slate-300">{organization.organization_id}</dd></div>
                      <div><dt className="text-[10px] text-slate-500">Uploaded by ID</dt><dd className="mt-1 break-all font-mono text-[10px] text-slate-300">{uploaderId}</dd></div>
                      <div><dt className="text-[10px] text-slate-500">Department</dt><dd className="mt-1 break-all text-xs text-slate-300">{selectedDepartment ? selectedDepartment.name : "No department selected"}</dd></div>
                      <div><dt className="text-[10px] text-slate-500">Archived</dt><dd className="mt-1 text-xs text-slate-300">{archived ? "true" : "false"}</dd></div>
                      <div><dt className="text-[10px] text-slate-500">Document / version IDs</dt><dd className="mt-1 text-xs text-slate-400">Generated on final save</dd></div>
                      <div><dt className="text-[10px] text-slate-500">Version number</dt><dd className="mt-1 text-xs text-slate-400">{isPotentialMatch ? "Next version if superseded; otherwise version 1" : "1 · original"}</dd></div>
                    </dl>
                  </section>

                  <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-100">Duplicate and version check</h3><p className="mt-1 text-xs text-slate-400">Classification is based on backend hash matching and semantic summary matching.</p></div><span className="rounded-full border border-slate-700 px-2.5 py-1 text-[10px] text-slate-400">{classification?.replace(/_/g, " ").toUpperCase()}</span></div>
                    {isPotentialMatch && (
                      <div className="mt-4 space-y-3">
                        <label className={labelClass} htmlFor="ingest-match-target">Existing document to supersede</label>
                        <select id="ingest-match-target" value={targetDocumentId} onChange={(event) => setTargetDocumentId(event.target.value)} className={inputClass}>
                          <option value="">Select a matching document</option>
                          {analysis.matching_candidates.map((candidate) => <option key={candidate.document_id} value={candidate.document_id}>{candidate.title || "Untitled document"} · v{candidate.version_number}{candidate.similarity_score == null ? "" : ` · ${Math.round(candidate.similarity_score * 100)}% similar`}</option>)}
                        </select>
                        <ul className="space-y-2">{analysis.matching_candidates.map((candidate) => <li key={candidate.version_id} className="rounded-lg border border-slate-800 bg-slate-950/70 p-3"><p className="text-xs font-medium text-slate-200">{candidate.title || "Untitled document"}</p><p className="mt-1 text-[10px] text-slate-500">Version {candidate.version_number} · {candidate.status}{candidate.similarity_score == null ? "" : ` · similarity ${(candidate.similarity_score * 100).toFixed(1)}%`}</p></li>)}</ul>
                      </div>
                    )}
                    {isExactDuplicate && <div className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/5 p-3"><p className="text-xs font-semibold text-rose-200">An exact duplicate was found</p><p className="mt-1 text-xs leading-5 text-slate-400">SaviraCortex did not create another staging session or permanent document record for this identical file/content.</p>{analysis.matching_candidates.map((candidate) => <p key={candidate.version_id} className="mt-2 text-xs text-slate-300">{candidate.title || "Existing document"} · version {candidate.version_number}</p>)}</div>}
                    {classification === "no_match" && <p className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-xs text-emerald-100">No matching document was found. This PDF can be ingested as a new document.</p>}
                  </section>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
                    <button type="button" onClick={() => { setStage("select"); setError(""); setAnalysis(null); }} className="rounded-lg px-3 py-2 text-xs font-medium text-slate-400 transition hover:bg-slate-800 hover:text-white">← Back to file</button>
                    <div className="flex flex-wrap gap-2">
                      {isExactDuplicate ? (
                        <button type="button" onClick={() => setStage("duplicate")} className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-2.5 text-xs font-semibold text-rose-200">Review duplicate result</button>
                      ) : (
                        <>
                          <button type="button" onClick={() => void finalize("reject")} className="rounded-xl border border-rose-400/30 px-4 py-2.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-400/10">Reject upload</button>
                          {classification === "no_match" && <button type="button" disabled={!title.trim() || !description.trim() || !documentType.trim()} onClick={() => void finalize("new")} className="rounded-xl bg-cyan-300 px-4 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-40">Ingest as new document →</button>}
                          {isPotentialMatch && <><button type="button" disabled={!targetDocumentId || !title.trim() || !description.trim() || !documentType.trim()} onClick={() => void finalize("supersede")} className="rounded-xl bg-cyan-300 px-4 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-40">Supersede selected document</button><button type="button" disabled={!title.trim() || !description.trim() || !documentType.trim()} onClick={() => void finalize("independent")} className="rounded-xl border border-slate-600 px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:border-slate-400 hover:bg-slate-800 disabled:opacity-40">Ingest independently</button></>}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {stage === "duplicate" && analysis && (
                <section className="py-8 text-center">
                  <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-rose-400/20 bg-rose-400/10 text-2xl text-rose-200">!</span>
                  <h3 className="mt-5 text-lg font-semibold text-white">This document already exists</h3>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">The backend found an exact {classification === "exact_file_match" ? "file" : "content"} match. It did not stage another copy or create a document/version record.</p>
                  <div className="mx-auto mt-5 max-w-lg rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-left">
                    {analysis.matching_candidates.map((candidate) => <div key={candidate.version_id} className="py-2"><p className="text-sm font-medium text-slate-200">{candidate.title || "Existing document"}</p><p className="mt-1 text-xs text-slate-500">Version {candidate.version_number} · {candidate.status}</p></div>)}
                  </div>
                  <button type="button" onClick={() => setIsOpen(false)} className="mt-6 rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800">Close</button>
                </section>
              )}

              {stage === "saving" && (
                <section className="py-12 text-center" aria-live="polite" aria-busy="true">
                  <span className="mx-auto grid size-12 place-items-center rounded-full border-2 border-cyan-300/30 border-t-cyan-300 text-cyan-200">…</span>
                  <h3 className="mt-5 text-lg font-semibold text-white">Saving your decision</h3>
                  <p className="mt-2 text-sm text-slate-400">{activeMessage}</p>
                  {error && <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p>}
                </section>
              )}

              {stage === "done" && finalizeResult && (
                <section className="py-8 text-center">
                  <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-2xl text-emerald-200">✓</span>
                  <h3 className="mt-5 text-lg font-semibold text-white">{finalizeResult.status === "rejected" ? "Upload rejected" : "Document registered"}</h3>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">{finalizeResult.status === "rejected" ? "The staged PDF was discarded. No document or version was created." : "The original PDF was copied into permanent Backblaze B2 storage and the document/version records were saved. The version is pending indexing."}</p>
                  {finalizeResult.status === "registered_pending" && <dl className="mx-auto mt-5 max-w-lg space-y-2 rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-left"><div><dt className="text-[10px] text-slate-500">Document ID</dt><dd className="mt-1 break-all font-mono text-xs text-slate-200">{finalizeResult.document_id}</dd></div><div><dt className="text-[10px] text-slate-500">Document version ID</dt><dd className="mt-1 break-all font-mono text-xs text-slate-200">{finalizeResult.document_version_id}</dd></div><div><dt className="text-[10px] text-slate-500">Version number / status</dt><dd className="mt-1 text-xs text-slate-200">{finalizeResult.version_number} · {finalizeResult.version_status}</dd></div></dl>}
                  <div className="mt-6 flex flex-wrap justify-center gap-2"><button type="button" onClick={reset} className="rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-200">Ingest another PDF</button><button type="button" onClick={() => setIsOpen(false)} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800">Close</button></div>
                </section>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-950/50 px-5 py-3 sm:px-7">
              <p className="text-[10px] text-slate-500">SaviraCortex · Live document ingestion</p>
              <p className="font-mono text-[10px] text-slate-600">ORG {organization.organization_id.slice(0, 8).toUpperCase()}</p>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
