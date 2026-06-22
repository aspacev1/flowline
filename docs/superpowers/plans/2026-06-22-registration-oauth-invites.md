# Registration, OAuth Login & Team Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google/Apple/Microsoft OAuth + email/password registration, a post-registration onboarding step (full name, position, company name), and an org invite flow (shareable link + emailed invites) to Flowline.

**Architecture:** Pure-logic helpers (slugify, token generation, OAuth profile parsing, mailer payload construction) are extracted into small testable modules with no DB/network side effects baked in, so they can be unit-tested with `vitest`. Route handlers stay thin — they call the helpers and do DB I/O, matching the existing style in `backend/src/routes/*.js`. Schema changes go directly into `db/schema.sql` since `migrate.js` only applies it on a fresh database (confirmed: it checks for table `users` and skips entirely if present).

**Tech Stack:** Node/Express/Postgres backend (existing), `vitest` (new, backend unit tests), `nodemailer` (new), `jsonwebtoken` (existing, reused for Apple client-secret signing), React/Vite frontend (existing).

---

## File Structure

**Backend — new files:**
- `backend/src/utils/slugify.js` — org slug generation from company name
- `backend/src/utils/inviteToken.js` — crypto-random token generation
- `backend/src/utils/mailer.js` — nodemailer wrapper + config-check
- `backend/src/oauth/google.js`, `backend/src/oauth/microsoft.js`, `backend/src/oauth/apple.js` — per-provider `getAuthUrl(state)` + `exchangeCode(code)` returning `{ providerUserId, email, emailVerified, name }`
- `backend/src/oauth/registry.js` — which providers are enabled based on env vars
- `backend/src/routes/oauth.js` — `/auth/oauth/:provider/start` + `/callback`
- `backend/src/routes/invites.js` — `/invites/*` routes
- `backend/src/utils/__tests__/slugify.test.js`, `inviteToken.test.js`, `mailer.test.js`
- `backend/src/oauth/__tests__/google.test.js` (pattern reused for microsoft/apple)

**Backend — modified files:**
- `db/schema.sql` — add `users.position`, `user_identities`, `org_invites`, `org_invite_emails`; make `users.password_hash` nullable
- `backend/src/routes/auth.js` — registration no longer creates an org; `/auth/me` returns `organization`; add `POST /auth/onboarding`
- `backend/src/server.js` — mount `oauth.js` and `invites.js` routers
- `.env.example` — add OAuth + SMTP env vars
- `docker-compose.yml` — pass through new env vars to backend
- `backend/package.json` — add `vitest`, `nodemailer`, `jsonwebtoken` already present

**Frontend — new files:**
- `frontend/src/components/OnboardingScreen.jsx`
- `frontend/src/components/InviteTeammatesScreen.jsx`

**Frontend — modified files:**
- `frontend/src/components/AuthScreen.jsx` — OAuth buttons, drop `organizationName` field
- `frontend/src/api.js` — new API calls
- `frontend/src/App.jsx` — routing logic for onboarding/invite screens

This plan covers backend tasks 1–11 in full TDD detail, then frontend tasks 12–15 at the same granularity. Microsoft/Apple OAuth modules follow the exact pattern established for Google in Task 7 — Task 8 gives their complete code rather than re-deriving it.

---

### Task 1: Add vitest to the backend

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Install vitest**

```bash
cd backend && npm install -D vitest
```

- [ ] **Step 2: Add test script**

In `backend/package.json`, add to `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 3: Verify it runs with no tests yet**

Run: `cd backend && npm test`
Expected: `No test files found` (exit code may be non-zero — that's expected until Task 2 adds a real test)

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore: add vitest to backend"
```

---

### Task 2: Org slug generation

**Files:**
- Create: `backend/src/utils/slugify.js`
- Test: `backend/src/utils/__tests__/slugify.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/utils/__tests__/slugify.test.js
import { describe, it, expect } from "vitest";
import { slugifyOrgName } from "../slugify.js";

describe("slugifyOrgName", () => {
  it("lowercases and replaces non-alphanumeric runs with a single dash", () => {
    expect(slugifyOrgName("Acme Inc.")).toBe("acme-inc");
  });

  it("strips leading/trailing dashes", () => {
    expect(slugifyOrgName("  --Acme--  ")).toBe("acme");
  });

  it("falls back to 'org' for empty/symbol-only input", () => {
    expect(slugifyOrgName("!!!")).toBe("org");
  });

  it("appends the suffix when provided", () => {
    expect(slugifyOrgName("Acme", "x7q2")).toBe("acme-x7q2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- slugify`
Expected: FAIL — `Cannot find module '../slugify.js'`

- [ ] **Step 3: Write implementation**

```javascript
// backend/src/utils/slugify.js
export function slugifyOrgName(name, suffix) {
  const base = (name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const safeBase = base || "org";
  return suffix ? `${safeBase}-${suffix}` : safeBase;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- slugify`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/slugify.js backend/src/utils/__tests__/slugify.test.js
git commit -m "feat: add org slug generation helper"
```

---

### Task 3: Invite token generation

**Files:**
- Create: `backend/src/utils/inviteToken.js`
- Test: `backend/src/utils/__tests__/inviteToken.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/utils/__tests__/inviteToken.test.js
import { describe, it, expect } from "vitest";
import { generateInviteToken } from "../inviteToken.js";

