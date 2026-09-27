# Solvani for iOS

Native iPhone client for the existing private workspace. It uses the existing authenticated `/api/assistant` endpoint; data and service keys are never copied to the app.

V1 includes Supabase sign-in, encrypted session storage, Face ID, and the two Notiscenter views. “Inte relevant” updates the existing learning and task records immediately. It never sends messages, books meetings, or performs browser actions.

For TestFlight, copy `.env.example` to `.env` with only the public Supabase URL and publishable key, then configure Apple/EAS signing for `com.victoriny.communicationintelligence`. Push credentials are intentionally enabled only after the first signed build; push payloads will contain a neutral alert, never message content.
