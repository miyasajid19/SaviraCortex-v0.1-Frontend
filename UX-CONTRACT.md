# SaviraCortex UX Contract

## Organization guardrail settings
- Visible to organization owners and admins only.
- Fetch and update policy through organization-scoped authenticated API endpoints.
- Display effective platform defaults when no tenant override exists.
- Tenant policy changes apply to new requests; an active request retains its resolved policy snapshot.
- Mandatory platform checks are visible but not editable.

## PII consent
- A detected-PII request pauses before agent execution and before conversation persistence.
- The user can redact and send, explicitly send as-is only when tenant policy allows it, or cancel.
- Retrying after consent reuses the original request ID and does not duplicate the user message.
- The redacted preview must not reveal the original detected values.
- Cancellation removes the pending local user message and never sends it to the agent.

## Streaming
- AI SDK UI `useChat` owns client-side chat messages, submission/streaming/ready/error status, cancellation, and stream consumption.
- The Next.js `/api/chat` route adapts the existing organization-scoped FastAPI SSE endpoint to the AI SDK UI message-stream protocol. It forwards the Firebase bearer token; FastAPI remains responsible for identity verification and organization membership.
- The request contains only the latest user message plus the organization, conversation, request, and PII-consent identifiers. The backend remains the source of truth for conversation history and persistence.
- Only server-approved deltas are rendered. The adapter closes provisional text and replaces it with the complete validated response on completion.
- An error or guardrail block removes the provisional assistant message and preserves the existing user-facing error behavior.
- PII consent is delivered as a transient SDK data part. Retrying reuses the original user-message ID and request ID; it must not duplicate the user message or persist the original PII-bearing input before consent.
- Status, PII-consent, generation-error, and redacted-user-message updates use typed custom data parts. Citations, guardrail indicators, feedback, markdown rendering, and PDF source viewing remain SaviraCortex-owned renderers.
- Aborting through AI SDK UI propagates through the Next.js adapter to the backend stream.
- AI SDK Core is not part of this frontend migration. Python/LangGraph continues to own model execution, RAG, tool orchestration, output validation, and persistence.


## Organization guardrail master switches

The Guardrails dashboard exposes independent `input_guardrails_enabled` and `output_guardrails_enabled` switches. Both default to enabled and are persisted with the organization policy. Turning either off disables only organization-configurable checks in that direction; it does not bypass platform-mandated prompt-injection, PII, secret/credential, or system-prompt protections. The corresponding per-category controls remain saved and resume when the master switch is enabled again.


### Ingestion and retrieval guardrail controls

The Guardrail Settings panel also exposes `ingestion_guardrails_enabled` and `retrieval_guardrails_enabled`, both defaulting to ON. Turning ingestion OFF skips document prompt-injection inspection during upload analysis; turning retrieval OFF bypasses filtering of previously flagged chunks before context construction. These switches do not affect upload validation, authentication, tenant authorization, or document ACL enforcement. Retrieval ON filters chunks carrying the ingestion prompt-injection flag.
