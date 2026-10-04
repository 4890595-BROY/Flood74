// Vercel serverless function: ระดับน้ำคลองบางจาก ซ.เพชรเกษม 68 (สถานี WL.BJK.02)
// แหล่งหลัก: POPNIX Flood open data API (flood.pop.in.th) ซึ่งนำข้อมูลของสำนักการระบายน้ำ กทม. มาจัดรูปแบบใหม่
// แหล่งสำรอง: หน้าเว็บ กทม. โดยตรง (อาจถูกกันคำขอจากเซิร์ฟเวอร์ต่างประเทศ)
const POP = "https://flood.pop.in.th";
const BMA = "https://weather.bangkok.go.th/water/StationDetail?id=252";
const STATION_ID = 252;

async function get(url, opts = {}, ms = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "หมดเวลารอ" : "เชื่อมต่อไม่ได้" + (e.cause && e.cause.code ? " (" + e.cause.code + ")" : ""));
  } finally {
    clearTimeout(timer);
  }
}

const norm = (s) => String(s || "").replace(/\s+/g, "");
const toIso = (t) => String(t).replace(" ", "T").slice(0, 16);

// ---------- แหล่งหลัก: POPNIX ----------
function findStation(list) {
  return (
    list.find((s) => norm(s.name).includes("บางจาก") && norm(s.name).includes("เพชรเกษม68")) ||
    list.find((s) => Number(s.id) === STATION_ID)
  );
}

async function fromPop() {
  const H = { Accept: "application/json", "User-Agent": "flood-dashboard-personal/1.0" };
  const r = await get(POP + "/api_overview.php?w=60", { headers: H });
  if (!r.ok) throw new Error("POPNIX ตอบกลับ " + r.status);
  const ov = await r.json();
  const st = findStation(ov.stations || []);
  if (!st) throw new Error("ไม่พบจุดวัดใน POPNIX");
  if (st.wl == null || !st.measured_at) throw new Error("จุดวัดไม่ส่งค่าตอนนี้");
  const latestT = toIso(st.measured_at);
  let series = [[latestT, Number(st.wl)]];
  try {
    const hr = await get(POP + "/api_history.php?id=" + encodeURIComponent(st.id) + "&h=168", { headers: H });
    if (hr.ok) {
      const h = await hr.json();
      const pts = (h.points || []).filter((p) => p.wl != null).map((p) => [toIso(p.t), Number(p.wl)]);
      if (pts.length) {
        if (pts[pts.length - 1][0] < latestT) pts.push([latestT, Number(st.wl)]);
        series = pts;
      }
    }
  } catch (e) {}
  return {
    source: "pop",
    latestT,
    level: Number(st.wl),
    maxToday: st.max_day == null ? null : Number(st.max_day),
    maxYesterday: st.max_yday == null ? null : Number(st.max_yday),
    warn: st.warn == null ? null : Number(st.warn),
    crit: st.crit == null ? null : Number(st.crit),
    bed: st.bed == null ? null : Number(st.bed),
    bank: st.bank == null ? null : Number(st.bank),
    series,
  };
}

// ---------- แหล่งสำรอง: หน้าเว็บ กทม. ----------
function parse(html) {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  const re = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\s+(-?\d+(?:\.\d+)?|-)(?=\s|$)/g;
  const map = new Map();
  let m;
  while ((m = re.exec(text)) !== null) {
    let y = +m[3];
    if (y > 2400) y -= 543;
    if (m[6] === "-") continue;
    map.set(`${y}-${m[2]}-${m[1]}T${m[4]}:${m[5]}`, +m[6]);
  }
  const series = [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (!series.length) throw new Error("อ่านตารางไม่ได้");
  const [latestT, level] = series[series.length - 1];
  const day = latestT.slice(0, 10);
  const prev = new Date(day + "T00:00:00Z");
  prev.setUTCDate(prev.getUTCDate() - 1);
  const prevDay = prev.toISOString().slice(0, 10);
  const maxOf = (d) => {
    const v = series.filter(([t]) => t.startsWith(d)).map(([, l]) => l);
    return v.length ? Math.max(...v) : null;
  };
  return { source: "bma", latestT, level, maxToday: maxOf(day), maxYesterday: maxOf(prevDay), series };
}

async function fromBma() {
  const r = await get(BMA, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "th-TH,th;q=0.9,en;q=0.5",
      Referer: "https://weather.bangkok.go.th/water/",
    },
  });
  if (!r.ok) throw new Error("เว็บ กทม. ตอบกลับ " + r.status);
  return parse(await r.text());
}

async function handler(req, res) {
  const errs = [];
  for (const [name, fn] of [["POPNIX", fromPop], ["กทม.", fromBma]]) {
    try {
      const data = await fn();
      res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
      res.status(200).json(data);
      return;
    } catch (e) {
      errs.push(name + ": " + (e.message || e));
    }
  }
  res.status(502).json({ error: errs.join(" · ") });
}

module.exports = handler;
module.exports.parse = parse;
module.exports.findStation = findStation;
