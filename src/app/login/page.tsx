"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut,
  type ConfirmationResult,
  type User,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import { auth, firebaseConfigError } from "../firebase";

const API = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
type Provider = "email" | "google" | "phone";

function readableAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === "auth/billing-not-enabled") {
    return "Firebase billing is not enabled for real SMS delivery. Your configured test phone numbers can still be used during development.";
  }
  if (code === "auth/invalid-phone-number") return "Enter a valid phone number in international format, for example +919876543210.";
  if (code === "auth/too-many-requests") return "Firebase temporarily blocked requests from this device. Please wait before trying again.";
  if (code === "auth/popup-closed-by-user") return "The Google sign-in window was closed before authentication completed.";
  if (code === "auth/popup-blocked") return "Your browser blocked the Google sign-in popup. Allow popups for localhost and try again.";
  if (code === "auth/network-request-failed") return "Network request failed. Check your connection and try again.";
  return (error as Error)?.message || "Sign-in failed. Please try again.";
}

export default function LoginPage() {
  const router = useRouter();
  const [provider, setProvider] = useState<Provider>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(firebaseConfigError);
  const recaptcha = useRef<RecaptchaVerifier | null>(null);
  const authFlowInProgress = useRef(false);
  const handledUid = useRef<string | null>(null);
  const mounted = useRef(true);

  async function loadProfile(user: User): Promise<void> {
    let token = await user.getIdToken(true);
    let response = await fetch(API + "/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (response.status === 401) {
      token = await user.getIdToken(true);
      response = await fetch(API + "/api/v1/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
    }

    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      handledUid.current = user.uid;
      router.replace("/dashboard");
      return;
    }
    if (response.status === 404) {
      throw new Error("This Firebase account is not registered in SaviraCortex yet. Create an organization first.");
    }
    if (response.status === 401) {
      await signOut(auth!);
      handledUid.current = null;
      throw new Error("SaviraCortex could not verify this Firebase session, even after refreshing its token. Please sign in again. If this repeats, check that the frontend and backend use the same Firebase project.");
    }
    throw new Error(data.detail || `Profile request failed (HTTP ${response.status}).`);
  }

  useEffect(() => {
    mounted.current = true;
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        handledUid.current = null;
        return;
      }
      if (authFlowInProgress.current || handledUid.current === user.uid) return;
      void loadProfile(user).catch((cause) => {
        if (mounted.current) setError(readableAuthError(cause));
      });
    });
    return () => {
      mounted.current = false;
      unsubscribe();
      recaptcha.current?.clear();
      recaptcha.current = null;
    };
  }, []);

  async function runAuthentication(action: () => Promise<unknown>) {
    if (!auth) {
      setError(firebaseConfigError || "Firebase is not configured.");
      return;
    }
    authFlowInProgress.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      const user = auth.currentUser;
      if (!user) throw new Error("Firebase did not return an authenticated user.");
      await user.reload();
      if (user.email && !user.emailVerified) {
        await signOut(auth);
        throw new Error("Please verify your email before signing in.");
      }
      await loadProfile(user);
    } catch (cause) {
      if (mounted.current) setError(readableAuthError(cause));
    } finally {
      authFlowInProgress.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function getRecaptchaVerifier() {
    if (!auth) throw new Error(firebaseConfigError || "Firebase is not configured.");
    if (!recaptcha.current) {
      recaptcha.current = new RecaptchaVerifier(auth, "login-recaptcha", { size: "invisible" });
    }
    return recaptcha.current;
  }

  async function submitEmailLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAuthentication(() => signInWithEmailAndPassword(auth!, email.trim(), password));
  }

  async function signInWithGoogle() {
    await runAuthentication(() => signInWithPopup(auth!, new GoogleAuthProvider()));
  }

  async function sendPhoneCode() {
    if (!auth) {
      setError(firebaseConfigError || "Firebase is not configured.");
      return;
    }
    setBusy(true);
    setError("");
    setConfirmation(null);
    try {
      const result = await signInWithPhoneNumber(auth, phone.trim(), getRecaptchaVerifier());
      setConfirmation(result);
    } catch (cause) {
      setError(readableAuthError(cause));
      recaptcha.current?.clear();
      recaptcha.current = null;
    } finally {
      setBusy(false);
    }
  }

  async function verifyPhoneCode() {
    if (!confirmation) return;
    await runAuthentication(() => confirmation.confirm(otp.trim()));
  }

  const providers: { id: Provider; label: string; mark: string }[] = [
    { id: "email", label: "Email", mark: "@" },
    { id: "google", label: "Google", mark: "G" },
    { id: "phone", label: "Phone", mark: "↗" },
  ];

  return (
    <main className="min-h-screen bg-[#f3f6fa] text-[#101c2d] lg:grid lg:grid-cols-[minmax(0,1.04fr)_minmax(520px,0.96fr)]">
      <section className="relative isolate hidden min-h-screen overflow-hidden bg-[#071525] px-12 py-10 text-white lg:flex lg:flex-col xl:px-[8.5vw]">
        <div className="pointer-events-none absolute -right-48 top-24 h-[34rem] w-[34rem] rounded-full border border-cyan-300/10" />
        <div className="pointer-events-none absolute -right-24 top-48 h-[25rem] w-[25rem] rounded-full border border-cyan-300/10" />
        <div className="pointer-events-none absolute -right-2 top-72 h-[16rem] w-[16rem] rounded-full border border-cyan-300/10" />
        <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-[#0a2438]/80 to-transparent" />

        <a href="/" className="relative z-10 inline-flex w-fit items-center gap-3 text-[19px] font-semibold tracking-[-0.04em]">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 text-sm font-bold text-cyan-200">S</span>
          <span>Savira<span className="text-cyan-300">Cortex</span></span>
        </a>

        <div className="relative z-10 my-auto max-w-xl pb-10">
          <p className="mb-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/80">
            <span className="h-px w-8 bg-cyan-300/70" /> Your intelligence workspace
          </p>
          <h1 className="max-w-lg text-[clamp(2.8rem,4.5vw,4.65rem)] font-medium leading-[1.06] tracking-[-0.065em]">
            Bring your knowledge <span className="text-cyan-300">into focus.</span>
          </h1>
          <p className="mt-7 max-w-md text-[15px] leading-7 text-slate-300/75">
            Sign in to continue building with your organization’s connected knowledge, AI workflows, and shared context.
          </p>

          <div className="relative mt-14 max-w-[440px] rounded-[26px] border border-white/10 bg-white/[0.045] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.25)] backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Knowledge stream</span>
              <span className="flex items-center gap-2 text-[10px] text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Ready</span>
            </div>
            <div className="mt-5 grid grid-cols-[1fr_42px_1fr] items-center gap-2">
              <div className="space-y-2">
                <div className="rounded-xl border border-white/10 bg-[#10283b] p-3">
                  <div className="mb-2 h-1.5 w-8 rounded bg-cyan-300/70" />
                  <div className="h-1.5 w-full rounded bg-slate-500/40" />
                  <div className="mt-1.5 h-1.5 w-3/4 rounded bg-slate-500/30" />
                  <p className="mt-3 text-[10px] text-slate-400">Documents</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#10283b] p-3">
                  <div className="mb-2 h-1.5 w-10 rounded bg-violet-300/70" />
                  <div className="h-1.5 w-full rounded bg-slate-500/40" />
                  <div className="mt-1.5 h-1.5 w-2/3 rounded bg-slate-500/30" />
                  <p className="mt-3 text-[10px] text-slate-400">Team context</p>
                </div>
              </div>
              <div className="flex flex-col items-center gap-1 text-cyan-200">
                <span className="h-px w-full bg-cyan-300/30" />
                <span className="grid h-9 w-9 place-items-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 text-base">✳</span>
                <span className="h-px w-full bg-cyan-300/30" />
              </div>
              <div className="rounded-xl border border-cyan-200/20 bg-cyan-300/[0.08] p-3">
                <div className="mb-3 flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-300/15 text-sm text-cyan-200">✦</div>
                <p className="text-xs font-medium text-white">Cortex AI</p>
                <p className="mt-1.5 text-[10px] leading-4 text-slate-400">Connected context, clearer answers.</p>
                <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-white/10"><div className="h-full w-4/5 rounded-full bg-cyan-300/80" /></div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-[10px] text-slate-500">
              <span>One workspace. Shared understanding.</span><span className="font-mono text-cyan-200/70">SC / 01</span>
            </div>
          </div>
        </div>
        <div className="relative z-10 flex items-center justify-between text-[11px] text-slate-500">
          <span>© 2026 SaviraCortex</span><span>Secure access for your team</span>
        </div>
      </section>

      <section className="flex min-h-screen flex-col px-5 py-6 sm:px-10 lg:px-12 xl:px-[7vw]">
        <header className="flex items-center justify-between lg:justify-end">
          <a href="/" className="inline-flex items-center gap-2 text-lg font-semibold tracking-[-0.04em] lg:hidden">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#0b2034] text-xs font-bold text-cyan-200">S</span>
            Savira<span className="-ml-2 text-cyan-700">Cortex</span>
          </a>
          <p className="text-sm text-slate-500">New to SaviraCortex? <a href="/register" className="font-semibold text-[#087d98] transition hover:text-[#075c72]">Create an account <span aria-hidden="true">↗</span></a></p>
        </header>

        <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col justify-center py-12">
          <div className="mb-8">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-[#0b849e]">Welcome back</p>
            <h2 className="text-[2.45rem] font-semibold leading-tight tracking-[-0.055em] text-[#102238]">Sign in to your<br className="hidden sm:block" /> workspace.</h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">Pick up where your team left off.</p>
          </div>

          <div className="rounded-[26px] border border-[#dce4eb] bg-white p-5 shadow-[0_18px_55px_rgba(17,42,65,0.07)] sm:p-7">
            <div className="grid grid-cols-3 rounded-xl bg-[#f1f5f8] p-1" role="tablist" aria-label="Sign-in method">
              {providers.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={provider === item.id}
                  onClick={() => { setProvider(item.id); setError(""); setConfirmation(null); setOtp(""); }}
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-[9px] px-2 text-sm font-medium transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0789a5] focus-visible:ring-offset-2 ${provider === item.id ? "bg-white text-[#102238] shadow-[0_1px_4px_rgba(16,34,56,0.12)]" : "text-slate-500 hover:text-slate-800"}`}
                >
                  <span aria-hidden="true" className={`text-[13px] ${provider === item.id ? "text-[#0789a5]" : "text-slate-400"}`}>{item.mark}</span>
                  {item.label}
                </button>
              ))}
            </div>

            {provider === "email" && (
              <form onSubmit={submitEmailLogin} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="login-email" className="mb-2 block text-[13px] font-semibold text-[#26394d]">Email address</label>
                  <input id="login-email" required type="email" autoComplete="email" placeholder="you@company.com" value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="h-12 w-full rounded-xl border border-[#d7e0e8] bg-white px-4 text-sm text-[#14283c] outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-[#0789a5] focus:ring-4 focus:ring-[#0789a5]/10" />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label htmlFor="login-password" className="text-[13px] font-semibold text-[#26394d]">Password</label>
                  </div>
                  <div className="relative">
                    <input id="login-password" required type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="h-12 w-full rounded-xl border border-[#d7e0e8] bg-white px-4 pr-20 text-sm text-[#14283c] outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-[#0789a5] focus:ring-4 focus:ring-[#0789a5]/10" />
                    <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute inset-y-0 right-3 my-auto h-8 rounded-md px-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0789a5]">
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>
                <button disabled={busy || !auth} className="group mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#087f99] px-4 text-sm font-semibold text-white shadow-[0_7px_16px_rgba(8,127,153,0.18)] transition hover:bg-[#066b82] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0789a5]/25 disabled:cursor-not-allowed disabled:opacity-55">
                  {busy ? "Signing in…" : "Sign in"}{!busy && <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>}
                </button>
              </form>
            )}

            {provider === "google" && (
              <div className="mt-6">
                <p className="mb-4 text-sm leading-6 text-slate-500">Use your Google account to securely access your organization.</p>
                <button type="button" disabled={busy || !auth} onClick={signInWithGoogle}
                  className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-[#d7e0e8] bg-white text-sm font-semibold text-[#26394d] transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0789a5]/15 disabled:cursor-not-allowed disabled:opacity-55">
                  <span aria-hidden="true" className="text-base font-bold text-[#4285F4]">G</span>
                  {busy ? "Connecting to Google…" : "Continue with Google"}
                </button>
              </div>
            )}

            {provider === "phone" && (
              <div className="mt-6 space-y-4">
                <p className="text-sm leading-6 text-slate-500">Sign in with the phone number linked to your account.</p>
                <div>
                  <label htmlFor="login-phone" className="mb-2 block text-[13px] font-semibold text-[#26394d]">Phone number</label>
                  <input id="login-phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="+91 98765 43210" value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    className="h-12 w-full rounded-xl border border-[#d7e0e8] bg-white px-4 text-sm text-[#14283c] outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-[#0789a5] focus:ring-4 focus:ring-[#0789a5]/10" />
                </div>
                {!confirmation ? (
                  <button type="button" disabled={busy || !phone.trim() || !auth} onClick={sendPhoneCode}
                    className="h-12 w-full rounded-xl bg-[#087f99] px-4 text-sm font-semibold text-white transition hover:bg-[#066b82] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0789a5]/25 disabled:cursor-not-allowed disabled:opacity-55">
                    {busy ? "Sending code…" : "Send verification code"}
                  </button>
                ) : (
                  <>
                    <div>
                      <label htmlFor="login-otp" className="mb-2 block text-[13px] font-semibold text-[#26394d]">Verification code</label>
                      <input id="login-otp" inputMode="numeric" autoComplete="one-time-code" placeholder="Enter 6-digit code" value={otp}
                        onChange={(event) => setOtp(event.target.value)}
                        className="h-12 w-full rounded-xl border border-[#d7e0e8] bg-white px-4 text-sm tracking-[0.2em] text-[#14283c] outline-none transition placeholder:tracking-normal placeholder:text-slate-400 focus:border-[#0789a5] focus:ring-4 focus:ring-[#0789a5]/10" />
                    </div>
                    <button type="button" disabled={busy || !otp.trim()} onClick={verifyPhoneCode}
                      className="h-12 w-full rounded-xl bg-[#087f99] px-4 text-sm font-semibold text-white transition hover:bg-[#066b82] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0789a5]/25 disabled:cursor-not-allowed disabled:opacity-55">
                      {busy ? "Verifying…" : "Verify and sign in"}
                    </button>
                    <button type="button" onClick={() => { setConfirmation(null); setOtp(""); }}
                      className="w-full py-1 text-xs font-semibold text-[#087f99] transition hover:text-[#075c72]">Use a different phone number</button>
                  </>
                )}
              </div>
            )}

            <div id="login-recaptcha" />
            {error && <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] leading-5 text-rose-800">{error}</div>}
            <div className="mt-6 flex items-center justify-center gap-2 border-t border-[#edf1f4] pt-5 text-[11px] text-slate-400">
              <span aria-hidden="true" className="text-[#0b8ba4]">◇</span>
              Your credentials are securely handled by Firebase.
            </div>
          </div>

          <p className="mt-6 text-center text-xs leading-5 text-slate-400">By continuing, you’re accessing your organization’s SaviraCortex workspace.</p>
        </div>

        <footer className="flex justify-center pb-2 text-[11px] text-slate-400 lg:justify-end">
          <span>© 2026 SaviraCortex</span>
        </footer>
      </section>
    </main>
  );
}
