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
