# SaviraCortex Frontend

Next.js App Router frontend for SaviraCortex.

## Local setup

1. Create a Firebase **Web app** in the same Firebase project used by the backend Admin SDK.
2. In Firebase Console, enable the Authentication providers used by the app: **Email/Password**, **Google** and **Phone**.
3. Copy `firebase-config.example.txt` to `.env.local` and fill in the web-app values from **Project settings → General → Your apps → Web app**.
4. Set `NEXT_PUBLIC_API_BASE_URL` if the backend is not running at `http://localhost:8000`.
5. Start the backend and frontend in separate terminals. Restart Next.js after changing `.env.local`.

Do not put the Admin SDK service-account JSON or private key in the frontend. The `NEXT_PUBLIC_FIREBASE_*` values are Firebase browser-app configuration, not Admin credentials.

## Run locally

```powershell
npm install
npm run dev
```

Open http://localhost:3000.

## Frontend routes

- `/`: public SaviraCortex homepage.
- `/login`: Email/Password, Google and Phone sign-in.
- `/register`: identity registration, email verification or phone verification, then organization signup.
- `/dashboard`: authenticated organization overview and department management.

## Authentication and organization signup

The browser Firebase SDK creates/authenticates the identity and obtains a Firebase ID token. Email registration sends a verification email; phone registration confirms an SMS verification code. Google uses Firebase popup authentication.

After identity verification, the frontend calls:

`POST /api/v1/auth/organizations/signup`

with `Authorization: Bearer <Firebase ID token>` and JSON:

```json
{
  "organization_name": "Example Organization",
  "admin_name": "Initial Administrator"
}
```

FastAPI verifies the Firebase ID token and the signup service validates the trusted identity claims before creating the SaviraCortex user, organization and initial membership in a database transaction.

## Dashboard department API

The dashboard calls `GET /api/v1/auth/me` to retrieve the authenticated user and organization memberships.

For each organization, it calls:
- `GET /api/v1/organizations/{organization_id}/departments`
- `POST /api/v1/organizations/{organization_id}/departments`

Department creation is restricted by the backend to organization owners/admins. The dashboard hides the form from ordinary members as a usability measure; the backend remains the authorization boundary.

The API is documented at http://localhost:8000/api/v1/docs.
