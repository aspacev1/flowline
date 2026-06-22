# Registration, OAuth Login & Team Invites — Design

Status: Approved by user, ready for implementation planning.
Date: 2026-06-22

## Goal

Replace Flowline's current email/password-only registration with:
1. Login/registration via Google, Apple, Microsoft OAuth, or email/password.
2. A post-registration onboarding step collecting full name, position, and (for org founders) company name.
3. An optional "invite teammates" step after onboarding, with two invite mechanisms: a shareable generic org-join link, and direct email invites.
4. Invited users land in the inviting org automatically, skipping company-name entry and the invite-teammates step.

## Data Model Changes

### `users` table
- Add `position` (text, nullable) — job title.
- Remove reliance on a single `auth_provider` column (doesn't exist yet to remove, just don't add one) — login methods live in `user_identities` instead, since one user can have multiple (password + one or more OAuth providers).
- `password_hash` is currently `NOT NULL` (`db/schema.sql:31`) — migrate it to nullable, since OAuth-only users never set a password. Login code must treat `null` as "password login unavailable for this account" rather than attempting `bcrypt.compare`.

### New table: `user_identities`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid fk -> users | |
| provider | text | `password`, `google`, `apple`, `microsoft` |
| provider_user_id | text | null for `password` |
| email | text | the email reported by that provider/method |
| created_at | timestamptz | |

Unique constraint on `(provider, provider_user_id)` where `provider_user_id is not null`. Password identity is effectively a marker row; the actual password hash stays on `users.password_hash` (existing column) to avoid disturbing existing login code more than necessary.

### `organizations` table
No schema change. `name` is set from the onboarding "Company name" field at creation time.

### New table: `org_invites`
One row per organization — the standing "generic join link."

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| organization_id | uuid fk -> organizations, unique | one active link per org |
| token | text, unique | crypto-random, base64url, 32 bytes |
| created_by | uuid fk -> users | |
| expires_at | timestamptz | default now() + 30 days |
| revoked_at | timestamptz, nullable | set on regenerate |
| created_at | timestamptz | |

Regenerating the link = revoke old row, insert new row (or update token + reset expiry in place — implementation detail, behavior is "old link stops working").

### New table: `org_invite_emails`
Tracks specific email invites sent via the "type emails" path.

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| organization_id | uuid fk -> organizations | |
| email | text | |
| invited_by | uuid fk -> users | |
| status | text | `pending` \| `accepted` |
| created_at | timestamptz | |
| accepted_at | timestamptz, nullable | |

No uniqueness constraint forcing one invite per email — re-inviting just adds another row; acceptance matching is by email + org on signup.

## Auth & Registration Flow

### OAuth (Google / Apple / Microsoft)
- `GET /auth/oauth/:provider/start` — builds provider authorization URL with a CSRF `state` param (and OIDC `nonce` where applicable), redirects browser.
- `GET /auth/oauth/:provider/callback` — validates `state`, exchanges code for tokens, verifies ID token / fetches profile, extracts verified email + name.
  - If `user_identities` has a row for `(provider, provider_user_id)` → log in as that user.
  - Else if a `users` row exists with that verified email → create a new `user_identities` row linking this provider to the existing user (auto-link), log in.
  - Else → create a new `users` row + `user_identities` row. This user is "new" (no org yet).
  - Issue the same JWT httpOnly cookie used today.
- Apple-specific: client secret is a JWT signed server-side with the Apple private key (`APPLE_KEY_ID`, `APPLE_TEAM_ID`, `APPLE_PRIVATE_KEY` env vars), generated fresh per request — not a static secret.
- Env vars (all required for that provider to be enabled; if unset, hide that login button rather than erroring):
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`
  - `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`
  - `OAUTH_REDIRECT_BASE_URL` (shared, e.g. `https://app.example.com`)

### Email/password
Existing register/login endpoints stay, but registration now creates the `users` row + a `password` `user_identities` row and stops short of creating an organization. Org creation moves to the onboarding step for everyone (OAuth and password alike), so both paths converge on the same "new user, no org yet" state.

### Onboarding
- `GET /invites/resolve/:token` — public. Given an invite token (from the URL query param `?invite=...`), returns the target org's name for display ("You're joining **Acme Inc**"). 404/expired if invalid or revoked.
- `POST /auth/onboarding` — requires auth (the JWT cookie from the just-completed register/OAuth step). Body: `{ fullName, position, companyName?, inviteToken? }`.
  - If `inviteToken` present and valid: resolve org from token, create `organization_members` row with role `member`, and if an `org_invite_emails` row exists for this org + the user's email, mark it `accepted`. `companyName` is ignored if provided.
  - Else: create a new `organizations` row with `name = companyName` (required in this branch). `slug` is generated by slugifying `companyName` (lowercase, non-alphanumeric → `-`) with a random/numeric suffix appended on collision, replacing today's `org-${Date.now()}` placeholder in `auth.js:51`. Create `organization_members` row with role `owner`.
  - Updates `users.full_name` (existing column) and `users.position`.
