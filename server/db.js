import pg from "pg";
const { Pool } = pg;

function sslForRailway(urlStr) {
  try {
    const u = new URL(urlStr);
    // Railway internal hostname usually does NOT require SSL
    if (u.hostname.endsWith(".railway.internal")) return false;

    // For external/hosted Postgres, SSL is often required
    return { rejectUnauthorized: false };
  } catch {
    return false;
  }
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslForRailway(process.env.DATABASE_URL || "")
});