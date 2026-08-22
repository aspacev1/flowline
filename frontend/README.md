# Planora frontend

React 19 + TypeScript + Vite + TanStack Query + react-router-dom v7. No
Redux/Zustand — server state lives in React Query, local UI state in
`useState`/context. No charting/Gantt library — the Gantt chart and
Scorecard sparkline are hand-built SVG + CSS + React.

This directory has no project-specific docs of its own on purpose — see:

- the repo root [`README.md`](../README.md) for the product overview, and
  [`README.ru.md`](../README.ru.md) for the full deployment/ops guide,
- the repo root [`CLAUDE.md`](../CLAUDE.md) and the `planora-conventions`
  skill (`.claude/skills/planora-conventions/`) for the architecture map —
  data model, the API-call pattern (`src/api/*.ts` → `client.ts`'s
  `request<T>()`), feature-folder layout, and dev-workflow commands (lint,
  typecheck, `gen:api`, tests).

Quick reference for this package specifically:

```bash
npm ci
npm run dev          # Vite dev server
npm run lint         # oxlint — see .oxlintrc.json
npx tsc -b           # typecheck
npm run gen:api      # regenerate src/api/schema.d.ts from the backend's openapi.json
npx vitest run --coverage
```
