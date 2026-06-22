import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./db/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function waitForDb(retries = 20, delayMs = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      console.log(`Postgres not ready yet, retrying (${i + 1}/${retries})...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("Postgres did not become ready in time");
}

function resolveDbFile(filename) {
  // В Docker-образе: /app/src/migrate.js и /app/db/<filename> (../db)
  // Локально: backend/src/migrate.js и flowline/db/<filename> (../../db)
  const candidates = [
    path.join(__dirname, "../db", filename),
    path.join(__dirname, "../../db", filename),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Не найден файл ${filename}. Искал в: ${candidates.join(", ")}`);
}

async function migrate() {
  await waitForDb();

  const alreadyInitialized = await pool.query(
    `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users') AS exists`
  );

  if (alreadyInitialized.rows[0].exists) {
    console.log("Schema already exists, skipping migration.");
    return;
  }

  console.log("Applying schema...");
  const schemaSql = fs.readFileSync(resolveDbFile("schema.sql"), "utf8");
  await pool.query(schemaSql);

  console.log("Applying seed data...");
  const seedSql = fs.readFileSync(resolveDbFile("seed.sql"), "utf8");
  await pool.query(seedSql);

  console.log("Migration complete.");
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
