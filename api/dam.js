// Vercel serverless function: ดึงอัตราน้ำไหลผ่านสถานี C.13 (ท้ายเขื่อนเจ้าพระยา) และ C.2 (นครสวรรค์)
// จาก API เปิดของกรมชลประทาน (SWOC) แล้วส่งเป็น JSON ให้หน้าเว็บ
const URL_SWOC = "https://bigdata-swoc.rid.go.th/api/ma/pier/all/get_pier_data";
const WANT = { "C.13": "c13", "C.2": "c2" };

function pick(json) {
  const rows = Array.isArray(json) ? json : json && json.data;
  if (!Array.isArray(rows)) throw new Error("unexpected response shape");
  const out = {};
  for (const r of rows) {
    const key = WANT[String(r.station_code || "").trim()];
    if (!key || out[key]) continue;
    out[key] = {
      q: r.q_values == null ? null : Number(r.q_values), // ลบ.ม./วินาที
      wl: r.wl_values_msl == null ? null : Number(r.wl_values_msl), // ม.รทก.
      trend: r.q_trend || null,
      name: r.station_detail || null,
      timeUtc: r.hourly_time_utc || null,
    };
  }
  return out;
}

async function handler(req, res) {
  try {
    const r = await fetch(URL_SWOC, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) throw new Error("upstream " + r.status);
    const data = pick(await r.json());
    if (!data.c13 && !data.c2) throw new Error("stations not found");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}

module.exports = handler;
module.exports.pick = pick;
