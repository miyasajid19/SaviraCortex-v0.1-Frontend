"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

const API = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

type Action = "allow" | "block" | "redact" | "redirect" | "error";
type AuditEvent = {
  id: string;
  request_id: string;
  stage: string;
  decision: string;
  categories: string[];
  created_at: string | null;
};

type Policy = {
  allowed_topics: string[];
  restricted_topics: string[];
  off_topic_message: string;
  custom_input_policy: string;
  custom_output_policy: string;
  input_guardrails_enabled: boolean;
  output_guardrails_enabled: boolean;
  ingestion_guardrails_enabled: boolean;
  retrieval_guardrails_enabled: boolean;
  input_enabled: Record<string, boolean>;
  output_enabled: Record<string, boolean>;
  input_actions: Record<string, Action>;
  output_actions: Record<string, Action>;
  pii_require_consent: boolean;
  pii_allow_send_as_is: boolean;
  topicality_enabled: boolean;
  topicality_high_threshold: number;
  topicality_low_threshold: number;
  history_window_exchanges: number;
  output_streaming_mode: "segment" | "optimistic" | "bucket";
  output_bucket_min_tokens: number;
  output_bucket_max_tokens: number;
};

const inputCategories = [
  ["direct_jailbreak", "Direct jailbreak", "Attempts to override system or developer instructions."],
  ["indirect_prompt_injection", "Indirect prompt injection", "Instructions embedded in quoted or pasted content."],
  ["role_manipulation", "Role manipulation", "Attempts to impersonate privileged roles."],
  ["prompt_extraction", "Prompt extraction", "Attempts to reveal hidden instructions."],
  ["toxicity", "Toxicity and harassment", "Targeted abusive or harassing language."],
  ["sexual_content", "Sexual content", "Explicit sexual content; educational and medical context is exempt."],
  ["hate_discrimination", "Hate and discrimination", "Targeted hate or discriminatory content."],
  ["violence_self_harm", "Violence and self-harm", "Requests facilitating real-world harm."],
  ["organization_policy", "Organization policy", "Tenant-specific prohibited request categories."],
] as const;

const outputCategories = [
  ["pii_leakage", "Personal information leakage", "Detect PII in generated responses."],
  ["secret_leakage", "Secrets and credentials", "Always enabled and blocked by platform policy."],
  ["system_prompt_leakage", "Hidden prompt leakage", "Always enabled and blocked by platform policy."],
  ["unsafe_instruction_compliance", "Unsafe instruction compliance", "Check whether the assistant followed malicious instructions."],
  ["toxicity", "Toxicity and harassment", "Detect abusive or harassing generated content."],
  ["sexual_content", "Sexual content", "Distinguish explicit content from legitimate information."],
  ["hate_discrimination", "Hate and discrimination", "Detect targeted hate or discriminatory output."],
  ["violence_self_harm", "Violence and self-harm", "Detect content facilitating real-world harm."],
  ["off_topic", "Off-topic response", "Keep generated answers within configured topics."],
  ["grounding", "Evidence grounding", "Check claims against retrieved authorized evidence."],
  ["organization_policy", "Organization policy", "Apply tenant-specific output rules."],
] as const;

function defaultPolicy(): Policy {
  const input_enabled = Object.fromEntries(inputCategories.map(([key]) => [key, true]));
  input_enabled.topicality = true;
  const output_enabled = Object.fromEntries(outputCategories.map(([key]) => [key, true]));
  const input_actions = Object.fromEntries(inputCategories.map(([key]) => [key, "block"] as const));
  const output_actions = Object.fromEntries(outputCategories.map(([key]) => [key, "block"] as const));
  return {
    allowed_topics: [], restricted_topics: [],
    off_topic_message: "I can help with topics related to this organization's knowledge. Could you rephrase your question?",
    custom_input_policy: "", custom_output_policy: "",
    input_guardrails_enabled: true, output_guardrails_enabled: true,
    ingestion_guardrails_enabled: true, retrieval_guardrails_enabled: true,
    input_enabled, output_enabled, input_actions, output_actions,
    pii_require_consent: true, pii_allow_send_as_is: true,
    topicality_enabled: true, topicality_high_threshold: 0.6,
    topicality_low_threshold: 0.2, history_window_exchanges: 5,
    output_streaming_mode: "segment", output_bucket_min_tokens: 128, output_bucket_max_tokens: 512,
  };
}

