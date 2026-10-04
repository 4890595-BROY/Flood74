// Vercel serverless function: อ่านระดับน้ำคลองบางจาก ซ.เพชรเกษม 68 (สถานี WL.BJK.02)
// จากหน้าเว็บสำนักการระบายน้ำ กทม. แล้วส่งเป็น JSON ให้หน้าเว็บ
const URL_STATION = "https://weather.bangkok.go.th/water/StationDetail?id=252";

function parse(html) {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  const re = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\s+(-?\d+(?:\.\d+)?|-)(?=\s|$)/g;
  const map = new Map();
  let m;
  while ((m = re.exec(text)) !== null) {
    let y = +m[3];
    if (y > 2400) y -= 543; // พ.ศ. -> ค.ศ.
    const t = `${y}-${m[2]}-${m[1]}T${m[4]}:${m[5]}`;
    if (m[6] === "-") continue;
    map.set(t, +m[6]);
  }
  const series = [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (!series.length) throw new Error("no data parsed");
  const [latestT, level] = series[series.length - 1];
  const day = latestT.slice(0, 10);
  const prev = new Date(day + "T00:00:00Z");
  prev.setUTCDate(prev.getUTCDate() - 1);
  const prevDay = prev.toISOString().slice(0, 10);
  const maxOf = (d) => {
    const v = series.filter(([t]) => t.startsWith(d)).map(([, l]) => l);
    return v.length ? Math.max(...v) : null;
  };
  return { latestT, level, maxToday: maxOf(day), maxYesterday: maxOf(prevDay), series };
}

async function handler(req, res) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(URL_STATION, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "th-TH,th;q=0.9,en;q=0.5",
        Referer: "https://weather.bangkok.go.th/water/",
      },
    });
    const html = await r.text();
    if (!r.ok) {
      res.status(502).json({ error: "เว็บ กทม. ตอบกลับ " + r.status, status: r.status });
      return;
    }
    let data;
    try {
      data = parse(html);
    } catch (e) {
      const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      res.status(502).json({
        error: "อ่านตารางข้อมูลไม่ได้",
        length: html.length,
        sample: text.slice(0, 300),
      });
      return;
    }
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: e.name === "AbortError" ? "หมดเวลารอเว็บ กทม." : "เชื่อมต่อเว็บ กทม. ไม่ได้: " + (e.cause && e.cause.code || e.message) });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = handler;
module.exports.parse = parse;
