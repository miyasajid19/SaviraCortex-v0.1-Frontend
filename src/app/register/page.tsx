"use client";

import { useState } from "react";

export default function RegisterPage() {
  const [organization, setOrganization] = useState("SaviraCortex");
  const [adminName, setAdminName] = useState("Sajid Miya");
  const [email, setEmail] = useState("miyasajid.01.13@gmail.com");
  const [password, setPassword] = useState("pass1234");
  const [submitted, setSubmitted] = useState(false);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6"><a href="/" className="text-xl font-bold"><span className="text-cyan-400">Savira</span>Cortex</a><a href="/" className="text-sm text-slate-400 hover:text-white">← Back home</a></nav>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-10 md:grid-cols-2 md:py-20">
        <div><div className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-300">CREATE YOUR WORKSPACE</div><h1 className="mt-6 text-4xl font-semibold leading-tight sm:text-5xl">Start building with <span className="text-cyan-400">SaviraCortex.</span></h1><p className="mt-5 max-w-lg leading-7 text-slate-400">Set up your organization workspace and explore the SaviraCortex platform. This is a UI demo form; it does not yet create an account or send data to the backend.</p><div className="mt-8 space-y-4 text-sm text-slate-300"><p>✦ AI-powered workspace experience</p><p>✦ Organization-first account setup</p><p>✦ Built for teams and intelligent workflows</p></div></div>
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-7 shadow-2xl shadow-cyan-950/30 sm:p-9"><div><h2 className="text-2xl font-semibold">Create an account</h2><p className="mt-2 text-sm text-slate-400">Enter your organization and admin details.</p></div>
          {submitted ? <div className="mt-8 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-5"><p className="font-semibold text-emerald-300">Demo form submitted!</p><p className="mt-2 text-sm text-slate-300">No account was created yet. Firebase and API integration will be added next.</p><button onClick={() => setSubmitted(false)} className="mt-4 text-sm text-cyan-300 underline">Edit details</button></div> : <form onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }} className="mt-7 space-y-5"><label className="block"><span className="text-sm font-medium text-slate-300">Organization name</span><input required minLength={2} value={organization} onChange={(e) => setOrganization(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-cyan-400" /></label><label className="block"><span className="text-sm font-medium text-slate-300">Administrator name</span><input required minLength={2} value={adminName} onChange={(e) => setAdminName(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-cyan-400" /></label><label className="block"><span className="text-sm font-medium text-slate-300">Email address</span><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-cyan-400" /></label><label className="block"><span className="text-sm font-medium text-slate-300">Password</span><input required type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-cyan-400" /></label><button type="submit" className="w-full rounded-xl bg-cyan-400 px-5 py-3.5 font-semibold text-slate-950 transition hover:bg-cyan-300">Create workspace</button><p className="text-center text-xs leading-5 text-slate-500">By continuing, you agree to the demo terms and privacy policy.</p></form>}
          <p className="mt-6 text-center text-sm text-slate-400">Already have an account? <a href="#" className="font-medium text-cyan-300">Sign in (coming soon)</a></p></div>
      </section><footer className="px-6 py-8 text-center text-sm text-slate-500">© 2026 SaviraCortex · Demo signup</footer>
    </main>
  );
}
