import express from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { signToken, requireAuth, COOKIE_OPTIONS } from "../middleware/auth.js";

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
  const { email, password, fullName, organizationName } = req.body;
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

    // Каждый новый регистрирующийся создаёт свою организацию (упрощённая модель —
    // в реальном проде сюда добавляется приглашение в существующую организацию)
    const orgResult = await client.query(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [organizationName || `${fullName}'s Workspace`, `org-${Date.now()}`]
    );
    const organizationId = orgResult.rows[0].id;

    const userResult = await client.query(
      `INSERT INTO users (email, full_name, initials, avatar_color, password_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email, full_name, initials, avatar_color`,
      [email, fullName, initials, color, passwordHash]
    );
    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, org_role) VALUES ($1, $2, 'owner')`,
      [organizationId, user.id]
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
      `SELECT u.id, u.email, u.full_name, u.initials, u.avatar_color, u.department_id,
              d.name AS department_name, d.color AS department_color
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
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
      department: user.department_id
        ? { id: user.department_id, name: user.department_name, color: user.department_color }
        : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка получения профиля" });
  }
});

export default router;
