# SaviraCortex frontend

## Local setup

1. Create a Firebase **Web app** in the same Firebase project used by the backend Admin SDK.
2. In Firebase Console, open **Authentication → Get started → Sign-in method** and enable **Email/Password**.
3. Copy `firebase-config.example.txt` to `.env.local` and fill in the web-app values from **Project settings → General → Your apps → Web app**. Do not put the Admin SDK service-account JSON or private key in the frontend.
4. Ensure the backend is running at `http://localhost:8000`, or set `NEXT_PUBLIC_API_BASE_URL` to its base URL.
5. Restart the Next.js dev server after changing `.env.local`.

The browser registration flow is:

- Firebase client SDK creates the user and sends the email-verification message.
- After verification, the client obtains a Firebase ID token.
- The client calls `POST /api/v1/auth/organizations/signup` with
  `Authorization: Bearer <Firebase ID token>` and JSON:
  `{"organization_name":"...","admin_name":"..."}`.
- FastAPI verifies the ID token, requires `email_verified=true`, and creates the user, organization, and initial `admin` membership in one database transaction.

The endpoint is documented in the backend Swagger UI at
`http://localhost:8000/api/v1/docs`.

Firebase client configuration is public web-app configuration, not a secret. The backend service-account file is private and must remain backend-only.
