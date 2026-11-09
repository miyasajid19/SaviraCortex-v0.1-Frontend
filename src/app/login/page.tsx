"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
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
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Mail01Icon, GoogleIcon, CallIcon, ShieldCheckIcon, EyeIcon, EyeClosedIcon } from "@hugeicons/core-free-icons";
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

  const loadProfile = useCallback(async (user: User): Promise<void> => {
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
      const firstOrganization = data.organizations?.[0];
      if (firstOrganization && firstOrganization.onboarding_completed === false) {
        router.replace(`/onboarding?organization_id=${encodeURIComponent(firstOrganization.organization_id)}`);
      } else {
        router.replace("/dashboard");
      }
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
  }, [router]);

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
  }, [loadProfile]);

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

  const providers = [
    { id: "email" as const, label: "Email", icon: Mail01Icon },
    { id: "google" as const, label: "Google", icon: GoogleIcon },
    { id: "phone" as const, label: "Phone", icon: CallIcon },
  ];

  return (
    <main className="sc-login min-h-screen text-white lg:grid lg:grid-cols-[1.08fr_0.92fr]">
      <section className="sc-stage relative isolate flex min-h-[560px] flex-col overflow-hidden px-6 py-7 sm:px-10 lg:min-h-screen lg:px-[6vw] lg:py-9">
        <div className="sc-grain" aria-hidden="true" />
        <div className="sc-aurora sc-aurora-one" aria-hidden="true" />
        <div className="sc-aurora sc-aurora-two" aria-hidden="true" />
        <div className="sc-orbit sc-orbit-a" aria-hidden="true" />
        <div className="sc-orbit sc-orbit-b" aria-hidden="true" />
        <div className="sc-orbit sc-orbit-c" aria-hidden="true" />
        <div className="relative z-10 flex items-center justify-between">
          <Link href="/" className="sc-wordmark inline-flex items-center gap-3">
            <span className="sc-mark"><span>S</span></span>
            <span>Savira<span className="text-cyan-300">Cortex</span></span>
          </Link>
          <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 py-2 text-[10px] font-medium tracking-[0.16em] text-slate-300 sm:inline-flex"><span className="sc-live-dot" /> INTELLIGENCE, CONNECTED</span>
        </div>
        <div className="relative z-10 my-auto grid items-center gap-8 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(230px,0.8fr)] lg:gap-2 lg:py-10">
          <div className="relative z-20 max-w-[570px]">
            <p className="sc-kicker"><span className="sc-kicker-line" /> THE KNOWLEDGE LAYER FOR WHAT’S NEXT</p>
            <h1 className="sc-display mt-7">Your data.<br /><span className="sc-gradient-text">In orbit.</span><br />Your advantage.</h1>
            <p className="mt-7 max-w-[410px] text-[15px] leading-7 text-slate-300/75 sm:text-base">Bring scattered knowledge together. Give every team a clearer signal, deeper context, and a smarter way forward.</p>
            <div className="mt-9 flex flex-wrap items-center gap-3"><span className="sc-chip"><span className="sc-chip-pulse" /> AI-powered knowledge</span><span className="sc-chip">Built for teams</span></div>
          </div>
          <div className="sc-visual relative mx-auto h-[310px] w-full max-w-[390px] sm:h-[370px] lg:-ml-12 lg:mt-8 lg:h-[460px]">
            <div className="sc-core-halo" /><div className="sc-core-ring sc-ring-one" /><div className="sc-core-ring sc-ring-two" /><div className="sc-core-ring sc-ring-three" />
            <div className="sc-core"><div className="sc-core-inner"><span className="sc-core-spark">✳</span><span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-100/70">CORTEX</span><span className="mt-1 text-[25px] font-semibold tracking-[-0.07em]">AI<span className="text-cyan-300">.</span></span></div></div>
            <div className="sc-node sc-node-doc"><span className="sc-node-icon">▤</span><span><b>Knowledge</b><small>Documents indexed</small></span></div>
            <div className="sc-node sc-node-team"><span className="sc-node-icon">◈</span><span><b>Team context</b><small>Shared understanding</small></span></div>
            <div className="sc-node sc-node-flow"><span className="sc-node-icon">⌘</span><span><b>AI workflows</b><small>Ready to accelerate</small></span></div>
            <div className="sc-signal sc-signal-one" /><div className="sc-signal sc-signal-two" />
            <div className="sc-float-label">CONTEXT ENGINE <span>● LIVE</span></div>
          </div>
        </div>
        <div className="relative z-10 flex items-center justify-between border-t border-white/10 pt-5 text-[10px] tracking-[0.08em] text-slate-500"><span>© 2026 SAVIRACORTEX</span><span>THINK CLEARER. MOVE FASTER.</span></div>
      </section>

      <section className="sc-auth-side relative flex min-h-screen flex-col px-5 py-6 sm:px-10 lg:px-12 xl:px-[6vw]">
        <header className="relative z-10 flex items-center justify-between">
          <Link href="/" className="sc-wordmark inline-flex items-center gap-2 lg:hidden"><span className="sc-mark sc-mark-small"><span>S</span></span><span>Savira<span className="text-cyan-300">Cortex</span></span></Link>
          <p className="ml-auto text-xs text-slate-400 sm:text-sm">New here? <Link href="/register" className="font-semibold text-cyan-300 transition hover:text-white">Create account ↗</Link></p>
        </header>
        <div className="relative z-10 mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center py-12">
          <div className="sc-auth-heading mb-7">
            <div className="sc-auth-eyebrow"><span className="sc-live-dot" /> SECURE WORKSPACE ACCESS</div>
            <h2 className="mt-5 text-[2.65rem] font-semibold leading-[1.02] tracking-[-0.075em] text-white sm:text-[3.15rem]">Welcome<br /><span className="text-slate-400">back.</span></h2>
            <p className="mt-4 max-w-sm text-sm leading-6 text-slate-400">Pick up where your team’s knowledge comes together.</p>
          </div>
          <div className="sc-auth-card">
            <div className="mb-6 flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-[0.17em] text-slate-300">Sign in to continue</span><span className="rounded-full border border-emerald-300/15 bg-emerald-300/[0.07] px-2.5 py-1 text-[9px] font-semibold tracking-[0.12em] text-emerald-300">ENCRYPTED</span></div>
            <div className="sc-provider-tabs" role="tablist" aria-label="Sign-in method">
              {providers.map((item) => <button key={item.id} type="button" role="tab" aria-selected={provider === item.id} onClick={() => { setProvider(item.id); setError(""); setConfirmation(null); setOtp(""); }} className={"sc-provider-tab " + (provider === item.id ? "is-active" : "")}><HugeiconsIcon icon={item.icon} size={17} />{item.label}</button>)}
            </div>
            {provider === "email" && (
              <form onSubmit={submitEmailLogin} className="mt-6 space-y-4">
                <div><label htmlFor="login-email" className="sc-field-label">Work email</label><input id="login-email" required type="email" autoComplete="email" placeholder="name@company.com" value={email} onChange={(event) => setEmail(event.target.value)} className="sc-input" /></div>
                <div><label htmlFor="login-password" className="sc-field-label">Password</label><div className="relative"><input id="login-password" required type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} className="sc-input pr-20" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute inset-y-0 right-3 my-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-slate-400 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"><HugeiconsIcon icon={showPassword ? EyeClosedIcon : EyeIcon} size={15} />{showPassword ? "Hide" : "Show"}</button></div></div>
                <button disabled={busy || !auth} className="sc-submit group"><span>{busy ? "Authenticating…" : "Enter your workspace"}</span>{!busy && <span className="text-lg transition-transform duration-300 group-hover:translate-x-1">↗</span>}</button>
              </form>
            )}
            {provider === "google" && <div className="mt-6"><p className="mb-5 text-sm leading-6 text-slate-400">Continue with the Google account connected to your organization.</p><button type="button" disabled={busy || !auth} onClick={signInWithGoogle} className="sc-submit sc-submit-secondary"><span className="flex items-center gap-3"><HugeiconsIcon icon={GoogleIcon} size={18} />{busy ? "Connecting…" : "Continue with Google"}</span><span>↗</span></button></div>}
            {provider === "phone" && (
              <div className="mt-6 space-y-4">
                <p className="text-sm leading-6 text-slate-400">Use the phone number linked to your SaviraCortex account.</p>
                <div><label htmlFor="login-phone" className="sc-field-label">Phone number</label><input id="login-phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="+91 98765 43210" value={phone} onChange={(event) => setPhone(event.target.value)} className="sc-input" /></div>
                {!confirmation ? <button type="button" disabled={busy || !phone.trim() || !auth} onClick={sendPhoneCode} className="sc-submit">{busy ? "Sending secure code…" : "Send verification code"}<span>↗</span></button> : <><div><label htmlFor="login-otp" className="sc-field-label">Verification code</label><input id="login-otp" inputMode="numeric" autoComplete="one-time-code" placeholder="Enter 6-digit code" value={otp} onChange={(event) => setOtp(event.target.value)} className="sc-input tracking-[0.25em]" /></div><button type="button" disabled={busy || !otp.trim()} onClick={verifyPhoneCode} className="sc-submit">{busy ? "Verifying…" : "Verify and sign in"}<span>↗</span></button><button type="button" onClick={() => { setConfirmation(null); setOtp(""); }} className="w-full py-2 text-xs font-medium text-cyan-300 transition hover:text-white">Use a different phone number</button></>}
              </div>
            )}
            <div id="login-recaptcha" />
            {error && <div role="alert" className="mt-5 rounded-xl border border-rose-300/20 bg-rose-400/[0.08] px-4 py-3 text-[13px] leading-5 text-rose-200">{error}</div>}
            <div className="mt-6 flex items-center gap-2 border-t border-white/[0.08] pt-5 text-[11px] text-slate-500"><HugeiconsIcon icon={ShieldCheckIcon} size={15} className="text-cyan-300" /><span>Your credentials are securely handled by Firebase.</span></div>
          </div>
          <p className="mt-6 text-center text-[11px] leading-5 text-slate-500">By continuing, you agree to access your organization’s secure SaviraCortex workspace.</p>
        </div>
        <footer className="relative z-10 flex justify-center pb-2 text-[10px] tracking-[0.08em] text-slate-600 lg:justify-end">© 2026 SAVIRACORTEX</footer>
      </section>
    </main>
  );
}
