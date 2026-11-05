"use client";

import { FormEvent, useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { auth, firebaseConfigError } from "../firebase";

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

function DepartmentPanel({ organization, token }: { organization: Organization; token: string }) {
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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadDepartments(); }, [organization.organization_id, token]);

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
    </article>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState(firebaseConfigError);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) { setLoading(false); return; }
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
      <a href="/" className="text-xl font-bold"><span className="text-cyan-400">Savira</span>Cortex</a>
      <button onClick={logout} className="rounded-xl border border-slate-700 px-4 py-2 text-sm transition hover:border-slate-500">Sign out</button>
    </nav>
    <section className="mx-auto max-w-6xl px-6 py-12">
      <p className="text-sm font-semibold tracking-widest text-cyan-400">WORKSPACE</p>
      <h1 className="mt-3 text-4xl font-semibold">Welcome{profile?.display_name ? `, ${profile.display_name}` : ""}.</h1>
      <p className="mt-3 text-slate-400">Manage your organization and its departments.</p>
      {loading ? <p className="mt-6 text-slate-400">Loading account…</p> :
        error ? <p role="alert" className="mt-6 rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-rose-200">{error}</p> :
        <div className="mt-8 grid gap-5 lg:grid-cols-2">{profile?.organizations.map((organization) => <DepartmentPanel key={organization.organization_id} organization={organization} token={token} />)}</div>}
      {profile && <p className="mt-8 text-sm text-slate-500">Signed in using {profile.sign_in_provider || "Firebase"} · {profile.email || profile.phone_number}</p>}
    </section>
  </main>;
}
