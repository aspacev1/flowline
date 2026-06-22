import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

// получить организацию текущего пользователя (упрощённая модель — одна организация на пользователя)
async function getOrgId(userId) {
  const result = await pool.query(
    `SELECT organization_id FROM organization_members WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return result.rows[0]?.organization_id || null;
}

// GET /api/team — все отделы организации со списком участников
router.get("/", async (req, res) => {
  try {
    const organizationId = await getOrgId(req.userId);
    if (!organizationId) return res.json({ departments: [] });

    const deptResult = await pool.query(
      `SELECT id, name, color FROM departments WHERE organization_id = $1 ORDER BY name`,
      [organizationId]
    );

    const peopleResult = await pool.query(
      `SELECT u.id, u.full_name, u.initials, u.avatar_color, u.department_id
       FROM users u
       JOIN organization_members om ON om.user_id = u.id
       WHERE om.organization_id = $1
       ORDER BY u.full_name`,
      [organizationId]
    );

    const departments = deptResult.rows.map((d) => ({
      id: d.id,
      name: d.name,
      color: d.color,
      members: peopleResult.rows
        .filter((p) => p.department_id === d.id)
        .map((p) => ({ id: p.id, name: p.full_name, initials: p.initials, color: p.avatar_color })),
    }));

    const unassigned = peopleResult.rows
      .filter((p) => !p.department_id)
      .map((p) => ({ id: p.id, name: p.full_name, initials: p.initials, color: p.avatar_color }));

    res.json({ departments, unassigned });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось загрузить команду" });
  }
});

// GET /api/team/people — плоский список всех людей организации (для селекторов исполнителя)
router.get("/people", async (req, res) => {
  try {
    const organizationId = await getOrgId(req.userId);
    if (!organizationId) return res.json({ people: [] });

    const result = await pool.query(
      `SELECT u.id, u.full_name, u.initials, u.avatar_color, u.department_id,
              d.name AS department_name, d.color AS department_color
       FROM users u
       JOIN organization_members om ON om.user_id = u.id
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE om.organization_id = $1
       ORDER BY u.full_name`,
      [organizationId]
    );

    res.json({
      people: result.rows.map((p) => ({
        id: p.id,
        name: p.full_name,
        initials: p.initials,
        color: p.avatar_color,
        department: p.department_id ? { id: p.department_id, name: p.department_name, color: p.department_color } : null,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось загрузить список людей" });
  }
});

export default router;
