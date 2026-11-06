"use client";

import { FormEvent, useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth, firebaseConfigError } from "../firebase";
import InvitationPanel from "./InvitationPanel";
import DocumentIngestionModal from "./DocumentIngestionModal";

const API = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

type Organization = { organization_id: string; organization_name: string; role: string };
type Profile = {
  user_id: string;
  email: string | null;
  phone_number: string | null;
  display_name: string | null;
  sign_in_provider: string | null;
  organizations: Organization[];
};
type Department = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  created_at: string;
};
type OrganizationRole = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  created_at: string;
};
type OrganizationMember = {
  user_id: string;
  organization_id: string;
  role: string;
  created_at: string;
  email: string | null;
  display_name: string | null;
  custom_roles: string[];
};
type DepartmentAssignment = {
  organization_id: string;
  user_id: string;
  department_id: string;
  created_at: string;
  email: string | null;
  display_name: string | null;
};

function DepartmentPanel({ organization, token, uploaderId }: { organization: Organization; token: string; uploaderId: string }) {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState("member");
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberError, setMemberError] = useState("");
  const [memberSuccess, setMemberSuccess] = useState("");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [departmentAssignments, setDepartmentAssignments] = useState<DepartmentAssignment[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentUserId, setAssignmentUserId] = useState("");
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [assignmentSuccess, setAssignmentSuccess] = useState("");
  const [roles, setRoles] = useState<OrganizationRole[]>([]);
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [rolesLoading, setRolesLoading] = useState(true);
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleError, setRoleError] = useState("");
  const [roleSuccess, setRoleSuccess] = useState("");

  async function loadRoles() {
    setRolesLoading(true);
    setRoleError("");
    try {
      const response = await fetch(`${API}/api/v1/organizations/${organization.organization_id}/roles`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Could not load roles (HTTP ${response.status}).`);
      setRoles(data);
    } catch (err) {
      setRoleError((err as Error).message);
    } finally {
      setRolesLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void loadRoles(); });
    return () => { cancelled = true; };
    // loadRoles uses only the organization ID and auth token listed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization.organization_id, token]);

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRoleSaving(true);
    setRoleError("");
    setRoleSuccess("");
    try {
      const response = await fetch(`${API}/api/v1/organizations/${organization.organization_id}/roles`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: roleName, description: roleDescription.trim() || null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Could not create role (HTTP ${response.status}).`);
      setRoles((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)));
      setRoleName("");
      setRoleDescription("");
      setRoleSuccess(`${data.name} role created.`);
    } catch (err) {
      setRoleError((err as Error).message);
    } finally {
      setRoleSaving(false);
    }
  }
  async function loadMembers() {
    setMembersLoading(true);
    setMemberError("");
    try {
      const response = await fetch(`${API}/api/v1/organizations/${organization.organization_id}/members`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Could not load members (HTTP ${response.status}).`);
      setMembers(data);
    } catch (err) {
      setMemberError((err as Error).message);
    } finally {
      setMembersLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void loadMembers(); });
    return () => { cancelled = true; };
    // loadMembers uses only the organization ID and auth token listed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization.organization_id, token]);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMemberSaving(true);
    setMemberError("");
    setMemberSuccess("");
    try {
      const response = await fetch(`${API}/api/v1/organizations/${organization.organization_id}/members`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: memberUserId.trim(), role: memberRole }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Could not add member (HTTP ${response.status}).`);
      setMembers((current) => [...current, data].sort((a, b) => (a.display_name || a.email || "").localeCompare(b.display_name || b.email || "")));
      setMemberUserId("");
      setMemberRole("member");
      setMemberSuccess("Member added to the organization.");
    } catch (err) {
      setMemberError((err as Error).message);
    } finally {
      setMemberSaving(false);
    }
  }

  async function changeMemberRole(member: OrganizationMember, role: string) {
    setMemberError("");
    setMemberSuccess("");
    try {
      const response = await fetch(`${API}/api/v1/organizations/${organization.organization_id}/members/${member.user_id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Could not update role (HTTP ${response.status}).`);
      setMembers((current) => current.map((item) => item.user_id === member.user_id ? data : item));
      setMemberSuccess(`Updated role for ${member.display_name || member.email || "member"}.`);
    } catch (err) {
      setMemberError((err as Error).message);
    }
  }

  async function removeMember(member: OrganizationMember) {
    const label = member.display_name || member.email || "this member";
    if (!window.confirm(`Remove ${label} from this organization? Their Firebase account will not be deleted.`)) return;
    setMemberError("");
    setMemberSuccess("");
    try {
      const response = await fetch(`${API}/api/v1/organizations/${organization.organization_id}/members/${member.user_id}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || `Could not remove member (HTTP ${response.status}).`);
      }
      setMembers((current) => current.filter((item) => item.user_id !== member.user_id));
      setDepartmentAssignments((current) => current.filter((item) => item.user_id !== member.user_id));
      setMemberSuccess(`${label} removed from the organization.`);
    } catch (err) {
      setMemberError((err as Error).message);
    }
  }

  async function loadDepartmentAssignments(departmentId: string) {
    if (!departmentId) { setDepartmentAssignments([]); return; }
    setAssignmentsLoading(true);
    setAssignmentError("");
    try {
      const response = await fetch(`${API}/api/v1/organizations/${organization.organization_id}/departments/${departmentId}/members`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Could not load department members (HTTP ${response.status}).`);
      setDepartmentAssignments(data);
    } catch (err) {
      setAssignmentError((err as Error).message);
    } finally {
      setAssignmentsLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void loadDepartmentAssignments(selectedDepartmentId); });
    return () => { cancelled = true; };
    // loadDepartmentAssignments uses the selected department and auth context listed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDepartmentId, organization.organization_id, token]);

  async function assignDepartmentMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDepartmentId) return;
    setAssignmentSaving(true);
    setAssignmentError("");
    setAssignmentSuccess("");
    try {
      const response = await fetch(`${API}/api/v1/organizations/${organization.organization_id}/departments/${selectedDepartmentId}/members`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: assignmentUserId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Could not assign member (HTTP ${response.status}).`);
      setDepartmentAssignments((current) => [...current, data]);
      setAssignmentUserId("");
      setAssignmentSuccess("Member assigned to the department.");
    } catch (err) {
      setAssignmentError((err as Error).message);
    } finally {
      setAssignmentSaving(false);
    }
  }

  async function unassignDepartmentMember(assignment: DepartmentAssignment) {
    const label = assignment.display_name || assignment.email || "this member";
    if (!window.confirm(`Remove ${label} from this department? They will remain in the organization.`)) return;
    setAssignmentError("");
    setAssignmentSuccess("");
    try {
      const response = await fetch(`${API}/api/v1/organizations/${organization.organization_id}/departments/${selectedDepartmentId}/members/${assignment.user_id}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || `Could not unassign member (HTTP ${response.status}).`);
      }
      setDepartmentAssignments((current) => current.filter((item) => item.user_id !== assignment.user_id));
      setAssignmentSuccess(`${label} removed from the department.`);
    } catch (err) {
      setAssignmentError((err as Error).message);
    }
  }

  const [departments, setDepartments] = useState<Department[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadDepartments() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/v1/organizations/${organization.organization_id}/departments`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Could not load departments (HTTP ${response.status}).`);
      setDepartments(data);
      setSelectedDepartmentId((current) => current || data[0]?.id || "");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void loadDepartments(); });
    return () => { cancelled = true; };
    // loadDepartments uses only the organization ID and auth token listed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization.organization_id, token]);

  async function createDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`${API}/api/v1/organizations/${organization.organization_id}/departments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description.trim() || null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Could not create department (HTTP ${response.status}).`);
      setDepartments((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
      setDescription("");
      setSuccess(`${data.name} department created.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const canManage = organization.role === "owner" || organization.role === "admin";

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-black/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">Organization</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{organization.organization_name}</h2>
        </div>
        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs capitalize text-emerald-300">{organization.role}</span>
      </div>
      <p className="mt-3 break-all text-xs text-slate-500">ID: {organization.organization_id}</p>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-900/40 bg-cyan-950/15 p-4">
        <div><h3 className="text-sm font-semibold text-slate-100">Knowledge base</h3><p className="mt-1 text-xs text-slate-400">Add a PDF to the organization&apos;s document collection.</p></div>
        <DocumentIngestionModal organization={organization} uploaderId={uploaderId} departments={departments} />
      </div>
      <InvitationPanel organization={organization} token={token} />
      <div className="my-6 border-t border-slate-800" />
      <div className="flex items-center justify-between gap-3">
        <div><h3 className="font-semibold text-slate-100">Departments</h3><p className="mt-1 text-xs text-slate-500">Teams and divisions inside this organization</p></div>
        <span className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300">{departments.length}</span>
      </div>
      {loading ? <p className="mt-4 text-sm text-slate-400">Loading departments…</p> :
        departments.length ? <ul className="mt-4 grid gap-2 sm:grid-cols-2">{departments.map((department) => (
          <li key={department.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <p className="text-sm font-medium text-slate-200">{department.name}</p>
            {department.description && <p className="mt-1 text-xs leading-5 text-slate-500">{department.description}</p>}
          </li>
        ))}</ul> : <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">No departments yet. Create the first one below.</p>}
      {canManage && <form onSubmit={createDepartment} className="mt-6 rounded-xl border border-cyan-900/50 bg-cyan-950/20 p-4">
        <h4 className="text-sm font-semibold text-cyan-100">Add a department</h4>
        <label className="mt-4 block text-xs font-medium text-slate-300" htmlFor={`department-name-${organization.organization_id}`}>Department name</label>
        <input id={`department-name-${organization.organization_id}`} required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Human Resources" className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/10" />
        <label className="mt-4 block text-xs font-medium text-slate-300" htmlFor={`department-description-${organization.organization_id}`}>Description <span className="text-slate-500">(optional)</span></label>
        <textarea id={`department-description-${organization.organization_id}`} rows={2} maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What does this department do?" className="mt-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/10" />
        {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
        {success && <p role="status" className="mt-3 text-sm text-emerald-300">{success}</p>}
        <button type="submit" disabled={saving || !name.trim()} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Creating…" : "Create department"} <span aria-hidden="true">↗</span></button>
      </form>}
      {!canManage && <p className="mt-5 text-xs text-slate-500">Only organization owners and admins can create departments.</p>}
      {!canManage && error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}

      <div className="my-6 border-t border-slate-800" />
      <section aria-labelledby={`members-heading-${organization.organization_id}`}>
        <div className="flex items-center justify-between gap-3">
          <div><h3 id={`members-heading-${organization.organization_id}`} className="font-semibold text-slate-100">Organization members</h3><p className="mt-1 text-xs text-slate-500">Manage who belongs to this workspace</p></div>
          <span className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300">{members.length}</span>
        </div>
        {membersLoading ? <p className="mt-4 text-sm text-slate-400">Loading members…</p> :
          members.length ? <ul className="mt-4 space-y-2">{members.map((member) => (
            <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-200">{member.display_name || member.email || "SaviraCortex user"}</p>
                <p className="mt-1 break-all text-xs text-slate-500">{member.email || member.user_id}</p>
                {member.custom_roles?.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{member.custom_roles.map((customRole) => <span key={customRole} className="rounded-full border border-violet-400/30 bg-violet-400/10 px-2 py-0.5 text-[11px] capitalize text-violet-200">{customRole}</span>)}</div>}
              </div>
              <div className="flex items-center gap-2">
                {organization.role === "owner" && member.role !== "owner" ?
                  <select aria-label={`Role for ${member.display_name || member.email || "member"}`} value={member.role} onChange={(event) => void changeMemberRole(member, event.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200">
                    <option value="member">Member</option><option value="admin">Admin</option>
                  </select> :
                  <span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs capitalize text-slate-400">{member.role}</span>}
                {canManage && member.role !== "owner" && <button type="button" onClick={() => void removeMember(member)} className="rounded-lg border border-rose-900/60 px-2.5 py-1.5 text-xs text-rose-300 transition hover:bg-rose-950/50">Remove</button>}
              </div>
            </li>
          ))}</ul> : <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">No members found.</p>}
        {memberError && <p role="alert" className="mt-3 text-sm text-rose-300">{memberError}</p>}
        {memberSuccess && <p role="status" className="mt-3 text-sm text-emerald-300">{memberSuccess}</p>}
        {canManage && <form onSubmit={addMember} className="mt-5 rounded-xl border border-cyan-900/50 bg-cyan-950/20 p-4">
          <h4 className="text-sm font-semibold text-cyan-100">Add an existing SaviraCortex user</h4>
          <p className="mt-1 text-xs leading-5 text-slate-400">Enter the user ID from their SaviraCortex profile. This does not create a Firebase account or send an invitation.</p>
          <label className="mt-4 block text-xs font-medium text-slate-300" htmlFor={`member-user-${organization.organization_id}`}>User ID</label>
          <input id={`member-user-${organization.organization_id}`} required value={memberUserId} onChange={(event) => setMemberUserId(event.target.value)} placeholder="Paste the user's UUID" className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/10" />
          {organization.role === "owner" && <><label className="mt-4 block text-xs font-medium text-slate-300" htmlFor={`member-role-${organization.organization_id}`}>Organization role</label><select id={`member-role-${organization.organization_id}`} value={memberRole} onChange={(event) => setMemberRole(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"><option value="member">Member</option><option value="admin">Admin</option></select></>}
          <button type="submit" disabled={memberSaving || !memberUserId.trim()} className="mt-4 rounded-lg bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">{memberSaving ? "Adding…" : "Add member"}</button>
        </form>}
        {!canManage && <p className="mt-4 text-xs text-slate-500">Only organization owners and admins can add or remove members.</p>}
      </section>

      <div className="my-6 border-t border-slate-800" />
      <section aria-labelledby={`department-members-heading-${organization.organization_id}`}>
        <div><h3 id={`department-members-heading-${organization.organization_id}`} className="font-semibold text-slate-100">Department membership</h3><p className="mt-1 text-xs text-slate-500">Assign organization members to departments</p></div>
        {departments.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">Create a department before assigning members.</p> : <>
          <label className="mt-4 block text-xs font-medium text-slate-300" htmlFor={`assignment-department-${organization.organization_id}`}>Department</label>
          <select id={`assignment-department-${organization.organization_id}`} value={selectedDepartmentId} onChange={(event) => setSelectedDepartmentId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white">
            {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
          </select>
          {assignmentsLoading ? <p className="mt-4 text-sm text-slate-400">Loading department members…</p> :
            departmentAssignments.length ? <ul className="mt-4 space-y-2">{departmentAssignments.map((assignment) => (
              <li key={assignment.user_id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="min-w-0"><p className="truncate text-sm text-slate-200">{assignment.display_name || assignment.email || "SaviraCortex user"}</p><p className="truncate text-xs text-slate-500">{assignment.email || assignment.user_id}</p></div>
                {canManage && <button type="button" onClick={() => void unassignDepartmentMember(assignment)} className="shrink-0 rounded-lg border border-rose-900/60 px-2.5 py-1.5 text-xs text-rose-300 transition hover:bg-rose-950/50">Unassign</button>}
              </li>
            ))}</ul> : !assignmentsLoading && <p className="mt-4 text-sm text-slate-500">No members assigned to this department yet.</p>}
          {canManage && <form onSubmit={assignDepartmentMember} className="mt-5 rounded-xl border border-violet-900/50 bg-violet-950/20 p-4">
            <h4 className="text-sm font-semibold text-violet-100">Assign a member</h4>
            <label className="mt-4 block text-xs font-medium text-slate-300" htmlFor={`assignment-user-${organization.organization_id}`}>Organization member</label>
            <select id={`assignment-user-${organization.organization_id}`} required value={assignmentUserId} onChange={(event) => setAssignmentUserId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white">
              <option value="">Select a member</option>
              {members.filter((member) => !departmentAssignments.some((assignment) => assignment.user_id === member.user_id)).map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name || member.email || member.user_id}</option>)}
            </select>
            <button type="submit" disabled={assignmentSaving || !assignmentUserId} className="mt-4 rounded-lg bg-violet-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-violet-200 disabled:cursor-not-allowed disabled:opacity-50">{assignmentSaving ? "Assigning…" : "Assign to department"}</button>
          </form>}
        </>}
        {assignmentError && <p role="alert" className="mt-3 text-sm text-rose-300">{assignmentError}</p>}
        {assignmentSuccess && <p role="status" className="mt-3 text-sm text-emerald-300">{assignmentSuccess}</p>}
        {!canManage && <p className="mt-4 text-xs text-slate-500">Only organization owners and admins can change department assignments.</p>}
      </section>

      <div className="my-6 border-t border-slate-800" />
      <div className="flex items-center justify-between gap-3">
        <div><h3 className="font-semibold text-slate-100">Custom roles</h3><p className="mt-1 text-xs text-slate-500">Define role names for your organization</p></div>
        <span className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300">{roles.length}</span>
      </div>
      {rolesLoading ? <p className="mt-4 text-sm text-slate-400">Loading roles…</p> :
        roles.length ? <ul className="mt-4 grid gap-2 sm:grid-cols-2">{roles.map((role) => (
          <li key={role.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <p className="text-sm font-medium text-slate-200">{role.name}</p>
            {role.description && <p className="mt-1 text-xs leading-5 text-slate-500">{role.description}</p>}
          </li>
        ))}</ul> : <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">No custom roles yet. Add a role to define your organization&apos;s role catalogue.</p>}
      {canManage && <form onSubmit={createRole} className="mt-6 rounded-xl border border-violet-900/50 bg-violet-950/20 p-4">
        <h4 className="text-sm font-semibold text-violet-100">Create a custom role</h4>
        <label className="mt-4 block text-xs font-medium text-slate-300" htmlFor={`role-name-${organization.organization_id}`}>Role name</label>
        <input id={`role-name-${organization.organization_id}`} required minLength={2} maxLength={100} value={roleName} onChange={(event) => setRoleName(event.target.value)} placeholder="e.g. Knowledge Manager" className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-400/10" />
        <label className="mt-4 block text-xs font-medium text-slate-300" htmlFor={`role-description-${organization.organization_id}`}>Description <span className="text-slate-500">(optional)</span></label>
        <textarea id={`role-description-${organization.organization_id}`} rows={2} maxLength={500} value={roleDescription} onChange={(event) => setRoleDescription(event.target.value)} placeholder="Describe the responsibilities of this role" className="mt-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-400/10" />
        {roleError && <p role="alert" className="mt-3 text-sm text-rose-300">{roleError}</p>}
        {roleSuccess && <p role="status" className="mt-3 text-sm text-emerald-300">{roleSuccess}</p>}
        <button type="submit" disabled={roleSaving || !roleName.trim()} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-violet-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-violet-200 disabled:cursor-not-allowed disabled:opacity-50">{roleSaving ? "Creating…" : "Create role"} <span aria-hidden="true">↗</span></button>
      </form>}
      {!canManage && <p className="mt-5 text-xs text-slate-500">Only organization owners and admins can create custom roles.</p>}
    </article>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState(firebaseConfigError);
  const [loading, setLoading] = useState(Boolean(auth));

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.replace("/login"); return; }
      try {
        const idToken = await user.getIdToken();
        const response = await fetch(API + "/api/v1/auth/me", { headers: { Authorization: `Bearer ${idToken}` }, cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || `Profile failed (HTTP ${response.status}).`);
        setProfile(data);
        setToken(idToken);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    });
  }, [router]);

  async function logout() {
    if (auth) await signOut(auth);
    router.replace("/login");
  }

  return <main className="min-h-screen bg-slate-950 text-white">
    <nav className="mx-auto flex max-w-6xl justify-between px-6 py-6">
      <Link href="/" className="text-xl font-bold"><span className="text-cyan-400">Savira</span>Cortex</Link>
      <button onClick={logout} className="rounded-xl border border-slate-700 px-4 py-2 text-sm transition hover:border-slate-500">Sign out</button>
    </nav>
    <section className="mx-auto max-w-6xl px-6 py-12">
      <p className="text-sm font-semibold tracking-widest text-cyan-400">WORKSPACE</p>
      <h1 className="mt-3 text-4xl font-semibold">Welcome{profile?.display_name ? `, ${profile.display_name}` : ""}.</h1>
      <p className="mt-3 text-slate-400">Manage your organization, departments, and custom roles.</p>
      {loading ? <p className="mt-6 text-slate-400">Loading account…</p> :
        error ? <p role="alert" className="mt-6 rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-rose-200">{error}</p> :
        <div className="mt-8 grid gap-5 lg:grid-cols-2">{profile?.organizations.map((organization) => <DepartmentPanel key={organization.organization_id} organization={organization} token={token} uploaderId={profile.user_id} />)}</div>}
      {profile && <p className="mt-8 text-sm text-slate-500">Signed in using {profile.sign_in_provider || "Firebase"} · {profile.email || profile.phone_number}</p>}
    </section>
  </main>;
}
