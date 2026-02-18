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
    } catch (e) {
      // fall through to retry without timezone
    }
  }

  // 2) Fallback: no timezonestring (AlAdhan infers from coordinates)
  const data = await fetchTimings(base);
  const mag = data?.data?.timings?.Maghrib;
  if (!mag) throw new Error("No Maghrib in response");
  return mag.slice(0, 5);
}
