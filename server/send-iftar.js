// server/send-iftar.js
// Cron job: sends Iftar (Maghrib) push notifications.
// Designed for Railway cron running every 5 minutes.
// - Uses AlAdhan timings API (method=0 => Jafari / Shia Ithna-Ashari)
// - Validates lat/lng
// - Per-row try/catch so one bad subscription never crashes the job
// - 5-minute window so it works with Railway's cron minimum interval

import webpush from "web-push";
import { pool } from "./db.js";

const WINDOW_MINUTES = 5; // Railway cron min frequency is 5 minutes

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

function hhmmToMinutes(hhmm) {
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  return h * 60 + mm;
}

function nowMinutesInTZ(now, tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(now);

    const h = Number(parts.find(p => p.type === "hour")?.value);
    const m = Number(parts.find(p => p.type === "minute")?.value);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;

    // Some environments can return hour "24" at midnight; normalize to 0.
    const hh = (h === 24) ? 0 : h;
    return hh * 60 + m;
  } catch {
    return null;
  }
}

async function fetchTimings(url) {
  const r = await fetch(url);
  const text = await r.text(); // keep body for debugging
  if (!r.ok) {
    throw new Error(`AlAdhan error ${r.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

async function getMaghribTime({ lat, lng, date, tz }) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const dateStr = `${dd}-${mm}-${yyyy}`;

  const base =
    `https://api.aladhan.com/v1/timings/${dateStr}` +
    `?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lng)}` +
    `&method=0`;

  // 1) Try with timezone string (if provided)
  if (tz && typeof tz === "string" && tz.includes("/")) {
    const urlWithTz = base + `&timezonestring=${encodeURIComponent(tz)}`;
    try {
      const data = await fetchTimings(urlWithTz);
      const mag = data?.data?.timings?.Maghrib;
      if (!mag) throw new Error("No Maghrib in response");
      return mag.slice(0, 5);
    } catch {
      // fall through to retry without timezone
    }
  }

  // 2) Fallback: no timezonestring (AlAdhan infers from coordinates)
  const data = await fetchTimings(base);
  const mag = data?.data?.timings?.Maghrib;
  if (!mag) throw new Error("No Maghrib in response");
  return mag.slice(0, 5);
}

function minutesDiff(nowMin, targetMin) {
  // diff = now - target, with wraparound protection
  let diff = nowMin - targetMin;
  if (diff < -720) diff += 1440; // crossed midnight
  if (diff > 720) diff -= 1440;
  return diff;
}

async function main() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) {
    throw new Error("Missing VAPID env vars: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("Missing DATABASE_URL env var (Railway Postgres plugin).");
  }

  const { rows } = await pool.query("SELECT * FROM subscriptions");

  const now = new Date();

  for (const s of rows) {
    try {
      // Validate coordinates early (prevents AlAdhan 400)
      const lat = Number(s.lat);
      const lng = Number(s.lng);

      if (
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        Math.abs(lat) > 90 || Math.abs(lng) > 180
      ) {
        console.error("Skipping invalid coords:", {
          endpoint: (s.endpoint || "").slice(0, 60),
          lat: s.lat,
          lng: s.lng
        });
        continue;
      }

      const tz = (s.timezone && typeof s.timezone === "string") ? s.timezone : "UTC";

      const nowMin = nowMinutesInTZ(now, tz);
      if (nowMin == null) {
        console.error("Skipping invalid timezone:", {
          endpoint: (s.endpoint || "").slice(0, 60),
          timezone: s.timezone
        });
        continue;
      }

      // Use user's local date key to prevent duplicates
      const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(now)
        .reduce((acc, p) => (acc[p.type] = p.value, acc), {});
      const localDateKey = `${todayKey.year}-${todayKey.month}-${todayKey.day}`;

      if (s.last_sent_date === localDateKey) continue;

      const maghribHHMM = await getMaghribTime({ lat, lng, date: now, tz });
      const magMin = hhmmToMinutes(maghribHHMM);
      if (magMin == null) {
        console.error("Bad Maghrib format:", { endpoint: (s.endpoint || "").slice(0, 60), maghrib: maghribHHMM });
        continue;
      }

      const diff = minutesDiff(nowMin, magMin);

      // Trigger within [0, WINDOW_MINUTES)
      if (diff >= 0 && diff < WINDOW_MINUTES) {
        const payload = JSON.stringify({
          title: "Iftar time (Maghrib)",
          body: `${s.city ? (s.city + " • ") : ""}Maghrib: ${maghribHHMM}`,
          url: "/"
        });

        const subscription = {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth }
        };

        try {
          await webpush.sendNotification(subscription, payload);

          await pool.query(
            "UPDATE subscriptions SET last_sent_date=$1 WHERE endpoint=$2",
            [localDateKey, s.endpoint]
          );

          console.log("Sent Iftar push:", { endpoint: (s.endpoint || "").slice(0, 40), localDateKey, maghribHHMM });
        } catch (e) {
          const code = e?.statusCode;
          if (code === 404 || code === 410) {
            // Subscription expired or gone
            await pool.query("DELETE FROM subscriptions WHERE endpoint=$1", [s.endpoint]);
            console.log("Deleted expired subscription:", (s.endpoint || "").slice(0, 40));
          } else {
            console.error("Push send failed:", code, e?.body || e?.message || e);
          }
        }
      }
    } catch (e) {
      console.error("Row failed:", {
        endpoint: (s.endpoint || "").slice(0, 60),
        lat: s.lat,
        lng: s.lng,
        tz: s.timezone,
        err: e?.message || String(e)
      });
      continue;
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Cron failed:", e?.message || e);
    process.exit(1);
  });
