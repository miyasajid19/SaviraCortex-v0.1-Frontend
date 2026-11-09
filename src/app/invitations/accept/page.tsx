"use client";

import { FormEvent, useEffect, useState } from "react";
import { signInWithCustomToken } from "firebase/auth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import BrandLockup from "../../../components/BrandLockup";
import { auth } from "../../firebase";

const API = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");


type InvitationPreview = {
  email: string;
  candidate_name: string;
  organization_name: string;
  expires_at: string;
};

export default function AcceptInvitationPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [fullName, setFullName] = useState("");
  const [credential, setCredential] = useState("");
  const [confirmCredential, setConfirmCredential] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accountCreated, setAccountCreated] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      const inviteToken = new URLSearchParams(window.location.search).get("token") || "";
      if (cancelled) return;
      setToken(inviteToken);
      if (!inviteToken) {
        setError("This invitation link is missing its token.");
        setLoading(false);
        return;
      }
      fetch(`${API}/api/v1/invitations/preview?token=${encodeURIComponent(inviteToken)}`, {
        method: "GET",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.detail || "This invitation is invalid or expired.");
          if (cancelled) return;
          setInvitation(data);
          setFullName(data.candidate_name || "");
        })
        .catch((err) => { if (!cancelled) setError((err as Error).message); })
        .finally(() => { if (!cancelled) setLoading(false); });
    });
    return () => { cancelled = true; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    if (credential !== confirmCredential) {
      setError("The passwords do not match.");
      return;
    }
    if (credential.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }
    if (!auth) {
      setError("Firebase client configuration is missing. Ask the administrator to configure the frontend Firebase environment before creating your account.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/v1/invitations/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          full_name: fullName.trim(),
          password: credential,
          phone_number: phone.trim() || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Account setup failed (HTTP ${response.status}).`);
      try {
        await signInWithCustomToken(auth, data.custom_token);
        router.replace("/dashboard");
      } catch {
        setAccountCreated(true);
        setError("Your account was created successfully, but automatic sign-in could not finish. Use the login link below and sign in with your invited email and the password you just created.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="sc-invitation min-h-screen px-5 py-12 text-neutral-900">
      <div className="mx-auto max-w-xl">
        <BrandLockup variant="light" />
        <section className="mt-10 rounded-3xl border border-slate-800 bg-slate-900 p-7 shadow-2xl sm:p-9">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">Organization invitation</p>
          <h1 className="mt-3 text-3xl font-semibold">Complete your account</h1>
          {loading ? <p className="mt-6 text-sm text-slate-400">Checking your invitation…</p> :
            invitation ? <>
              <p className="mt-3 text-sm leading-6 text-slate-400">You have been invited to join <strong className="text-white">{invitation.organization_name}</strong>. Set your full name and password to activate your account.</p>
              <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs text-slate-500">Invited email address</p>
                <p className="mt-1 break-all text-sm font-medium text-slate-100">{invitation.email}</p>
                <p className="mt-3 text-xs text-slate-500">This address is fixed by your organization invitation.</p>
              </div>
              <form onSubmit={submit} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="full-name" className="block text-sm font-medium text-slate-300">Full name</label>
                  <input id="full-name" required minLength={2} maxLength={255} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-cyan-400" placeholder="Your full name" />
                </div>
                <div>
                  <label htmlFor="credential" className="block text-sm font-medium text-slate-300">Create password</label>
                  <input id="credential" required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={credential} onChange={(event) => setCredential(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-cyan-400" placeholder="At least 8 characters" />
                </div>
                <div>
                  <label htmlFor="confirm-credential" className="block text-sm font-medium text-slate-300">Confirm password</label>
                  <input id="confirm-credential" required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={confirmCredential} onChange={(event) => setConfirmCredential(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-cyan-400" placeholder="Enter it again" />
                </div>
                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-slate-300">Phone number <span className="text-slate-500">(optional)</span></label>
                  <input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-cyan-400" placeholder="+91…" />
                </div>
                {error && <div role="alert" className={accountCreated ? "rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200" : "rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200"}>{error}{accountCreated && <p className="mt-2"><Link className="font-semibold underline" href="/login">Continue to login</Link></p>}</div>}
                <button type="submit" disabled={saving || accountCreated || !fullName.trim() || credential.length < 8 || credential !== confirmCredential} className="w-full rounded-xl bg-cyan-300 px-4 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Creating your account…" : "Create account and continue"}</button>
              </form>
            </> : <div className="mt-6 rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">{error || "This invitation is not available."}</div>}
          <p className="mt-6 text-center text-xs text-slate-500">Your invited email address cannot be changed. The link is single-use and expires after seven days.</p>
        </section>
      </div>
    </main>
  );
}
