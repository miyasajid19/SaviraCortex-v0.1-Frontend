# SaviraCortex Frontend

Next.js App Router frontend for SaviraCortex.

## Local setup

1. Create a Firebase **Web app** in the same Firebase project used by the backend Admin SDK.
2. In Firebase Console, enable the Authentication providers used by the app: **Email/Password**, **Google** and **Phone**.
3. Copy `firebase-config.example.txt` to `.env.local` and fill in the web-app values from **Project settings â†’ General â†’ Your apps â†’ Web app**.
4. Set `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000` (or the intended backend URL).
5. Start the backend and frontend in separate terminals. Restart Next.js after changing `.env.local`.

Do not put the Admin SDK service-account JSON or private key in the frontend. The `NEXT_PUBLIC_FIREBASE_*` values are Firebase browser-app configuration, not Admin credentials.

## Run locally

```powershell
npm install
npm run dev
```

Open http://localhost:3000.

## Routes

| Route | Purpose |
|---|---|
| `/` | Public SaviraCortex homepage |
| `/privacy` | Privacy Policy and browser-storage disclosures |
| `/terms` | Terms of Service |
| `/login` | Email/Password, Google and Phone sign-in |
| `/register` | Firebase registration and organization onboarding |
| `/signup` | Additional signup route |
| `/dashboard` | Authenticated organization workspace |
| `/dashboard/chat` | Organization-grounded chat UI |
| `/invitations/accept` | Invitation acceptance |

## Dashboard components

- `dashboard/page.tsx`: organization workspace, members, roles, departments and navigation.
- `dashboard/InvitationPanel.tsx`: organization invitation workflows.
- `dashboard/DocumentIngestionModal.tsx`: document upload and ingestion UI.
- `dashboard/DocumentLibrary.tsx`: document listing, detail/version history, metadata and summary editing, archive/restore and deletion.
- `BatchIngestionWidget.tsx`: batch upload progress presentation.

The batch progress widget is browser UI state; it is not a durable background job service.

## Authentication and organization signup

The browser Firebase SDK creates/authenticates the identity and obtains a Firebase ID token. Email registration sends a verification email; phone registration confirms an SMS verification code. Google uses Firebase popup authentication.

After identity verification, the frontend calls:

`POST /api/v1/auth/organizations/signup`

with `Authorization: Bearer <Firebase ID token>` and the signup request body. FastAPI verifies the token and the signup service validates trusted identity claims before creating SaviraCortex records.

## Authenticated API requests

API requests send the Firebase ID token as a Bearer token. The backend verifies identity and then checks SaviraCortex user registration, organization membership and required role. Hiding controls in the UI is only a usability feature; backend authorization remains authoritative.

Current API route families and the end-to-end architecture are documented in [the project-wide checkpoint](../backend/docs/31-project-wide-current-state.md). The live API contract is available at http://localhost:8000/api/v1/docs.