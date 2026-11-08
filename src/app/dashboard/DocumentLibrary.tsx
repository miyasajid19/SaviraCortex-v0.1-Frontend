"use client";

import { FormEvent, useEffect, useState } from "react";
import { auth } from "../firebase";

type Organization = { organization_id: string; organization_name: string };
type Department = { id: string; name: string };
type Version = {
  id: string;
  version_number: number;
  version_label: string | null;
  original_filename: string;
  summary: string | null;
  status: string;
  page_count: number | null;
  effective_from: string | null;
  effective_until: string | null;
  supersedes_version_id: string | null;
  created_at: string;
};
type DocumentRecord = {
  id: string;
  title: string;
  document_type: string;
  description: string | null;
  department_id: string | null;
  department_name: string | null;
  archived: boolean;
  created_at: string;
  active_version_id: string | null;
  versions: Version[];
};
type LibraryResponse = {
  items: DocumentRecord[];
  total: number;
  limit: number;
  offset: number;
};
type VersionSummaryUpdate = { version: Version; summary_index_synced: boolean };

const API = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
const PAGE_SIZE = 10;

function messageFrom(data: unknown, fallback: string) {
  return data && typeof data === "object" && "detail" in data && typeof data.detail === "string"
    ? data.detail
    : fallback;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function statusClass(status: string) {
  if (status === "active") return "border-emerald-300/20 bg-emerald-300/10 text-emerald-200";
  if (status === "superseded") return "border-slate-400/20 bg-slate-400/10 text-slate-300";
  if (status === "pending") return "border-amber-300/20 bg-amber-300/10 text-amber-200";
  return "border-white/10 bg-white/[0.04] text-slate-400";
}

export default function DocumentLibrary({
  organization,
  token,
  uploaderId,
  departments,
  canManage,
}: {
  organization: Organization;
  token: string;
  uploaderId: string;
  departments: Department[];
  canManage: boolean;
}) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<DocumentRecord | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftType, setDraftType] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftDepartment, setDraftDepartment] = useState("");
  const [summaryDrafts, setSummaryDrafts] = useState<Record<string, string>>({});
  const [savingVersionId, setSavingVersionId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const onDocumentsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ organization_id?: string }>).detail;
      if (detail?.organization_id === organization.organization_id) {
        setReloadKey((current) => current + 1);
      }
    };
    window.addEventListener("savira:documents-changed", onDocumentsChanged);
    return () => window.removeEventListener("savira:documents-changed", onDocumentsChanged);
  }, [organization.organization_id]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
          include_archived: String(includeArchived),
        });
        if (search) params.set("search", search);
        let bearer = token;
        const send = () => fetch(
          `${API}/api/v1/organizations/${organization.organization_id}/documents?${params.toString()}`,
          { headers: { Authorization: `Bearer ${bearer}` }, cache: "no-store" },
        );
        let response = await send();
        if (response.status === 401 && auth?.currentUser) {
          bearer = await auth.currentUser.getIdToken(true);
          response = await send();
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(messageFrom(data, `Could not load documents (HTTP ${response.status}).`));
        if (cancelled) return;
        const result = data as LibraryResponse;
        setDocuments(result.items || []);
        setTotal(result.total || 0);
        setSelected((current) => current
          ? (result.items || []).find((item) => item.id === current.id) || null
          : null);
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message || "Could not load the document library.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [organization.organization_id, token, page, search, includeArchived, reloadKey]);

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!auth?.currentUser) throw new Error("Your sign-in session has expired. Sign in again.");
    let bearer = await auth.currentUser.getIdToken();
    const send = () => fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...(init.headers as Record<string, string> | undefined),
      },
      cache: "no-store",
    });
    let response = await send();
    if (response.status === 401) {
      bearer = await auth.currentUser!.getIdToken(true);
      response = await send();
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(messageFrom(data, `Request failed (HTTP ${response.status}).`));
    return data as T;
  }

  function openDocument(document: DocumentRecord) {
    setSelected(document);
    setDraftTitle(document.title);
    setDraftType(document.document_type);
    setDraftDescription(document.description || "");
    setDraftDepartment(document.department_id || "");
    setSummaryDrafts(Object.fromEntries(
      document.versions.map((version) => [version.id, version.summary || ""]),
    ));
    setError("");
    setSuccess("");
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(0);
    setSearch(searchInput.trim());
  }

  async function saveMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !canManage) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const updated = await request<DocumentRecord>(
        `/api/v1/organizations/${organization.organization_id}/documents/${selected.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: draftTitle.trim(),
            document_type: draftType.trim(),
            description: draftDescription.trim(),
            department_id: draftDepartment || null,
          }),
        },
      );
      setSelected(updated);
      setSuccess("Document details saved.");
      setReloadKey((current) => current + 1);
    } catch (cause) {
      setError((cause as Error).message || "Document details could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function setArchived(archived: boolean) {
    if (!selected || !canManage) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const updated = await request<DocumentRecord>(
        `/api/v1/organizations/${organization.organization_id}/documents/${selected.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived }),
        },
      );
      setSelected(updated);
      setSuccess(archived ? "Document archived." : "Document restored to the library.");
      setReloadKey((current) => current + 1);
    } catch (cause) {
      setError((cause as Error).message || "The document lifecycle could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  async function saveVersionSummary(versionId: string) {
    if (!selected || !canManage) return;
    const summary = (summaryDrafts[versionId] || "").trim();
    if (!summary) {
      setError("A version summary cannot be empty.");
      return;
    }
    setSavingVersionId(versionId);
    setError("");
    setSuccess("");
    try {
      const result = await request<VersionSummaryUpdate>(
        `/api/v1/organizations/${organization.organization_id}/documents/${selected.id}/versions/${versionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summary }),
        },
      );
      setSelected((current) => current
        ? {
            ...current,
            versions: current.versions.map((version) =>
              version.id === versionId ? result.version : version,
            ),
          }
        : current);
      setSummaryDrafts((current) => ({ ...current, [versionId]: result.version.summary || "" }));
      if (result.summary_index_synced) {
        setSuccess(`Version ${result.version.version_number} summary saved and synchronized.`);
      } else {
        setError("The summary was saved in the database, but its Qdrant summary index could not be synchronized. Save it again to retry.");
      }
    } catch (cause) {
      setError((cause as Error).message || "The version summary could not be saved.");
    } finally {
      setSavingVersionId(null);
    }
  }

  async function permanentlyDelete() {
    if (!selected || !canManage) return;
    setSaving(true);
    setError("");
    try {
      await request(
        `/api/v1/organizations/${organization.organization_id}/documents/${selected.id}`,
        { method: "DELETE" },
      );
      setSelected(null);
      setConfirmDelete(false);
      setSuccess("Document and its indexed content were permanently deleted.");
      setPage((current) => Math.max(0, current - (documents.length === 1 ? 1 : 0)));
      setReloadKey((current) => current + 1);
    } catch (cause) {
      setError((cause as Error).message || "The document could not be fully deleted.");
      setConfirmDelete(false);
    } finally {
      setSaving(false);
    }
  }

  function addReplacementVersion() {
    if (!selected || !canManage) return;
    window.dispatchEvent(new CustomEvent("savira:open-ingestion", {
      detail: {
        organization,
        uploaderId,
        departments,
        targetDocumentId: selected.id,
        targetDocumentTitle: selected.title,
      },
    }));
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const latestVersion = (document: DocumentRecord) => document.versions[0];

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0b1724]/80 shadow-xl shadow-black/10">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.07] px-5 py-5 sm:px-6">
        <div>
          <p className="sc-kicker">KNOWLEDGE / DOCUMENT REGISTER</p>
          <h3 className="mt-2 text-xl font-semibold text-white">Available documents</h3>
          <p className="mt-1 text-xs text-slate-500">Browse source files, summaries and the full revision history for this workspace.</p>
        </div>
        <span className="sc-count-chip">{total} {total === 1 ? "document" : "documents"}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-5 py-4 sm:px-6">
        <form onSubmit={submitSearch} className="flex min-w-[220px] flex-1 gap-2">
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search document titles"
            aria-label="Search document titles"
            className="sc-input min-w-0"
          />
          {searchInput && <button type="button" onClick={() => { setSearchInput(""); setSearch(""); setPage(0); }} className="rounded-lg border border-white/10 px-3 text-xs text-slate-400 hover:text-white">Clear</button>}
          <button type="submit" className="sc-action-button">Search</button>
        </form>
        {canManage && (
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => { setIncludeArchived(event.target.checked); setPage(0); setSelected(null); }}
              className="accent-cyan-300"
            />
            Include archived
          </label>
        )}
      </div>

      {error && <p role="alert" className="sc-inline-error mx-5 mt-4 sm:mx-6">{error}</p>}
      {success && <p role="status" className="sc-inline-success mx-5 mt-4 sm:mx-6">{success}</p>}

      <div className={selected ? "grid gap-0 xl:grid-cols-[minmax(0,1fr)_minmax(340px,.9fr)]" : ""}>
        <div className="min-w-0">
          {loading ? (
            <div className="space-y-3 p-5"><div className="sc-skeleton h-10 w-full" /><div className="sc-skeleton h-16 w-full" /><div className="sc-skeleton h-16 w-full" /></div>
          ) : documents.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-xs">
                <thead className="bg-white/[0.025] text-[10px] uppercase tracking-[.12em] text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold sm:px-6">Document</th>
                    <th className="px-3 py-3 font-semibold">Latest summary</th>
                    <th className="px-3 py-3 font-semibold">Versions</th>
                    <th className="px-3 py-3 font-semibold">Current status</th>
                    <th className="px-5 py-3 font-semibold sm:px-6">Latest version</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((document) => {
                    const latest = latestVersion(document);
                    const isSelected = selected?.id === document.id;
                    return (
                      <tr key={document.id} className={`border-t border-white/[0.055] transition hover:bg-white/[0.035] ${isSelected ? "bg-cyan-300/[0.055]" : ""}`}>
                        <td className="px-5 py-4 sm:px-6">
                          <button type="button" onClick={() => openDocument(document)} className="block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
                            <span className="block truncate font-semibold text-slate-100">{document.title}</span>
                            <span className="mt-1 block truncate text-[10px] text-slate-500">{document.document_type}{document.department_name ? ` · ${document.department_name}` : ""}{document.archived ? " · Archived" : ""}</span>
                          </button>
                        </td>
                        <td className="max-w-[260px] px-3 py-4"><p className="line-clamp-2 text-[10px] leading-4 text-slate-400">{latest?.summary || "No summary available"}</p></td>
                        <td className="px-3 py-4 text-slate-300">{document.versions.length}</td>
                        <td className="px-3 py-4">
                          {latest ? <span className={`rounded-full border px-2 py-1 text-[10px] capitalize ${statusClass(latest.status)}`}>{latest.status}</span> : <span className="text-slate-500">No version</span>}
                        </td>
                        <td className="px-5 py-4 text-slate-500 sm:px-6">{formatDate(latest?.created_at || document.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="sc-empty m-5">
              <strong>{search ? "No matching documents" : "No documents yet"}</strong>
              <span>{search ? "Try a different title or clear your search." : "Ingest a PDF to add the first document to this organization's library."}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-3 sm:px-6">
            <span className="text-[10px] text-slate-500">{total ? `Showing ${page * PAGE_SIZE + 1}–${Math.min(total, page * PAGE_SIZE + documents.length)} of ${total}` : "No documents"}</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page === 0 || loading} onClick={() => setPage((current) => Math.max(0, current - 1))} className="rounded-lg border border-white/10 px-3 py-1.5 text-[10px] text-slate-300 hover:bg-white/[0.05] disabled:opacity-35">Previous</button>
              <span className="text-[10px] tabular-nums text-slate-500">{page + 1} / {pageCount}</span>
              <button type="button" disabled={page + 1 >= pageCount || loading} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} className="rounded-lg border border-white/10 px-3 py-1.5 text-[10px] text-slate-300 hover:bg-white/[0.05] disabled:opacity-35">Next</button>
            </div>
          </div>
        </div>

        {selected && (
          <aside className="border-t border-white/[0.08] bg-slate-950/25 p-5 xl:border-l xl:border-t-0 sm:p-6" aria-label="Selected document details">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="sc-kicker">DOCUMENT DETAILS</p>
                <h4 className="mt-2 break-words text-lg font-semibold text-white">{selected.title}</h4>
                <p className="mt-1 text-[10px] text-slate-500">{selected.versions.length} stored {selected.versions.length === 1 ? "version" : "versions"} · Added {formatDate(selected.created_at)}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close document details" className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 text-slate-400 hover:bg-white/[0.05] hover:text-white">×</button>
            </div>

            {canManage && (
              <form onSubmit={saveMetadata} className="mt-5 space-y-3">
                <label className="block text-[11px] text-slate-400">Title
                  <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} required maxLength={255} className="sc-input mt-1" />
                </label>
                <label className="block text-[11px] text-slate-400">Document type
                  <input value={draftType} onChange={(event) => setDraftType(event.target.value)} required maxLength={100} className="sc-input mt-1" />
                </label>
                <label className="block text-[11px] text-slate-400">Description
                  <textarea value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} rows={3} maxLength={10000} className="sc-input mt-1 h-auto resize-y py-2" />
                </label>
                <label className="block text-[11px] text-slate-400">Department
                  <select value={draftDepartment} onChange={(event) => setDraftDepartment(event.target.value)} className="sc-input mt-1">
                    <option value="">No department</option>
                    {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                  </select>
                </label>
                <button type="submit" disabled={saving || !draftTitle.trim() || !draftType.trim()} className="sc-action-button w-full">{saving ? "Saving…" : "Save document details"}</button>
              </form>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {canManage && (
                <>
                  <button type="button" disabled={saving || selected.archived} onClick={addReplacementVersion} className="rounded-lg border border-cyan-300/25 bg-cyan-300/[0.07] px-3 py-2 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-300/[0.12] disabled:opacity-40">Supersede with new version</button>
                  <button type="button" disabled={saving} onClick={() => void setArchived(!selected.archived)} className="rounded-lg border border-white/10 px-3 py-2 text-[10px] text-slate-300 hover:bg-white/[0.05] disabled:opacity-40">{selected.archived ? "Restore document" : "Archive document"}</button>
                  <button type="button" disabled={saving} onClick={() => setConfirmDelete(true)} className="rounded-lg border border-rose-300/20 px-3 py-2 text-[10px] text-rose-200 hover:bg-rose-300/[0.07] disabled:opacity-40">Delete permanently</button>
                </>
              )}
            </div>

            <div className="mt-6 border-t border-white/[0.07] pt-5">
              <div className="flex items-center justify-between gap-3">
                <div><p className="sc-kicker">REVISION HISTORY</p><h5 className="mt-1 text-sm font-semibold text-white">Summaries by version</h5></div>
                <span className="sc-count-chip">{selected.versions.length}</span>
              </div>
              {selected.versions.length ? (
                <div className="mt-3 max-h-[520px] space-y-3 overflow-y-auto pr-1">
                  {selected.versions.map((version) => (
                    <article key={version.id} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-xs text-slate-100">Version {version.version_number}{version.version_label ? ` · ${version.version_label}` : ""}</strong>
                        <span className={`rounded-full border px-2 py-1 text-[9px] capitalize ${statusClass(version.status)}`}>{version.status}</span>
                      </div>
                      <p className="mt-2 text-[10px] text-slate-500">{version.original_filename} · {version.page_count ?? "—"} pages · {formatDate(version.created_at)}</p>
                      {canManage ? (
                        <div className="mt-3">
                          <label className="block text-[10px] font-medium text-slate-500">Version summary
                            <textarea
                              rows={5}
                              maxLength={20000}
                              value={summaryDrafts[version.id] ?? version.summary ?? ""}
                              onChange={(event) => setSummaryDrafts((current) => ({ ...current, [version.id]: event.target.value }))}
                              className="sc-input mt-1 h-auto resize-y py-2 text-xs leading-5"
                            />
                          </label>
                          <button
                            type="button"
                            disabled={savingVersionId === version.id || !(summaryDrafts[version.id] ?? version.summary ?? "").trim()}
                            onClick={() => void saveVersionSummary(version.id)}
                            className="sc-action-button mt-2 w-full"
                          >
                            {savingVersionId === version.id ? "Saving summary…" : "Save version summary"}
                          </button>
                        </div>
                      ) : (
                        <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-slate-300">{version.summary || "No summary is available for this version."}</p>
                      )}
                      {version.effective_from && <p className="mt-2 text-[10px] text-slate-500">Effective from {formatDate(version.effective_from)}</p>}
                    </article>
                  ))}
                </div>
              ) : <p className="mt-3 text-xs text-slate-500">No versions have been registered for this document.</p>}
            </div>
          </aside>
        )}
      </div>

      {confirmDelete && selected && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <section role="alertdialog" aria-modal="true" aria-labelledby="delete-document-title" aria-describedby="delete-document-description" className="w-full max-w-md rounded-2xl border border-rose-300/20 bg-[#0b1724] p-5 shadow-2xl">
            <p className="sc-kicker text-rose-200">PERMANENT ACTION</p>
            <h4 id="delete-document-title" className="mt-2 text-lg font-semibold text-white">Delete “{selected.title}”?</h4>
            <p id="delete-document-description" className="mt-2 text-sm leading-6 text-slate-400">This permanently removes every version, its source PDFs, document summaries, Qdrant chunks and BM25 search entries. This cannot be undone.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setConfirmDelete(false)} className="rounded-lg border border-white/10 px-4 py-2 text-xs text-slate-300 hover:bg-white/[0.05]">Cancel</button>
              <button type="button" disabled={saving} onClick={() => void permanentlyDelete()} className="rounded-lg bg-rose-400 px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40">{saving ? "Deleting…" : "Delete permanently"}</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
