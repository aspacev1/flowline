import express from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { signToken, requireAuth, COOKIE_OPTIONS } from "../middleware/auth.js";
import { slugifyOrgName } from "../utils/slugify.js";

const router = express.Router();

// Простая палитра для новых пользователей при регистрации
const AVATAR_COLORS = ["#4F5DFF", "#E8A33D", "#2FB67C", "#E0567C", "#9061F9"];

function initialsFromName(name) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
}

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

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email и password обязательны" });
  }

  try {
    const result = await pool.query(
      `SELECT id, email, full_name, initials, avatar_color, password_hash FROM users WHERE email = $1`,
      [email]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: "Неверная почта или пароль" });
    }

    if (!user.password_hash) {
      return res.status(401).json({ error: "Для этого аккаунта вход по паролю не настроен. Используйте OAuth." });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Неверная почта или пароль" });
    }

    const token = signToken(user);
    res.cookie("token", token, COOKIE_OPTIONS);
    res.json({
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      initials: user.initials,
      avatarColor: user.avatar_color,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка входа" });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie("token", { ...COOKIE_OPTIONS, maxAge: undefined });
  res.json({ ok: true });
});

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

export default router;
