import Link from "next/link";
import BrandLockup from "../components/BrandLockup";
import { CookieSettingsLink } from "@/components/legal/CookieConsent";

const capabilities = [
  { n: "01", title: "Understand your knowledge", desc: "Connect documents and organizational context, then find the signal inside complex information." },
  { n: "02", title: "Build intelligent workflows", desc: "Move from scattered tasks to connected, repeatable ways of working." },
  { n: "03", title: "Keep your team aligned", desc: "Give people one shared space for knowledge, decisions, and execution." },
];

export default function Home() {
  return <main className="sc-home min-h-screen overflow-hidden">
    <div className="sc-home-backdrop" aria-hidden="true"><span/><span/><span/></div>
    <header className="sc-home-nav-wrap"><nav className="sc-home-nav mx-auto flex max-w-7xl items-center justify-between px-6">
      <BrandLockup variant="light" />
      <div className="hidden items-center gap-9 md:flex"><a href="#platform" className="sc-home-nav-link">Platform</a><a href="#how-it-works" className="sc-home-nav-link">How it works</a></div>
      <div className="flex items-center gap-4"><Link href="/login" className="sc-home-signin">Sign in</Link><Link href="/register" className="sc-home-nav-cta">Get started <span>↗</span></Link></div>
    </nav></header>
    <section className="sc-home-hero mx-auto grid max-w-7xl items-center gap-8 px-6 pb-24 pt-16 lg:grid-cols-[.92fr_1.08fr] lg:gap-2 lg:pb-32 lg:pt-20">
      <div className="sc-home-copy relative z-10"><div className="sc-home-eyebrow"><span className="sc-live-dot"/> INTELLIGENCE, CONNECTED</div>
        <h1 className="sc-home-title mt-7">Your knowledge.<br/>In a new <span>dimension.</span></h1>
        <p className="sc-home-description mt-7">Turn your organization&apos;s information into shared understanding, intelligent workflows, and better decisions.</p>
        <div className="mt-9 flex flex-wrap items-center gap-4"><Link href="/register" className="sc-home-primary">Create your workspace <span>↗</span></Link><a href="#platform" className="sc-home-secondary">Explore the platform <span>↓</span></a></div>
        <div className="sc-home-proof mt-12"><span className="sc-home-proof-line"/><p>One connected space for <strong>knowledge</strong>, <strong>people</strong>, and <strong>work</strong>.</p></div>
      </div>
      <div className="sc-home-art relative mx-auto w-full" aria-label="Visualization of connected SaviraCortex intelligence">
        <div className="sc-home-art-grid"/><div className="sc-home-art-glow"/>
        <div className="sc-home-orbit sc-home-orbit-a"/><div className="sc-home-orbit sc-home-orbit-b"/><div className="sc-home-orbit sc-home-orbit-c"/>
        <div className="sc-home-arc-label">KNOWLEDGE GRAPH <i>● LIVE</i></div>
        <div className="sc-home-core"><div className="sc-home-core-pulse"/><div className="sc-home-core-symbol">S<span/></div><small>Savira<br/>Cortex</small></div>
        <div className="sc-home-float sc-home-float-doc"><span className="sc-home-float-icon">▤</span><div><b>Knowledge base</b><small>Documents connected</small></div><span className="sc-home-float-state">●</span></div>
        <div className="sc-home-float sc-home-float-ai"><span className="sc-home-float-icon">✳</span><div><b>AI intelligence</b><small>Context understood</small></div><span className="sc-home-float-state">●</span></div>
        <div className="sc-home-float sc-home-float-team"><span className="sc-home-float-icon">◉</span><div><b>Team workspace</b><small>People in sync</small></div><span className="sc-home-float-state">●</span></div>
        <div className="sc-home-data-label">CONNECTED SYSTEMS <span>03</span></div><div className="sc-home-spark sc-home-spark-one"/><div className="sc-home-spark sc-home-spark-two"/>
      </div>
    </section>
    <section className="sc-home-ribbon"><div className="sc-home-ribbon-track"><span>KNOWLEDGE THAT CONNECTS</span><i>✳</i><span>INTELLIGENCE THAT SCALES</span><i>✳</i><span>WORK THAT FLOWS</span><i>✳</i><span>KNOWLEDGE THAT CONNECTS</span><i>✳</i><span>INTELLIGENCE THAT SCALES</span><i>✳</i><span>WORK THAT FLOWS</span><i>✳</i></div></section>
    <section id="platform" className="sc-home-platform px-6 py-24 lg:py-32"><div className="mx-auto max-w-7xl">
      <div className="sc-home-section-head"><div><div className="sc-home-eyebrow"><span className="sc-home-eyebrow-mark"/> THE PLATFORM</div><h2 className="sc-home-section-title mt-5">Less searching.<br/><span>More seeing.</span></h2></div><p className="sc-home-section-intro">Your organization already has the information. SaviraCortex helps make it useful, connected, and ready to move work forward.</p></div>
      <div className="sc-home-features mt-16">{capabilities.map((item,i)=><article key={item.n} className={`sc-home-feature ${i===0?"sc-home-feature-wide":""}`}><div className="sc-home-feature-top"><span>{item.n} / CAPABILITY</span><span className="sc-home-feature-arrow">↗</span></div>
        <div className={`sc-home-feature-art sc-home-feature-art-${i+1}`}>{i===0?<><div className="sc-home-mini-node node-a">DOCS</div><div className="sc-home-mini-node node-b">CONTEXT</div><div className="sc-home-mini-node node-c">INSIGHT</div><div className="sc-home-mini-link link-a"/><div className="sc-home-mini-link link-b"/><div className="sc-home-mini-core">S</div></>:i===1?<><div className="sc-home-flow-step">INPUT</div><div className="sc-home-flow-line"/><div className="sc-home-flow-step active">PROCESS</div><div className="sc-home-flow-line"/><div className="sc-home-flow-step">ACTION</div></>:<div className="sc-home-team-orbit"><span>SC</span><i/><i/><i/></div>}</div>
        <h3>{item.title}</h3><p>{item.desc}</p></article>)}</div>
    </div></section>
    <section id="how-it-works" className="sc-home-bottom px-6 py-24 lg:py-28"><div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[1fr_auto]"><div><div className="sc-home-eyebrow"><span className="sc-home-eyebrow-mark"/> A CLEARER WAY FORWARD</div><h2 className="sc-home-bottom-title mt-5">Bring your work<br/>into <span>focus.</span></h2><p className="mt-5 max-w-lg text-base leading-7 text-slate-400">Start with a workspace built to bring your organization&apos;s knowledge and people closer together.</p></div><Link href="/register" className="sc-home-primary sc-home-bottom-cta">Start building your workspace <span>↗</span></Link></div></section>
    <footer className="sc-home-footer px-6 py-7"><div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 sm:flex-row"><BrandLockup variant="light" size="compact" /><p>© 2026 SaviraCortex. Built for connected intelligence.</p><div className="flex flex-wrap items-center gap-5"><Link href="/login">Sign in</Link><Link href="/register">Get started</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><CookieSettingsLink className="sc-home-cookie-settings" /></div></div></footer>
  </main>;
}