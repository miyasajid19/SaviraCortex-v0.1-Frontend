import Link from "next/link";
import type { ReactNode } from "react";
import { CookieSettingsLink } from "./CookieConsent";

type Section = { title: string; body: ReactNode };

export default function LegalPage({ title, eyebrow, intro, sections }: { title: string; eyebrow: string; intro: string; sections: Section[] }) {
  return (
    <main className="sc-legal-page">
      <header className="sc-legal-nav"><Link href="/" className="sc-legal-brand"><span className="sc-mark">S</span><span>Savira<span>Cortex</span></span></Link><Link href="/" className="sc-legal-back">Back to home <span aria-hidden="true">↗</span></Link></header>
      <div className="sc-legal-shell">
        <aside className="sc-legal-aside"><span className="sc-legal-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{intro}</p><div className="sc-legal-meta">Last updated <strong>November 9, 2026</strong></div><nav aria-label="Legal pages"><Link href="/privacy" aria-current={title === "Privacy Policy" ? "page" : undefined}>Privacy Policy</Link><Link href="/terms" aria-current={title === "Terms of Service" ? "page" : undefined}>Terms of Service</Link><CookieSettingsLink /></nav></aside>
        <article className="sc-legal-content">{sections.map((section, index) => <section key={section.title}><span className="sc-legal-section-index">{String(index + 1).padStart(2, "0")}</span><div><h2>{section.title}</h2><div className="sc-legal-prose">{section.body}</div></div></section>)}<div className="sc-legal-endnote">SaviraCortex · A workspace for connected organizational knowledge</div></article>
      </div>
      <footer className="sc-legal-footer"><span>© 2026 SaviraCortex</span><div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><CookieSettingsLink /></div></footer>
    </main>
  );
}