- `GET /auth/me` currently returns no organization info at all (`auth.js:128-149`) — this work must extend it to join `organization_members`/`organizations` and return `organization: { id, name } | null`. Frontend routes a freshly authenticated user with `organization: null` to the Onboarding screen automatically.
- `organizationName` is removed from the `/auth/register` request body — company name is now collected exclusively during onboarding, not at registration time.

### Invite Teammates (post-onboarding, founders only)
Shown immediately after onboarding completes, only when the user just became an `owner` (i.e., didn't join via invite token). Two tabs:
- **Copy link**: `GET /invites/link` (creates one lazily if it doesn't exist) returns `{ url }`. `POST /invites/link/regenerate` rotates it.
- **Invite by email**: `POST /invites/emails` with `{ emails: string[] }` — validates each as an email, creates `org_invite_emails` rows, sends mail via `mailer.js`.
- "Skip for now" link routes straight to the Projects screen; both invite endpoints remain available later from a new entry point on the Team screen, since any org member can invite at any time (not just at onboarding).

### Authorization for invite actions
Per decision: **any authenticated org member** may view/regenerate the link and send email invites — no owner/admin restriction. This is consistent with the rest of the app's current lack of role enforcement; this feature does not change that posture.

## Email Sending

New `backend/src/utils/mailer.js` wrapping `nodemailer` with SMTP transport. Env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. If unset, `POST /invites/emails` returns a 503 with a clear "email not configured" error rather than silently failing — matches the existing pattern of failing loudly on missing config (e.g. `JWT_SECRET`).

Invite email contains a link of the form `{FRONTEND_ORIGIN}/register?invite={org_invites.token}`. It is the same generic link mechanism — the email just pre-fills context and lets the backend mark the matching `org_invite_emails` row `accepted` on completion by matching email + org, but does not cryptographically restrict the link to that address (per "any org member" / generic-link decision — a forwarded email link still works for anyone).

## Frontend Changes

- `AuthScreen.jsx`: add three OAuth buttons (Google/Apple/Microsoft) above the existing email/password form, each redirecting to `/auth/oauth/:provider/start`. Buttons for providers with no configured client ID are hidden (backend exposes `GET /auth/oauth/providers` listing which are enabled).
- New `OnboardingScreen.jsx`: full name, position, company name (conditionally hidden + replaced with "Joining {orgName}" banner when `?invite=` is present, resolved via `GET /invites/resolve/:token` on mount).
- New `InviteTeammatesScreen.jsx`: tabbed UI (Link / Emails), "Skip for now".
- Routing: after any successful auth action (register, login via OAuth callback redirect, login via password), `GET /auth/me` determines next screen: no org → Onboarding; has org → Projects (existing behavior unchanged for current users).

## Security Notes

- Invite tokens: 32 random bytes, base64url-encoded, unguessable.
- OAuth `state` validated on callback (stored in a short-lived signed cookie, compared on return) to prevent CSRF on the OAuth flow itself.
- Apple JWT client secret generated per-request server-side, never stored as a static secret in env.
- SMTP credentials follow existing `.env` pattern; startup validation logs a warning (not a hard crash) if mail is unconfigured, since invites are optional ("skip" is a valid path).
- No change to the broader authorization gap identified in the prior product analysis (no project/org role enforcement elsewhere) — explicitly out of scope for this feature.

## Testing Plan

- Backend unit tests: invite token generation/uniqueness, `POST /auth/onboarding` org-creation vs. org-join branching, `org_invite_emails` accept-matching on signup, mailer call construction (SMTP mocked).
- Backend integration test: full OAuth callback using a mocked provider HTTP response (no live Google/Microsoft/Apple credentials required in CI).
- Frontend component tests: Onboarding screen (both branches), Invite Teammates screen (skip path, email parsing/validation, copy-link interaction).
- Manual pre-ship verification: real OAuth login against live dev credentials for all three providers, since the handshake details (redirect URIs, scopes, Apple's JWT secret) are easy to get subtly wrong and hard to fully simulate.

## Out of Scope

- Enforcing org/project role-based permissions elsewhere in the app (existing gap, unrelated to this feature).
- Multi-org membership per user (a user still belongs to exactly one org, consistent with current schema).
- Revoking/expiring individual email invites independently of the org's link.
