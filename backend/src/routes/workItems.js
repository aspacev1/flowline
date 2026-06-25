import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { workEndDate, daysBetween } from "../utils/workdays.js";

const router = express.Router();
router.use(requireAuth);

async function getOrgId(userId) {
  const result = await pool.query(
    `SELECT organization_id FROM organization_members WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return result.rows[0]?.organization_id || null;
}

// проект и любая задача/подзадача внутри него должны принадлежать
// организации вызывающего — иначе можно читать/менять чужие данные,
// подставив project/work-item id в URL
async function projectInOrg(projectId, organizationId) {
  const result = await pool.query(
    `SELECT 1 FROM projects WHERE id = $1 AND organization_id = $2`,
    [projectId, organizationId]
  );
  return result.rowCount > 0;
}

async function workItemInOrg(workItemId, organizationId) {
  const result = await pool.query(
    `SELECT 1 FROM work_items wi
     JOIN projects p ON p.id = wi.project_id
     WHERE wi.id = $1 AND p.organization_id = $2`,
    [workItemId, organizationId]
  );
  return result.rowCount > 0;
}

const FIELD_LABELS = {
  name: "Название",
  start_date: "Дата начала",
  duration_days: "Запланировано",
  logged_hours: "Потрачено",
  status: "Статус",
  priority: "Приоритет",
  assignee_id: "Исполнитель",
};

// строит записи истории, сравнивая старые и новые значения изменённых полей
function buildHistoryEntries(oldRow, patch, changedBy) {
  const entries = [];
  for (const field of Object.keys(patch)) {
    if (!(field in FIELD_LABELS)) continue;
    const oldValue = oldRow[field];
    const newValue = patch[field];
    let changed;
    if (field === "start_date") {
      changed = new Date(oldValue).toDateString() !== new Date(newValue).toDateString();
    } else {
      changed = String(oldValue) !== String(newValue);
    }
    if (!changed) continue;
    entries.push({
      field,
      oldValue: oldValue === null || oldValue === undefined ? null : String(oldValue),
      newValue: newValue === null || newValue === undefined ? null : String(newValue),
      changedBy,
    });
  }
  return entries;
}

async function insertHistoryEntries(client, workItemId, entries) {
  for (const e of entries) {
    await client.query(
      `INSERT INTO work_item_history (work_item_id, field, old_value, new_value, changed_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [workItemId, e.field, e.oldValue, e.newValue, e.changedBy]
    );
  }
}

// проверка циклов в графе зависимостей через обход в глубину
async function wouldCreateCycle(client, predecessorId, successorId) {
  if (predecessorId === successorId) return true;
  const visited = new Set();
  const stack = [successorId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === predecessorId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const result = await client.query(
      `SELECT successor_id FROM work_item_dependencies WHERE predecessor_id = $1`,
      [current]
    );
    for (const row of result.rows) stack.push(row.successor_id);
  }
  return false;
}

function mapRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    start: row.start_date,
    duration: row.duration_days,
    status: row.status,
    priority: row.priority,
    loggedHours: Number(row.logged_hours),
    assignee: row.assignee_id,
    originalEndDate: row.original_end_date,
    parentId: row.parent_task_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/projects/:projectId/work-items — все задачи+подзадачи+зависимости проекта