function mergePolicy(value: Partial<Policy> | undefined): Policy {
  const base = defaultPolicy();
  if (!value) return base;
  const merged = {
    ...base, ...value,
    input_enabled: { ...base.input_enabled, ...value.input_enabled },
    output_enabled: { ...base.output_enabled, ...value.output_enabled },
    input_actions: { ...base.input_actions, ...value.input_actions },
    output_actions: { ...base.output_actions, ...value.output_actions },
  };
  delete (merged as Policy & { version?: number }).version;
  return merged;
}

export default function GuardrailSettingsPanel({
  organizationId,
  token,
}: {
  organizationId: string;
  token: string;
}) {
  const [policy, setPolicy] = useState<Policy>(defaultPolicy);
  const [allowedTopicsText, setAllowedTopicsText] = useState("");
  const [restrictedTopicsText, setRestrictedTopicsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [activeView, setActiveView] = useState<"overview" | "topicality" | "organization" | "input" | "streaming" | "documents" | "output">("overview");
  const auditPage = 1;
  const auditPageSize = 10;


  useEffect(() => {
    let active = true;
    fetch(API + "/api/v1/organizations/" + organizationId + "/guardrails", {
      headers: { Authorization: "Bearer " + token }, cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || "Could not load guardrail settings.");
        if (!active) return;
        const next = mergePolicy(data.effective_policy);
        setPolicy(next);
        setAllowedTopicsText(next.allowed_topics.join("\\n"));
        setRestrictedTopicsText(next.restricted_topics.join("\\n"));
        return fetch(API + "/api/v1/organizations/" + organizationId + "/guardrails/audit?limit=25", {
          headers: { Authorization: "Bearer " + token }, cache: "no-store",
        });
      })
      .then(async (response) => {
        if (!response || !response.ok || !active) return;
        const data = await response.json();
        setAuditEvents(Array.isArray(data.events) ? data.events : []);
      })
      .catch((err) => { if (active) setError((err as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organizationId, token]);

  const mandatoryOutput = useMemo(() => new Set(["pii_leakage", "secret_leakage", "system_prompt_leakage"]), []);
  const lockedOutputActions = useMemo(() => new Set(["secret_leakage", "system_prompt_leakage"]), []);
  const mandatoryInputActions = useMemo(() => new Set(["direct_jailbreak", "indirect_prompt_injection"]), []);
  const mandatoryInput = useMemo(() => new Set(["direct_jailbreak", "indirect_prompt_injection"]), []);

  function updateMap(
    mapName: "input_enabled" | "output_enabled" | "input_actions" | "output_actions",
    key: string,
    value: boolean | Action,
  ) {
    setPolicy((current) => ({
      ...current,
      [mapName]: { ...current[mapName], [key]: value },
    }));
  }

  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    const payload = {
      ...policy,
      allowed_topics: allowedTopicsText.split("\n").map((item) => item.trim()).filter(Boolean),
      restricted_topics: restrictedTopicsText.split("\n").map((item) => item.trim()).filter(Boolean),
    };
    try {
      const response = await fetch(API + "/api/v1/organizations/" + organizationId + "/guardrails", {
        method: "PATCH",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Could not save guardrail settings.");
      const next = mergePolicy(data.effective_policy);
      setPolicy(next);
      setAllowedTopicsText(next.allowed_topics.join("\n"));
      setRestrictedTopicsText(next.restricted_topics.join("\n"));
      setSuccess("Guardrail policy saved. New requests will use this policy snapshot.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="sc-empty">Loading guardrail policy…</div>;

  return (
    <form onSubmit={savePolicy} className="sc-neutral-settings sc-guardrails-form space-y-6">
      <header className="sc-section-heading sc-guardrails-header">
        <div className="sc-guardrails-heading-copy">
          <p className="sc-kicker">SECURITY & GOVERNANCE <span className="sc-guardrails-header-dot">/</span> ORGANIZATION SETTINGS</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">Guardrail policy</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Set how SaviraCortex handles sensitive information, unsafe requests, and organization-specific boundaries. Platform protections always remain active.
          </p>
        </div>
        <span className="sc-guardrails-protected"><span aria-hidden="true">✓</span> Platform protected</span>
      </header>

      <section className="sc-guardrails-overview" aria-label="Guardrail policy overview">
        <div className="sc-guardrails-overview-item"><span className="sc-guardrails-overview-label">INPUT CHECKS</span><strong>{policy.input_guardrails_enabled ? inputCategories.length : mandatoryInput.size}</strong><span>{policy.input_guardrails_enabled ? "Organization checks active" : "Platform checks retained"}</span></div>
        <div className="sc-guardrails-overview-item"><span className="sc-guardrails-overview-label">OUTPUT CHECKS</span><strong>{policy.output_guardrails_enabled ? outputCategories.length : mandatoryOutput.size}</strong><span>{policy.output_guardrails_enabled ? "Organization checks active" : "Platform checks retained"}</span></div>
        <div className="sc-guardrails-overview-item"><span className="sc-guardrails-overview-label">TOPICALITY</span><strong>{policy.topicality_enabled ? "On" : "Off"}</strong><span>Organization topic boundaries</span></div>
        <div className="sc-guardrails-overview-item"><span className="sc-guardrails-overview-label">LOCKED PROTECTIONS</span><strong>03</strong><span>Always enforced by platform</span></div>
      </section>

      {activeView === "overview" && (
        <section className="sc-guardrails-navigation" aria-label="Guardrail settings sections">
          <div className="sc-guardrails-navigation-heading"><div><p className="sc-kicker">POLICY CONTROLS</p><h4>Configure guardrail areas</h4><p>Choose a section to review or update its settings.</p></div></div>
          <div className="sc-guardrails-navigation-grid">
            {([
              ["topicality", "Topicality scope", "Define allowed and restricted topics, thresholds, and off-topic responses.", "Topic boundaries"],
              ["organization", "Organization policies", "Set custom instructions for incoming requests and generated responses.", "Custom rules"],
              ["input", "Input privacy & guardrails", "Manage PII consent and checks for incoming messages.", "Incoming protection"],
              ["streaming", "Output streaming", "Choose how response segments are reviewed before being shown.", "Display strategy"],
              ["documents", "Ingestion & retrieval", "Configure document upload inspection and retrieved-chunk filtering.", "Document pipeline"],
              ["output", "Output guardrails", "Inspect generated content and set actions for policy violations.", "Response protection"],
            ] as const).map(([view, title, description, tag]) => (
              <button type="button" key={view} onClick={() => setActiveView(view)} className="sc-guardrails-nav-card">
                <span className="sc-guardrails-nav-card-top"><span>{tag}</span><span aria-hidden="true">↗</span></span>
                <strong>{title}</strong><span className="sc-guardrails-nav-card-description">{description}</span>
                <span className="sc-guardrails-nav-card-action">Open settings <span aria-hidden="true">→</span></span>
              </button>
            ))}
          </div>
        </section>
      )}

      {activeView !== "overview" && <button type="button" className="sc-guardrails-back" onClick={() => setActiveView("overview")} aria-label="Back to guardrail overview">← Back to guardrail overview</button>}

            {activeView === "topicality" && (
        <section className="sc-detail-panel space-y-4">
        <div>
          <p className="sc-kicker">TOPICALITY SCOPE</p>
          <h4 className="mt-2 text-base font-semibold text-white">What can this assistant help with?</h4>
          <p className="mt-1 text-xs leading-5 text-slate-500">Add one topic or short description per line. The assistant uses semantic similarity first, then JEV for ambiguous scores.</p>
        </div>
        <label className="block">
          <span className="sc-field-label">Allowed topics</span>
          <textarea rows={4} maxLength={12000} value={allowedTopicsText} onChange={(event) => setAllowedTopicsText(event.target.value)}
            placeholder={"Company policies\nHuman resources and leave\nProduct documentation"} className="sc-input h-auto min-h-28 py-3" />
        </label>
        <label className="block">
          <span className="sc-field-label">Restricted topics (optional)</span>
          <textarea rows={3} maxLength={12000} value={restrictedTopicsText} onChange={(event) => setRestrictedTopicsText(event.target.value)}
            placeholder={"Personal legal advice\nIndividual medical diagnosis"} className="sc-input h-auto min-h-20 py-3" />
        </label>
        <label className="block">
          <span className="sc-field-label">Off-topic response</span>
          <textarea rows={2} maxLength={1000} value={policy.off_topic_message} onChange={(event) => setPolicy((current) => ({ ...current, off_topic_message: event.target.value }))}
            className="sc-input h-auto py-3" />
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block"><span className="sc-field-label">On-topic threshold</span><input type="number" min="0.01" max="1" step="0.01" value={policy.topicality_high_threshold} onChange={(event) => setPolicy((current) => ({ ...current, topicality_high_threshold: Number(event.target.value) }))} className="sc-input" /></label>
          <label className="block"><span className="sc-field-label">Off-topic threshold</span><input type="number" min="0" max="0.99" step="0.01" value={policy.topicality_low_threshold} onChange={(event) => setPolicy((current) => ({ ...current, topicality_low_threshold: Number(event.target.value) }))} className="sc-input" /></label>
          <label className="block"><span className="sc-field-label">History exchanges</span><input type="number" min="0" max="20" step="1" value={policy.history_window_exchanges} onChange={(event) => setPolicy((current) => ({ ...current, history_window_exchanges: Number(event.target.value) }))} className="sc-input" /></label>
        </div>
        <p className="text-[11px] leading-5 text-slate-500">Similarity uses a 0–1 scale: 0.60 means 60% (on-topic); 0.20 means 20% (off-topic). Values between the thresholds go to JEV.</p>
        <label className="flex items-center gap-3 text-sm text-slate-300"><input type="checkbox" checked={policy.topicality_enabled} onChange={(event) => setPolicy((current) => ({ ...current, topicality_enabled: event.target.checked }))} className="h-4 w-4 accent-cyan-400" /> Enable organization topicality checks</label>
      </section>
      )}


            {activeView === "organization" && (
        <section className="sc-detail-panel space-y-4">
        <div><p className="sc-kicker">ORGANIZATION POLICIES</p><h4 className="mt-2 text-base font-semibold text-white">Custom policy instructions</h4><p className="mt-1 text-xs leading-5 text-slate-500">Describe additional organization rules in plain language. Output review receives both input and output policies; input review receives input policy only.</p></div>
        <label className="block"><span className="sc-field-label">Input policy</span><textarea rows={4} maxLength={5000} value={policy.custom_input_policy} onChange={(event) => setPolicy((current) => ({ ...current, custom_input_policy: event.target.value }))} placeholder="Requests involving confidential employee records must be handled according to the organization's privacy policy." className="sc-input h-auto py-3" /></label>
        <label className="block"><span className="sc-field-label">Output policy</span><textarea rows={4} maxLength={5000} value={policy.custom_output_policy} onChange={(event) => setPolicy((current) => ({ ...current, custom_output_policy: event.target.value }))} placeholder="Do not disclose internal-only procedures or information outside the requester's authorization." className="sc-input h-auto py-3" /></label>
      </section>
      )}


            {activeView === "input" && (
        <section className="sc-detail-panel space-y-4">
        <div><p className="sc-kicker">INPUT PRIVACY</p><h4 className="mt-2 text-base font-semibold text-white">Personal information handling</h4></div>
        <label className="flex items-start gap-3 text-sm text-slate-300"><input type="checkbox" checked={policy.pii_require_consent} onChange={(event) => setPolicy((current) => ({ ...current, pii_require_consent: event.target.checked }))} className="mt-0.5 h-4 w-4 accent-cyan-400" /><span><strong className="font-medium text-white">Require user consent</strong><span className="mt-0.5 block text-xs text-slate-500">Pause the request when PII is detected, before sending it to the assistant. If disabled, detected values are automatically redacted.</span></span></label>
        <label className="flex items-start gap-3 text-sm text-slate-300"><input type="checkbox" checked={policy.pii_allow_send_as_is} onChange={(event) => setPolicy((current) => ({ ...current, pii_allow_send_as_is: event.target.checked }))} className="mt-0.5 h-4 w-4 accent-cyan-400" /><span><strong className="font-medium text-white">Allow explicit send-as-is consent</strong><span className="mt-0.5 block text-xs text-slate-500">If disabled, users can redact or cancel, but cannot send detected PII unchanged.</span></span></label>
      </section>
      )}


            {activeView === "input" && (
        <section className="sc-detail-panel">
        <div className="mb-4"><p className="sc-kicker">INPUT GUARDRAILS</p><h4 className="mt-2 text-base font-semibold text-white">Inspect incoming messages</h4><p className="mt-1 text-xs text-slate-500">Turn off organization-configurable input checks while retaining platform-required prompt-injection and PII protections.</p></div>
        <label className="mb-3 flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm text-slate-200">
          <input type="checkbox" checked={policy.input_guardrails_enabled} onChange={(event) => setPolicy((current) => ({ ...current, input_guardrails_enabled: event.target.checked }))} className="mt-0.5 h-4 w-4 accent-cyan-400" />
          <span><strong className="block font-medium text-white">Enable organization input guardrails</strong><span className="mt-0.5 block text-xs leading-5 text-slate-500">When disabled, optional input classifications, topicality and custom input policies are skipped. Platform-required checks remain active.</span></span>
        </label>
        <div className="divide-y divide-white/[0.07]">
          {inputCategories.map(([key, label, description]) => (
            <div key={key} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <label className="flex min-w-0 flex-1 items-start gap-3">
                <input type="checkbox" checked={mandatoryInput.has(key) || policy.input_enabled[key] !== false} disabled={mandatoryInput.has(key) || !policy.input_guardrails_enabled} onChange={(event) => updateMap("input_enabled", key, event.target.checked)} className="mt-1 h-4 w-4 accent-cyan-400 disabled:opacity-70" />
                <span><strong className="block text-sm font-medium text-slate-200">{label}</strong><span className="mt-0.5 block text-xs leading-5 text-slate-500">{description}</span></span>
              </label>
              <select aria-label={label + " action"} value={mandatoryInputActions.has(key) ? "block" : policy.input_actions[key] || "block"} disabled={mandatoryInputActions.has(key)} onChange={(event) => updateMap("input_actions", key, event.target.value as Action)} className="sc-select disabled:opacity-60">
                <option value="block">Block</option><option value="allow">Allow</option>
              </select>
            </div>
          ))}
        </div>
      </section>
      )}


            {activeView === "streaming" && (
        <section className="sc-detail-panel space-y-4">
        <div><p className="sc-kicker">OUTPUT STREAMING EXPERIENCE</p><h4 className="mt-2 text-base font-semibold text-white">Choose when generated text becomes visible</h4><p className="mt-1 text-xs leading-5 text-slate-500">The platform default checks each segment before display. Optimistic mode displays before background review and may retract content after detection. Bucket mode waits for a token window to pass review.</p></div>
        <label className="block"><span className="sc-field-label">Streaming strategy</span>
          <select value={policy.output_guardrails_enabled ? policy.output_streaming_mode : "none"} disabled={!policy.output_guardrails_enabled} onChange={(event) => setPolicy((current) => ({ ...current, output_streaming_mode: event.target.value as Policy["output_streaming_mode"] }))} className="sc-select w-full disabled:cursor-not-allowed disabled:opacity-60">
            <option value="none">None — organization output guardrails disabled</option>
            <option value="segment">Strict — check before display (default)</option>
            <option value="optimistic">Optimistic — display immediately, review in background</option>
            <option value="bucket">Bucket — collect, review, then display</option>
          </select>
        </label>
        {!policy.output_guardrails_enabled && <p className="text-[11px] leading-5 text-slate-500">No organization output-guardrail streaming strategy is active. Platform-mandated protections remain enforced. Your previously selected strategy is preserved and will return if output guardrails are re-enabled.</p>}
        {policy.output_guardrails_enabled && policy.output_streaming_mode === "bucket" && <div className="grid gap-4 sm:grid-cols-2">
          <label className="block"><span className="sc-field-label">Minimum bucket tokens</span><input type="number" min="16" max="8192" step="16" value={policy.output_bucket_min_tokens} onChange={(event) => setPolicy((current) => ({ ...current, output_bucket_min_tokens: Number(event.target.value) }))} className="sc-input" /></label>
          <label className="block"><span className="sc-field-label">Maximum bucket tokens</span><input type="number" min="32" max="16384" step="32" value={policy.output_bucket_max_tokens} onChange={(event) => setPolicy((current) => ({ ...current, output_bucket_max_tokens: Number(event.target.value) }))} className="sc-input" /></label>
        </div>}
        <p className="text-[11px] leading-5 text-amber-200/80">Platform-mandated secret and credential protections remain pre-display in every mode. Optimistic UI suppression cannot undo content already seen or copied. Full-response validation remains enabled.</p>
      </section>
      )}


            {activeView === "documents" && (
        <section className="sc-detail-panel space-y-4">
        <div><p className="sc-kicker">DOCUMENT PIPELINE GUARDRAILS</p><h4 className="mt-2 text-base font-semibold text-white">Control ingestion and retrieval checks</h4><p className="mt-1 text-xs leading-5 text-slate-500">These controls are independent from chat input and output guardrails.</p></div>
        <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm text-slate-200">
          <input type="checkbox" checked={policy.ingestion_guardrails_enabled} onChange={(event) => setPolicy((current) => ({ ...current, ingestion_guardrails_enabled: event.target.checked }))} className="mt-0.5 h-4 w-4 accent-cyan-400" />
          <span><strong className="block font-medium text-white">Enable ingestion guardrails</strong><span className="mt-0.5 block text-xs leading-5 text-slate-500">When disabled, document prompt-injection inspection is skipped during upload and analysis. File validation, access control and ingestion processing continue.</span></span>
        </label>
        <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm text-slate-200">
          <input type="checkbox" checked={policy.retrieval_guardrails_enabled} onChange={(event) => setPolicy((current) => ({ ...current, retrieval_guardrails_enabled: event.target.checked }))} className="mt-0.5 h-4 w-4 accent-cyan-400" />
          <span><strong className="block font-medium text-white">Enable retrieval guardrails</strong><span className="mt-0.5 block text-xs leading-5 text-slate-500">When disabled, flagged retrieved chunks are not filtered and can be passed into the generation pipeline. When enabled, ingestion-flagged chunks are excluded before context construction.</span></span>
        </label>
      </section>
      )}


            {activeView === "output" && (
        <section className="sc-detail-panel">
        <div className="mb-4"><p className="sc-kicker">OUTPUT GUARDRAILS</p><h4 className="mt-2 text-base font-semibold text-white">Inspect generated responses</h4><p className="mt-1 text-xs text-slate-500">Control organization-configurable output checks independently from input checks.</p></div>
        <label className="mb-3 flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm text-slate-200">
          <input type="checkbox" checked={policy.output_guardrails_enabled} onChange={(event) => setPolicy((current) => ({ ...current, output_guardrails_enabled: event.target.checked }))} className="mt-0.5 h-4 w-4 accent-cyan-400" />
          <span><strong className="block font-medium text-white">Enable organization output guardrails</strong><span className="mt-0.5 block text-xs leading-5 text-slate-500">When disabled, optional output classifications, grounding, topicality and custom output policies are skipped. Platform-required PII, secret and hidden-prompt protections remain active.</span></span>
        </label>
        <div className="divide-y divide-white/[0.07]">
          {outputCategories.map(([key, label, description]) => {
            const mandatory = mandatoryOutput.has(key);
            return (
              <div key={key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <label className="flex min-w-0 flex-1 items-start gap-3">
                  <input type="checkbox" checked={mandatory || policy.output_enabled[key] !== false} disabled={mandatory || !policy.output_guardrails_enabled}
                    onChange={(event) => updateMap("output_enabled", key, event.target.checked)} className="mt-1 h-4 w-4 accent-cyan-400 disabled:opacity-70" />
                  <span><strong className="block text-sm font-medium text-slate-200">{label}{mandatory && <span className="ml-2 text-[10px] uppercase tracking-wider text-cyan-300">Platform required</span>}</strong><span className="mt-0.5 block text-xs leading-5 text-slate-500">{description}</span></span>
                </label>
                <select aria-label={label + " action"} value={lockedOutputActions.has(key) ? "block" : policy.output_actions[key] || "block"} disabled={lockedOutputActions.has(key)}
                  onChange={(event) => updateMap("output_actions", key, event.target.value as Action)} className="sc-select disabled:opacity-60">
                  <option value="block">Block</option><option value="redact">Redact when a safe span is available</option>{key !== "pii_leakage" && <option value="allow">Allow</option>}
                </select>
              </div>
            );
          })}
        </div>
      </section>
      )}


      {error && <p role="alert" className="sc-inline-error">{error}</p>}
      {success && <p role="status" className="sc-inline-success">{success}</p>}
      {activeView === "overview" && (
      <section className="sc-detail-panel sc-guardrails-audit">
        <div className="mb-4"><p className="sc-kicker">AUDIT & MONITORING</p><h4 className="mt-2 text-base font-semibold text-white">Recent guardrail decisions</h4><p className="mt-1 text-xs text-slate-500">Audit records contain request IDs, stages, decisions, and categories—not raw user prompts or generated answers.</p></div>
        {auditEvents.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-500">No guardrail events recorded yet.</p>
        ) : (
          <div className="divide-y divide-white/[0.07]">
            {auditEvents.slice((auditPage - 1) * auditPageSize, auditPage * auditPageSize).map((event) => (
              <div key={event.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-200">{event.stage.replaceAll("_", " ")} · {event.decision}</p>
                  <p className="mt-1 break-words text-xs text-slate-500">{event.categories.join(", ") || "No categories triggered"}</p>
                </div>
                <time className="text-[11px] text-slate-500" dateTime={event.created_at || undefined}>{event.created_at ? new Date(event.created_at).toLocaleString() : "—"}</time>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {activeView !== "overview" && <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs leading-5 text-slate-500">Policy changes apply to new requests. Each active request keeps the policy snapshot it started with.</p>
        <button type="submit" disabled={saving || policy.topicality_low_threshold >= policy.topicality_high_threshold || (policy.output_streaming_mode === "bucket" && (policy.output_bucket_min_tokens < 16 || policy.output_bucket_max_tokens > 16384 || policy.output_bucket_min_tokens > policy.output_bucket_max_tokens))}
          className="sc-action-button">{saving ? "Saving policy…" : "Save guardrail policy"}</button>
      </div>}
    </form>
  );
}