describe("generateInviteToken", () => {
  it("returns a base64url string with no padding or unsafe characters", () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns a string at least 40 characters long for 32 random bytes", () => {
    const token = generateInviteToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it("returns a different value on each call", () => {
    expect(generateInviteToken()).not.toBe(generateInviteToken());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- inviteToken`
Expected: FAIL — `Cannot find module '../inviteToken.js'`

- [ ] **Step 3: Write implementation**

```javascript
// backend/src/utils/inviteToken.js
import crypto from "crypto";

export function generateInviteToken() {
  return crypto.randomBytes(32).toString("base64url");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- inviteToken`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/inviteToken.js backend/src/utils/__tests__/inviteToken.test.js
git commit -m "feat: add invite token generator"
```

---

### Task 4: Mailer wrapper

**Files:**
- Create: `backend/src/utils/mailer.js`
- Test: `backend/src/utils/__tests__/mailer.test.js`
- Modify: `backend/package.json`

- [ ] **Step 1: Install nodemailer**

```bash
cd backend && npm install nodemailer
```

- [ ] **Step 2: Write the failing test**

```javascript
// backend/src/utils/__tests__/mailer.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("mailer", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
  });

  it("isMailerConfigured returns false when SMTP env vars are missing", async () => {
    const { isMailerConfigured } = await import("../mailer.js");
    expect(isMailerConfigured()).toBe(false);
  });

  it("isMailerConfigured returns true when all SMTP env vars are set", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    process.env.SMTP_FROM = "noreply@example.com";
    const { isMailerConfigured } = await import("../mailer.js");
    expect(isMailerConfigured()).toBe(true);
  });

  it("sendMail calls the injected transport with from/to/subject/html", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    process.env.SMTP_FROM = "noreply@example.com";
    const { sendMail } = await import("../mailer.js");
    const fakeTransport = { sendMail: vi.fn().mockResolvedValue({ messageId: "1" }) };

    await sendMail(
      { to: "person@example.com", subject: "Hi", html: "<p>Hi</p>" },
      fakeTransport
    );

    expect(fakeTransport.sendMail).toHaveBeenCalledWith({
      from: "noreply@example.com",
      to: "person@example.com",
      subject: "Hi",
      html: "<p>Hi</p>",
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test -- mailer`
Expected: FAIL — `Cannot find module '../mailer.js'`

- [ ] **Step 4: Write implementation**

```javascript
// backend/src/utils/mailer.js
import nodemailer from "nodemailer";

export function isMailerConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_FROM
  );
}

let cachedTransport = null;
function getDefaultTransport() {
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return cachedTransport;
}

export async function sendMail({ to, subject, html }, transport = getDefaultTransport()) {
  if (!isMailerConfigured()) {
    throw new Error("Mailer is not configured");
  }
  return transport.sendMail({ from: process.env.SMTP_FROM, to, subject, html });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- mailer`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/utils/mailer.js backend/src/utils/__tests__/mailer.test.js backend/package.json backend/package-lock.json
git commit -m "feat: add SMTP mailer wrapper"
```

---

### Task 5: Schema changes

**Files:**
- Modify: `db/schema.sql`

- [ ] **Step 1: Make `password_hash` nullable**

In `db/schema.sql`, find the `users` table definition and change:

```sql
    password_hash   text NOT NULL,
```
to:
```sql
    password_hash   text,
```

- [ ] **Step 2: Add `position` column to `users`**

Immediately after the `password_hash` line in the same table definition, add:

```sql
    position        text,
```

- [ ] **Step 3: Add `user_identities` table**

After the `organization_members` table definition, add:

```sql
-- ---------- Способы входа ----------
-- Один пользователь может иметь несколько способов входа
-- (пароль + один или несколько OAuth-провайдеров).

CREATE TABLE user_identities (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider          text NOT NULL CHECK (provider IN ('password', 'google', 'apple', 'microsoft')),
    provider_user_id  text,
    email             text NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_user_id)
);

CREATE INDEX idx_user_identities_user_id ON user_identities(user_id);
```

- [ ] **Step 4: Add `org_invites` and `org_invite_emails` tables**

After the `departments`/`users.department_id` block, add:

```sql
-- ---------- Приглашения в организацию ----------

CREATE TABLE org_invites (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
    token           text NOT NULL UNIQUE,
    created_by      uuid NOT NULL REFERENCES users(id),
    expires_at      timestamptz NOT NULL,
    revoked_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org_invite_emails (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email           text NOT NULL,
    invited_by      uuid NOT NULL REFERENCES users(id),
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    accepted_at     timestamptz
);

CREATE INDEX idx_org_invite_emails_org_email ON org_invite_emails(organization_id, email);
```

- [ ] **Step 5: Verify schema applies cleanly against a throwaway database**

Run:
```bash
docker run --rm -d --name flowline-schema-check -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:15
sleep 3
PGPASSWORD=test psql -h localhost -p 55432 -U postgres -f db/schema.sql
docker stop flowline-schema-check
```
Expected: every `CREATE TABLE`/`CREATE INDEX` prints `CREATE TABLE`/`CREATE INDEX` with no errors.

- [ ] **Step 6: Commit**

```bash
git add db/schema.sql
git commit -m "feat: add user_identities, org_invites, org_invite_emails tables; make password_hash nullable; add users.position"
```

---

### Task 6: `/auth/onboarding` endpoint and `/auth/me` org field

**Files:**
- Modify: `backend/src/routes/auth.js`

- [ ] **Step 1: Update `/auth/register` to stop creating an organization**

In `backend/src/routes/auth.js`, replace the `router.post("/register", ...)` handler body (everything from `const { email, password, fullName, organizationName } = req.body;` through the `client.release();` before `});`) with:

```javascript
router.post("/register", async (req, res) => {
  const { email, password, fullName } = req.body;
  if (!email || !password || !fullName) {
    return res.status(400).json({ error: "email, password и fullName обязательны" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Пароль должен быть не короче 8 символов" });
  }

  const client = await pool.connect().catch((err) => {
    console.error("DB connection failed:", err.message);
    return null;
  });
  if (!client) {
    return res.status(503).json({ error: "База данных недоступна, попробуйте позже" });
  }

  try {
    await client.query("BEGIN");

    const existing = await client.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Пользователь с такой почтой уже существует" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const initials = initialsFromName(fullName) || "??";
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    const userResult = await client.query(
      `INSERT INTO users (email, full_name, initials, avatar_color, password_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email, full_name, initials, avatar_color`,
      [email, fullName, initials, color, passwordHash]
    );
    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO user_identities (user_id, provider, email) VALUES ($1, 'password', $2)`,
      [user.id, email]
    );

    await client.query("COMMIT");

    const token = signToken(user);
    res.cookie("token", token, COOKIE_OPTIONS);
    res.status(201).json({
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      initials: user.initials,
      avatarColor: user.avatar_color,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Не удалось создать аккаунт" });
  } finally {
    client.release();
  }
});
```

- [ ] **Step 2: Update `/auth/login` to handle null `password_hash`**

In the `router.post("/login", ...)` handler, after `const user = result.rows[0];` and the existing "not found" check, add a guard before `bcrypt.compare`:

```javascript
    if (!user.password_hash) {
      return res.status(401).json({ error: "Для этого аккаунта вход по паролю не настроен. Используйте OAuth." });
    }
```

- [ ] **Step 3: Update `/auth/me` to return organization info**

Replace the SQL query and response object inside `router.get("/me", ...)` with:

```javascript
router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.initials, u.avatar_color, u.department_id, u.position,
              d.name AS department_name, d.color AS department_color,
              o.id AS organization_id, o.name AS organization_name,
              om.org_role
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN organization_members om ON om.user_id = u.id
       LEFT JOIN organizations o ON o.id = om.organization_id
       WHERE u.id = $1`,
      [req.userId]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });

    res.json({
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      initials: user.initials,
      avatarColor: user.avatar_color,
      position: user.position,
      department: user.department_id
        ? { id: user.department_id, name: user.department_name, color: user.department_color }
        : null,
      organization: user.organization_id
        ? { id: user.organization_id, name: user.organization_name, role: user.org_role }
        : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка получения профиля" });
  }
});
```

- [ ] **Step 4: Add `POST /auth/onboarding`**

Add this new route in `backend/src/routes/auth.js`, before `export default router;`. It needs `slugifyOrgName` and `requireAuth`:

```javascript
import { slugifyOrgName } from "../utils/slugify.js";

router.post("/onboarding", requireAuth, async (req, res) => {
  const { fullName, position, companyName, inviteToken } = req.body;
  if (!fullName || !position) {
    return res.status(400).json({ error: "fullName и position обязательны" });
  }

  const client = await pool.connect().catch(() => null);
  if (!client) {
    return res.status(503).json({ error: "База данных недоступна, попробуйте позже" });
  }

  try {
    await client.query("BEGIN");

    const existingMembership = await client.query(
      "SELECT 1 FROM organization_members WHERE user_id = $1",
      [req.userId]
    );
    if (existingMembership.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Пользователь уже состоит в организации" });
    }

    let organizationId;
    let becameOwner;

    if (inviteToken) {
      const invite = await client.query(
        `SELECT organization_id FROM org_invites
         WHERE token = $1 AND revoked_at IS NULL AND expires_at > now()`,
        [inviteToken]
      );
      if (invite.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Ссылка-приглашение недействительна или истекла" });
      }
      organizationId = invite.rows[0].organization_id;
      becameOwner = false;

      await client.query(
        `INSERT INTO organization_members (organization_id, user_id, org_role) VALUES ($1, $2, 'member')`,
        [organizationId, req.userId]
      );

      const userEmail = await client.query("SELECT email FROM users WHERE id = $1", [req.userId]);
      await client.query(
        `UPDATE org_invite_emails SET status = 'accepted', accepted_at = now()
         WHERE organization_id = $1 AND email = $2 AND status = 'pending'`,
        [organizationId, userEmail.rows[0].email]
      );
    } else {
      if (!companyName) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "companyName обязателен при создании новой организации" });
      }
      const suffix = Math.random().toString(36).slice(2, 8);
      const slug = slugifyOrgName(companyName, suffix);
      const orgResult = await client.query(
        `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
        [companyName, slug]
      );
      organizationId = orgResult.rows[0].id;
      becameOwner = true;

      await client.query(
        `INSERT INTO organization_members (organization_id, user_id, org_role) VALUES ($1, $2, 'owner')`,
        [organizationId, req.userId]
      );
    }

    await client.query(
      `UPDATE users SET full_name = $1, position = $2 WHERE id = $3`,
      [fullName, position, req.userId]
    );

    await client.query("COMMIT");
    res.json({ organizationId, becameOwner });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Не удалось завершить онбординг" });
  } finally {
    client.release();
  }
});
```

- [ ] **Step 5: Manual verification against a running stack**

Run: `docker compose up --build -d db backend`
Then:
```bash
curl -i -c /tmp/cookies.txt -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","fullName":"Test User"}'
curl -i -b /tmp/cookies.txt http://localhost:4000/api/auth/me
```
Expected: register returns 201; `/auth/me` returns `"organization": null`.

```bash
curl -i -b /tmp/cookies.txt -X POST http://localhost:4000/api/auth/onboarding \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Test User","position":"Engineer","companyName":"Acme Inc."}'
curl -i -b /tmp/cookies.txt http://localhost:4000/api/auth/me
```
Expected: onboarding returns `{"organizationId": "...", "becameOwner": true}`; `/auth/me` now returns a populated `organization` object with `role: "owner"`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/auth.js
git commit -m "feat: add onboarding endpoint, org field on /auth/me, drop org creation from register"
```

---

### Task 7: Google OAuth module

**Files:**
- Create: `backend/src/oauth/google.js`
- Test: `backend/src/oauth/__tests__/google.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/oauth/__tests__/google.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("google oauth module", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.OAUTH_REDIRECT_BASE_URL = "http://localhost:8080";
  });

  it("getAuthUrl builds a Google authorization URL containing client_id, redirect_uri and state", async () => {
    const { getAuthUrl } = await import("../google.js");
    const url = getAuthUrl("the-state-value");
    expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain("client_id=client-id");
    expect(url).toContain("state=the-state-value");
    expect(url).toContain(encodeURIComponent("http://localhost:8080/api/auth/oauth/google/callback"));
  });

  it("exchangeCode posts the code and returns normalized profile fields", async () => {
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: "google-user-1",
          email: "person@example.com",
          email_verified: true,
          name: "Person Example",
        }),
      });

    const { exchangeCode } = await import("../google.js");
    const profile = await exchangeCode("auth-code", fakeFetch);

    expect(profile).toEqual({
      providerUserId: "google-user-1",
      email: "person@example.com",
      emailVerified: true,
      name: "Person Example",
    });
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("exchangeCode throws if the token exchange response is not ok", async () => {
    const fakeFetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 400 });
    const { exchangeCode } = await import("../google.js");
    await expect(exchangeCode("bad-code", fakeFetch)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- google`
Expected: FAIL — `Cannot find module '../google.js'`

- [ ] **Step 3: Write implementation**

```javascript
// backend/src/oauth/google.js
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

function redirectUri() {
  return `${process.env.OAUTH_REDIRECT_BASE_URL}/api/auth/oauth/google/callback`;
}

export function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code, fetchImpl = fetch) {
  const tokenRes = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Google token exchange failed: ${tokenRes.status}`);
  }
  const { access_token } = await tokenRes.json();

  const profileRes = await fetchImpl(USERINFO_URL, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!profileRes.ok) {
    throw new Error(`Google userinfo fetch failed: ${profileRes.status}`);
  }
  const profile = await profileRes.json();

  return {
    providerUserId: profile.sub,
    email: profile.email,
    emailVerified: Boolean(profile.email_verified),
    name: profile.name,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- google`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/oauth/google.js backend/src/oauth/__tests__/google.test.js
git commit -m "feat: add Google OAuth module"
```

---

### Task 8: Microsoft and Apple OAuth modules

**Files:**
- Create: `backend/src/oauth/microsoft.js`
- Create: `backend/src/oauth/apple.js`
- Test: `backend/src/oauth/__tests__/microsoft.test.js`
- Test: `backend/src/oauth/__tests__/apple.test.js`

- [ ] **Step 1: Write the failing test for Microsoft**

```javascript
// backend/src/oauth/__tests__/microsoft.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("microsoft oauth module", () => {
  beforeEach(() => {
    process.env.MICROSOFT_CLIENT_ID = "ms-client-id";
    process.env.MICROSOFT_CLIENT_SECRET = "ms-client-secret";
    process.env.OAUTH_REDIRECT_BASE_URL = "http://localhost:8080";
  });

  it("getAuthUrl builds a Microsoft authorization URL", async () => {
    const { getAuthUrl } = await import("../microsoft.js");
    const url = getAuthUrl("state-value");
    expect(url).toContain("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url).toContain("client_id=ms-client-id");
    expect(url).toContain("state=state-value");
  });

  it("exchangeCode returns normalized profile fields", async () => {
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "tok" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "ms-user-1",
          mail: "person@example.com",
          displayName: "Person Example",
        }),
      });
    const { exchangeCode } = await import("../microsoft.js");
    const profile = await exchangeCode("code", fakeFetch);
    expect(profile).toEqual({
      providerUserId: "ms-user-1",
      email: "person@example.com",
      emailVerified: true,
      name: "Person Example",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- microsoft`
Expected: FAIL — `Cannot find module '../microsoft.js'`

- [ ] **Step 3: Write the Microsoft implementation**

```javascript
// backend/src/oauth/microsoft.js
const AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const PROFILE_URL = "https://graph.microsoft.com/v1.0/me";

function redirectUri() {
  return `${process.env.OAUTH_REDIRECT_BASE_URL}/api/auth/oauth/microsoft/callback`;
}

export function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile User.Read",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code, fetchImpl = fetch) {
  const tokenRes = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Microsoft token exchange failed: ${tokenRes.status}`);
  }
  const { access_token } = await tokenRes.json();

  const profileRes = await fetchImpl(PROFILE_URL, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!profileRes.ok) {
    throw new Error(`Microsoft profile fetch failed: ${profileRes.status}`);
  }
  const profile = await profileRes.json();

  return {
    providerUserId: profile.id,
    email: profile.mail,
    emailVerified: true,
    name: profile.displayName,
  };
}
```

- [ ] **Step 4: Run Microsoft test to verify it passes**

Run: `cd backend && npm test -- microsoft`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test for Apple**

```javascript
// backend/src/oauth/__tests__/apple.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";

describe("apple oauth module", () => {
  beforeEach(() => {
    process.env.APPLE_CLIENT_ID = "apple-client-id";
    process.env.APPLE_TEAM_ID = "team-id";
    process.env.APPLE_KEY_ID = "key-id";
    process.env.APPLE_PRIVATE_KEY =
      "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIBaW4B... (test key not real)\n-----END EC PRIVATE KEY-----";
    process.env.OAUTH_REDIRECT_BASE_URL = "http://localhost:8080";
  });

  it("getAuthUrl builds an Apple authorization URL", async () => {
    const { getAuthUrl } = await import("../apple.js");
    const url = getAuthUrl("state-value");
    expect(url).toContain("https://appleid.apple.com/auth/authorize");
    expect(url).toContain("client_id=apple-client-id");
    expect(url).toContain("state=state-value");
  });

  it("exchangeCode decodes the id_token and returns normalized profile fields", async () => {
    vi.spyOn(jwt, "sign").mockReturnValue("fake-client-secret");
    const fakeIdToken = jwt.sign(
      { sub: "apple-user-1", email: "person@example.com", email_verified: "true" },
      "irrelevant-because-mocked",
      { algorithm: "none" }
    );
    vi.spyOn(jwt, "decode").mockReturnValue({
      sub: "apple-user-1",
      email: "person@example.com",
      email_verified: "true",
    });

    const fakeFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id_token: fakeIdToken }),
    });

    const { exchangeCode } = await import("../apple.js");
    const profile = await exchangeCode("code", fakeFetch);

    expect(profile).toEqual({
      providerUserId: "apple-user-1",
      email: "person@example.com",
      emailVerified: true,
      name: null,
    });
  });
});
```

- [ ] **Step 6: Run Apple test to verify it fails**

Run: `cd backend && npm test -- apple`
Expected: FAIL — `Cannot find module '../apple.js'`

- [ ] **Step 7: Write the Apple implementation**

```javascript
// backend/src/oauth/apple.js
import jwt from "jsonwebtoken";

const AUTH_URL = "https://appleid.apple.com/auth/authorize";
const TOKEN_URL = "https://appleid.apple.com/auth/token";

function redirectUri() {
  return `${process.env.OAUTH_REDIRECT_BASE_URL}/api/auth/oauth/apple/callback`;
}

function buildClientSecret() {
  return jwt.sign({}, process.env.APPLE_PRIVATE_KEY, {
    algorithm: "ES256",
    expiresIn: "5m",
    audience: "https://appleid.apple.com",
    issuer: process.env.APPLE_TEAM_ID,
    subject: process.env.APPLE_CLIENT_ID,
    keyid: process.env.APPLE_KEY_ID,
  });
}

export function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.APPLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "name email",
    response_mode: "form_post",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code, fetchImpl = fetch) {
  const clientSecret = buildClientSecret();
  const tokenRes = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.APPLE_CLIENT_ID,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Apple token exchange failed: ${tokenRes.status}`);
  }
  const { id_token } = await tokenRes.json();
  const claims = jwt.decode(id_token);

  return {
    providerUserId: claims.sub,
    email: claims.email,
    emailVerified: claims.email_verified === "true" || claims.email_verified === true,
    name: null,
  };
}
```

- [ ] **Step 8: Run Apple test to verify it passes**

Run: `cd backend && npm test -- apple`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git add backend/src/oauth/microsoft.js backend/src/oauth/apple.js backend/src/oauth/__tests__/microsoft.test.js backend/src/oauth/__tests__/apple.test.js
git commit -m "feat: add Microsoft and Apple OAuth modules"
```

---

### Task 9: Provider registry and `/auth/oauth/providers`

**Files:**
- Create: `backend/src/oauth/registry.js`
- Test: `backend/src/oauth/__tests__/registry.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/src/oauth/__tests__/registry.test.js
import { describe, it, expect, beforeEach } from "vitest";

describe("oauth registry", () => {
  beforeEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
    delete process.env.APPLE_CLIENT_ID;
    delete process.env.APPLE_TEAM_ID;
    delete process.env.APPLE_KEY_ID;
    delete process.env.APPLE_PRIVATE_KEY;
  });

  it("reports no providers enabled when no env vars are set", async () => {
    const { listEnabledProviders } = await import("../registry.js");
    expect(listEnabledProviders()).toEqual([]);
  });

  it("reports google enabled when both google env vars are set", async () => {
    process.env.GOOGLE_CLIENT_ID = "x";
    process.env.GOOGLE_CLIENT_SECRET = "y";
    const { listEnabledProviders } = await import("../registry.js");
    expect(listEnabledProviders()).toEqual(["google"]);
  });

  it("getProviderModule returns the google module by name", async () => {
    const { getProviderModule } = await import("../registry.js");
    const mod = await getProviderModule("google");
    expect(typeof mod.getAuthUrl).toBe("function");
    expect(typeof mod.exchangeCode).toBe("function");
  });

  it("getProviderModule throws for an unknown provider", async () => {
    const { getProviderModule } = await import("../registry.js");
    await expect(getProviderModule("facebook")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- registry`
Expected: FAIL — `Cannot find module '../registry.js'`

- [ ] **Step 3: Write implementation**

```javascript
// backend/src/oauth/registry.js
export function listEnabledProviders() {
  const enabled = [];
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    enabled.push("google");
  }
  if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
    enabled.push("microsoft");
  }
  if (
    process.env.APPLE_CLIENT_ID &&
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID &&
    process.env.APPLE_PRIVATE_KEY
  ) {
    enabled.push("apple");
  }
  return enabled;
}

export async function getProviderModule(provider) {
  switch (provider) {
    case "google":
      return import("./google.js");
    case "microsoft":
      return import("./microsoft.js");
    case "apple":
      return import("./apple.js");
    default:
      throw new Error(`Unknown OAuth provider: ${provider}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- registry`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/oauth/registry.js backend/src/oauth/__tests__/registry.test.js
git commit -m "feat: add OAuth provider registry"
```

---

### Task 10: OAuth routes (`/auth/oauth/:provider/start`, `/callback`, `/providers`)

**Files:**
- Create: `backend/src/routes/oauth.js`
- Modify: `backend/src/server.js`

- [ ] **Step 1: Write `backend/src/routes/oauth.js`**

```javascript
import express from "express";
import crypto from "crypto";
import { pool } from "../db/pool.js";
import { signToken, COOKIE_OPTIONS } from "../middleware/auth.js";
import { listEnabledProviders, getProviderModule } from "../oauth/registry.js";

const router = express.Router();

const STATE_COOKIE = "oauth_state";
const STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 10 * 60 * 1000,
};

function initialsFromName(name) {
  return (name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
}

const AVATAR_COLORS = ["#4F5DFF", "#E8A33D", "#2FB67C", "#E0567C", "#9061F9"];

router.get("/providers", (req, res) => {
  res.json({ providers: listEnabledProviders() });
});

router.get("/:provider/start", async (req, res) => {
  const { provider } = req.params;
  if (!listEnabledProviders().includes(provider)) {
    return res.status(404).json({ error: "Провайдер не настроен" });
  }
  const state = crypto.randomBytes(16).toString("base64url");
  res.cookie(STATE_COOKIE, state, STATE_COOKIE_OPTIONS);
  const mod = await getProviderModule(provider);
  res.redirect(mod.getAuthUrl(state));
});

router.get("/:provider/callback", async (req, res) => {
  const { provider } = req.params;
  const { code, state } = req.query;
  const cookieState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, STATE_COOKIE_OPTIONS);

  if (!listEnabledProviders().includes(provider)) {
    return res.status(404).json({ error: "Провайдер не настроен" });
  }
  if (!code || !state || state !== cookieState) {
    return res.status(400).json({ error: "Недействительный OAuth state" });
  }

  let profile;
  try {
    const mod = await getProviderModule(provider);
    profile = await mod.exchangeCode(code);
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: "Не удалось получить данные от провайдера" });
  }

  if (!profile.emailVerified) {
    return res.status(403).json({ error: "Email не подтверждён провайдером" });
  }

  const client = await pool.connect().catch(() => null);
  if (!client) {
    return res.status(503).json({ error: "База данных недоступна, попробуйте позже" });
  }

  try {
    await client.query("BEGIN");

    const existingIdentity = await client.query(
      `SELECT u.id, u.email, u.full_name, u.initials, u.avatar_color
       FROM user_identities ui JOIN users u ON u.id = ui.user_id
       WHERE ui.provider = $1 AND ui.provider_user_id = $2`,
      [provider, profile.providerUserId]
    );

    let user;
    if (existingIdentity.rows.length > 0) {
      user = existingIdentity.rows[0];
    } else {
      const existingUser = await client.query(
        `SELECT id, email, full_name, initials, avatar_color FROM users WHERE email = $1`,
        [profile.email]
      );

      if (existingUser.rows.length > 0) {
        user = existingUser.rows[0];
      } else {
        const initials = initialsFromName(profile.name || profile.email) || "??";
        const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
        const created = await client.query(
          `INSERT INTO users (email, full_name, initials, avatar_color, password_hash)
           VALUES ($1, $2, $3, $4, NULL) RETURNING id, email, full_name, initials, avatar_color`,
          [profile.email, profile.name || profile.email, initials, color]
        );
        user = created.rows[0];
      }

      await client.query(
        `INSERT INTO user_identities (user_id, provider, provider_user_id, email)
         VALUES ($1, $2, $3, $4)`,
        [user.id, provider, profile.providerUserId, profile.email]
      );
    }

    await client.query("COMMIT");

    const token = signToken(user);
    res.cookie("token", token, COOKIE_OPTIONS);
    res.redirect(process.env.FRONTEND_ORIGIN || "http://localhost:5173");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Не удалось войти через OAuth" });
  } finally {
    client.release();
  }
});

export default router;
```

- [ ] **Step 2: Mount the router in `backend/src/server.js`**

Add the import near the other route imports:

```javascript
import oauthRouter from "./routes/oauth.js";
```

Add the mount line after `app.use("/api/auth", authRouter);`:

```javascript
app.use("/api/auth/oauth", oauthRouter);
```

- [ ] **Step 3: Manual verification (requires real Google dev credentials)**

Set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`OAUTH_REDIRECT_BASE_URL` in `.env`, restart the backend, then visit `http://localhost:4000/api/auth/oauth/google/start` in a browser and confirm it redirects to Google's consent screen, and that completing it lands back on the frontend with a session cookie set.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/oauth.js backend/src/server.js
git commit -m "feat: add OAuth start/callback/providers routes"
```

---

### Task 11: Invite routes

**Files:**
- Create: `backend/src/routes/invites.js`
- Modify: `backend/src/server.js`

- [ ] **Step 1: Write `backend/src/routes/invites.js`**

```javascript
import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { generateInviteToken } from "../utils/inviteToken.js";
import { isMailerConfigured, sendMail } from "../utils/mailer.js";

const router = express.Router();
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function getUserOrgId(userId) {
  const result = await pool.query(
    "SELECT organization_id FROM organization_members WHERE user_id = $1",
    [userId]
  );
  return result.rows[0]?.organization_id || null;
}

router.get("/resolve/:token", async (req, res) => {
  const result = await pool.query(
    `SELECT o.name FROM org_invites oi
     JOIN organizations o ON o.id = oi.organization_id
     WHERE oi.token = $1 AND oi.revoked_at IS NULL AND oi.expires_at > now()`,
    [req.params.token]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Ссылка-приглашение недействительна или истекла" });
  }
  res.json({ organizationName: result.rows[0].name });
});

router.get("/link", requireAuth, async (req, res) => {
  const organizationId = await getUserOrgId(req.userId);
  if (!organizationId) {
    return res.status(409).json({ error: "Пользователь не состоит в организации" });
  }

  const existing = await pool.query(
    `SELECT token FROM org_invites
     WHERE organization_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [organizationId]
  );

  let token;
  if (existing.rows.length > 0) {
    token = existing.rows[0].token;
  } else {
    token = generateInviteToken();
    await pool.query(
      `INSERT INTO org_invites (organization_id, token, created_by, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id) DO UPDATE
         SET token = EXCLUDED.token, created_by = EXCLUDED.created_by,
             expires_at = EXCLUDED.expires_at, revoked_at = NULL`,
      [organizationId, token, req.userId, new Date(Date.now() + INVITE_TTL_MS)]
    );
  }

  res.json({ url: `${process.env.FRONTEND_ORIGIN || "http://localhost:5173"}/register?invite=${token}` });
});

router.post("/link/regenerate", requireAuth, async (req, res) => {
  const organizationId = await getUserOrgId(req.userId);
  if (!organizationId) {
    return res.status(409).json({ error: "Пользователь не состоит в организации" });
  }

  const token = generateInviteToken();
  await pool.query(
    `INSERT INTO org_invites (organization_id, token, created_by, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id) DO UPDATE
       SET token = EXCLUDED.token, created_by = EXCLUDED.created_by,
           expires_at = EXCLUDED.expires_at, revoked_at = NULL`,
    [organizationId, token, req.userId, new Date(Date.now() + INVITE_TTL_MS)]
  );

  res.json({ url: `${process.env.FRONTEND_ORIGIN || "http://localhost:5173"}/register?invite=${token}` });
});

router.post("/emails", requireAuth, async (req, res) => {
  const { emails } = req.body;
  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: "emails должен быть непустым массивом" });
  }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalid = emails.filter((e) => !emailPattern.test(e));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Некорректные адреса: ${invalid.join(", ")}` });
  }

  const organizationId = await getUserOrgId(req.userId);
  if (!organizationId) {
    return res.status(409).json({ error: "Пользователь не состоит в организации" });
  }

  if (!isMailerConfigured()) {
    return res.status(503).json({ error: "Отправка почты не настроена" });
  }

  const linkResult = await pool.query(
    `SELECT token FROM org_invites
     WHERE organization_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [organizationId]
  );
  let token = linkResult.rows[0]?.token;
  if (!token) {
    token = generateInviteToken();
    await pool.query(
      `INSERT INTO org_invites (organization_id, token, created_by, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [organizationId, token, req.userId, new Date(Date.now() + INVITE_TTL_MS)]
    );
  }
  const url = `${process.env.FRONTEND_ORIGIN || "http://localhost:5173"}/register?invite=${token}`;

  for (const email of emails) {
    await pool.query(
      `INSERT INTO org_invite_emails (organization_id, email, invited_by) VALUES ($1, $2, $3)`,
      [organizationId, email, req.userId]
    );
    await sendMail({
      to: email,
      subject: "Вас пригласили в Flowline",
      html: `<p>Вас пригласили присоединиться к организации в Flowline.</p><p><a href="${url}">Присоединиться</a></p>`,
    });
  }

  res.json({ invited: emails.length });
});

export default router;
```

- [ ] **Step 2: Mount the router in `backend/src/server.js`**

Add the import:

```javascript
import invitesRouter from "./routes/invites.js";
```

Add the mount line:

```javascript
app.use("/api/invites", invitesRouter);
```

- [ ] **Step 3: Manual verification**

```bash
curl -i -b /tmp/cookies.txt http://localhost:4000/api/invites/link
curl -i -b /tmp/cookies.txt -X POST http://localhost:4000/api/invites/link/regenerate
curl -i http://localhost:4000/api/invites/resolve/<token-from-previous-response>
```
Expected: first two return `{"url": "...?invite=<token>"}` with different tokens; resolve returns the organization name created in Task 6's manual test.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/invites.js backend/src/server.js
git commit -m "feat: add invite link and invite-by-email routes"
```

---

### Task 12: `.env.example` and `docker-compose.yml` updates

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add new variables to `.env.example`**

Append:

```
# OAuth
OAUTH_REDIRECT_BASE_URL=http://localhost:8080
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
APPLE_CLIENT_ID=
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY=

# SMTP (invite emails)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

- [ ] **Step 2: Pass the variables through to the backend service**

In `docker-compose.yml`, under the `backend` service's `environment:` block, add:

```yaml
      OAUTH_REDIRECT_BASE_URL: ${OAUTH_REDIRECT_BASE_URL:-http://localhost:8080}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:-}
      MICROSOFT_CLIENT_ID: ${MICROSOFT_CLIENT_ID:-}
      MICROSOFT_CLIENT_SECRET: ${MICROSOFT_CLIENT_SECRET:-}
      APPLE_CLIENT_ID: ${APPLE_CLIENT_ID:-}
      APPLE_TEAM_ID: ${APPLE_TEAM_ID:-}
      APPLE_KEY_ID: ${APPLE_KEY_ID:-}
      APPLE_PRIVATE_KEY: ${APPLE_PRIVATE_KEY:-}
      SMTP_HOST: ${SMTP_HOST:-}
      SMTP_PORT: ${SMTP_PORT:-587}
      SMTP_USER: ${SMTP_USER:-}
      SMTP_PASS: ${SMTP_PASS:-}
      SMTP_FROM: ${SMTP_FROM:-}
```

- [ ] **Step 3: Verify compose config parses**

Run: `docker compose config --quiet`
Expected: no output, exit code 0

- [ ] **Step 4: Commit**

```bash
git add .env.example docker-compose.yml
git commit -m "chore: wire OAuth and SMTP env vars through docker-compose"
```

---

### Task 13: Frontend API client additions

**Files:**
- Modify: `frontend/src/api.js`

- [ ] **Step 1: Read the existing file to match its conventions**

Run: `cat frontend/src/api.js` and confirm the existing pattern for making requests (base URL, credentials, error handling) before adding to it.

- [ ] **Step 2: Add new exported functions**

Add to `frontend/src/api.js`, following the same request-helper pattern already used by the existing functions in that file (e.g. if there's a shared `request(path, options)` helper, reuse it):

```javascript
export function getOAuthProviders() {
  return request("/auth/oauth/providers");
}

export function startOAuth(provider) {
  window.location.href = `${API_BASE}/auth/oauth/${provider}/start`;
}

export function resolveInvite(token) {
  return request(`/invites/resolve/${token}`);
}

export function submitOnboarding({ fullName, position, companyName, inviteToken }) {
  return request("/auth/onboarding", {
    method: "POST",
    body: JSON.stringify({ fullName, position, companyName, inviteToken }),
  });
}

export function getInviteLink() {
  return request("/invites/link");
}

export function regenerateInviteLink() {
  return request("/invites/link/regenerate", { method: "POST" });
}

export function inviteByEmail(emails) {
  return request("/invites/emails", {
    method: "POST",
    body: JSON.stringify({ emails }),
  });
}
```

Note: `API_BASE` must reference whatever base-URL constant the existing file already defines (e.g. `VITE_API_URL` or `/api`) — match the existing export name, do not introduce a second one.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.js
git commit -m "feat: add frontend API calls for OAuth, onboarding, and invites"
```

---

### Task 14: OnboardingScreen and InviteTeammatesScreen components

**Files:**
- Create: `frontend/src/components/OnboardingScreen.jsx`
- Create: `frontend/src/components/InviteTeammatesScreen.jsx`

- [ ] **Step 1: Read an existing screen component for styling/structure conventions**

Run: `cat frontend/src/components/AuthScreen.jsx` to match Tailwind class patterns, form layout, and error-display conventions already established.

- [ ] **Step 2: Write `OnboardingScreen.jsx`**

```jsx
import { useEffect, useState } from "react";
import { resolveInvite, submitOnboarding } from "../api.js";

export default function OnboardingScreen({ inviteToken, onComplete }) {
  const [orgName, setOrgName] = useState(null);
  const [fullName, setFullName] = useState("");
  const [position, setPosition] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!inviteToken) return;
    resolveInvite(inviteToken)
      .then((res) => setOrgName(res.organizationName))
      .catch(() => setError("Ссылка-приглашение недействительна или истекла"));
  }, [inviteToken]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await submitOnboarding({
        fullName,
        position,
        companyName: inviteToken ? undefined : companyName,
        inviteToken,
      });
      onComplete(result);
    } catch (err) {
      setError(err.message || "Не удалось завершить онбординг");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-md w-full max-w-md space-y-4">
        <h1 className="text-xl font-semibold">Расскажите о себе</h1>
        {inviteToken && orgName && (
          <p className="text-sm text-gray-600">
            Вы присоединяетесь к организации <strong>{orgName}</strong>
          </p>
        )}
        {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>}
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Полное имя"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Должность"
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          required
        />
        {!inviteToken && (
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="Название компании"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            required
          />
        )}
        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-indigo-600 text-white rounded px-3 py-2 disabled:opacity-50"
        >
          {submitting ? "Сохраняем..." : "Продолжить"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Write `InviteTeammatesScreen.jsx`**

```jsx
import { useState } from "react";
import { getInviteLink, regenerateInviteLink, inviteByEmail } from "../api.js";

export default function InviteTeammatesScreen({ onDone }) {
  const [tab, setTab] = useState("link");
  const [link, setLink] = useState(null);
  const [emailsInput, setEmailsInput] = useState("");
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  async function loadLink() {
    setError(null);
    try {
      const res = await getInviteLink();
      setLink(res.url);
    } catch (err) {
      setError(err.message || "Не удалось получить ссылку");
    }
  }

  async function handleRegenerate() {
    setError(null);
    try {
      const res = await regenerateInviteLink();
      setLink(res.url);
    } catch (err) {
      setError(err.message || "Не удалось обновить ссылку");
    }
  }

  async function handleSendEmails(e) {
    e.preventDefault();
    setError(null);
    const emails = emailsInput
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await inviteByEmail(emails);
      setSent(true);
    } catch (err) {
      setError(err.message || "Не удалось отправить приглашения");
    }
  }

  if (!link && tab === "link") {
    loadLink();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md space-y-4">
        <h1 className="text-xl font-semibold">Пригласите команду</h1>
        <div className="flex gap-2">
          <button
            className={`px-3 py-1 rounded ${tab === "link" ? "bg-indigo-600 text-white" : "bg-gray-100"}`}
            onClick={() => setTab("link")}
          >
            Ссылка
          </button>
          <button
            className={`px-3 py-1 rounded ${tab === "emails" ? "bg-indigo-600 text-white" : "bg-gray-100"}`}
            onClick={() => setTab("emails")}
          >
            По email
          </button>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>}

        {tab === "link" && (
          <div className="space-y-2">
            <input className="w-full border rounded px-3 py-2 text-sm" readOnly value={link || ""} />
            <button className="text-sm text-indigo-600" onClick={handleRegenerate}>
              Сгенерировать новую ссылку
            </button>
          </div>
        )}

        {tab === "emails" && !sent && (
          <form onSubmit={handleSendEmails} className="space-y-2">
            <textarea
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="email1@example.com, email2@example.com"
              value={emailsInput}
              onChange={(e) => setEmailsInput(e.target.value)}
            />
            <button type="submit" className="w-full bg-indigo-600 text-white rounded px-3 py-2">
              Отправить приглашения
            </button>
          </form>
        )}
        {tab === "emails" && sent && <p className="text-sm text-green-600">Приглашения отправлены.</p>}

        <button onClick={onDone} className="w-full text-sm text-gray-500">
          Пропустить
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/OnboardingScreen.jsx frontend/src/components/InviteTeammatesScreen.jsx
git commit -m "feat: add OnboardingScreen and InviteTeammatesScreen components"
```

---

### Task 15: Wire routing in `App.jsx` and OAuth buttons in `AuthScreen.jsx`

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/AuthScreen.jsx`

- [ ] **Step 1: Read both files to find the existing screen-switching logic and the register-form fields**

Run: `cat frontend/src/App.jsx frontend/src/components/AuthScreen.jsx`. Identify: (a) how `App.jsx` currently decides which screen to render based on auth state, (b) the `organizationName` input in `AuthScreen.jsx`'s register form to remove, (c) the existing OAuth-button-free button layout to extend.

- [ ] **Step 2: Remove `organizationName` from `AuthScreen.jsx`'s register form**

Delete the input field and its corresponding state variable bound to `organizationName` (or equivalent name used in that file), and remove it from the object passed to the register API call.

- [ ] **Step 3: Add OAuth buttons to `AuthScreen.jsx`**

Above the existing email/password form, add (adjusting to match the file's existing import of `startOAuth` and any provider-list state already fetched via `getOAuthProviders` on mount):

```jsx
{providers.length > 0 && (
  <div className="space-y-2 mb-4">
    {providers.includes("google") && (
      <button onClick={() => startOAuth("google")} className="w-full border rounded px-3 py-2">
        Войти через Google
      </button>
    )}
    {providers.includes("microsoft") && (
      <button onClick={() => startOAuth("microsoft")} className="w-full border rounded px-3 py-2">
        Войти через Microsoft
      </button>
    )}
    {providers.includes("apple") && (
      <button onClick={() => startOAuth("apple")} className="w-full border rounded px-3 py-2">
        Войти через Apple
      </button>
    )}
  </div>
)}
```

Add a `useEffect` that calls `getOAuthProviders().then((res) => setProviders(res.providers))` on mount, with `providers` initialized to `[]` via `useState`.

- [ ] **Step 4: Add onboarding/invite routing to `App.jsx`**

In the part of `App.jsx` that decides which top-level screen to show based on the current user (loaded via `/auth/me`), insert this branching ahead of the existing logged-in routing:

```jsx
const inviteToken = new URLSearchParams(window.location.search).get("invite");

if (user && !user.organization) {
  return (
    <OnboardingScreen
      inviteToken={inviteToken}
      onComplete={(result) => {
        if (result.becameOwner) {
          setShowInviteScreen(true);
        }
        refreshUser();
      }}
    />
  );
}

if (showInviteScreen) {
  return <InviteTeammatesScreen onDone={() => setShowInviteScreen(false)} />;
}
```

Add `const [showInviteScreen, setShowInviteScreen] = useState(false);` near the other `useState` calls in `App.jsx`, and import `OnboardingScreen` and `InviteTeammatesScreen` at the top. `refreshUser` should call whatever existing function in `App.jsx` re-fetches `/auth/me` after a state-changing action (matching the pattern already used after login/register).

- [ ] **Step 5: Manual verification in the browser**

Run: `docker compose up --build`, open `http://localhost:8080`, register a new account, confirm you land on the Onboarding screen, submit it, confirm you land on the Invite Teammates screen, click "Пропустить", confirm you land on the Projects screen. Then log out, open the invite link copied during that flow in a new private browser window, register a second account through it, and confirm that account lands on Onboarding without a company-name field and ends up in the same organization (visible on the Team screen).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.jsx frontend/src/components/AuthScreen.jsx
git commit -m "feat: wire onboarding and invite screens into app routing, add OAuth buttons"
```

---

## Self-Review Notes

- **Spec coverage:** OAuth (Google/Apple/Microsoft) → Tasks 7–10; email/password registration → Task 6; onboarding (full name/position/company) → Tasks 6, 14; invite-teammates step with skip → Tasks 11, 14, 15; generic link + email invites → Task 11; auto-mapping invited users to org → Task 6 (`inviteToken` branch); account auto-linking by verified email → Task 10 (`existingUser` lookup); `password_hash` nullable, slug generation, `/auth/me` organization field, dropped `organizationName` from register → Tasks 5, 6, 15.
- **Type consistency:** `exchangeCode(code, fetchImpl)` signature is identical across `google.js`/`microsoft.js`/`apple.js`; all three return the same `{ providerUserId, email, emailVerified, name }` shape, consumed uniformly in `oauth.js`'s callback handler. `getProviderModule`/`listEnabledProviders` names match between `registry.js` and `oauth.js`. `submitOnboarding`/`getInviteLink`/`regenerateInviteLink`/`inviteByEmail` names match between `api.js` and the two new screen components.
- **No placeholders:** all code blocks are complete; the only intentionally-fake values are the Apple test's dummy private key (clearly commented `test key not real`) and the manual-verification steps requiring real third-party dev credentials, which is unavoidable for live OAuth handshakes.
