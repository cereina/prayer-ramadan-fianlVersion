// server/send-iftar.js
import webpush from "web-push";
import { pool } from "./db.js";

const WINDOW_MINUTES = 5; // because Railway cron min is 5 min

function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

async function getMaghribTime({ lat, lng, date, tz }) {
  // date format: DD-MM-YYYY for this endpoint
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const dateStr = `${dd}-${mm}-${yyyy}`;

  const url =
    `https://api.aladhan.com/v1/timings/${dateStr}` +
    `?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lng)}` +
    `&method=0` +
    `&timezonestring=${encodeURIComponent(tz)}`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`AlAdhan error ${r.status}`);
  const data = await r.json();

  // Example: "17:45 (EST)" -> take first 5 chars
  const mag = data?.data?.timings?.Maghrib;
  if (!mag) throw new Error("No Maghrib in API response");
  return mag.slice(0, 5);
}

async function main() {
  const { rows } = await pool.query("SELECT * FROM subscriptions");

  for (const s of rows) {
    const now = new Date(); // your server time (UTC). We'll compare by timezone string via API + local minutes logic.

    // we use "todayKey" stored to prevent duplicates
    const todayKey = now.toISOString().slice(0, 10);

    // if already sent today, skip
    if (s.last_sent_date === todayKey) continue;

    // Ask API for Maghrib in the user's timezone (Jafari)
    const maghribHHMM = await getMaghribTime({
      lat: s.lat,
      lng: s.lng,
      date: now,
      tz: s.timezone // store like "America/Toronto"
    });

    const nowLocal = new Intl.DateTimeFormat("en-CA", {
      timeZone: s.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(now);

    const nowMin = hhmmToMinutes(nowLocal);
    const magMin = hhmmToMinutes(maghribHHMM);

    let diff = nowMin - magMin;
    if (diff < -720) diff += 1440; // midnight safety

    if (diff >= 0 && diff < WINDOW_MINUTES) {
      // SEND PUSH
      await webpush.sendNotification(
        {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth }
        },
        JSON.stringify({
          title: "Iftar Time",
          body: `Maghrib: ${maghribHHMM} — Time to break your fast.`,
          url: "/"
        })
      );

      await pool.query(
        "UPDATE subscriptions SET last_sent_date=$1 WHERE endpoint=$2",
        [todayKey, s.endpoint]
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
