"use client";

import { FormEvent, useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth, firebaseConfigError } from "../firebase";
import InvitationPanel from "./InvitationPanel";
import DocumentIngestionModal from "./DocumentIngestionModal";
import DocumentLibrary from "./DocumentLibrary";

const API = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

type Organization = { organization_id: string; organization_name: string; role: string; onboarding_completed?: boolean };
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
  const [activeSection, setActiveSection] = useState<"overview" | "departments" | "people" | "access">("overview");
  const selectedDepartment = departments.find((department) => department.id === selectedDepartmentId);
  const sectionItems = [
    { id: "overview" as const, label: "Overview", detail: "Workspace summary", mark: "01" },
    { id: "departments" as const, label: "Departments", detail: "Teams and spaces", mark: "02" },
    { id: "people" as const, label: "People", detail: "Members and assignments", mark: "03" },
    { id: "access" as const, label: "Access & roles", detail: "Invitations and permissions", mark: "04" },
  ];

  return (
    <article className="sc-workspace">
      <header className="sc-workspace-head">
        <div className="min-w-0"><div className="sc-kicker"><span className="sc-live-dot" /> ORGANIZATION WORKSPACE</div><h2 className="mt-3 truncate text-2xl font-semibold tracking-tight text-white sm:text-3xl">{organization.organization_name}</h2><p className="mt-2 text-sm text-slate-400">A focused place for your teams, knowledge and people.</p></div>
        <div className="flex shrink-0 flex-wrap items-center gap-2"><span className="sc-role-chip">{organization.role}</span><DocumentIngestionModal organization={organization} uploaderId={uploaderId} departments={departments} /></div>
      </header>
      <div className="sc-workspace-body">
        <aside className="sc-workspace-sidebar" aria-label="Organization navigation">
          <p className="sc-side-label">WORKSPACE</p><nav className="mt-3 grid gap-1">
            {sectionItems.map((item) => <button key={item.id} type="button" onClick={() => setActiveSection(item.id)} className={activeSection === item.id ? "sc-side-link is-active" : "sc-side-link"}><span className="sc-side-mark">{item.mark}</span><span className="min-w-0 text-left"><span className="block text-sm font-semibold">{item.label}</span><span className="mt-0.5 block text-[11px] text-slate-500">{item.detail}</span></span><span className="ml-auto text-slate-500">›</span></button>)}
          </nav>
          <div className="sc-sidebar-divider" /><p className="sc-side-label">KNOWLEDGE</p>
          <Link href={`/dashboard/chat?organizationId=${organization.organization_id}`} className="sc-side-link mt-3"><span className="sc-side-icon">✳</span><span className="min-w-0 text-left"><span className="block text-sm font-semibold">AI assistant</span><span className="mt-0.5 block text-[11px] text-slate-500">Ask your workspace</span></span><span className="ml-auto text-slate-500">↗</span></Link>
          <div className="mt-6 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-slate-500">Workspace ID</p><p className="mt-2 break-all font-mono text-[10px] leading-5 text-slate-400">{organization.organization_id}</p></div>
        </aside>
        <div className="sc-workspace-content">
          {activeSection === "overview" && <div className="space-y-6">
            <div className="sc-welcome-banner"><div className="relative z-10 max-w-xl"><p className="sc-kicker">YOUR COMMAND CENTRE</p><h3 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-[2rem]">Everything your team needs, in one place.</h3><p className="mt-3 max-w-lg text-sm leading-6 text-slate-300/75">Move between departments, manage access and explore the knowledge your organization has collected.</p><Link href={`/dashboard/chat?organizationId=${organization.organization_id}`} className="sc-primary-link mt-5">Open knowledge assistant <span>↗</span></Link></div><div className="sc-banner-orbit" aria-hidden="true"><span>SC</span><i /><b /></div></div>
            <DocumentLibrary organization={organization} token={token} uploaderId={uploaderId} departments={departments} canManage={canManage} />
            <div className="grid gap-3 sm:grid-cols-3"><div className="sc-metric"><span className="sc-metric-label">DEPARTMENTS</span><strong>{departments.length}</strong><span>Organized teams</span></div><div className="sc-metric"><span className="sc-metric-label">PEOPLE</span><strong>{members.length}</strong><span>Workspace members</span></div><div className="sc-metric"><span className="sc-metric-label">CUSTOM ROLES</span><strong>{roles.length}</strong><span>Defined role labels</span></div></div>
            <section><div className="sc-section-heading"><div><p className="sc-kicker">YOUR ORGANIZATION</p><h3 className="mt-2 text-lg font-semibold text-white">Explore departments</h3><p className="mt-1 text-xs text-slate-500">Choose a team to view its people and workspace details.</p></div><button type="button" onClick={() => setActiveSection("departments")} className="sc-text-action">View all departments ↗</button></div>
              {loading ? <div className="sc-empty">Loading departments…</div> : departments.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{departments.slice(0,6).map((department,index) => <button key={department.id} type="button" onClick={() => {setSelectedDepartmentId(department.id);setActiveSection("departments");}} className="sc-department-card text-left"><span className="sc-dept-index">DEPT / {String(index+1).padStart(2,"0")}</span><span className="sc-dept-symbol">{department.name.slice(0,1).toUpperCase()}</span><strong>{department.name}</strong><span className="line-clamp-2 text-xs leading-5 text-slate-500">{department.description || "Department workspace and team members."}</span><span className="sc-card-open">Explore department <span>↗</span></span></button>)}</div> : <div className="sc-empty"><strong>No departments yet</strong><span>Create your first department to organize your workspace.</span>{canManage && <button type="button" onClick={() => setActiveSection("departments")} className="sc-text-action mt-2">Create a department ↗</button>}</div>}
            </section>
          </div>}
          {activeSection === "departments" && <section>
            <div className="sc-section-heading"><div><p className="sc-kicker">TEAM STRUCTURE</p><h3 className="mt-2 text-2xl font-semibold text-white">Departments</h3><p className="mt-1 text-sm text-slate-500">Select a department to inspect its team and manage assignments.</p></div><span className="sc-count-chip">{departments.length} total</span></div>
            {error && <p role="alert" className="sc-inline-error mt-4">{error}</p>}
            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,.8fr)]"><div className="space-y-2">
              {loading ? <div className="sc-empty">Loading departments…</div> : departments.map((department,index) => <button key={department.id} type="button" onClick={() => setSelectedDepartmentId(department.id)} className={selectedDepartmentId===department.id ? "sc-dept-row is-selected" : "sc-dept-row"}><span className="sc-dept-symbol">{department.name.slice(0,1).toUpperCase()}</span><span className="min-w-0 flex-1 text-left"><strong className="block truncate text-sm text-white">{department.name}</strong><span className="mt-1 block truncate text-xs text-slate-500">{department.description || "No description added"}</span></span><span className="text-xs text-slate-500">{String(index+1).padStart(2,"0")}</span><span className="text-slate-500">›</span></button>)}
              {!loading && !departments.length && <div className="sc-empty">No departments have been created.</div>}
            </div><div className="sc-detail-panel">{selectedDepartment ? <>
              <p className="sc-kicker">DEPARTMENT DETAILS</p><div className="sc-dept-symbol mt-4">{selectedDepartment.name.slice(0,1).toUpperCase()}</div><h4 className="mt-3 text-xl font-semibold text-white">{selectedDepartment.name}</h4><p className="mt-2 text-sm leading-6 text-slate-400">{selectedDepartment.description || "No description has been added for this department."}</p><div className="my-5 border-t border-white/[0.08]" /><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-300">Assigned members</span><span className="sc-count-chip">{departmentAssignments.length}</span></div>
              {assignmentsLoading ? <p className="mt-3 text-xs text-slate-500">Loading members…</p> : departmentAssignments.length ? <ul className="mt-3 space-y-2">{departmentAssignments.map((assignment)=><li key={assignment.user_id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.035] p-2.5"><span className="truncate text-xs text-slate-300">{assignment.display_name || assignment.email || "Member"}</span>{canManage && <button type="button" onClick={()=>void unassignDepartmentMember(assignment)} className="text-[11px] text-rose-300">Remove</button>}</li>)}</ul> : <p className="mt-3 text-xs text-slate-500">No members assigned yet.</p>}
              {canManage && <form onSubmit={assignDepartmentMember} className="mt-5 border-t border-white/[0.08] pt-4"><label className="sc-field-label" htmlFor={`assignment-user-${organization.organization_id}`}>Add a team member</label><select id={`assignment-user-${organization.organization_id}`} required value={assignmentUserId} onChange={(event)=>setAssignmentUserId(event.target.value)} className="sc-input"><option value="">Choose a member</option>{members.filter((member)=>!departmentAssignments.some((assignment)=>assignment.user_id===member.user_id)).map((member)=><option key={member.user_id} value={member.user_id}>{member.display_name || member.email || member.user_id}</option>)}</select><button type="submit" disabled={assignmentSaving || !assignmentUserId} className="sc-action-button mt-3">{assignmentSaving ? "Assigning…" : "Assign member"}</button></form>}
            </> : <div className="sc-empty h-full">Select a department to see its details.</div>}</div></div>
            {assignmentError && <p role="alert" className="sc-inline-error mt-3">{assignmentError}</p>}{assignmentSuccess && <p role="status" className="sc-inline-success mt-3">{assignmentSuccess}</p>}
            {canManage && <form onSubmit={createDepartment} className="sc-form-panel mt-5"><p className="sc-kicker">GROW YOUR WORKSPACE</p><h4 className="mt-2 text-base font-semibold text-white">Create a department</h4><div className="mt-4 grid gap-3 md:grid-cols-2"><div><label className="sc-field-label" htmlFor={`department-name-${organization.organization_id}`}>Department name</label><input id={`department-name-${organization.organization_id}`} required minLength={2} maxLength={100} value={name} onChange={(event)=>setName(event.target.value)} placeholder="e.g. Human Resources" className="sc-input" /></div><div><label className="sc-field-label" htmlFor={`department-description-${organization.organization_id}`}>Description (optional)</label><input id={`department-description-${organization.organization_id}`} maxLength={500} value={description} onChange={(event)=>setDescription(event.target.value)} placeholder="What does this team do?" className="sc-input" /></div></div>{success && <p role="status" className="sc-inline-success mt-3">{success}</p>}<button type="submit" disabled={saving || !name.trim()} className="sc-action-button mt-4">{saving ? "Creating…" : "Create department"}</button></form>}
          </section>}
          {activeSection === "people" && <section>
            <div className="sc-section-heading"><div><p className="sc-kicker">YOUR TEAM</p><h3 className="mt-2 text-2xl font-semibold text-white">People</h3><p className="mt-1 text-sm text-slate-500">Organization members and their department assignments.</p></div><span className="sc-count-chip">{members.length} members</span></div>
            {memberError && <p role="alert" className="sc-inline-error mt-4">{memberError}</p>}{memberSuccess && <p role="status" className="sc-inline-success mt-3">{memberSuccess}</p>}
            {membersLoading ? <div className="sc-empty mt-5">Loading people…</div> : members.length ? <div className="mt-5 overflow-hidden rounded-xl border border-white/[0.08]">{members.map((member)=><div key={member.user_id} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] bg-white/[0.02] p-4 last:border-0"><div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-cyan-200/15 bg-cyan-200/[0.06] text-sm font-semibold text-cyan-100">{(member.display_name || member.email || "U").slice(0,1).toUpperCase()}</span><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-100">{member.display_name || member.email || "SaviraCortex user"}</p><p className="mt-1 truncate text-xs text-slate-500">{member.email || member.user_id}</p></div></div><div className="flex items-center gap-2">{organization.role==="owner" && member.role!=="owner" ? <select aria-label={`Role for ${member.display_name || member.email || "member"}`} value={member.role} onChange={(event)=>void changeMemberRole(member,event.target.value)} className="sc-select"><option value="member">Member</option><option value="admin">Admin</option></select> : <span className="sc-role-chip capitalize">{member.role}</span>}{canManage && member.role!=="owner" && <button type="button" onClick={()=>void removeMember(member)} className="sc-danger-link">Remove</button>}</div></div>)}</div> : <div className="sc-empty mt-5">No organization members found.</div>}
            {canManage && <form onSubmit={addMember} className="sc-form-panel mt-5"><p className="sc-kicker">TEAM ACCESS</p><h4 className="mt-2 text-base font-semibold text-white">Add an existing member</h4><p className="mt-1 text-xs text-slate-500">Use the user ID from their SaviraCortex profile.</p><div className="mt-4 grid gap-3 md:grid-cols-[1fr_180px_auto]"><input required value={memberUserId} onChange={(event)=>setMemberUserId(event.target.value)} placeholder="User UUID" className="sc-input" aria-label="User ID" />{organization.role==="owner" && <select value={memberRole} onChange={(event)=>setMemberRole(event.target.value)} className="sc-select"><option value="member">Member</option><option value="admin">Admin</option></select>}<button type="submit" disabled={memberSaving || !memberUserId.trim()} className="sc-action-button">{memberSaving ? "Adding…" : "Add member"}</button></div></form>}
          </section>}
          {activeSection === "access" && <section>
            <div className="sc-section-heading"><div><p className="sc-kicker">GOVERNANCE</p><h3 className="mt-2 text-2xl font-semibold text-white">Access & roles</h3><p className="mt-1 text-sm text-slate-500">Invite teammates and define organization role labels.</p></div><span className="sc-count-chip">{roles.length} roles</span></div>
            <div className="mt-5"><InvitationPanel organization={organization} token={token} /></div>
            <div className="mt-6 grid gap-4 xl:grid-cols-2"><div className="sc-detail-panel"><p className="sc-kicker">ROLE CATALOGUE</p><h4 className="mt-2 text-lg font-semibold text-white">Custom roles</h4><p className="mt-1 text-xs text-slate-500">Create role labels that reflect how your organization works.</p>{rolesLoading ? <p className="mt-4 text-xs text-slate-500">Loading roles…</p> : roles.length ? <ul className="mt-4 space-y-2">{roles.map((role)=><li key={role.id} className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-3"><p className="text-sm font-semibold text-slate-200">{role.name}</p>{role.description && <p className="mt-1 text-xs text-slate-500">{role.description}</p>}</li>)}</ul> : <p className="mt-4 text-xs text-slate-500">No custom roles yet.</p>}</div>
              {canManage && <form onSubmit={createRole} className="sc-form-panel"><p className="sc-kicker">DEFINE A ROLE</p><h4 className="mt-2 text-base font-semibold text-white">Create custom role</h4><label className="sc-field-label mt-4" htmlFor={`role-name-${organization.organization_id}`}>Role name</label><input id={`role-name-${organization.organization_id}`} required minLength={2} maxLength={100} value={roleName} onChange={(event)=>setRoleName(event.target.value)} placeholder="e.g. Knowledge Manager" className="sc-input" /><label className="sc-field-label mt-4" htmlFor={`role-description-${organization.organization_id}`}>Description (optional)</label><textarea id={`role-description-${organization.organization_id}`} rows={3} maxLength={500} value={roleDescription} onChange={(event)=>setRoleDescription(event.target.value)} placeholder="Describe the responsibilities of this role" className="sc-input h-auto py-3" />{roleError && <p role="alert" className="sc-inline-error mt-3">{roleError}</p>}{roleSuccess && <p role="status" className="sc-inline-success mt-3">{roleSuccess}</p>}<button type="submit" disabled={roleSaving || !roleName.trim()} className="sc-action-button mt-4">{roleSaving ? "Creating…" : "Create role"}</button></form>}
            </div>
          </section>}
        </div>
      </div>
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

    let active = true;
    let authRequestId = 0;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const requestId = ++authRequestId;
      if (!user) {
        if (active) router.replace("/login");
        return;
      }

      setLoading(true);
      setError("");

      try {
        const idToken = await user.getIdToken();
        let response: Response | null = null;
        let lastNetworkError: unknown;

        // Retry transient network/5xx failures during the post-signup redirect.
        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            response = await fetch(API + "/api/v1/auth/me", {
              headers: { Authorization: `Bearer ${idToken}` },
              cache: "no-store",
            });
            if (response.ok || response.status < 500 || attempt === 3) break;
          } catch (err) {
            lastNetworkError = err;
            if (attempt === 3) throw err;
          }

          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }

        if (!response) throw lastNetworkError || new Error("Could not connect to the SaviraCortex API.");
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || `Profile failed (HTTP ${response.status}).`);

        if (!active || requestId !== authRequestId) return;

        const firstOrganization = data.organizations?.[0];
        if (firstOrganization && firstOrganization.onboarding_completed === false) {
          router.replace(`/onboarding?organization_id=${encodeURIComponent(firstOrganization.organization_id)}`);
          return;
        }

        setProfile(data);
        setToken(idToken);
      } catch (err) {
        if (active && requestId === authRequestId) {
          setError((err as Error).message || "Could not connect to the SaviraCortex API.");
        }
      } finally {
        if (active && requestId === authRequestId) setLoading(false);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [router]);

  async function logout() {
    if (auth) await signOut(auth);
    router.replace("/login");
  }

  return (
    <main className="sc-dashboard min-h-screen text-slate-100">
      <header className="sc-topbar">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3"><span className="sc-brand-mark">S</span><span className="text-sm font-semibold tracking-tight text-white">SAVIRA<span className="text-cyan-300">CORTEX</span><span className="ml-2 hidden text-[10px] font-medium tracking-[.16em] text-slate-500 sm:inline">WORKSPACE</span></span></Link>
          <div className="flex items-center gap-3"><div className="hidden text-right sm:block"><p className="text-xs font-semibold text-slate-200">{profile?.display_name || "Workspace member"}</p><p className="mt-0.5 text-[10px] text-slate-500">{profile?.email || profile?.phone_number}</p></div><span className="sc-user-avatar">{(profile?.display_name || profile?.email || "U").slice(0,1).toUpperCase()}</span><button onClick={logout} className="sc-signout">Sign out</button></div>
        </div>
      </header>
      <section className="mx-auto w-full max-w-[1600px] px-4 pb-12 pt-8 sm:px-6 lg:px-8 lg:pt-12">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="sc-kicker">INTELLIGENCE WORKSPACE / OVERVIEW</p><h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Good to see you{profile?.display_name ? `, ${profile.display_name.split(" ")[0]}` : ""}.</h1><p className="mt-2 text-sm text-slate-400">Your organization, departments and knowledge—within reach.</p></div><div className="sc-date-chip"><span className="sc-live-dot" /> SECURE WORKSPACE</div></div>
        {loading ? <div className="sc-loading-shell"><div className="sc-skeleton h-8 w-48" /><div className="sc-skeleton mt-4 h-28 w-full" /><div className="mt-4 grid gap-4 md:grid-cols-2"><div className="sc-skeleton h-56" /><div className="sc-skeleton h-56" /></div></div> : error ? <p role="alert" className="sc-inline-error">{error}</p> : profile?.organizations.length ? <div className="space-y-6">{profile.organizations.map((organization)=><DepartmentPanel key={organization.organization_id} organization={organization} token={token} uploaderId={profile.user_id} />)}</div> : <div className="sc-empty py-16"><strong>No organization yet</strong><span>Create an organization or accept an invitation to begin.</span></div>}
        {profile && <p className="mt-8 text-center text-[10px] text-slate-600">Signed in using {profile.sign_in_provider || "Firebase"} · {profile.email || profile.phone_number}</p>}
      </section>
    </main>
  );
}
