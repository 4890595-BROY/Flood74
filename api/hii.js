// Vercel serverless function: ปริมาณน้ำรายวัน (06:00 น.) ของสถานี C.2 ค่ายจิรประวัติ และ C.13 ท้ายเขื่อนเจ้าพระยา
// จากผังน้ำลุ่มเจ้าพระยาของ สสน. (HII): หน้าเว็บฝังข้อมูลไว้ในตัวแปร JavaScript `json_data`
// ส่งวันที่ด้วย POST datepicker=YYYY-MM-DD เพื่อดูย้อนหลัง (วิธีเดียวกับโปรเจกต์ chaophraya-ai-analytics)
const SOURCE = "https://tiwrm.hii.or.th/DATA/REPORT/php/chart/chaopraya/small/chaopraya.php";
const DAYS = 14;

const num = (x) => {
  if (x === null || x === undefined || x === "" || x === "-") return null;
  const n = Number(String(x).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

// ตัดอาร์เรย์ JSON หลัง "var json_data" ด้วยการนับวงเล็บ (ทนกว่า regex)
function extractJson(html) {
  const i = html.indexOf("var json_data");
  if (i < 0) throw new Error("ไม่พบ json_data ในหน้าเว็บ");
  const start = html.indexOf("[", i);
  if (start < 0) throw new Error("json_data ผิดรูปแบบ");
  let depth = 0, inStr = false, esc = false;
  for (let k = start; k < html.length; k++) {
    const c = html[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(start, k + 1));
    }
  }
  throw new Error("json_data ไม่สมบูรณ์");
}

function pickItc(json) {
  const root = Array.isArray(json) ? json[0] : json;
  const itc = (root && root.itc_water) || {};
  const list = Array.isArray(itc) ? itc : Object.values(itc);
  const out = {};
  for (const [key, name] of [["C2", "c2"], ["C13", "c13"]]) {
    let v = !Array.isArray(itc) ? itc[key] : null;
    if (!v) v = list.find((x) => x && String(x.code || x.station_code || "").replace(/\./g, "") === key);
    if (v && num(v.storage) !== null) {
      out[name] = {
        date: String(v.date || "").slice(0, 10),
        at: String(v.date || ""), // วันเวลาตามที่ สสน. ระบุ (ใช้ตรวจว่าเป็นค่าเวลาไหน)
        q: num(v.storage), // ลบ.ม./วินาที
        qmax: num(v.qmax), // ความจุลำน้ำ ลบ.ม./วินาที
        wl: num(v.water_l),
        bank: num(v.r_bank),
      };
    }
  }
  return out;
}

async function fetchDay(day) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(SOURCE, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (flood-dashboard-personal)",
      },
      body: "datepicker=" + day,
    });
    if (!r.ok) throw new Error("สสน. ตอบกลับ " + r.status);
    return { day, data: pickItc(extractJson(await r.text())) };
  } finally {
    clearTimeout(timer);
  }
}

async function handler(req, res) {
  try {
    const bkkNow = new Date(Date.now() + 7 * 3600000);
    const days = [];
    for (let k = 0; k < DAYS; k++) {
      days.push(new Date(bkkNow.getTime() - k * 86400000).toISOString().slice(0, 10));
    }
    const results = await Promise.allSettled(days.map(fetchDay));
    const byDate = new Map();
    const meta = {};
    let firstErr = null;
    for (const r of results) {
      if (r.status !== "fulfilled") {
        firstErr = firstErr || (r.reason && r.reason.message) || String(r.reason);
        continue;
      }
      for (const key of ["c2", "c13"]) {
        const v = r.value.data[key];
        if (!v) continue;
        const d = v.date || r.value.day;
        const row = byDate.get(d) || { date: d, c2: null, c13: null, at: "" };
        row.at = row.at || v.at || "";
        row[key] = v.q;
        byDate.set(d, row);
        if (!meta[key] || d >= meta[key].date) meta[key] = { date: d, qmax: v.qmax, wl: v.wl, bank: v.bank };
      }
    }
    const rows = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!rows.length) throw new Error(firstErr || "ไม่พบข้อมูล C.2/C.13");
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
    res.status(200).json({ days: rows, stations: meta, requested: DAYS });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}

module.exports = handler;
module.exports.extractJson = extractJson;
module.exports.pickItc = pickItc;
module.exports.fetchDay = fetchDay;
