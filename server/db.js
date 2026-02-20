import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for Railway
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      endpoint TEXT PRIMARY KEY,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      city TEXT NOT NULL,
      timezone TEXT NOT NULL,
      last_sent_date TEXT
    );
  `);

  console.log("Database initialized");
}
