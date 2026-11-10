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
    input_enabled, output_enabled, input_actions, output_actions,
    pii_require_consent: true, pii_allow_send_as_is: true,
    topicality_enabled: true, topicality_high_threshold: 0.6,
    topicality_low_threshold: 0.2, history_window_exchanges: 5,
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
    <form onSubmit={savePolicy} className="space-y-6">
      <header className="sc-section-heading">
        <div>
          <p className="sc-kicker">SECURITY & GOVERNANCE</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">Guardrail policy</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            Configure organization-level input and output rules. Platform-mandated protections remain enforced for every tenant.
          </p>
        </div>
        <span className="sc-count-chip">Platform protected</span>
      </header>

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

      <section className="sc-detail-panel space-y-4">
        <div><p className="sc-kicker">ORGANIZATION POLICIES</p><h4 className="mt-2 text-base font-semibold text-white">Custom policy instructions</h4><p className="mt-1 text-xs leading-5 text-slate-500">Describe additional organization rules in plain language. Output review receives both input and output policies; input review receives input policy only.</p></div>
        <label className="block"><span className="sc-field-label">Input policy</span><textarea rows={4} maxLength={5000} value={policy.custom_input_policy} onChange={(event) => setPolicy((current) => ({ ...current, custom_input_policy: event.target.value }))} placeholder="Requests involving confidential employee records must be handled according to the organization's privacy policy." className="sc-input h-auto py-3" /></label>
        <label className="block"><span className="sc-field-label">Output policy</span><textarea rows={4} maxLength={5000} value={policy.custom_output_policy} onChange={(event) => setPolicy((current) => ({ ...current, custom_output_policy: event.target.value }))} placeholder="Do not disclose internal-only procedures or information outside the requester's authorization." className="sc-input h-auto py-3" /></label>
      </section>

      <section className="sc-detail-panel space-y-4">
        <div><p className="sc-kicker">INPUT PRIVACY</p><h4 className="mt-2 text-base font-semibold text-white">Personal information handling</h4></div>
        <label className="flex items-start gap-3 text-sm text-slate-300"><input type="checkbox" checked={policy.pii_require_consent} onChange={(event) => setPolicy((current) => ({ ...current, pii_require_consent: event.target.checked }))} className="mt-0.5 h-4 w-4 accent-cyan-400" /><span><strong className="font-medium text-white">Require user consent</strong><span className="mt-0.5 block text-xs text-slate-500">Pause the request when PII is detected, before sending it to the assistant. If disabled, detected values are automatically redacted.</span></span></label>
        <label className="flex items-start gap-3 text-sm text-slate-300"><input type="checkbox" checked={policy.pii_allow_send_as_is} onChange={(event) => setPolicy((current) => ({ ...current, pii_allow_send_as_is: event.target.checked }))} className="mt-0.5 h-4 w-4 accent-cyan-400" /><span><strong className="font-medium text-white">Allow explicit send-as-is consent</strong><span className="mt-0.5 block text-xs text-slate-500">If disabled, users can redact or cancel, but cannot send detected PII unchanged.</span></span></label>
      </section>

      <section className="sc-detail-panel">
        <div className="mb-4"><p className="sc-kicker">INPUT GUARDRAILS</p><h4 className="mt-2 text-base font-semibold text-white">Inspect incoming messages</h4><p className="mt-1 text-xs text-slate-500">Semantic checks are performed by JEV. PII is handled separately through Presidio and consent.</p></div>
        <div className="divide-y divide-white/[0.07]">
          {inputCategories.map(([key, label, description]) => (
            <div key={key} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <label className="flex min-w-0 flex-1 items-start gap-3">
                <input type="checkbox" checked={mandatoryInput.has(key) || policy.input_enabled[key] !== false} disabled={mandatoryInput.has(key)} onChange={(event) => updateMap("input_enabled", key, event.target.checked)} className="mt-1 h-4 w-4 accent-cyan-400 disabled:opacity-70" />
                <span><strong className="block text-sm font-medium text-slate-200">{label}</strong><span className="mt-0.5 block text-xs leading-5 text-slate-500">{description}</span></span>
              </label>
              <select aria-label={label + " action"} value={mandatoryInputActions.has(key) ? "block" : policy.input_actions[key] || "block"} disabled={mandatoryInputActions.has(key)} onChange={(event) => updateMap("input_actions", key, event.target.value as Action)} className="sc-select disabled:opacity-60">
                <option value="block">Block</option><option value="allow">Allow</option>
              </select>
            </div>
          ))}
        </div>
      </section>

      <section className="sc-detail-panel">
        <div className="mb-4"><p className="sc-kicker">OUTPUT GUARDRAILS</p><h4 className="mt-2 text-base font-semibold text-white">Inspect generated responses</h4><p className="mt-1 text-xs text-slate-500">Every stream segment is checked before release. The complete answer is checked again before persistence and completion.</p></div>
        <div className="divide-y divide-white/[0.07]">
          {outputCategories.map(([key, label, description]) => {
            const mandatory = mandatoryOutput.has(key);
            return (
              <div key={key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <label className="flex min-w-0 flex-1 items-start gap-3">
                  <input type="checkbox" checked={mandatory || policy.output_enabled[key] !== false} disabled={mandatory}
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

      {error && <p role="alert" className="sc-inline-error">{error}</p>}
      {success && <p role="status" className="sc-inline-success">{success}</p>}
      <section className="sc-detail-panel">
        <div className="mb-4"><p className="sc-kicker">AUDIT & MONITORING</p><h4 className="mt-2 text-base font-semibold text-white">Recent guardrail decisions</h4><p className="mt-1 text-xs text-slate-500">Audit records contain request IDs, stages, decisions, and categories—not raw user prompts or generated answers.</p></div>
        {auditEvents.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-500">No guardrail events recorded yet.</p>
        ) : (
          <div className="divide-y divide-white/[0.07]">
            {auditEvents.map((event) => (
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs leading-5 text-slate-500">Policy changes apply to new requests. Each active request keeps the policy snapshot it started with.</p>
        <button type="submit" disabled={saving || policy.topicality_low_threshold >= policy.topicality_high_threshold}
          className="sc-action-button">{saving ? "Saving policy…" : "Save guardrail policy"}</button>
      </div>
    </form>
  );
}
