"use client";

import { useCallback, useEffect, useState } from "react";

const CONSENT_KEY = "savira-cookie-consent-v1";
type ConsentChoice = "accepted" | "rejected";

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  const readChoice = useCallback(() => {
    try {
      const saved = window.localStorage.getItem(CONSENT_KEY);
      if (saved === "accepted" || saved === "rejected") {
        setVisible(false);
      } else {
        setVisible(true);
      }
    } catch {
      // Storage may be unavailable in hardened/private browser contexts.
      setVisible(true);
    }
  }, []);

  useEffect(() => {
    const initialRead = window.setTimeout(readChoice, 0);
    const openSettings = () => setVisible(true);
    window.addEventListener("savira:open-cookie-settings", openSettings);
    return () => { window.clearTimeout(initialRead); window.removeEventListener("savira:open-cookie-settings", openSettings); };
  }, [readChoice]);

  const saveChoice = (next: ConsentChoice) => {
    try {
      window.localStorage.setItem(CONSENT_KEY, next);
    } catch {
      // Keep the current-session choice usable even when persistence is blocked.
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <aside className="sc-cookie-banner" aria-label="Cookie preferences" aria-live="polite">
      <div className="sc-cookie-copy">
        <span className="sc-cookie-eyebrow">YOUR PRIVACY</span>
        <h2>Cookies, on your terms.</h2>
        <p>We use essential browser storage to keep SaviraCortex secure and remember your preferences. Optional analytics or advertising cookies are not currently enabled. Your choice is saved for future optional technologies; none are currently active. Essential storage remains active either way.</p>
        <a href="/privacy">Read our Privacy Policy</a>
      </div>
      <div className="sc-cookie-actions">
        <button type="button" className="sc-cookie-reject" onClick={() => saveChoice("rejected")}>Reject optional</button>
        <button type="button" className="sc-cookie-accept" onClick={() => saveChoice("accepted")}>Accept all</button>
      </div>
    </aside>
  );
}

export function CookieSettingsLink({ className = "" }: { className?: string }) {
  return <button type="button" className={className} onClick={() => window.dispatchEvent(new Event("savira:open-cookie-settings"))}>Cookie settings</button>;
}
