# SaviraCortex Frontend Design Context

## Product
SaviraCortex is a multi-tenant enterprise knowledge assistant. Organization owners and admins manage their assistant, knowledge, people, access, and security policy. Members primarily use the chat experience.

## Visual direction
- Preserve the existing SaviraCortex visual language: restrained dark workspace chrome, neutral content surfaces, cyan accents, and clear typography.
- Prefer information-dense but calm settings layouts with clear section hierarchy and short explanatory copy.
- Use existing workspace primitives and CSS classes before introducing new global styles.
- Keep user-facing safety and consent interactions neutral, explicit, and accessible. Use warning color only for genuine privacy or safety attention.

## Interaction principles
- Explain what a policy does before exposing its controls.
- Distinguish platform-mandated protections from tenant-configurable settings.
- Disable controls that tenants cannot change and explain why.
- Show save/loading/error states; never imply a policy was saved before the API confirms it.
- Preserve typed input on failed saves.
- Consent must be explicit and scoped to the current message; never preselect sending detected PII unchanged.

## Accessibility
- Use semantic forms, labels, field descriptions, alert roles for errors, and status roles for successful saves.
- Dialogs must expose dialog role, aria-modal, a title, and a description.
- Controls must have visible focus styles and accessible names.
