# Create Project Form — Design

Status: Approved by user, ready for implementation planning.
Date: 2026-06-24

## Goal

Replace the current one-click "create a placeholder-named project" behavior with a proper
create-project form, collecting:

1. Project name (required)
2. Stakeholders — picked from a list of org members, grouped by department
3. Participants — picked from a list of org members, grouped by department (same UI pattern
   as stakeholders, independent selection)
4. Description (optional, free text)

The form supports clearing all fields (resetting the in-progress form, not deleting anything
saved) and saving, which creates the project — along with its member rows — in the database
and makes it immediately available in the UI (the user is taken straight into the new project,
matching today's behavior).

## Decisions From Brainstorming

- **Stakeholders vs. participants is a UI-only distinction.** Both pickers select people from
  the same org member list. In the database, everyone selected in either list becomes a
  `project_members` row with `role = 'collaborator'` — no new role value, no schema change to
  the role model. If a person is somehow selected in both lists, they still only get one row
  (enforced naturally by `project_members`'s existing `PRIMARY KEY (project_id, user_id)`).
- **People list source:** `GET /team` (already exists, returns departments with members
  grouped), reused for both pickers' grouped-by-department display — the same pattern already
  used for the assignee picker in `GanttScreen.jsx`.
- **Form is a modal**, not a separate screen — opened from the existing "Новый проект" button
  on `ProjectsScreen.jsx`.
- **Only `name` is required** to save, matching today's existing backend validation. Stakeholders,
  participants, and description are all optional.
- **The creator is excluded from both picker lists.** They're auto-added as `manager` regardless
  (existing, unchanged behavior), so showing them in the picker would be redundant.

## Data Model Changes

### `projects` table
Add one column:

```sql
ALTER TABLE projects ADD COLUMN description text;
```

(Nullable — no default needed, no existing rows to backfill meaningfully beyond NULL.)

No other schema changes. `project_members` already supports everything needed (existing
`role` CHECK constraint already allows `'collaborator'`, which is all this feature uses).

## Backend Changes

### `POST /api/projects`

Request body extends from `{ name, color }` to:

```json
{
  "name": "string (required)",
  "color": "string (optional, existing behavior unchanged)",
  "description": "string (optional)",
  "stakeholderIds": ["uuid", "..."],
  "participantIds": ["uuid", "..."]
}
```

`stakeholderIds` and `participantIds` are both optional; if omitted, default to empty arrays.

Inside the existing transaction (`backend/src/routes/projects.js`'s `POST /` handler):

1. Insert the project row, now including `description` (currently inserts `organization_id,
   name, color, created_by` — add `description` to the column list and values, defaulting to
   `null` if not provided).
2. Insert the creator as `manager` (unchanged — existing line).
3. Build the union of `stakeholderIds` and `participantIds` (deduplicated, e.g. via a `Set`),
   excluding the creator's own ID defensively (even though the frontend won't offer the creator
   as a pickable option, the backend shouldn't trust that and should silently skip the creator's
   ID if present, rather than attempting a duplicate-PK insert that would roll back the whole
   transaction).
4. For each remaining ID, insert `INSERT INTO project_members (project_id, user_id, role) VALUES
   ($1, $2, 'collaborator')`.
5. Commit. Any FK violation (a bogus user ID) rolls back the entire transaction and returns the
   existing generic 500 path — no new validation layer, consistent with how this route already
   handles errors.

### `GET /api/projects/:id`

Add `description` to the selected columns and to the response object (alongside the existing
`id, name, color, created_at` and the `members` array). `GET /api/projects` (the list endpoint)
is **not** changed — project cards stay as compact summaries without description, matching the
existing UI density.

## Frontend Changes

### New file: `frontend/src/components/CreateProjectModal.jsx`

Props: `{ onClose, onCreated }` — `onClose` dismisses the modal with no side effects, `onCreated`
is called with the newly created project object on success (so `ProjectsScreen` can append it to
the list and navigate into it, exactly like the current `handleCreateProject` does today).

- On mount, calls `api.getTeam()` once to fetch `{ departments, unassigned }` for the grouped
  picker lists. Filters out the current user from every department's member list — `ProjectsScreen`
  already receives `currentUser` as a prop (from `App.jsx`), so `CreateProjectModal` takes
  `currentUser` as an additional prop and `ProjectsScreen` passes its existing `currentUser`
  straight through when rendering the modal.
- Visual style: dark semi-transparent backdrop + centered white `rounded-2xl` card, consistent
  with the existing palette (`bg-[#4F5DFF]` primary button, `border-slate-200` borders, same
  input/label classes already used in `AuthScreen.jsx`/`OnboardingScreen.jsx`).
- Fields:
  - **Название проекта** — required text input.
  - **Заинтересованные лица** — checkbox list grouped by department heading, each row showing
    avatar initials + name.
  - **Участники** — identical grouped checkbox list, independent selection state from
    stakeholders.
  - **Описание** — optional `<textarea>`.
- **"Очистить" button** — resets all local form state (name, description, both selection sets)
  back to empty. Pure client-side, no API call.
- **"Создать проект" button** — disabled while submitting; calls
  `api.createProject({ name, description, color, stakeholderIds, participantIds })` (color
  continues to be auto-assigned by `ProjectsScreen`'s existing cycling palette logic, passed
  through unchanged — no color picker added in this feature). On success, calls `onCreated(project)`.
  On failure, shows an inline error banner inside the modal (same `err.body?.error || fallback`
  pattern used throughout this app) and leaves all fields intact so the user doesn't lose their
  input.

### `frontend/src/components/ProjectsScreen.jsx` changes

- Add `showCreateModal` state.
- The "Новый проект" button now sets `showCreateModal = true` instead of calling
  `handleCreateProject` directly.
- Render `<CreateProjectModal onClose={...} onCreated={...} />` when `showCreateModal` is true.
- `onCreated` callback: append the new project to `projects` state and call
  `onOpenProject(project.id)` — same two effects `handleCreateProject` currently produces,
  just triggered from the modal's success path instead of immediately on button click.
- The old `handleCreateProject` function (which created a project named "Новый проект" with no
  form) is removed, replaced by this modal flow.

### `frontend/src/api.js` changes

`createProject` already exists and just forwards its `data` argument as the POST body — no
signature change needed, since the new fields (`description`, `stakeholderIds`,
`participantIds`) are simply additional keys in the same object already being passed through.

## Error Handling

- Frontend: inline error banner in the modal on any `createProject` failure, form state
  preserved, same pattern as `AuthScreen.jsx`/`OnboardingScreen.jsx`.
- Backend: no new validation layer. A bogus user ID in `stakeholderIds`/`participantIds` causes
  a foreign-key violation, which rolls back the transaction and returns the existing generic
  500 (`"Не удалось создать проект"`) — consistent with this route's current error handling for
  all other failure modes.

## Testing

- No frontend test runner exists in this project; verification is by manual code review, as with
  prior frontend work in this codebase.
- No existing test coverage for `backend/src/routes/projects.js` (unlike the OAuth/invite modules
  added in the previous feature, which do have vitest coverage) — this feature does not introduce
  a new test file for this route, consistent with the existing coverage boundary. Verification is
  manual (static review of the transaction logic) plus a real run against the dev stack if Docker
  is available in the implementer's environment.

## Out of Scope

- No project-level role distinction between "stakeholder" and "participant" in the data model —
  confirmed as a deliberate decision; both collapse to `collaborator`.
- No color picker in the new modal — color assignment stays automatic, exactly as today.
- No ability to remove/edit stakeholders or participants from within this modal after creation —
  that's the existing `POST /api/projects/:id/members` endpoint's job, unchanged, accessible
  later from project settings (not part of this feature).
