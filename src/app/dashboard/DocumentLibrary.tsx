"use client";

import { FormEvent, useEffect, useState } from "react";
import { auth } from "../firebase";

type Organization = { organization_id: string; organization_name: string };
type Department = { id: string; name: string };
type AccessRole = { id: string; name: string };
type AccessMember = { user_id: string; email: string | null; display_name: string | null };
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
  department_name?: string | null;
  department_ids: string[];
  department_tags: string[];
  department_deny_ids: string[];
  role_allow_ids: string[];
  role_deny_ids: string[];
  user_allow_ids: string[];
  user_deny_ids: string[];
  organization_wide_access: boolean;
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
  if (status === "active") return "border-[#dedee1] bg-[#f7f7f8] text-[#333]";
  if (status === "superseded") return "border-[#e5e5e7] bg-white text-[#666]";
  if (status === "pending") return "border-[#dedee1] bg-[#f7f7f8] text-[#555]";
  return "border-[#e5e5e7] bg-white text-[#777]";
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
  const [summaryDrafts, setSummaryDrafts] = useState<Record<string, string>>({});
  const [savingVersionId, setSavingVersionId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [accessRoles, setAccessRoles] = useState<AccessRole[]>([]);
  const [accessMembers, setAccessMembers] = useState<AccessMember[]>([]);
  const [departmentAllowIds, setDepartmentAllowIds] = useState<string[]>([]);
  const [departmentDenyIds, setDepartmentDenyIds] = useState<string[]>([]);
  const [roleAllowIds, setRoleAllowIds] = useState<string[]>([]);
  const [roleDenyIds, setRoleDenyIds] = useState<string[]>([]);
  const [userAllowIds, setUserAllowIds] = useState<string[]>([]);
  const [userDenyIds, setUserDenyIds] = useState<string[]>([]);
  const [organizationWideAccess, setOrganizationWideAccess] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    async function loadAccessOptions() {
      try {
        const bearer = auth?.currentUser ? await auth.currentUser.getIdToken() : token;
        const headers = { Authorization: "Bearer " + bearer };
        const [roleResponse, memberResponse] = await Promise.all([
          fetch(API + "/api/v1/organizations/" + organization.organization_id + "/roles", { headers, cache: "no-store" }),
          fetch(API + "/api/v1/organizations/" + organization.organization_id + "/members", { headers, cache: "no-store" }),
        ]);
        if (!roleResponse.ok || !memberResponse.ok) throw new Error("Could not load access options.");
        const [roleData, memberData] = await Promise.all([roleResponse.json(), memberResponse.json()]);
        if (!cancelled) {
          setAccessRoles(roleData);
          setAccessMembers(memberData);
        }
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message || "Could not load access options.");
      }
    }
    void loadAccessOptions();
    return () => { cancelled = true; };
  }, [organization.organization_id, token, canManage]);

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
    setDepartmentAllowIds(document.department_ids || []);
    setDepartmentDenyIds(document.department_deny_ids || []);
    setRoleAllowIds(document.role_allow_ids || []);
    setRoleDenyIds(document.role_deny_ids || []);
    setUserAllowIds(document.user_allow_ids || []);
    setUserDenyIds(document.user_deny_ids || []);
    setOrganizationWideAccess(Boolean(document.organization_wide_access));
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

  async function saveAccessRules() {
    if (!selected || !canManage) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await request(
        "/api/v1/organizations/" + organization.organization_id + "/documents/" + selected.id + "/access",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            department_allow_ids: departmentAllowIds,
            department_deny_ids: departmentDenyIds,
            role_allow_ids: roleAllowIds,
            role_deny_ids: roleDenyIds,
            user_allow_ids: userAllowIds,
            user_deny_ids: userDenyIds,
            organization_wide_access: organizationWideAccess,
          }),
        },
      );
      setSuccess("Document access rules saved.");
      setReloadKey((current) => current + 1);
    } catch (cause) {
      setError((cause as Error).message || "Document access rules could not be saved.");
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
    <section className="overflow-hidden sc-document-library rounded-2xl border border-[#e8e8ea] bg-white shadow-sm shadow-black/[0.03]">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#ededee] px-5 py-5 sm:px-6">
        <div>
          <p className="sc-kicker">KNOWLEDGE / DOCUMENT REGISTER</p>
          <h3 className="mt-2 text-xl font-semibold text-[#202024]">Available documents</h3>
          <p className="mt-1 text-xs text-[#77777f]">Browse source files, summaries and the full revision history for this workspace.</p>
        </div>
        <span className="sc-count-chip">{total} {total === 1 ? "document" : "documents"}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-[#ededee] px-5 py-4 sm:px-6">
        <form onSubmit={submitSearch} className="flex min-w-[220px] flex-1 gap-2">
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search document titles"
            aria-label="Search document titles"
            className="sc-input min-w-0"
          />
          {searchInput && <button type="button" onClick={() => { setSearchInput(""); setSearch(""); setPage(0); }} className="rounded-lg border border-[#e5e5e7] px-3 text-xs text-[#66666e] hover:text-[#202024]">Clear</button>}
          <button type="submit" className="sc-action-button">Search</button>
        </form>
        {canManage && (
          <label className="flex items-center gap-2 text-xs text-[#66666e]">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => { setIncludeArchived(event.target.checked); setPage(0); setSelected(null); }}
              className="accent-[#555]"
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
              <table className="w-full min-w-[780px] table-fixed text-left text-xs">
                <thead className="bg-[#fafafa] text-[10px] uppercase tracking-[.12em] text-[#77777f]">
                  <tr>
                    <th className="w-[30%] px-5 py-3 font-semibold sm:px-6">Document</th>
                    <th className="w-[30%] px-3 py-3 font-semibold">Latest summary</th>
                    <th className="w-[9%] px-3 py-3 font-semibold">Versions</th>
                    <th className="w-[13%] px-3 py-3 font-semibold">Current status</th>
                    <th className="w-[18%] px-5 py-3 font-semibold sm:px-6">Latest version</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((document) => {
                    const latest = latestVersion(document);
                    const isSelected = selected?.id === document.id;
                    return (
                      <tr key={document.id} className={`border-t border-[#ededee] transition hover:bg-[#f8f8f9] ${isSelected ? "bg-[#f2f2f3]" : ""}`}>
                        <td className="px-5 py-4 sm:px-6">
                          <button type="button" onClick={() => openDocument(document)} className="block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#777]">
                            <span title={document.title} className="block max-w-full truncate font-semibold text-[#222226]">{document.title}</span>
                            <span className="mt-1 block truncate text-[10px] text-[#77777f]">{document.document_type}{(document.department_tags?.length ? document.department_tags.join(", ") : document.department_name) ? ` · ${(document.department_tags?.length ? document.department_tags : [document.department_name]).join(", ")}` : ""}{document.archived ? " · Archived" : ""}</span>
                          </button>
                        </td>
                        <td className="max-w-[260px] px-3 py-4"><p className="line-clamp-2 text-[10px] leading-4 text-[#66666e]">{latest?.summary || "No summary available"}</p></td>
                        <td className="px-3 py-4 text-[#55555c]">{document.versions.length}</td>
                        <td className="px-3 py-4">
                          {latest ? <span className={`rounded-full border px-2 py-1 text-[10px] capitalize ${statusClass(latest.status)}`}>{latest.status}</span> : <span className="text-[#77777f]">No version</span>}
                        </td>
                        <td className="px-5 py-4 text-[#77777f] sm:px-6">{formatDate(latest?.created_at || document.created_at)}</td>
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

          <div className="flex items-center justify-between gap-3 border-t border-[#ededee] px-5 py-3 sm:px-6">
            <span className="text-[10px] text-[#77777f]">{total ? `Showing ${page * PAGE_SIZE + 1}–${Math.min(total, page * PAGE_SIZE + documents.length)} of ${total}` : "No documents"}</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page === 0 || loading} onClick={() => setPage((current) => Math.max(0, current - 1))} className="rounded-lg border border-[#e5e5e7] px-3 py-1.5 text-[10px] text-[#55555c] hover:bg-[#f7f7f8] disabled:opacity-35">Previous</button>
              <span className="text-[10px] tabular-nums text-[#77777f]">{page + 1} / {pageCount}</span>
              <button type="button" disabled={page + 1 >= pageCount || loading} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} className="rounded-lg border border-[#e5e5e7] px-3 py-1.5 text-[10px] text-[#55555c] hover:bg-[#f7f7f8] disabled:opacity-35">Next</button>
            </div>
          </div>
        </div>

        {selected && (
          <aside className="border-t border-[#e8e8ea] bg-[#fafafa] p-5 xl:border-l xl:border-t-0 sm:p-6" aria-label="Selected document details">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="sc-kicker">DOCUMENT DETAILS</p>
                <h4 className="mt-2 break-words text-lg font-semibold text-[#202024]">{selected.title}</h4>
                <p className="mt-1 text-[10px] text-[#77777f]">{selected.versions.length} stored {selected.versions.length === 1 ? "version" : "versions"} · Added {formatDate(selected.created_at)}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close document details" className="grid size-8 shrink-0 place-items-center rounded-lg border border-[#e5e5e7] text-[#66666e] hover:bg-[#f7f7f8] hover:text-[#202024]">×</button>
            </div>

            {canManage && (
              <form onSubmit={saveMetadata} className="mt-5 space-y-3">
                <label className="block text-[11px] text-[#66666e]">Title
                  <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} required maxLength={255} className="sc-input mt-1" />
                </label>
                <label className="block text-[11px] text-[#66666e]">Document type
                  <input value={draftType} onChange={(event) => setDraftType(event.target.value)} required maxLength={100} className="sc-input mt-1" />
                </label>
                <label className="block text-[11px] text-[#66666e]">Description
                  <textarea value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} rows={3} maxLength={10000} className="sc-input mt-1 h-auto resize-y py-2" />
                </label>
<button type="submit" disabled={saving || !draftTitle.trim() || !draftType.trim()} className="sc-action-button w-full">{saving ? "Saving…" : "Save document details"}</button>
              </form>
            )}

            {canManage && (
              <section className="mt-5 rounded-xl border border-[#e8e8ea] bg-[#fafafa] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div><h3 className="text-sm font-semibold text-[#222226]">Retrieval access rules</h3><p className="mt-1 text-[10px] text-[#77777f]">Any matching allow grants access. Any matching deny overrides every grant, including owner/admin retrieval.</p></div>
                  <label className="flex shrink-0 items-center gap-2 text-[10px] text-[#55555c]"><input type="checkbox" checked={organizationWideAccess} onChange={(event) => setOrganizationWideAccess(event.target.checked)} />Organization-wide</label>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div><p className="text-xs font-semibold text-[#55555c]">Departments — allow</p>{departments.map((item) => <label key={"dept-a-"+item.id} className="mt-2 flex items-center gap-2 text-xs text-[#55555c]"><input type="checkbox" checked={departmentAllowIds.includes(item.id)} onChange={(event) => setDepartmentAllowIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />{item.name}</label>)}</div>
                  <div><p className="text-xs font-semibold text-[#55555c]">Departments — deny</p>{departments.map((item) => <label key={"dept-d-"+item.id} className="mt-2 flex items-center gap-2 text-xs text-[#55555c]"><input type="checkbox" checked={departmentDenyIds.includes(item.id)} onChange={(event) => setDepartmentDenyIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />{item.name}</label>)}</div>
                  <div><p className="text-xs font-semibold text-[#55555c]">Roles — allow</p>{accessRoles.map((item) => <label key={"role-a-"+item.id} className="mt-2 flex items-center gap-2 text-xs text-[#55555c]"><input type="checkbox" checked={roleAllowIds.includes(item.id)} onChange={(event) => setRoleAllowIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />{item.name}</label>)}</div>
                  <div><p className="text-xs font-semibold text-[#55555c]">Roles — deny</p>{accessRoles.map((item) => <label key={"role-d-"+item.id} className="mt-2 flex items-center gap-2 text-xs text-[#55555c]"><input type="checkbox" checked={roleDenyIds.includes(item.id)} onChange={(event) => setRoleDenyIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />{item.name}</label>)}</div>
                  <div><p className="text-xs font-semibold text-[#55555c]">Members — allow</p><div className="mt-2 max-h-32 space-y-2 overflow-y-auto">{accessMembers.map((item) => <label key={"user-a-"+item.user_id} className="flex items-center gap-2 text-xs text-[#55555c]"><input type="checkbox" checked={userAllowIds.includes(item.user_id)} onChange={(event) => setUserAllowIds((current) => event.target.checked ? [...current, item.user_id] : current.filter((id) => id !== item.user_id))} />{item.display_name || item.email || item.user_id}</label>)}</div></div>
                  <div><p className="text-xs font-semibold text-[#55555c]">Members — deny</p><div className="mt-2 max-h-32 space-y-2 overflow-y-auto">{accessMembers.map((item) => <label key={"user-d-"+item.user_id} className="flex items-center gap-2 text-xs text-[#55555c]"><input type="checkbox" checked={userDenyIds.includes(item.user_id)} onChange={(event) => setUserDenyIds((current) => event.target.checked ? [...current, item.user_id] : current.filter((id) => id !== item.user_id))} />{item.display_name || item.email || item.user_id}</label>)}</div></div>
                </div>
                <button type="button" onClick={() => void saveAccessRules()} disabled={saving} className="sc-action-button mt-4 w-full">{saving ? "Saving…" : "Save access rules"}</button>
              </section>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {canManage && (
                <>
                  <button type="button" disabled={saving || selected.archived} onClick={addReplacementVersion} className="rounded-lg border border-[#222] bg-[#222] px-3 py-2 text-[10px] font-semibold text-white hover:bg-[#3c3c3c] disabled:opacity-40">Supersede with new version</button>
                  <button type="button" disabled={saving} onClick={() => void setArchived(!selected.archived)} className="rounded-lg border border-[#e5e5e7] px-3 py-2 text-[10px] text-[#55555c] hover:bg-[#f7f7f8] disabled:opacity-40">{selected.archived ? "Restore document" : "Archive document"}</button>
                  <button type="button" disabled={saving} onClick={() => setConfirmDelete(true)} className="rounded-lg border border-[#e8d5d3] px-3 py-2 text-[10px] text-[#9f2920] hover:bg-[#fff7f6] disabled:opacity-40">Delete permanently</button>
                </>
              )}
            </div>

            <div className="mt-6 border-t border-[#ededee] pt-5">
              <div className="flex items-center justify-between gap-3">
                <div><p className="sc-kicker">REVISION HISTORY</p><h5 className="mt-1 text-sm font-semibold text-[#202024]">Summaries by version</h5></div>
                <span className="sc-count-chip">{selected.versions.length}</span>
              </div>
              {selected.versions.length ? (
                <div className="mt-3 max-h-[520px] space-y-3 overflow-y-auto pr-1">
                  {selected.versions.map((version) => (
                    <article key={version.id} className="rounded-xl border border-[#e8e8ea] bg-[#fafafa] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-xs text-[#222226]">Version {version.version_number}{version.version_label ? ` · ${version.version_label}` : ""}</strong>
                        <span className={`rounded-full border px-2 py-1 text-[9px] capitalize ${statusClass(version.status)}`}>{version.status}</span>
                      </div>
                      <p className="mt-2 text-[10px] text-[#77777f]">{version.original_filename} · {version.page_count ?? "—"} pages · {formatDate(version.created_at)}</p>
                      {canManage ? (
                        <div className="mt-3">
                          <label className="block text-[10px] font-medium text-[#77777f]">Version summary
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
                        <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-[#55555c]">{version.summary || "No summary is available for this version."}</p>
                      )}
                      {version.effective_from && <p className="mt-2 text-[10px] text-[#77777f]">Effective from {formatDate(version.effective_from)}</p>}
                    </article>
                  ))}
                </div>
              ) : <p className="mt-3 text-xs text-[#77777f]">No versions have been registered for this document.</p>}
            </div>
          </aside>
        )}
      </div>

      {confirmDelete && selected && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <section role="alertdialog" aria-modal="true" aria-labelledby="delete-document-title" aria-describedby="delete-document-description" className="w-full max-w-md rounded-2xl border border-[#e8d5d3] bg-white p-5 shadow-2xl">
            <p className="sc-kicker text-[#9f2920]">PERMANENT ACTION</p>
            <h4 id="delete-document-title" className="mt-2 text-lg font-semibold text-[#202024]">Delete “{selected.title}”?</h4>
            <p id="delete-document-description" className="mt-2 text-sm leading-6 text-[#66666e]">This permanently removes every version, its source PDFs, document summaries, Qdrant chunks and BM25 search entries. This cannot be undone.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setConfirmDelete(false)} className="rounded-lg border border-[#e5e5e7] px-4 py-2 text-xs text-[#55555c] hover:bg-[#f7f7f8]">Cancel</button>
              <button type="button" disabled={saving} onClick={() => void permanentlyDelete()} className="rounded-lg bg-[#222] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{saving ? "Deleting…" : "Delete permanently"}</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
