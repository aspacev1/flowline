[Русская версия / deployment & ops guide →](README.ru.md)

# Planora

**A self-hosted project planner** for teams who plan work on a Gantt chart
and need to explain it to clients: organizations → projects → categories →
tasks, an undo-able edit journal instead of silent overwrites, a
proposal/quoting module that turns a plan into a priced estimate, and a
weekly health dashboard that flags what's slipping before a client asks.

No SaaS account, no per-seat billing — one `docker compose up` and it's
running on your own server, behind your own domain.

![Gantt chart with categories, dependencies, and a blocked task](docs/screenshots/gantt.png)

## Features

### Gantt-chart planning
Drag tasks across the timeline, draw dependencies between them, mark
milestones and criticality, and — if you turn on auto-scheduling for a
project — let dependent tasks cascade forward automatically when something
upstream slips. The chart is hand-built SVG — no charting library, no
license, no bundle bloat.

### Portfolio at a glance
![Projects list with done/in-progress/blocked/overdue counts per project](docs/screenshots/projects.png)

The projects list *is* the status report: done/in-progress/blocked/overdue
counts per project, so "how's it going?" has an answer before you open
anything.

### Task cards built for collaboration
![Task detail card with status, criticality, dependencies, assignees, and comments](docs/screenshots/task-card.png)

Every task carries its own description, status, criticality, dependencies,
assignees, and a threaded comment discussion — click a bar on the chart and
the whole conversation is right there.

### Nothing is ever silently lost
![Project history feed listing every change with an Undo button](docs/screenshots/history.png)

Every edit to the plan — move a task, add a dependency, rename a category —
is written to a revision journal with a computed inverse, so it can be
undone one click at a time. The History tab reads straight from that
journal: a full, attributed changelog of the plan, not just an audit log
nobody opens.

### Weekly health Scorecard
![Scorecard dashboard with overdue tasks, data quality, and an alerts panel](docs/screenshots/scorecard.png)

A rolling weekly snapshot of the project's vital signs — overdue tasks,
average days late, unassigned work, data quality — each with a target, a
trend sparkline, and a status. Past weeks are frozen at the moment they
were recorded, so the trend line reflects reality, not this week's
recalculated targets.

### Turn the plan into a quote
![Proposal / quoting screen with role, effort, rate, and a computed total](docs/screenshots/proposal.png)

Price out the same plan as a client proposal — role, effort, rate, tax —
and push the agreed line items straight into the Gantt chart as real tasks
once the client signs off, instead of re-typing the estimate a second time.

### Share it outside the team
![Public read-only project page, no login required](docs/screenshots/public-share.png)

Issue a public, read-only link for a client or stakeholder — no account, no
invite, just the live chart. Revoke it and the link stops working
immediately.

## Quick start

Docker with the `compose` plugin is the only dependency — no Python or
Node.js needed on the host.

```sh
git clone https://github.com/aspacev1/planora.git
cd planora
cp .env.example .env      # set APP_SECRET, DIRECTOR_EMAIL, and Postgres credentials
docker compose up --build
```

The first run takes a few minutes to build the images and apply the schema;
after that, `docker compose up` starts in seconds. Open
<http://localhost:8080> to register the first account — it becomes the
`owner` of its own organization.

That's the short version. For backups and restore, a custom domain and TLS,
transactional mail, invitations, deploying to Vercel, and the local dev
workflow, see the [full guide](README.ru.md) (in Russian).

## How it's built

- **Backend** — FastAPI + SQLAlchemy 2.0 + Alembic + Postgres (Python 3.12).
- **Frontend** — React 19 + TypeScript + Vite + TanStack Query.
- **One domain** — Caddy serves the frontend and proxies `/api/*` to the
  backend, so the session cookie stays HTTP-only and same-origin.
- **Two deploy targets** — self-hosted Docker with live WebSocket updates,
  or serverless on Vercel with an external Postgres.
- **Secrets encrypted at rest** — API credentials for the optional AI
  integration are stored Fernet-encrypted and never returned by the API.

## Documentation

- [README.ru.md](README.ru.md) — self-hosting, backups, mail, invitations,
  Vercel deploy, and the local dev workflow.
- [docs/](docs/) — design notes and architecture write-ups.
