import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import webpush from "web-push";
import { pool } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const app = express();
app.use(express.json());

// Serve PWA files
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/vapid-public-key", (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

app.post("/api/subscribe", async (req, res) => {
  const { subscription, lat, lng, city, timeZone } = req.body;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ ok: false, error: "Invalid subscription" });
  }
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return res.status(400).json({ ok: false, error: "Invalid lat/lng" });
  }

  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys.p256dh;
  const auth = subscription.keys.auth;

  await pool.query(
    `INSERT INTO subscriptions(endpoint, p256dh, auth, lat, lng, city, timezone, last_sent_date)
     VALUES($1,$2,$3,$4,$5,$6,$7,NULL)
     ON CONFLICT(endpoint) DO UPDATE SET
       p256dh=EXCLUDED.p256dh,
       auth=EXCLUDED.auth,
       lat=EXCLUDED.lat,
       lng=EXCLUDED.lng,
       city=EXCLUDED.city,
       timezone=EXCLUDED.timezone`,
    [endpoint, p256dh, auth, Number(lat), Number(lng), city || "", timeZone || "UTC"]
  );

  res.json({ ok: true });
});

app.post("/api/unsubscribe", async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.json({ ok: true });
  await pool.query(`DELETE FROM subscriptions WHERE endpoint=$1`, [endpoint]);
  res.json({ ok: true });
});













app.post("/api/test-push", async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ ok: false, error: "Missing endpoint" });

  const { rows } = await pool.query(
    "SELECT * FROM subscriptions WHERE endpoint=$1",
    [endpoint]
  );

  if (!rows.length) return res.status(404).json({ ok: false, error: "Subscription not found" });

  const s = rows[0];
  const payload = JSON.stringify({
    title: "Test Notification",
    body: "If you see this, push is working ✅",
    url: "/"
  });

  try {
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      payload
    );
    return res.json({ ok: true });
  } catch (e) {
    const code = e?.statusCode;
    if (code === 404 || code === 410) {
      await pool.query("DELETE FROM subscriptions WHERE endpoint=$1", [s.endpoint]);
    }
    return res.status(500).json({ ok: false, error: e?.message || "Push failed" });
  }
});











app.get("/api/health", (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on", port));
