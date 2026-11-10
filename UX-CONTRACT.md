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
- Only server-approved deltas are rendered.
- An error or guardrail block removes the provisional assistant message.
- Completion replaces provisional text with the final validated response.
