-- ============================================================
-- Flowline — схема БД (PostgreSQL 15+)
-- Принципы:
--   * Нет искусственных лимитов: участники, менеджеры, задачи,
--     подзадачи — все через обычные join-таблицы, без полей
--     типа max_members.
--   * work_items — общий слой для task и subtask, чтобы
--     зависимости и Гант-логика были единой моделью.
--   * У каждого work_item один ответственный (assignee_id),
--     не многие-ко-многим — так решили в прототипе.
--   * duration_days означает РАБОЧИЕ дни (5-дневная неделя),
--     не календарные. Конец задачи вычисляется в коде приложения.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- для gen_random_uuid()

-- ---------- Организации и пользователи ----------

CREATE TABLE organizations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    slug        text NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           text NOT NULL UNIQUE,
    full_name       text NOT NULL,
    initials        text NOT NULL,
    avatar_color    text NOT NULL DEFAULT '#4F5DFF',
    password_hash   text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_role        text NOT NULL DEFAULT 'member'
                      CHECK (org_role IN ('owner', 'admin', 'member')),
    joined_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, user_id)
);

-- ---------- Отделы ----------
-- Один отдел на человека (простая связь, не many-to-many).

CREATE TABLE departments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            text NOT NULL,
    color           text NOT NULL DEFAULT '#9061F9',
    created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN department_id uuid REFERENCES departments(id) ON DELETE SET NULL;

-- ---------- Проекты ----------

CREATE TABLE projects (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name             text NOT NULL,
    color            text NOT NULL DEFAULT '#4F5DFF',
    created_by       uuid NOT NULL REFERENCES users(id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    archived_at      timestamptz
);

-- Участники проекта. Роль "manager" — привилегия внутри
-- конкретного проекта, не организации. Неограниченное число
-- строк = неограниченное число коллабораторов и менеджеров.
CREATE TABLE project_members (
    project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        text NOT NULL DEFAULT 'collaborator'
                  CHECK (role IN ('manager', 'collaborator', 'viewer')),
    added_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

CREATE INDEX idx_project_members_user ON project_members(user_id);

-- ---------- Общий слой work_items ----------
-- task и subtask — это два "вида" work_item. Зависимости,
-- даты, статус, приоритет и часы живут здесь единообразно.

CREATE TABLE work_items (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind             text NOT NULL CHECK (kind IN ('task', 'subtask')),
    name             text NOT NULL,
    start_date       date NOT NULL,
    duration_days    integer NOT NULL CHECK (duration_days >= 1), -- рабочие дни
    status           text NOT NULL DEFAULT 'todo'
                       CHECK (status IN ('todo', 'in_progress', 'in_review', 'delayed', 'blocked', 'completed', 'archived')),
    priority         text NOT NULL DEFAULT 'medium'
                       CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    logged_hours     numeric(6,1) NOT NULL DEFAULT 0 CHECK (logged_hours >= 0),
    assignee_id      uuid REFERENCES users(id), -- один ответственный, не many-to-many
    original_end_date date NOT NULL, -- зафиксирован один раз при создании, не меняется
    created_by       uuid NOT NULL REFERENCES users(id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_work_items_project ON work_items(project_id);
CREATE INDEX idx_work_items_assignee ON work_items(assignee_id);
CREATE INDEX idx_work_items_dates ON work_items(start_date, duration_days);

-- task — верхнеуровневая работа в проекте
CREATE TABLE tasks (
    work_item_id  uuid PRIMARY KEY REFERENCES work_items(id) ON DELETE CASCADE
);

-- subtask — расширение work_item, обязательно принадлежит task.
-- Подзадач у одной задачи — неограниченное количество (строки).
CREATE TABLE subtasks (
    work_item_id   uuid PRIMARY KEY REFERENCES work_items(id) ON DELETE CASCADE,
    parent_task_id uuid NOT NULL REFERENCES tasks(work_item_id) ON DELETE CASCADE
);

CREATE INDEX idx_subtasks_parent ON subtasks(parent_task_id);

-- ---------- Зависимости ----------
-- Ссылаются на work_items.id, поэтому одинаково работают
-- между task<->task, task<->subtask, subtask<->subtask.

CREATE TABLE work_item_dependencies (
    predecessor_id  uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    successor_id    uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    dependency_type text NOT NULL DEFAULT 'finish_to_start'
                      CHECK (dependency_type IN
                        ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish')),
    PRIMARY KEY (predecessor_id, successor_id),
    CHECK (predecessor_id <> successor_id)
);

CREATE INDEX idx_deps_successor ON work_item_dependencies(successor_id);

-- ---------- История изменений ----------
-- Журналирует любое изменение поля work_item: дата, статус,
-- приоритет, исполнитель, часы, название.

CREATE TABLE work_item_history (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_item_id uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    field        text NOT NULL,
    old_value    text,
    new_value    text,
    changed_by   uuid NOT NULL REFERENCES users(id),
    changed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_history_work_item ON work_item_history(work_item_id, changed_at DESC);

-- ---------- Комментарии ----------

CREATE TABLE comments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_item_id uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    author_id    uuid NOT NULL REFERENCES users(id),
    body         text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_comments_work_item ON comments(work_item_id);

-- ============================================================
-- Примечания
-- ============================================================
-- 1. FK не предотвращает циклы в work_item_dependencies
--    (A зависит от B, B зависит от A). Проверяется в коде
--    приложения через рекурсивный обход графа перед сохранением.
--
-- 2. duration_days — РАБОЧИЕ дни. Конец задачи (для отрисовки
--    на Ганте, проверки задержек и т.д.) вычисляется в коде
--    приложения функцией workEndDate(start_date, duration_days),
--    которая пропускает субботу/воскресенье. Хранить вычисленную
--    дату конца в столбце намеренно не стали — она производная.
--
-- 3. Пример: получить все work_items проекта с именами
--    исполнителей и количеством подзадач одним запросом:
--
-- SELECT
--   wi.*,
--   u.full_name AS assignee_name,
--   u.initials AS assignee_initials,
--   u.avatar_color AS assignee_color,
--   (SELECT count(*) FROM subtasks st WHERE st.parent_task_id = wi.id) AS subtask_count
-- FROM work_items wi
-- LEFT JOIN users u ON u.id = wi.assignee_id
-- WHERE wi.project_id = $1
-- ORDER BY wi.created_at;
