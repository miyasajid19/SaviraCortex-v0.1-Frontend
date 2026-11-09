"use client";

import { FormEvent, useEffect, useState } from "react";

const API = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

type Organization = { organization_id: string; organization_name: string; role: string };
type Invitation = {
  id: string; email: string; candidate_name: string; role: string; custom_role: string;
  status: string; created_at: string; expires_at: string; email_sent_at: string | null;
};
type Choice = { id: string; name: string; description?: string | null };

const fieldClass = "mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400";
const buttonClass = "rounded-lg bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50";

function apiErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const detail = (data as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => {
      if (!item || typeof item !== "object") return String(item);
      const issue = item as { loc?: unknown[]; msg?: unknown };
      const location = Array.isArray(issue.loc)
        ? issue.loc.filter((part) => part !== "body").join(" -> ")
        : "";
      const message = typeof issue.msg === "string" ? issue.msg : "Invalid value";
      return location ? "" + location + ": " + message : message;
    });
    return messages.filter(Boolean).join("; ") || fallback;
  }
  if (detail && typeof detail === "object" && "msg" in detail) {
    const message = (detail as { msg?: unknown }).msg;
    if (typeof message === "string") return message;
  }
  return fallback;
}

export default function InvitationPanel({ organization, token }: { organization: Organization; token: string }) {
  const [rows, setRows] = useState<Invitation[]>([]);
  const [roles, setRoles] = useState<Choice[]>([]);
  const [departments, setDepartments] = useState<Choice[]>([]);
  const [email, setEmail] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [role, setRole] = useState("member");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [step, setStep] = useState(1);
  const [newRole, setNewRole] = useState("");
  const [newDepartment, setNewDepartment] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function requestChoices() {
    const headers = { Authorization: `Bearer ${token}` };
    const [roleResponse, departmentResponse] = await Promise.all([
      fetch(`${API}/api/v1/organizations/${organization.organization_id}/roles`, { headers, cache: "no-store" }),
      fetch(`${API}/api/v1/organizations/${organization.organization_id}/departments`, { headers, cache: "no-store" }),
    ]);
    const roleData = await roleResponse.json().catch(() => []);
    const departmentData = await departmentResponse.json().catch(() => []);
    if (!roleResponse.ok) throw new Error(roleData.detail || "Could not load organization roles.");
    if (!departmentResponse.ok) throw new Error(departmentData.detail || "Could not load organization departments.");
    setRoles(roleData);
    setDepartments(departmentData);
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [response] = await Promise.all([
        fetch(`${API}/api/v1/organizations/${organization.organization_id}/invitations`, {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
        }),
        requestChoices(),
      ]);
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(apiErrorMessage(data, "Could not load invitations."));
      setRows(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (organization.role !== "owner" && organization.role !== "admin") return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization.organization_id, organization.role, token]);

  function toggle(setter: (value: string[]) => void, current: string[], id: string) {
    setter(current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function createChoice(kind: "role" | "department", event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = kind === "role" ? newRole.trim() : newDepartment.trim();
    if (!name) return;
    setError("");
    try {
      const response = await fetch(`${API}/api/v1/organizations/${organization.organization_id}/${kind === "role" ? "roles" : "departments"}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Could not create ${kind}.`);
      if (kind === "role") {
        setRoles((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)));
        setRoleIds((current) => [...current, data.id]);
        setNewRole("");
      } else {
        setDepartments((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)));
        setDepartmentIds((current) => [...current, data.id]);
        setNewDepartment("");
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function send() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const emailName = email.trim().split("@")[0].replace(/[._-]+/g, " ");
      const derivedName = candidateName.trim() || (emailName.length >= 2 ? emailName : "New member");
      const response = await fetch(`${API}/api/v1/organizations/${organization.organization_id}/invitations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(), candidate_name: derivedName, role,
          role_ids: roleIds, department_ids: departmentIds,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(data, "Could not send the invitation."));
      setRows((current) => [data, ...current]);
      setEmail(""); setCandidateName(""); setRole("member");
      setRoleIds([]); setDepartmentIds([]); setStep(1);
      setNotice(`Invitation email sent to ${data.email} with the selected roles and departments.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const canInviteAdmin = organization.role === "owner";
  const emailIsValid = email.trim().includes("@") && email.trim().split("@")[1]?.includes(".") === true && !email.trim().includes(" " );
  if (organization.role !== "owner" && organization.role !== "admin") return null;

  return (
    <section className="mt-6 rounded-2xl border border-cyan-900/50 bg-cyan-950/10 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-100">Employee invitations</h3>
          <p className="mt-1 text-xs text-slate-400">Set up a new member&apos;s access before sending their invitation.</p>
        </div>
        <span className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300">{rows.length}</span>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        {["Member details", "Assign roles", "Departments"].map((label, index) => {
          const number = index + 1;
          const active = step === number;
          const complete = step > number;
          return (
            <button key={label} type="button" onClick={() => number < step && setStep(number)}
              className={`rounded-xl border px-3 py-3 text-left text-xs transition ${active ? "border-cyan-400 bg-cyan-400/10 text-cyan-200" : complete ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-200" : "border-slate-800 bg-slate-950/50 text-slate-500"}`}>
              <span className="block text-[10px] tracking-widest">STEP 0{number}</span>
              <span className="mt-1 block font-semibold">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {step === 1 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-300" htmlFor="invite-email">Email address</label>
              <input id="invite-email" required type="email" maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="employee@company.com" className={fieldClass} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300" htmlFor="invite-name">Full name <span className="text-slate-500">(optional)</span></label>
              <input id="invite-name" minLength={2} maxLength={255} value={candidateName} onChange={(event) => setCandidateName(event.target.value)} placeholder="e.g. Aanya Sharma" className={fieldClass} />
            </div>
            {canInviteAdmin && (
              <div>
                <label className="block text-xs font-medium text-slate-300" htmlFor="invite-access">Organization access</label>
                <select id="invite-access" value={role} onChange={(event) => setRole(event.target.value)} className={fieldClass}>
                  <option value="member">Member</option><option value="admin">Admin</option>
                </select>
                <p className="mt-1 text-[11px] text-slate-500">Only the owner can invite an administrator.</p>
              </div>
            )}
            <div className="flex items-end justify-end">
              <button type="button" disabled={!emailIsValid} onClick={() => { setError(""); setStep(2); }} className={buttonClass}>Continue to roles</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h4 className="text-sm font-semibold text-slate-100">Assign organization roles</h4><p className="mt-1 text-xs text-slate-400">Select as many roles as this person needs. Only roles created in this organization are available.</p></div>
            </div>
            {roles.length ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {roles.map((item) => (
                  <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-200">
                    <input type="checkbox" checked={roleIds.includes(item.id)} onChange={() => toggle(setRoleIds, roleIds, item.id)} className="mt-0.5 accent-cyan-400" />
                    <span><span className="block font-medium">{item.name}</span>{item.description && <span className="mt-1 block text-xs text-slate-500">{item.description}</span>}</span>
                  </label>
                ))}
              </div>
            ) : <p className="mt-4 rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">No custom roles exist yet. Create one below or continue without additional roles.</p>}
            <form onSubmit={(event) => void createChoice("role", event)} className="mt-4 flex flex-wrap gap-2">
              <input value={newRole} onChange={(event) => setNewRole(event.target.value)} placeholder="New role name" maxLength={100} minLength={2} className={`${fieldClass} mt-0 min-w-[180px] flex-1`} />
              <button type="submit" disabled={newRole.trim().length < 2} className="rounded-lg border border-cyan-700 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-950">+ Create role</button>
            </form>
            <div className="mt-5 flex justify-between gap-2">
              <button type="button" onClick={() => setStep(1)} className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300">Back</button>
              <button type="button" onClick={() => { setError(""); setStep(3); }} className={buttonClass}>Continue to departments</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h4 className="text-sm font-semibold text-slate-100">Assign departments</h4>
            <p className="mt-1 text-xs text-slate-400">A person can belong to multiple departments. Select all that apply.</p>
            {departments.length ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {departments.map((item) => (
                  <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-200">
                    <input type="checkbox" checked={departmentIds.includes(item.id)} onChange={() => toggle(setDepartmentIds, departmentIds, item.id)} className="accent-cyan-400" />
                    <span>{item.name}</span>
                  </label>
                ))}
              </div>
            ) : <p className="mt-4 rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">No departments exist yet. Create one below or continue without a department.</p>}
            <form onSubmit={(event) => void createChoice("department", event)} className="mt-4 flex flex-wrap gap-2">
              <input value={newDepartment} onChange={(event) => setNewDepartment(event.target.value)} placeholder="New department name" maxLength={100} minLength={2} className={`${fieldClass} mt-0 min-w-[180px] flex-1`} />
              <button type="submit" disabled={newDepartment.trim().length < 2} className="rounded-lg border border-cyan-700 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-950">+ Create department</button>
            </form>
            <div className="mt-5 flex flex-wrap justify-between gap-2">
              <button type="button" onClick={() => setStep(2)} className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300">Back</button>
              <button type="button" onClick={() => void send()} disabled={saving || !email.trim()} className={buttonClass}>{saving ? "Sending invitation…" : "Send invitation"}</button>
            </div>
          </div>
        )}
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-emerald-300">{notice}</p>}

      <div className="mt-5 border-t border-slate-800 pt-4">
        <h4 className="text-sm font-semibold text-slate-200">Invitation mail log</h4>
        {loading ? <p className="mt-3 text-sm text-slate-500">Loading invitation history…</p> :
          rows.length ? <ul className="mt-3 space-y-2">{rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><p className="text-sm font-medium text-slate-100">{row.candidate_name}</p><p className="mt-1 break-all text-xs text-slate-400">{row.email}</p></div>
                <div className="flex flex-wrap items-center gap-1.5"><span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs capitalize text-slate-300">{row.status}</span><span className="text-[11px] text-slate-500">Access: {row.role}</span></div>
              </div>
              <p className="mt-2 text-xs text-slate-500">Sent: {row.email_sent_at ? new Date(row.email_sent_at).toLocaleString() : "Not recorded"} · Expires: {new Date(row.expires_at).toLocaleString()}</p>
            </li>
          ))}</ul> : <p className="mt-3 text-sm text-slate-500">No invitations sent yet.</p>}
        <button type="button" onClick={() => void load()} className="mt-3 text-xs text-cyan-300 hover:text-cyan-200">Refresh invitation log</button>
      </div>
    </section>
  );
}
