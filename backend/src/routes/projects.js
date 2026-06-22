import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

async function getOrgId(userId) {
  const result = await pool.query(
    `SELECT organization_id FROM organization_members WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return result.rows[0]?.organization_id || null;
}

// GET /api/projects — список проектов организации
router.get("/", async (req, res) => {
  try {
    const organizationId = await getOrgId(req.userId);
    if (!organizationId) return res.json({ projects: [] });

    const result = await pool.query(
      `SELECT id, name, color, created_at FROM projects
       WHERE organization_id = $1 AND archived_at IS NULL
       ORDER BY created_at`,
      [organizationId]
    );

    res.json({ projects: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось загрузить проекты" });
  }
});

// POST /api/projects — создать проект
router.post("/", async (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: "name обязателен" });

  const client = await pool.connect().catch((err) => {
    console.error("DB connection failed:", err.message);
    return null;
  });
  if (!client) {
    return res.status(503).json({ error: "База данных недоступна, попробуйте позже" });
  }

  try {
    const organizationId = await getOrgId(req.userId);
    if (!organizationId) return res.status(400).json({ error: "Нет организации" });

    await client.query("BEGIN");

    const projectResult = await client.query(
      `INSERT INTO projects (organization_id, name, color, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id, name, color, created_at`,
      [organizationId, name, color || "#4F5DFF", req.userId]
    );
    const project = projectResult.rows[0];

    await client.query(
      `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'manager')`,
      [project.id, req.userId]
    );

    await client.query("COMMIT");
    res.status(201).json(project);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Не удалось создать проект" });
  } finally {
    client.release();
  }
});

// GET /api/projects/:id — детали проекта + участники
router.get("/:id", async (req, res) => {
  try {
    const projectResult = await pool.query(
      `SELECT id, name, color, created_at FROM projects WHERE id = $1`,
      [req.params.id]
    );
    const project = projectResult.rows[0];
    if (!project) return res.status(404).json({ error: "Проект не найден" });

    const membersResult = await pool.query(
      `SELECT pm.role, u.id, u.full_name, u.initials, u.avatar_color
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1`,
      [req.params.id]
    );

    res.json({
      ...project,
      members: membersResult.rows.map((m) => ({
        id: m.id,
        name: m.full_name,
        initials: m.initials,
        color: m.avatar_color,
        role: m.role,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось загрузить проект" });
  }
});

// PATCH /api/projects/:id — переименовать / изменить цвет
router.patch("/:id", async (req, res) => {
  const { name, color } = req.body;
  try {
    const result = await pool.query(
      `UPDATE projects SET name = COALESCE($1, name), color = COALESCE($2, color)
       WHERE id = $3 RETURNING id, name, color, created_at`,
      [name, color, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Проект не найден" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось обновить проект" });
  }
});

// DELETE /api/projects/:id — архивировать (мягкое удаление)
router.delete("/:id", async (req, res) => {
  try {
    await pool.query(`UPDATE projects SET archived_at = now() WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось удалить проект" });
  }
});

// POST /api/projects/:id/members — добавить участника (неограниченное число коллабораторов/менеджеров)
router.post("/:id/members", async (req, res) => {
  const { userId, role } = req.body;
  if (!userId) return res.status(400).json({ error: "userId обязателен" });
  try {
    await pool.query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [req.params.id, userId, role || "collaborator"]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось добавить участника" });
  }
});

export default router;
