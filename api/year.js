// Vercel serverless function: ปริมาณน้ำรายวันของสถานี C.2 ตั้งแต่ 1 ม.ค. ของปีนี้ถึงวันนี้
// เอาไว้ plot ทับกราฟสถิติปีน้ำท่วมใหญ่ (ดึงจาก สสน. ด้วยวิธีเดียวกับ api/hii.js)
// เพื่อไม่ให้ภาระเซิร์ฟเวอร์ต้นทางมากเกินไป: ดึงทุก 3 วัน + 6 วันล่าสุดทุกวัน และเก็บผลไว้ 12 ชั่วโมง
const { fetchDay } = require("./hii.js");
const STEP = 3;
const CHUNK = 25;
const DAY = 86400000;

async function handler(req, res) {
  try {
    const bkk = new Date(Date.now() + 7 * 3600000);
    const year = bkk.getUTCFullYear();
    const start = Date.UTC(year, 0, 1);
    const today = Date.UTC(year, bkk.getUTCMonth(), bkk.getUTCDate());
    const want = new Set();
    for (let t = start; t <= today; t += STEP * DAY) want.add(new Date(t).toISOString().slice(0, 10));
    for (let k = 0; k < 6; k++) want.add(new Date(today - k * DAY).toISOString().slice(0, 10));
    const days = [...want].sort();

    const byDate = new Map();
    let qmax = null;
    let firstErr = null;
    for (let i = 0; i < days.length; i += CHUNK) {
      const results = await Promise.allSettled(days.slice(i, i + CHUNK).map(fetchDay));
      for (const r of results) {
        if (r.status !== "fulfilled") {
          firstErr = firstErr || (r.reason && r.reason.message) || String(r.reason);
          continue;
        }
        const v = r.value.data.c2;
        if (!v || v.q == null) continue;
        const d = v.date || r.value.day;
        if (!d.startsWith(String(year))) continue;
        byDate.set(d, { date: d, q: v.q });
        if (v.qmax != null) qmax = v.qmax;
      }
    }
    const points = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!points.length) throw new Error(firstErr || "ไม่พบข้อมูล C.2 ของปีนี้");
    res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate=86400");
    res.status(200).json({ year, points, qmax, requested: days.length });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}

module.exports = handler;
