# Data model reference

All models live in `backend/app/models.py` — one file, on purpose, so the
whole schema is visible at once. Every table has a UUID primary key via the
`_uuid_pk()` helper. Migrations are Alembic, hand-written, linear history in
`backend/migrations/versions/`.

Conventions used throughout, worth matching in new tables:

- A `StrEnum` for any fixed set of string values, paired with a derived
  tuple (`TASK_STATUSES = tuple(s.value for s in TaskStatus)`) that feeds a
  `CheckConstraint` on the column — the enum and the DB constraint are
  generated from the same source, so they can't drift.
- `server_default` alongside a Python-side `default` wherever a NOT NULL
  column needs a value on a second write path (raw SQL, a migration
  backfill) that doesn't go through the ORM default.
- `ondelete="CASCADE"` vs `ondelete="SET NULL"` is a deliberate per-column
  decision, not a default habit — CASCADE where the child row is meaningless
  without the parent (a task without its project), SET NULL where the row is
  a historical record that should outlive the referenced actor (e.g.
  `Revision.actor_user_id`, `Invitation.invited_by`).
- `index=True` only on columns that are actually queried by — the comment
  next to each usually names the query.

## Org, auth, and platform

- **Organization** — the tenant/data-isolation unit. Registration is free;
  first person in gets `owner`. Carries defaults (locale, timezone, working
  days, holiday calendar) that projects inherit unless overridden.
- **User** — email/password (argon2), locale, nullable per-user timezone
  (`null` means "ask the browser," deliberately not copied from the org).
  `last_active_at` feeds the director's admin panel.
- **Membership** — `(org_id, user_id)` unique, carries `role` (`Role` enum:
  owner/editor/viewer/client) and `project_scoped` (bool — if true, this
  membership only sees projects it's explicitly granted via
  `ProjectAccess`, even though its role would otherwise see the whole org).
- **Session** — opaque bearer token, only `token_hash` stored, 30-day TTL
  with a 7-day idle timeout enforced in `app/auth.py`. Carries
  `active_org_id` (which org this *tab* is looking at — lives on the
  session, not the user, because two tabs can look at two different orgs).
- **ThrottleEvent** — durable (Postgres-backed) rate-limit event log, used
  for login/signup/password-reset brute-force protection. Distinct from the
  in-memory `app/rate_limit.py` used for cheap abuse prevention that doesn't
  need to survive a restart.
