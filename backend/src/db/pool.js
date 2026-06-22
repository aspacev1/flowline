import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.DB_HOST || "postgres",
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || "flowline",
  password: process.env.DB_PASSWORD || "flowline",
  database: process.env.DB_NAME || "flowline",
});

// Без этого обработчика ошибка простаивающего соединения в пуле
// (например, БД временно недоступна) кидает необработанное
// событие 'error' и крашит весь процесс Node.
pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client", err);
});

export async function query(text, params) {
  return pool.query(text, params);
}
