"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { auth } from "./firebase";

type Organization = { organization_id: string; organization_name: string };
type Department = { id: string; name: string };
type AccessRole = { id: string; name: string };
type AccessMember = { user_id: string; email: string | null; display_name: string | null };
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
  matching_candidates: Array<{ document_id?: string | null; version_id?: string | null; title: string; version_number?: number | null; similarity_score: number | null; matched_by?: string | null; batch_item_id?: number | null; original_filename?: string | null; batch_ingestion_session_id?: string | null; identity_match_reasons?: string[] }>;
  validation_warnings: string[];
};
type BatchItem = {
  item_id: number;
  filename: string;
  status: "queued" | "processing" | "ready_for_review" | "duplicate" | "failed" | "indexed" | "indexing_failed" | "rejected";
  stage?: string;
  progress?: number;
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
type FinalizeAction = "new" | "independent" | "supersede" | "delete_and_ingest" | "reject";
type BatchAction = "review" | "independent" | "supersede" | "delete_and_ingest" | "reject";

function messageFrom(data: unknown, fallback: string) {
  return data && typeof data === "object" && "detail" in data && typeof data.detail === "string" ? data.detail : fallback;
}

function stageProgress(stage: string, state: string) {
  const stages: Record<string, [number, number]> = {
    validate_pdf: [3, 8], hash_pdf: [8, 14], parse_pdf: [14, 38],
    sample_content: [38, 46], summarize: [46, 72], prepare_embedding: [72, 82],
    duplicate_check: [82, 90], store_original: [90, 96],
  };
  const range = stages[stage] || [5, 85];
  return state === "completed" ? range[1] : range[0];
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
  const [targetDocumentId, setTargetDocumentId] = useState("");
  const [archived, setArchived] = useState(false);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [members, setMembers] = useState<AccessMember[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [deniedDepartments, setDeniedDepartments] = useState<string[]>([]);
  const [deniedRoles, setDeniedRoles] = useState<string[]>([]);
  const [deniedMembers, setDeniedMembers] = useState<string[]>([]);
  const [organizationWideAccess, setOrganizationWideAccess] = useState(true);
  const [rememberAccessSelection, setRememberAccessSelection] = useState(false);
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState(false);
  const [confirmSingleDelete, setConfirmSingleDelete] = useState(false);
  const [accessLoading, setAccessLoading] = useState(false);
  const autoReviewOpened = useRef(false);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenDetail>).detail;
      if (!detail?.organization?.organization_id) return;
      setContext(detail);
      setIsOpen(true);
      setStep(1);
      setFiles([]);
      setItems([]);
      const preferenceKey = "savira:document-access:" + detail.organization.organization_id + ":" + detail.uploaderId;
      try {
        const saved = window.localStorage.getItem(preferenceKey);
        const preference = saved ? JSON.parse(saved) as {
          organizationWideAccess?: boolean;
          selectedDepartments?: string[];
          selectedRoles?: string[];
          selectedMembers?: string[];
          deniedDepartments?: string[];
          deniedRoles?: string[];
          deniedMembers?: string[];
        } : null;
        setOrganizationWideAccess(preference?.organizationWideAccess ?? true);
        setSelectedDepartments(Array.isArray(preference?.selectedDepartments) ? preference.selectedDepartments : []);
        setSelectedRoles(Array.isArray(preference?.selectedRoles) ? preference.selectedRoles : []);
        setSelectedMembers(Array.isArray(preference?.selectedMembers) ? preference.selectedMembers : []);
        setDeniedDepartments(Array.isArray(preference?.deniedDepartments) ? preference.deniedDepartments : []);
        setDeniedRoles(Array.isArray(preference?.deniedRoles) ? preference.deniedRoles : []);
        setDeniedMembers(Array.isArray(preference?.deniedMembers) ? preference.deniedMembers : []);
        setRememberAccessSelection(Boolean(preference));
        if (preference) setStep(2);
      } catch {
        setOrganizationWideAccess(true);
        setSelectedDepartments([]);
        setSelectedRoles([]);
        setSelectedMembers([]);
        setDeniedDepartments([]);
        setDeniedRoles([]);
        setDeniedMembers([]);
        setRememberAccessSelection(false);
      }
      setConfirmDeleteBatch(false);
      setConfirmSingleDelete(false);
      setError("");
    };
    window.addEventListener("savira:open-ingestion", onOpen);
    return () => window.removeEventListener("savira:open-ingestion", onOpen);
  }, []);

  useEffect(() => {
    if (!context) return;
    let cancelled = false;
    const loadAccessOptions = async () => {
      setAccessLoading(true);
      try {
        let bearer = await token();
        const request = async (url: string) => {
          let response = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` }, cache: "no-store" });
          if (response.status === 401) {
            bearer = await token(true);
            response = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` }, cache: "no-store" });
          }
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(messageFrom(data, "Could not load access options."));
          return data;
        };
        const [roleData, memberData] = await Promise.all([
          request(`${API}/api/v1/organizations/${context.organization.organization_id}/roles`),
          request(`${API}/api/v1/organizations/${context.organization.organization_id}/members`),
        ]);
        if (!cancelled) { setRoles(roleData); setMembers(memberData); }
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message || "Could not load access options.");
      } finally { if (!cancelled) setAccessLoading(false); }
    };
    void loadAccessOptions();
    return () => { cancelled = true; };
  }, [context]);

  const selectedItem = useMemo(() => items.find((item) => item.item_id === selectedId) ?? null, [items, selectedId]);
  const completedCount = items.filter((item) => ["duplicate", "indexed", "rejected"].includes(item.status)).length;
  const reviewCount = items.filter((item) => item.status === "ready_for_review").length;
  const activeCount = items.filter((item) => item.status === "processing" || item.status === "queued").length;
  const progressPercent = batchTotal ? Math.round(items.reduce((sum, item) => sum + (["duplicate", "indexed", "rejected", "failed", "indexing_failed"].includes(item.status) ? 100 : item.progress || 0), 0) / batchTotal) : 0;
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


  function continueToUpload() {
    if (!context) return;
    const preferenceKey = "savira:document-access:" + context.organization.organization_id + ":" + context.uploaderId;
    try {
      if (rememberAccessSelection) {
        window.localStorage.setItem(preferenceKey, JSON.stringify({
          organizationWideAccess,
          selectedDepartments,
          selectedRoles,
          selectedMembers,
          deniedDepartments,
          deniedRoles,
          deniedMembers,
        }));
      } else {
        window.localStorage.removeItem(preferenceKey);
      }
    } catch {
      setError("Your browser could not save this access preference. You can still continue with the current selection.");
    }
    setStep(2);
  }

  async function finalizeSession(
    item: BatchItem,
    action: FinalizeAction,
    targetId?: string,
    metadata?: { title?: string; documentType?: string; description?: string; archived?: boolean },
  ) {
    if (!context || !item.analysis?.ingestion_session_id) throw new Error("This upload is no longer available to finalize.");
    const analysis = item.analysis;
    const url = API + "/api/v1/organizations/" + context.organization.organization_id +
      "/documents/ingestion-sessions/" + analysis.ingestion_session_id + "/complete";
    const send = async (bearer: string) => fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + bearer, "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        title: metadata?.title?.trim() || analysis.title || item.filename,
        document_type: metadata?.documentType?.trim() || analysis.document_type || "General document",
        description: metadata?.description?.trim() || analysis.description || analysis.summary || (action === "reject" ? "Rejected during batch processing." : "Uploaded document."),
        archived: (action === "new" || action === "independent") ? Boolean(metadata?.archived) : false,
        ...(["supersede", "delete_and_ingest"].includes(action) && targetId ? { target_document_id: targetId } : {}),
      }),
      cache: "no-store",
    });
    let bearer = await token();
    let response = await send(bearer);
    if (response.status === 401) {
      bearer = await token(true);
      response = await send(bearer);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(messageFrom(data, "Could not process " + item.filename + " (HTTP " + response.status + ")."));
    if (data.document_id) {
      window.dispatchEvent(new CustomEvent("savira:documents-changed", { detail: { organization_id: context.organization.organization_id } }));
    }
    return data as { status: string; document_id?: string; document_version_id?: string; version_number?: number };
  }

  async function finalizeBatchAutomatically(batchResults: BatchItem[], strategy: Exclude<BatchAction, "review">) {
    const working = [...batchResults];
    let failures = 0;
    for (let index = 0; index < working.length; index += 1) {
      const item = working[index];
      if (item.status !== "ready_for_review" || !item.analysis?.ingestion_session_id) continue;
      const candidates = item.analysis.matching_candidates || [];
      const hasMatch = item.analysis.matching_classification !== "no_match" || candidates.length > 0;
      const target = candidates.find((candidate) => Boolean(candidate.document_id));
      let action: FinalizeAction = "new";
      if (strategy === "independent") action = hasMatch ? "independent" : "new";
      if (strategy === "supersede") action = hasMatch ? "supersede" : "new";
      if (strategy === "delete_and_ingest") action = hasMatch ? "delete_and_ingest" : "new";
      if (strategy === "reject") action = hasMatch ? "reject" : "new";

      if ((action === "supersede" || action === "delete_and_ingest") && !target?.document_id) {
        failures += 1;
        working[index] = { ...item, status: "failed", message: "A matched document is not ready for this action. Open Review to choose another action." };
        setItems([...working]);
        continue;
      }

      const actionLabel = strategy === "independent" ? "Ingest anyway" :
        strategy === "supersede" ? "Supersede and ingest" :
        strategy === "delete_and_ingest" ? "Delete and ingest" : "Reject duplicate";
      working[index] = { ...item, status: "processing", message: "Applying " + actionLabel + "…" };
      setItems([...working]);
      try {
        working[index] = { ...working[index], progress: Math.max(working[index].progress || 0, 97), stage: "finalizing", message: "Applying " + actionLabel + "…" };
        setItems([...working]);
        const data = await finalizeSession(item, action, target?.document_id ?? undefined);
        working[index] = {
          ...working[index],
          progress: 100,
          status: data.status === "rejected" ? "rejected" : data.status as BatchItem["status"],
          message: data.status.replace(/_/g, " "),
          finalizeStatus: data.status,
        };
        for (let later = index + 1; later < working.length; later += 1) {
          const laterItem = working[later];
          if (!laterItem.analysis) continue;
          const updatedCandidates = laterItem.analysis.matching_candidates
            .filter((candidate) => !(action === "reject" && candidate.batch_item_id === item.item_id))
            .map((candidate) => (candidate.batch_item_id === item.item_id ||
              (action === "delete_and_ingest" && candidate.document_id === target?.document_id)) && data.document_id
              ? {
                  ...candidate,
                  document_id: data.document_id,
                  version_id: data.document_version_id,
                  version_number: data.version_number,
                  status: data.status,
                  matched_by: "batch_summary_finalized",
                }
              : candidate);
          working[later] = {
            ...laterItem,
            analysis: {
              ...laterItem.analysis,
              matching_candidates: updatedCandidates,
              matching_classification: updatedCandidates.length ? laterItem.analysis.matching_classification : "no_match",
            },
          };
        }
      } catch (cause) {
        failures += 1;
        working[index] = { ...working[index], status: "failed", message: "Automatic decision failed: " + ((cause as Error).message || "Please review this upload manually.") };
      }
      setItems([...working]);
    }
    batchResults.splice(0, batchResults.length, ...working);
    if (failures) setError(failures + " document" + (failures === 1 ? "" : "s") + " could not be processed automatically. Open Review on those rows to retry or choose another action.");
  }

  async function startBatch(strategy: BatchAction = "review") {
    if (!context || !files.length || isRunning) return;
    setError("");
    setConfirmDeleteBatch(false);
    setStep(2);
    const batchResults: BatchItem[] = files.map((file, index) => ({ item_id: index, filename: file.name, status: "queued" }));
    setItems(batchResults);
    setBatchTotal(files.length);
    setIsRunning(true);
    setSelectedId(null);
    autoReviewOpened.current = false;
    setTitle("");
    setDescription("");

    try {
      const send = async (bearer: string) => {
        const form = new FormData();
        files.forEach((file) => form.append("files", file));
        selectedDepartments.forEach((id) => form.append("department_ids", id));
        selectedRoles.forEach((id) => form.append("access_role_ids", id));
        selectedMembers.forEach((id) => form.append("access_user_ids", id));
        deniedDepartments.forEach((id) => form.append("deny_department_ids", id));
        deniedRoles.forEach((id) => form.append("deny_role_ids", id));
        deniedMembers.forEach((id) => form.append("deny_user_ids", id));
        form.append("organization_wide_access", String(organizationWideAccess));
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
      const handle = async (frame: string) => {
        const line = frame.split(/\r?\n/).find((part) => part.startsWith("data:"));
        if (!line) return;
        const event = JSON.parse(line.slice(5).trim()) as BatchEvent;
        if (event.type === "progress") {
          const current = batchResults[event.item_id];
          if (current) batchResults[event.item_id] = { ...current, status: "processing", stage: event.stage, progress: Math.max(current.progress || 0, stageProgress(event.stage, event.state)), message: event.message || event.stage };
          setItems([...batchResults]);
        } else if (event.type === "item_result") {
          const analysis = event.data.data;
          const current = batchResults[event.data.item_id];
          if (current) batchResults[event.data.item_id] = {
            ...current,
            status: event.data.status as BatchItem["status"],
            analysis,
            error: event.data.error,
            message: event.data.error || event.data.status,
          };
          setItems([...batchResults]);
          if (strategy !== "review" && analysis?.ingestion_session_id && event.data.status === "ready_for_review") {
            await finalizeBatchAutomatically(batchResults, strategy);
          }
          if (strategy === "review" && analysis && analysis.ingestion_session_id && analysis.matching_classification !== "no_match" && !autoReviewOpened.current) {
            autoReviewOpened.current = true;
            setSelectedId(event.data.item_id);
            setTitle(analysis.title || event.data.filename.replace(/\.pdf$/i, ""));
            setDocumentType(analysis.document_type || "General document");
            setDescription(analysis.description || analysis.summary || "");
            setTargetDocumentId(context?.targetDocumentId || analysis.matching_candidates.find((candidate) => candidate.document_id)?.document_id || "");
            setArchived(false);
            setError("");
          }
        } else if (event.type === "completed") {
          setBatchTotal(event.total);
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          await handle(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
        if (done) break;
      }
      if (buffer.trim()) await handle(buffer);
      for (let index = 0; index < batchResults.length; index += 1) {
        const item = batchResults[index];
        if (item.status === "queued" || item.status === "processing") {
          batchResults[index] = { ...item, status: "failed", error: "The progress stream ended before this document returned a result." };
        }
      }
      setItems([...batchResults]);

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
    setTargetDocumentId(context?.targetDocumentId || item.analysis.matching_candidates.find((candidate) => candidate.document_id)?.document_id || "");
    setArchived(false);
    setError("");
    setIsOpen(true);
  }

  async function finalizeSelected(action: FinalizeAction, confirmed = false) {
    if (!context || !selectedItem?.analysis?.ingestion_session_id) return;
    if (action === "delete_and_ingest" && !confirmed) {
      setConfirmSingleDelete(true);
      return;
    }
    if (action !== "reject" && (!title.trim() || !documentType.trim() || !description.trim())) {
      setError("Title, document type, and description are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const data = await finalizeSession(selectedItem, action, targetDocumentId, {
        title,
        documentType,
        description,
        archived,
      });
      setItems((current) => current.map((item) => {
        if (item.item_id === selectedId) {
          return { ...item, status: data.status === "rejected" ? "rejected" : data.status as BatchItem["status"], message: data.status.replace(/_/g, " "), finalizeStatus: data.status };
        }
        if (!item.analysis) return item;
        const matchingCandidates = item.analysis.matching_candidates
          .filter((candidate) => !(action === "reject" && candidate.batch_item_id === selectedId))
          .map((candidate) => (candidate.batch_item_id === selectedId ||
            (action === "delete_and_ingest" && candidate.document_id === targetDocumentId)) && data.document_id
            ? { ...candidate, document_id: data.document_id, version_id: data.document_version_id, version_number: data.version_number, title: title.trim() || candidate.title, status: data.status, matched_by: "batch_summary_finalized" }
            : candidate);
        return { ...item, analysis: { ...item.analysis, matching_candidates: matchingCandidates, matching_classification: matchingCandidates.length ? item.analysis.matching_classification : "no_match" } };
      }));
      setSelectedId(null);
      setConfirmSingleDelete(false);
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
        <button type="button" onClick={() => setIsOpen(true)} className="sc-ingestion-launcher fixed bottom-5 right-5 z-[900] flex items-center gap-3 rounded-full border border-cyan-300/40 bg-slate-950 px-4 py-3 text-left text-white shadow-2xl shadow-black/40 transition hover:-translate-y-0.5 hover:border-cyan-200" aria-label="Open document ingestion progress">
          <span className="relative grid size-9 place-items-center rounded-full bg-cyan-300 text-sm font-bold text-slate-950">
            {isRunning ? <span className="animate-pulse">↻</span> : "PDF"}
            {isRunning && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-950" />}
          </span>
          <span className="min-w-0"><span className="block text-xs font-semibold">Document ingestion</span><span className="block text-[10px] text-slate-400">{isRunning ? `${completedCount}/${batchTotal} complete · ${activeCount} active` : `${reviewCount} awaiting review Â· ${progressPercent}% done`}</span></span>
        </button>
      )}

      {isOpen && context && (
        <div className="sc-ingestion-overlay fixed inset-0 z-[850] flex items-center justify-center bg-slate-950/75 p-3 backdrop-blur-sm sm:p-6">
          <section role="dialog" aria-modal="true" aria-labelledby="batch-ingestion-title" className="sc-ingestion-panel flex max-h-[min(92dvh,900px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#0b1724] text-white shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4 sm:px-7">
              <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400">Knowledge ingestion Â· Batch</p><h2 id="batch-ingestion-title" className="mt-1 text-xl font-semibold">{hasBatch ? "Batch ingestion progress" : "Add documents"}</h2><p className="mt-1 truncate text-xs text-slate-400">{context.organization.organization_name}</p></div>
              <button type="button" onClick={() => setIsOpen(false)} aria-label="Minimize ingestion panel" className="grid size-9 shrink-0 place-items-center rounded-lg border border-cyan-400/40 text-cyan-200 hover:bg-cyan-400/10"><span aria-hidden="true">×</span></button>
            </header>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-7">
              {!hasBatch && step === 1 && (
                <section className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg border border-cyan-300/40 bg-cyan-300/10 p-3 text-cyan-100"><b>STEP 01</b><span className="mt-1 block">Access & departments</span></div><div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3 text-slate-500"><b>STEP 02</b><span className="mt-1 block">Upload & process</span></div></div>
                  <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                    <h3 className="text-sm font-semibold">Who can access these documents?</h3>
                    <label className="mt-3 flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={organizationWideAccess} onChange={(event) => setOrganizationWideAccess(event.target.checked)} /> All current and future organization members</label>
                    {accessLoading ? <p className="mt-3 text-xs text-slate-500">Loading access options…</p> : <>
                      <p className="mt-4 text-xs font-semibold text-slate-300">Departments — allow</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">{context.departments.map((department) => <label key={"allow-"+department.id} className="flex items-center gap-2 rounded-lg border border-slate-800 p-2 text-xs text-slate-300"><input type="checkbox" checked={selectedDepartments.includes(department.id)} onChange={(event) => setSelectedDepartments((current) => event.target.checked ? [...current, department.id] : current.filter((id) => id !== department.id))} />{department.name}</label>)}</div>
                      <p className="mt-3 text-xs font-semibold text-rose-300">Departments — explicitly deny</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">{context.departments.map((department) => <label key={"deny-"+department.id} className="flex items-center gap-2 rounded-lg border border-rose-900/50 p-2 text-xs text-slate-300"><input type="checkbox" checked={deniedDepartments.includes(department.id)} onChange={(event) => setDeniedDepartments((current) => event.target.checked ? [...current, department.id] : current.filter((id) => id !== department.id))} />{department.name}</label>)}</div>
                      <p className="mt-4 text-xs font-semibold text-slate-300">Roles — allow</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">{roles.map((role) => <label key={"allow-"+role.id} className="flex items-center gap-2 rounded-lg border border-slate-800 p-2 text-xs text-slate-300"><input type="checkbox" checked={selectedRoles.includes(role.id)} onChange={(event) => setSelectedRoles((current) => event.target.checked ? [...current, role.id] : current.filter((id) => id !== role.id))} />{role.name}</label>)}</div>
                      <p className="mt-3 text-xs font-semibold text-rose-300">Roles — explicitly deny</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">{roles.map((role) => <label key={"deny-"+role.id} className="flex items-center gap-2 rounded-lg border border-rose-900/50 p-2 text-xs text-slate-300"><input type="checkbox" checked={deniedRoles.includes(role.id)} onChange={(event) => setDeniedRoles((current) => event.target.checked ? [...current, role.id] : current.filter((id) => id !== role.id))} />{role.name}</label>)}</div>
                      <p className="mt-4 text-xs font-semibold text-slate-300">Specific people — allow</p>
                      <div className="mt-2 max-h-36 space-y-2 overflow-y-auto">{members.map((member) => <label key={"allow-"+member.user_id} className="flex items-center gap-2 rounded-lg border border-slate-800 p-2 text-xs text-slate-300"><input type="checkbox" checked={selectedMembers.includes(member.user_id)} onChange={(event) => setSelectedMembers((current) => event.target.checked ? [...current, member.user_id] : current.filter((id) => id !== member.user_id))} /><span>{member.display_name || member.email || member.user_id}</span><span className="ml-auto text-[10px] text-slate-500">{member.email || ""}</span></label>)}</div>
                      <p className="mt-3 text-xs font-semibold text-rose-300">Specific people — explicitly deny</p>
                      <div className="mt-2 max-h-36 space-y-2 overflow-y-auto">{members.map((member) => <label key={"deny-"+member.user_id} className="flex items-center gap-2 rounded-lg border border-rose-900/50 p-2 text-xs text-slate-300"><input type="checkbox" checked={deniedMembers.includes(member.user_id)} onChange={(event) => setDeniedMembers((current) => event.target.checked ? [...current, member.user_id] : current.filter((id) => id !== member.user_id))} /><span>{member.display_name || member.email || member.user_id}</span><span className="ml-auto text-[10px] text-slate-500">{member.email || ""}</span></label>)}</div>
                    </>}
                  </section>
                  <label className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5 text-xs text-slate-300">
                    <input type="checkbox" checked={rememberAccessSelection} onChange={(event) => setRememberAccessSelection(event.target.checked)} className="mt-0.5" />
                    <span><b className="block text-slate-100">Remember this access selection</b><span className="mt-0.5 block text-slate-500">Reuse it the next time you upload documents in this organization. Your next saved selection replaces it.</span></span>
                  </label>
                  <button type="button" onClick={continueToUpload} disabled={accessLoading} className="w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-40">Continue to upload</button>
                </section>
              )}

              {!hasBatch && step === 2 && (
                <section>
                  <div className="grid grid-cols-2 gap-2 text-xs"><button type="button" onClick={() => setStep(1)} className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 p-3 text-left text-emerald-100"><b>STEP 01</b><span className="mt-1 block">Access & departments ✓</span></button><div className="rounded-lg border border-cyan-300/40 bg-cyan-300/10 p-3 text-cyan-100"><b>STEP 02</b><span className="mt-1 block">Upload & process</span></div></div>
                  <div className="mb-2 flex justify-end"><button type="button" onClick={() => setStep(1)} className="text-[11px] font-medium text-cyan-300 underline-offset-4 hover:text-cyan-100 hover:underline">Change access settings</button></div>
                  <p className="mb-3 text-xs text-slate-400">Access: {organizationWideAccess ? "All organization members" : "Explicit grants"} Â· {selectedDepartments.length} department grants Â· {selectedRoles.length} role grants Â· {selectedMembers.length} user grants Â· {deniedDepartments.length} department denies Â· {deniedRoles.length} role denies Â· {deniedMembers.length} user denies</p>
                  <label htmlFor="batch-pdf-files" className="block rounded-2xl border border-dashed border-slate-600 bg-slate-950/40 p-8 text-center hover:border-cyan-400/70">
                    <span className="text-3xl text-cyan-200">↑</span><span className="mt-3 block text-sm font-semibold">Choose multiple PDF documents</span><span className="mt-1 block text-xs text-slate-400">Up to {MAX_FILES} files Â· 25 MB per file</span>
                    <input id="batch-pdf-files" type="file" accept=".pdf,application/pdf" multiple onChange={chooseFiles} className="sr-only" />
                  </label>
                  {files.length > 0 && <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3"><div className="mb-2 flex justify-between text-xs"><span>{files.length} documents selected</span><span className="text-slate-400">{formatBytes(files.reduce((sum, file) => sum + file.size, 0))}</span></div><ul className="max-h-40 space-y-1 overflow-y-auto">{files.map((file) => <li key={file.name + file.size} className="flex justify-between gap-3 text-xs text-slate-300"><span className="truncate">{file.name}</span><span className="shrink-0 text-slate-500">{formatBytes(file.size)}</span></li>)}</ul></div>}
                  <div className="mt-4 flex items-center justify-between gap-2"><button type="button" onClick={() => setStep(1)} className="rounded-xl border border-slate-700 px-4 py-2.5 text-xs text-slate-300">Back</button><p className="text-[10px] text-slate-500">Choose how matching uploads should be handled</p></div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={() => void startBatch("independent")} disabled={!files.length || isRunning} className="rounded-xl border border-emerald-400/50 bg-gradient-to-br from-emerald-950/80 to-slate-900 px-4 py-3 text-left text-xs text-emerald-50 transition hover:border-emerald-300 hover:from-emerald-900/80 disabled:cursor-not-allowed disabled:opacity-90"><b className="block text-sm">Ingest anyway</b><span className="mt-1 block text-[10px] leading-4 text-slate-400">Keep matched documents and ingest each upload separately.</span></button>
                    <button type="button" onClick={() => setConfirmDeleteBatch(true)} disabled={!files.length || isRunning} className="rounded-xl border border-rose-400/60 bg-gradient-to-br from-rose-950/90 to-slate-900 px-4 py-3 text-left text-xs text-rose-50 transition hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-90"><b className="block text-sm">Delete and ingest</b><span className="mt-1 block text-[10px] leading-4 text-rose-200/70">Delete each matched document and all its versions before ingesting the upload.</span></button>
                    <button type="button" onClick={() => void startBatch("supersede")} disabled={!files.length || isRunning} className="rounded-xl border border-cyan-300/60 bg-gradient-to-br from-cyan-950/90 to-blue-950/70 px-4 py-3 text-left text-xs text-cyan-50 transition hover:border-cyan-200 disabled:cursor-not-allowed disabled:opacity-90"><b className="block text-sm">Supersede and ingest</b><span className="mt-1 block text-[10px] leading-4 text-cyan-100/70">Add a new version to the matched document.</span></button>
                    <button type="button" onClick={() => void startBatch("reject")} disabled={!files.length || isRunning} className="rounded-xl border border-amber-300/60 bg-gradient-to-br from-amber-950/90 to-orange-950/60 px-4 py-3 text-left text-xs text-amber-50 transition hover:border-amber-200 disabled:cursor-not-allowed disabled:opacity-90"><b className="block text-sm">Reject duplicates</b><span className="mt-1 block text-[10px] leading-4 text-amber-100/70">Reject matching uploads; ingest documents with no match.</span></button>
                    <button type="button" onClick={() => void startBatch("review")} disabled={!files.length || isRunning} className="rounded-xl bg-gradient-to-r from-cyan-300 to-sky-300 px-4 py-3 text-left text-xs font-semibold text-slate-950 shadow-md shadow-cyan-950/30 transition hover:from-cyan-200 hover:to-sky-200 disabled:cursor-not-allowed disabled:opacity-90 sm:col-span-2"><b className="block text-sm">Upload for review</b><span className="mt-1 block text-[10px] font-normal leading-4 text-slate-800">Analyze the batch, then let you inspect metadata and choose what to do with each match.</span></button>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-slate-500">For every strategy, documents without a match are ingested as new. Delete and supersede only apply when a matched document can be identified.</p>
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
                      <div className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 p-3 text-xs text-cyan-100"><b>STEP 03 Â· REVIEW</b><span className="mt-1 block">Verify the summary, hashes, metadata and duplicate matches before deciding.</span></div>
                      <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-cyan-100">Review document</p><p className="mt-1 truncate text-xs text-slate-400">{selectedItem.filename}</p></div><button type="button" onClick={() => setSelectedId(null)} className="text-xs text-slate-400 hover:text-white">Back to batch</button></div>
                      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-300">Title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={255} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="text-xs text-slate-300">Document type<input value={documentType} onChange={(event) => setDocumentType(event.target.value)} maxLength={100} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="text-xs text-slate-300 sm:col-span-2">Description<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={10000} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="flex items-center gap-2 self-end pb-2 text-xs text-slate-300"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} /> Archived</label></div>
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-[10px] text-slate-400"><p><b className="text-slate-300">SHA-256 file hash:</b> <span className="break-all font-mono">{selectedItem.analysis?.file_hash}</span></p><p className="mt-2"><b className="text-slate-300">Content hash:</b> <span className="break-all font-mono">{selectedItem.analysis?.content_hash}</span></p><p className="mt-2"><b className="text-slate-300">Pages:</b> {selectedItem.analysis?.page_count} Â· <b className="text-slate-300">Duplicate check:</b> {selectedItem.analysis?.matching_classification?.replace(/_/g, " ")}</p></div>
                      {selectedItem.analysis?.summary && <p className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs leading-5 text-slate-300">{selectedItem.analysis.summary}</p>}
                      {selectedItem.analysis && selectedItem.analysis.matching_classification !== "no_match" && <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-100"><b>Potential existing document detected — choose what to do</b><ul className="mt-2 space-y-2">{selectedItem.analysis.matching_candidates.map((candidate, index) => <li key={candidate.version_id || candidate.batch_ingestion_session_id || candidate.batch_item_id || index} className="flex items-start justify-between gap-3"><span>{candidate.title || candidate.original_filename || "Matched document"}<span className="block text-[10px] text-slate-400">{candidate.matched_by === "batch_identity" ? `Same resume identity: ${(candidate.identity_match_reasons || []).join(", ")}` : candidate.matched_by === "batch_summary" ? "Similar upload in this batch" : candidate.matched_by || "Summary similarity"}{!candidate.document_id ? " Â· waiting for earlier upload decision" : ` Â· v${candidate.version_number ?? "?"}`}</span></span><b className="shrink-0">{candidate.similarity_score == null ? "Exact match" : `${Math.round(candidate.similarity_score * 100)}%`}</b></li>)}</ul></div>}
                      {(context?.targetDocumentId || selectedItem.analysis?.matching_candidates.some((candidate) => Boolean(candidate.document_id))) && <label className="block text-xs text-amber-100">Matching document<select value={targetDocumentId} onChange={(event) => setTargetDocumentId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"><option value="">Choose a document to supersede</option>{context?.targetDocumentId && !selectedItem.analysis?.matching_candidates.some((candidate) => candidate.document_id === context.targetDocumentId) && <option value={context.targetDocumentId}>{context.targetDocumentTitle || "Selected document"}</option>}{(selectedItem.analysis?.matching_candidates || []).filter((candidate) => candidate.document_id).map((candidate) => <option key={candidate.document_id} value={candidate.document_id!}>{candidate.title || "Untitled document"} Â· v{candidate.version_number}</option>)}</select><span className="mt-1 block text-[10px] text-slate-500">You can supersede an existing document or ingest this as an independent document.</span></label>}
                      {error && <p role="alert" className="text-xs text-rose-200">{error}</p>}
                      <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={saving} onClick={() => void finalizeSelected("reject")} className="rounded-lg border border-rose-400/30 px-3 py-2 text-xs text-rose-200 disabled:opacity-40">Reject upload</button>{(context?.targetDocumentId || selectedItem.analysis?.matching_classification !== "no_match") ? <><button type="button" disabled={saving || !targetDocumentId} onClick={() => setConfirmSingleDelete(true)} className="rounded-lg border border-rose-400/40 px-3 py-2 text-xs text-rose-100 disabled:opacity-40">Delete previous & ingest</button><button type="button" disabled={saving || !targetDocumentId} onClick={() => void finalizeSelected("supersede")} className="rounded-lg bg-cyan-300 px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40">Ingest as superseding version</button><button type="button" disabled={saving} onClick={() => void finalizeSelected("independent")} className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 disabled:opacity-40">Ingest anyway</button></> : <button type="button" disabled={saving} onClick={() => void finalizeSelected("new")} className="rounded-lg bg-cyan-300 px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40">{saving ? "Saving…" : "Ingest as new"}</button>}</div>
                    </section>
                  ) : (
                    <section className="space-y-2">
                      {items.map((item) => <div key={item.item_id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                        <div className="flex items-center gap-3">
                          <span className={`grid size-8 shrink-0 place-items-center rounded-lg text-[10px] font-bold ${item.status === "failed" ? "bg-rose-400/10 text-rose-200" : item.status === "duplicate" ? "bg-amber-400/10 text-amber-200" : item.status === "indexed" || item.status === "rejected" ? "bg-emerald-400/10 text-emerald-200" : "bg-cyan-400/10 text-cyan-200"}`}>PDF</span>
                          <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-100">{item.filename}</p><p className="mt-1 truncate text-[10px] text-slate-400">{item.message || item.stage || item.status}</p></div>
                          <span className="shrink-0 font-mono text-xs font-semibold text-cyan-200">{item.status === "failed" ? "Error" : `${Math.round(item.progress || (["duplicate", "indexed", "rejected"].includes(item.status) ? 100 : 0))}%`}</span>
                          {(item.status === "ready_for_review" || item.status === "failed") && item.analysis?.ingestion_session_id && <button type="button" onClick={() => openReview(item)} className="shrink-0 rounded-lg border border-cyan-400/30 px-2.5 py-1.5 text-[10px] text-cyan-200">Review</button>}
                        </div>
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-label={`Progress for ${item.filename}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.status === "failed" ? 0 : Math.round(item.progress || (["duplicate", "indexed", "rejected"].includes(item.status) ? 100 : 0))}>
                          <div className={`h-full rounded-full transition-all duration-500 ${item.status === "failed" ? "bg-rose-400" : item.status === "duplicate" || item.status === "rejected" ? "bg-amber-300" : "bg-gradient-to-r from-cyan-400 to-emerald-300"}`} style={{ width: `${item.status === "failed" ? 100 : Math.round(item.progress || (["duplicate", "indexed", "rejected"].includes(item.status) ? 100 : 0))}%` }} />
                        </div>
                      </div>)}
                    </section>
                  )}
                  {!isRunning && !selectedItem && <button type="button" onClick={() => { setItems([]); setFiles([]); setBatchTotal(0); setSelectedId(null); setStep(1); setError(""); }} className="w-full rounded-xl border border-slate-700 px-4 py-2.5 text-xs text-slate-200 hover:bg-slate-800">Start another batch</button>}
                </>
              )}
              {error && !selectedItem && <p role="alert" className="rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2.5 text-xs text-rose-200">{error}</p>}
            </div>
            {confirmDeleteBatch && (
              <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/80 p-4" role="presentation">
                <section role="alertdialog" aria-modal="true" aria-labelledby="delete-batch-title" aria-describedby="delete-batch-description" className="w-full max-w-md rounded-2xl border border-rose-400/40 bg-[#101b29] p-5 text-white shadow-2xl">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-rose-300">Permanent deletion</p>
                  <h3 id="delete-batch-title" className="mt-2 text-lg font-semibold">Delete matched documents and ingest?</h3>
                  <p id="delete-batch-description" className="mt-2 text-xs leading-5 text-slate-300">This applies to matched documents in the {files.length}-file batch. Each matched document and all its versions, PDFs, access rules and search indexes will be permanently deleted before the new upload is ingested. Files with no match will be ingested as new.</p>
                  <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setConfirmDeleteBatch(false)} className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200">Cancel</button><button type="button" onClick={() => { setConfirmDeleteBatch(false); void startBatch("delete_and_ingest"); }} className="rounded-lg bg-rose-500 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-400">Delete and start batch</button></div>
                </section>
              </div>
            )}
            {confirmSingleDelete && selectedItem && (
              <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/80 p-4" role="presentation">
                <section role="alertdialog" aria-modal="true" aria-labelledby="delete-item-title" aria-describedby="delete-item-description" className="w-full max-w-md rounded-2xl border border-rose-400/40 bg-[#101b29] p-5 text-white shadow-2xl">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-rose-300">Permanent deletion</p>
                  <h3 id="delete-item-title" className="mt-2 text-lg font-semibold">Delete the matched document?</h3>
                  <p id="delete-item-description" className="mt-2 text-xs leading-5 text-slate-300">All versions, source PDFs, access rules and search indexes for the selected document will be permanently deleted before this upload is ingested.</p>
                  <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setConfirmSingleDelete(false)} disabled={saving} className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200">Cancel</button><button type="button" onClick={() => void finalizeSelected("delete_and_ingest", true)} disabled={saving} className="rounded-lg bg-rose-500 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-400 disabled:opacity-40">{saving ? "Deleting…" : "Delete and ingest"}</button></div>
                </section>
              </div>
            )}
            <footer className="flex items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/50 px-5 py-3 text-[10px] text-slate-500 sm:px-7"><span>Minimize to continue working elsewhere in SaviraCortex.</span><button type="button" onClick={() => setIsOpen(false)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800">Minimize</button></footer>
          </section>
        </div>
      )}
    </>
  );
}
