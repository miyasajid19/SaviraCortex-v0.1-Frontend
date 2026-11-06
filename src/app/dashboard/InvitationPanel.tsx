"use client";

import { FormEvent, useEffect, useState } from "react";

const API = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

type Organization = { organization_id: string; organization_name: string; role: string };
type Invitation = {
  id: string;
  email: string;
  candidate_name: string;
  role: string;
  custom_role: string;
  status: string;
  created_at: string;
  expires_at: string;
  email_sent_at: string | null;
};

export default function InvitationPanel({ organization, token }: { organization: Organization; token: string }) {
  const [rows, setRows] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [role, setRole] = useState("member");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/v1/organizations/${organization.organization_id}/invitations`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.detail || "Could not load invitations.");
      setRows(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (organization.role === "owner" || organization.role === "admin") void load(); }, [organization.organization_id, organization.role, token]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${API}/api/v1/organizations/${organization.organization_id}/invitations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), candidate_name: candidateName.trim(), role }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Could not send the invitation.");
      setRows((current) => [data, ...current]);
      setEmail("");
      setCandidateName("");
      setRole("member");
      setNotice(`Invitation email sent to ${data.email}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const canInviteAdmin = organization.role === "owner";
  if (organization.role !== "owner" && organization.role !== "admin") return null;

  return (
    <section className="mt-6 rounded-2xl border border-cyan-900/50 bg-cyan-950/10 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-100">Employee invitations</h3>
          <p className="mt-1 text-xs text-slate-400">Invite new people by email. They create their own login credential after accepting.</p>
        </div>
        <span className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300">{rows.length}</span>
      </div>
      <form onSubmit={send} className="mt-5 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-slate-300" htmlFor={`invite-name-${organization.organization_id}`}>Candidate full name</label>
          <input id={`invite-name-${organization.organization_id}`} required minLength={2} maxLength={255} value={candidateName} onChange={(event) => setCandidateName(event.target.value)} placeholder="e.g. Aanya Sharma" className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-300" htmlFor={`invite-email-${organization.organization_id}`}>Email address</label>
          <input id={`invite-email-${organization.organization_id}`} required type="email" maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="employee@company.com" className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-300" htmlFor={`invite-role-${organization.organization_id}`}>Access level</label>
          <select id={`invite-role-${organization.organization_id}`} value={role} onChange={(event) => setRole(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white">
            <option value="member">Member</option>
            {canInviteAdmin && <option value="admin">Admin</option>}
          </select>
        </div>
        <div>
          <span className="block text-xs font-medium text-slate-300">Default organization role</span>
          <div className="mt-2 flex min-h-[42px] items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2.5 text-sm text-violet-200">
            <span className="rounded-full bg-violet-400/15 px-2.5 py-1 text-xs font-semibold capitalize">Newbie</span>
            <span className="text-xs text-slate-400">Assigned automatically after acceptance</span>
          </div>
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={saving || !email.trim() || candidateName.trim().length < 2} className="w-full rounded-lg bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Sending invitation…" : "Send invitation email"}</button>
        </div>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-emerald-300">{notice}</p>}
      <div className="mt-5 border-t border-slate-800 pt-4">
        <h4 className="text-sm font-semibold text-slate-200">Invitation mail log</h4>
        {loading ? <p className="mt-3 text-sm text-slate-500">Loading invitation history…</p> :
          rows.length ? <ul className="mt-3 space-y-2">{rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100">{row.candidate_name}</p>
                  <p className="mt-1 break-all text-xs text-slate-400">{row.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5"><span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs capitalize text-slate-300">{row.status} · {row.custom_role}</span><span className="text-[11px] text-slate-500">Access: {row.role}</span></div>
              </div>
              <p className="mt-2 text-xs text-slate-500">Sent: {row.email_sent_at ? new Date(row.email_sent_at).toLocaleString() : "Not recorded"} · Expires: {new Date(row.expires_at).toLocaleString()}</p>
            </li>
          ))}</ul> : <p className="mt-3 text-sm text-slate-500">No invitations sent yet.</p>}
        <button type="button" onClick={() => void load()} className="mt-3 text-xs text-cyan-300 hover:text-cyan-200">Refresh invitation log</button>
      </div>
    </section>
  );
}
