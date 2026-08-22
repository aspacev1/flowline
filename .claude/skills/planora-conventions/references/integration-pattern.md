# Adding a third-party integration

Planora has two features shaped like "connect an external service, per
organization, with a secret": the LLM/AI connection used for the AI
project-intake interview (`backend/app/ai/`), and the Jira connection used
to import/sync a project's plan from Jira Cloud/Server
(`backend/app/jira/`). They're structurally identical — same credential
model, same encrypt-at-rest rule, same SSRF guard shape, same
Protocol-backed outbound client with a recorded test double — and either is
the template to copy for anything else in this family: a new AI provider, a
chat webhook, a calendar sync, etc. This doc walks through the AI one in
detail since it came first; where Jira's version differs, it's called out
inline.

## The existing shape

- **`backend/app/models.py` → `OrgLlmCredential`** — one row per org
  (`org_id` is `unique`), holding `provider`, `base_url`, `model`, and
  `encrypted_key`. Nothing about the secret is queryable in plaintext.
- **`backend/app/crypto.py`** — `encrypt(value: str) -> str` /
  `decrypt(value: str) -> str`, Fernet symmetric encryption with a key
  derived (`SHA-256`) from `APP_SECRET`. Reuse this module rather than adding
  a second encryption scheme — it already backs two secrets, `OrgLlmCredential.encrypted_key`
  and `JiraConnection.encrypted_token`. `DecryptionError` is a distinct
  exception from "key missing" — it means `APP_SECRET` rotated since the
  value was encrypted, and the fix is either restoring the old secret or
  asking the org to re-enter the credential, not retrying.
- **`backend/app/ai/credentials.py`** — `save_credential()` /
  `credential()` / `provider_for()`. Notice the save-time UX detail: an
  **empty key on update means "keep the existing one"** — the key is never
  sent back to the client to prefill a form, so re-saving the base URL alone
  can't require re-typing the secret.
- **`backend/app/ai/provider.py`** — the outbound-call side, behind a
  `Protocol`:
  ```python
  class LlmProvider(Protocol):
      def generate(self, messages: list[dict], schema: dict) -> tuple[dict, int]: ...
  ```
  `HttpProvider` is the real implementation (raw `urllib`, no vendor SDK —
  deliberate, so the same code works against any OpenAI-compatible endpoint,
  including a self-hosted model). `RecordedProvider` replays a fixed list of
  canned responses/exceptions and is a first-class test double, not a
  placeholder — tests exercise real business logic against it with zero
  network access.
- **`backend/app/ai/netguard.py`** — `ensure_public_https(url)`, called
  **both** when the credential is saved (fail fast, in the settings form)
  **and** on every single outbound call (because DNS can change after
  saving — a classic SSRF rebinding trick). Blocks non-https schemes and any
  resolved address that isn't globally routable (loopback, private ranges,
  link-local/cloud-metadata `169.254.0.0/16`, CGN). Redirects are disabled
  separately in `provider.py`'s HTTP opener, because a public host answering
  with a 3xx to an internal address would otherwise bypass the resolve-time
  check entirely. `AI_ALLOW_PRIVATE_URLS=true` is the one escape hatch, for
  a self-hosted install pointed at a model on its own private network — keep
  that pattern (a config flag, off by default) if a new integration needs an
  equivalent.
- **`backend/app/ai/usage.py`** — per-org rate limiting (`ai_requests_per_minute`)
  and a daily token budget (`ai_daily_token_budget`), both configured in
  `app/config.py` with `0` meaning "no limit." A paid third-party API used
  on behalf of an org needs the same kind of budget guard — otherwise one
  member can exhaust the whole org's quota/bill in an evening. Jira has no
  equivalent budget guard — it isn't metered/billed per call the way an LLM
  API is — but it does have its own hard cap, `jira_max_issues_per_sync`
  (`app/config.py`), which refuses an oversized sync outright rather than
  silently truncating it.

## The Jira connection — the second worked example

`backend/app/jira/` mirrors the shape above file-for-file:
`JiraConnection` (`base_url` + `email` + `encrypted_token`, one row per org)
in `models.py`; `credentials.py` (same "empty token on update = keep
existing" UX rule); `client.py` defining a `JiraClient` `Protocol` with
`HttpJiraClient` (raw `urllib`, no vendor SDK) and `RecordedJiraClient` (the
test double) implementations; `netguard.py` (`ensure_public_https`, same
SSRF shape, its own `JIRA_ALLOW_PRIVATE_URLS` escape hatch); and `sync.py`,
which holds the integration-specific logic — importing/syncing a Jira
project's issues and epics into Planora tasks/categories through the
**mutation layer** (one shared `batch_id` per import/sync, so the whole
operation is one-click undoable, exactly like a human-driven multi-edit
would be), plus a manual "push due dates to Jira" action.

The one deliberate divergence worth knowing before copying this pattern:
Jira uses Basic auth (email + a personal API token) rather than OAuth, on
purpose — see the docstring on `JiraConnection` in `models.py` for why an
org-owned API token was judged good enough here. Don't take "the AI/Jira
connections don't use OAuth" as evidence OAuth is unneeded in general; it's
evidence this specific pair of integrations didn't need it.

## What doesn't exist yet (design it before building it)

- **No OAuth-client flow.** Planora issues session cookies to its own users;
  it has never been the OAuth *consumer* side of a flow with an external
  provider, and neither of the two integrations above needed one (see
  above). Building "Connect your GitHub/Slack account" via OAuth is still
  new territory — there's no `oauth.py` to copy. Model the stored token the
  same way as `OrgLlmCredential`/`JiraConnection` (encrypted, never returned
  by the API), and keep the state/redirect handling in its own module rather
  than folding it into `auth.py` (which is exclusively about Planora's own
  session lifecycle).
- **No webhook receiver.** Nothing in this codebase accepts inbound HTTP
  from a third party today. If you add one: it sits outside the normal
  session-cookie auth entirely (verify by signature/secret instead, the way
  a payment processor's webhook would), it must **not** go through
  `reject_cross_origin_writes` in `main.py` (that middleware assumes a
  browser Origin header, which a webhook sender won't send) — add an
  explicit path exemption there rather than disabling the check globally,
  and it should call into the mutation layer for anything that changes plan
  state, exactly like a human-triggered route would.

## Where a new route/model for this would plug in

- Router: a new `backend/app/api/<name>_routes.py`, registered in
  `backend/app/main.py` next to the existing `app.include_router(...)` calls.
- Permission: add an `Action` in `app/access.py` and decide, explicitly, for
  every `Role`, whether it can configure/use the integration — don't assume
  "same as `PROJECT_ADMIN`" without checking that's actually the granularity
  wanted (org-wide like the LLM credential, or per-project).
- Migration: a new file in `backend/migrations/versions/`, hand-written
  `upgrade`/`downgrade`, chained via `down_revision` to the current head —
  see `dev-workflow.md` for how to generate and run it.
- Config: any new required setting goes in `backend/app/config.py` as a
  `Settings` field with a validator that **fails at startup** if
  half-configured (mirror `_refuse_a_mail_setup_that_cannot_send`'s pattern:
  check the whole set of required variables together, not field-by-field),
  plus a documented entry in `.env.example` with a comment explaining the
  variable and its default.