- **Invitation / EmailVerification / PasswordReset** — all follow the same
  shape: raw token shown once, only its hash stored, an `expires_at`, and a
  `used_at`/`accepted_at`/`revoked_at` marker column instead of deletion (so
  a reused link can answer "this link already worked" instead of "not
  found").
- **AiUsage** — per-org per-day token counter for the LLM budget.
  **IdempotencyRecord** — caches the response to a write request by
  `(project_id, key)` so a retried mutation isn't double-applied; rows live
  one day.

## Plan / Gantt

- **Project** — belongs to an org; `schedule_mode` is `relative` (no start
  date yet — tasks live on a "Day N of the project" axis) or `calendar`
  (dates are real, anchored to `start_date`). `auto_schedule` toggles
  whether dependency edges push successor dates automatically
  (`app/cascade.py`) — off by default because turning it on changes the
  meaning of every dependency in the project at once.
- **Category** — groups tasks for Gantt row grouping and color; has
  `position` for manual ordering.
- **Task** — the core row. `status` (planned/in_progress/done/blocked),
  `criticality` (low/normal/high/critical), `milestone` (bool — a milestone
  is a `Task` with `duration_days = 1`, enforced by a `CheckConstraint`, not
  a separate table, because it shares every other Task feature —
  assignees, comments, dependencies, history). `position` is unique *within
  a category* via a `DEFERRABLE INITIALLY DEFERRED` constraint, so a
  multi-row reorder in one transaction doesn't trip over intermediate
  duplicate positions. `baseline_start`/`baseline_duration` hold the
  approved-plan snapshot for deviation tracking. `done_at` /
  `in_progress_since` are stamped by the mutation layer on status
  transitions specifically to feed the Scorecard ("closed this week," "stuck
  in progress N days") without a full scan of the revision journal.
- **Dependency** — directed edge `from_task_id → to_task_id`, unique per
  pair. Both ends are indexed: outgoing for cascade pushes, incoming (`to_task_id`)
  for "who's waiting on this task" and for cleanup on delete.
- **TaskAssignee** — join table, `(task_id, user_id)` unique.
- **PlanVersion** — an approved-plan snapshot (JSONB), numbered per project.
  Separate from `Task.baseline_*` because the baseline columns only hold the
  *latest* approval; the full "what did we promise in January vs. March"
  history needs every prior version.
- **Revision** — the undo/audit journal. `op`/`inverse` are JSONB (GIN
  index on `op`, because task history is found by searching for a `task_id`
  inside the payload). `batch_id` groups a multi-op action for one-click
  undo of the whole batch. `undoes_seq` records which revision this one
  undid, so "undo the top of the stack" can't accidentally re-undo its own
  undo. See `mutations.py` and the main SKILL.md for how this layer works.

## Proposal (quoting/estimation)

- **Proposal** — one per project, created lazily on first edit (no row for
  projects that never got a quote). Carries `effort_unit` (days/hours),
  `hours_per_day`, `tax_rate_pct` (`Numeric`, never `Float` — money/percent
  fields are `Numeric` throughout this module for exactness), `currency`
  (ISO 4217, stored explicitly rather than derived from locale).
- **ProposalCategory** — a section of the quote (own table, not the plan's
  `Category` — a quote section exists before and independent of a plan).
- **ProposalTask** — a line item: `role` (free text — the assignee isn't
  known yet at quoting time), `effort` × `rate` in `Numeric`. **Price is
  never stored** — it's `effort * rate`, computed on both client and server
  from the same two numbers, specifically so it can't drift out of sync with
  its factors.
- **ProposalComment** — internal-only discussion on a line item; unlike plan
  `Comment`, always has an authenticated author (no guest comments here).

## Scorecard (weekly dashboard)

- **ScorecardMetric** — per-project config (owner, target, enabled),
  seeded lazily on first Scorecard open (`app.scorecard.ensure_metrics`) —
  no organization-level defaults table.
- **ScorecardSnapshot** — one immutable row per `(project, metric, week)`
  for past weeks; the *current* week's row is the only one ever
  overwritten, and doubles as a 5-minute cache for the live calculation.
  Copies `target_value`/`direction` at write time deliberately — editing
  today's target must never repaint the color of a past week.
- **ScorecardAlert** — event log for the "needs attention" panel:
  `metric_risk` (a metric is red this week) or `rule_triggered` (red two
  weeks running → a task got auto-created; `payload` links to it). Closed
  events get `resolved_at` rather than deletion, which is also what
  suppresses a repeat firing of the same rule within one red streak.

## Sharing, comments, AI

- **ShareLink** — public read link per project; token stored **in
  cleartext** (unlike every other token in this schema) because the owner
  re-copies it repeatedly from settings — forgetting it would mean "issue a
  new one, kill the old" as the only way to "show me the link again." A
  partial unique index (`WHERE revoked_at IS NULL`) allows unlimited history
  of dead links but only one active link per project.
- **ProjectAccess** — explicit per-user grant to one project; only meaningful
  for roles that need it (`client`, guest-by-link) or a `project_scoped`
  membership.
- **Comment** — project- or task-scoped (`task_id` nullable = project-level).
  Author is a `User` **xor** a `guest_name` string, enforced by
  `CheckConstraint("num_nonnulls(author_user_id, guest_name) = 1")` — the DB
  won't allow an unsigned or double-signed comment even from a second write
  path. `internal` (bool) hides a reply from the public link's guest.
  `created_at` uses `clock_timestamp()`, not `now()` — `now()` is frozen at
  transaction start, and two comments inserted in one transaction need
  distinguishable ordering.
- **OrgLlmCredential** — one per org, `encrypted_key` (Fernet via
  `app/crypto.py`), never decrypted for output — see
  `integration-pattern.md`.
- **AiSession** — an in-progress AI intake interview/draft, separate from
  `Project` because nothing is written to a real project until the human
  applies the draft.
