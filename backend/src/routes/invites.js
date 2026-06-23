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
    const newToken = generateInviteToken();
    const upserted = await pool.query(
      `INSERT INTO org_invites (organization_id, token, created_by, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id) DO UPDATE
         SET token = EXCLUDED.token, created_by = EXCLUDED.created_by,
             expires_at = EXCLUDED.expires_at, revoked_at = NULL
       RETURNING token`,
      [organizationId, newToken, req.userId, new Date(Date.now() + INVITE_TTL_MS)]
    );
    token = upserted.rows[0].token;
  }

  res.json({ url: `${process.env.FRONTEND_ORIGIN || "http://localhost:5173"}/register?invite=${token}` });
});

router.post("/link/regenerate", requireAuth, async (req, res) => {
  const organizationId = await getUserOrgId(req.userId);
  if (!organizationId) {
    return res.status(409).json({ error: "Пользователь не состоит в организации" });
  }

  const newToken = generateInviteToken();
  const upserted = await pool.query(
    `INSERT INTO org_invites (organization_id, token, created_by, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id) DO UPDATE
       SET token = EXCLUDED.token, created_by = EXCLUDED.created_by,
           expires_at = EXCLUDED.expires_at, revoked_at = NULL
     RETURNING token`,
    [organizationId, newToken, req.userId, new Date(Date.now() + INVITE_TTL_MS)]
  );
  const token = upserted.rows[0].token;

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
    const newToken = generateInviteToken();
    const upserted = await pool.query(
      `INSERT INTO org_invites (organization_id, token, created_by, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id) DO UPDATE
         SET token = EXCLUDED.token, created_by = EXCLUDED.created_by,
             expires_at = EXCLUDED.expires_at, revoked_at = NULL
       RETURNING token`,
      [organizationId, newToken, req.userId, new Date(Date.now() + INVITE_TTL_MS)]
    );
    token = upserted.rows[0].token;
  }
  const url = `${process.env.FRONTEND_ORIGIN || "http://localhost:5173"}/register?invite=${token}`;

  const results = { sent: [], failed: [] };
  for (const email of emails) {
    await pool.query(
      `INSERT INTO org_invite_emails (organization_id, email, invited_by) VALUES ($1, $2, $3)`,
      [organizationId, email, req.userId]
    );
    try {
      await sendMail({
        to: email,
        subject: "Вас пригласили в Flowline",
        html: `<p>Вас пригласили присоединиться к организации в Flowline.</p><p><a href="${url}">Присоединиться</a></p>`,
      });
      results.sent.push(email);
    } catch (err) {
      console.error(`Failed to send invite email to ${email}:`, err);
      results.failed.push(email);
    }
  }

  res.json({ invited: results.sent.length, sent: results.sent, failed: results.failed });
});

export default router;