router.get("/projects/:projectId/work-items", async (req, res) => {
  try {
    const organizationId = await getOrgId(req.userId);
    if (!organizationId || !(await projectInOrg(req.params.projectId, organizationId))) {
      return res.status(404).json({ error: "Проект не найден" });
    }

    const itemsResult = await pool.query(
      `SELECT wi.*, s.parent_task_id
       FROM work_items wi
       LEFT JOIN subtasks s ON s.work_item_id = wi.id
       WHERE wi.project_id = $1
       ORDER BY wi.created_at`,
      [req.params.projectId]
    );

    const depsResult = await pool.query(
      `SELECT wd.predecessor_id, wd.successor_id
       FROM work_item_dependencies wd
       JOIN work_items wi ON wi.id = wd.successor_id
       WHERE wi.project_id = $1`,
      [req.params.projectId]
    );

    const depsBySuccessor = {};
    for (const d of depsResult.rows) {
      if (!depsBySuccessor[d.successor_id]) depsBySuccessor[d.successor_id] = [];
      depsBySuccessor[d.successor_id].push(d.predecessor_id);
    }

    const items = itemsResult.rows.map((row) => ({
      ...mapRow(row),
      deps: depsBySuccessor[row.id] || [],
    }));

    res.json({ items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось загрузить задачи" });
  }
});

// POST /api/projects/:projectId/work-items — создать задачу или подзадачу
router.post("/projects/:projectId/work-items", async (req, res) => {
  const { kind, name, start, duration, status, priority, assignee, parentId, deps } = req.body;
  if (!kind || !["task", "subtask"].includes(kind)) {
    return res.status(400).json({ error: "kind должен быть 'task' или 'subtask'" });
  }
  if (!name || !start || !duration) {
    return res.status(400).json({ error: "name, start и duration обязательны" });
  }
  if (kind === "subtask" && !parentId) {
    return res.status(400).json({ error: "subtask требует parentId" });
  }

  const organizationId = await getOrgId(req.userId);
  if (!organizationId || !(await projectInOrg(req.params.projectId, organizationId))) {
    return res.status(404).json({ error: "Проект не найден" });
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

    const startDate = new Date(start);
    const originalEndDate = workEndDate(startDate, duration);

    const itemResult = await client.query(
      `INSERT INTO work_items
        (project_id, kind, name, start_date, duration_days, status, priority, assignee_id, original_end_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        req.params.projectId,
        kind,
        name,
        startDate,
        duration,
        status || "todo",
        priority || "medium",
        assignee || null,
        originalEndDate,
        req.userId,
      ]
    );
    const item = itemResult.rows[0];

    if (kind === "task") {
      await client.query(`INSERT INTO tasks (work_item_id) VALUES ($1)`, [item.id]);
    } else {
      await client.query(`INSERT INTO subtasks (work_item_id, parent_task_id) VALUES ($1, $2)`, [item.id, parentId]);
    }

    if (Array.isArray(deps)) {
      for (const depId of deps) {
        await client.query(
          `INSERT INTO work_item_dependencies (predecessor_id, successor_id) VALUES ($1, $2)`,
          [depId, item.id]
        );
      }
    }

    await client.query("COMMIT");
    res.status(201).json({ ...mapRow(item), deps: deps || [], parentId: parentId || null });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Не удалось создать задачу" });
  } finally {
    client.release();
  }
});

// PATCH /api/work-items/:id — обновить поля задачи/подзадачи, журналируя изменения
// body: { patch: {...}, confirmedDelay: bool } — confirmedDelay подтверждает
// сдвиг дедлайна вправо (см. диалог подтверждения в интерфейсе)
router.patch("/work-items/:id", async (req, res) => {
  const { patch, confirmedDelay } = req.body;
  if (!patch || typeof patch !== "object") {
    return res.status(400).json({ error: "patch обязателен" });
  }

  const organizationId = await getOrgId(req.userId);
  if (!organizationId || !(await workItemInOrg(req.params.id, organizationId))) {
    return res.status(404).json({ error: "Задача не найдена" });
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

    const currentResult = await client.query(`SELECT * FROM work_items WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const current = currentResult.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Задача не найдена" });
    }

    // если меняются даты/длительность, проверяем — не задержка ли это
    const newStart = patch.start ? new Date(patch.start) : current.start_date;
    const newDuration = patch.duration ?? current.duration_days;
    const touchesSchedule = "start" in patch || "duration" in patch;

    if (touchesSchedule) {
      const newEnd = workEndDate(newStart, newDuration);
      const isDelay = daysBetween(new Date(current.original_end_date), newEnd) > 0;
      if (isDelay && !confirmedDelay) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "SCHEDULE_DELAY_REQUIRES_CONFIRMATION",
          message: "Это изменение сдвигает дедлайн вправо относительно исходного плана",
          originalEndDate: current.original_end_date,
          newEndDate: newEnd,
        });
      }
    }

    // строим dbPatch (snake_case) из входящего patch (camelCase)
    const dbPatch = {};
    if ("name" in patch) dbPatch.name = patch.name;
    if ("start" in patch) dbPatch.start_date = newStart;
    if ("duration" in patch) dbPatch.duration_days = newDuration;
    if ("status" in patch) dbPatch.status = patch.status;
    if ("priority" in patch) dbPatch.priority = patch.priority;
    if ("loggedHours" in patch) dbPatch.logged_hours = patch.loggedHours;
    if ("assignee" in patch) dbPatch.assignee_id = patch.assignee;

    const historyEntries = buildHistoryEntries(current, dbPatch, req.userId);

    const setClauses = Object.keys(dbPatch).map((k, i) => `${k} = $${i + 1}`);
    const values = Object.values(dbPatch);
    if (setClauses.length > 0) {
      await client.query(
        `UPDATE work_items SET ${setClauses.join(", ")}, updated_at = now() WHERE id = $${values.length + 1}`,
        [...values, req.params.id]
      );
    }

    await insertHistoryEntries(client, req.params.id, historyEntries);

    await client.query("COMMIT");

    const updatedResult = await pool.query(
      `SELECT wi.*, s.parent_task_id FROM work_items wi
       LEFT JOIN subtasks s ON s.work_item_id = wi.id
       WHERE wi.id = $1`,
      [req.params.id]
    );
    res.json(mapRow(updatedResult.rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Не удалось обновить задачу" });
  } finally {
    client.release();
  }
});

// GET /api/work-items/:id/history — журнал изменений
router.get("/work-items/:id/history", async (req, res) => {
  try {
    const organizationId = await getOrgId(req.userId);
    if (!organizationId || !(await workItemInOrg(req.params.id, organizationId))) {
      return res.status(404).json({ error: "Задача не найдена" });
    }

    const result = await pool.query(
      `SELECT h.*, u.full_name, u.initials, u.avatar_color
       FROM work_item_history h
       JOIN users u ON u.id = h.changed_by
       WHERE h.work_item_id = $1
       ORDER BY h.changed_at DESC`,
      [req.params.id]
    );
    res.json({
      history: result.rows.map((h) => ({
        id: h.id,
        field: h.field,
        fieldLabel: FIELD_LABELS[h.field] || h.field,
        oldValue: h.old_value,
        newValue: h.new_value,
        changedAt: h.changed_at,
        changedBy: { id: h.changed_by, name: h.full_name, initials: h.initials, color: h.avatar_color },
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось загрузить историю" });
  }
});

// DELETE /api/work-items/:id
router.delete("/work-items/:id", async (req, res) => {
  try {
    const organizationId = await getOrgId(req.userId);
    if (!organizationId || !(await workItemInOrg(req.params.id, organizationId))) {
      return res.status(404).json({ error: "Задача не найдена" });
    }

    await pool.query(`DELETE FROM work_items WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось удалить задачу" });
  }
});

// POST /api/work-items/:id/dependencies — добавить зависимость (с проверкой цикла)
router.post("/work-items/:id/dependencies", async (req, res) => {
  const { predecessorId } = req.body;
  if (!predecessorId) return res.status(400).json({ error: "predecessorId обязателен" });

  const organizationId = await getOrgId(req.userId);
  if (
    !organizationId ||
    !(await workItemInOrg(req.params.id, organizationId)) ||
    !(await workItemInOrg(predecessorId, organizationId))
  ) {
    return res.status(404).json({ error: "Задача не найдена" });
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
    const cycle = await wouldCreateCycle(client, predecessorId, req.params.id);
    if (cycle) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Эта зависимость создала бы цикл" });
    }
    await client.query(
      `INSERT INTO work_item_dependencies (predecessor_id, successor_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [predecessorId, req.params.id]
    );
    await client.query("COMMIT");
    res.status(201).json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Не удалось добавить зависимость" });
  } finally {
    client.release();
  }
});

export default router;
