// Vercel serverless function: ปริมาณน้ำรายวัน (06:00 น.) ของสถานี C.2 "ทีละเดือน" ของปีนี้
// เรียกเป็น /api/year?m=1 ... /api/year?m=12 (หน้าเว็บเรียกทีละเดือนต่อเนื่องกัน)
// ดึงจาก สสน. ด้วยวิธีเดียวกับ api/hii.js และเก็บผลไว้ใน cache: เดือนที่จบแล้วเก็บ 7 วัน เดือนปัจจุบันเก็บ 1 ชั่วโมง
// เดือนที่ผ่านมาแล้วดึงเดือนละ 2 ครั้ง (วันที่ 1 และ 15) เดือนปัจจุบันดึงรายวัน ครั้งละไม่เกิน 4 คำขอพร้อมกัน
const { fetchDay } = require("./hii.js");
const DAY = 86400000;
const CONC = 4;

async function handler(req, res) {
  try {
    const bkk = new Date(Date.now() + 7 * 3600000);
    const year = bkk.getUTCFullYear();
    const curMonth = bkk.getUTCMonth() + 1;
    const m = parseInt(req.query && req.query.m, 10);
    if (!(m >= 1 && m <= 12) || m > curMonth) {
      res.status(400).json({ error: "เดือนไม่ถูกต้อง" });
      return;
    }
    // เดือนที่ผ่านมาแล้ว: ดึงเดือนละ 2 ครั้ง (วันที่ 1 และ 15) · เดือนปัจจุบัน: ดึงรายวันตั้งแต่วันที่ 1 ถึงวันนี้
    const days = [];
    if (m < curMonth) {
      for (const d of [1, 15]) days.push(new Date(Date.UTC(year, m - 1, d)).toISOString().slice(0, 10));
    } else {
      for (let d = 1; d <= bkk.getUTCDate(); d++) days.push(new Date(Date.UTC(year, m - 1, d)).toISOString().slice(0, 10));
    }

    const byDate = new Map();
    let qmax = null;
    let firstErr = null;
    let tlsRelaxed = false;
    for (let i = 0; i < days.length; i += CONC) {
      const results = await Promise.allSettled(days.slice(i, i + CONC).map(fetchDay));
      for (const r of results) {
        if (r.status !== "fulfilled") {
          firstErr = firstErr || (r.reason && r.reason.message) || String(r.reason);
          continue;
        }
        if (r.value.relaxed) tlsRelaxed = true;
        const v = r.value.data.c2;
        if (!v || v.q == null) continue;
        const d = v.date || r.value.day;
        if (!d.startsWith(String(year))) continue;
        byDate.set(d, { date: d, q: v.q });
        if (v.qmax != null) qmax = v.qmax;
      }
    }
    const points = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!points.length) throw new Error(firstErr || "ไม่พบข้อมูล C.2 ของเดือนนี้");
    res.setHeader(
      "Cache-Control",
      m < curMonth ? "s-maxage=604800, stale-while-revalidate=86400" : "s-maxage=3600, stale-while-revalidate=7200"
    );
    res.status(200).json({ year, month: m, points, qmax, requested: days.length, tlsRelaxed });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}

module.exports = handler;
