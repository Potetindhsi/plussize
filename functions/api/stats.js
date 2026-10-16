// GET /api/stats?password=... -> aggregated metrics (KV)
// Password comes from ADMIN_PASSWORD env (falls back to Mine123 only for dev).
const FALLBACK_PASSWORD = "Mine123";

const SYNOPSES = {
  1: "The Bride They Should Have Never Underestimated",
  2: "The Plus-Size Bride Who Terrified the Mafia",
  3: "The Bride Who Turned a Mafia Empire Upside Down"
};
const PREVIEWS = {
  1: "tiktok 7687159415908125985",
  2: "tiktok 7687509802456534305",
  3: "tiktok 7687523753533689121"
};

function defaults() {
  const st = {};
  for (let s = 1; s <= 3; s++) for (let v = 1; v <= 3; v++) {
    const k = `s${s}v${v}`;
    st[k] = { s, v, views: 0, clicks: 0 };
  }
  return st;
}

export async function onRequestGet({ request, env }) {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  try {
    const url = new URL(request.url);
    const ADMIN_PW = (env && env.ADMIN_PASSWORD) || FALLBACK_PASSWORD;
    if (url.searchParams.get("password") !== ADMIN_PW) {
      return new Response(JSON.stringify({ error: "wrong password" }), { status: 401, headers });
    }
    if (!env || !env.AB_KV) {
      return new Response(JSON.stringify({ error: "KV not bound (AB_KV)" }), { status: 500, headers });
    }
    const raw = await env.AB_KV.get("ab_stats");
    const all = raw ? { ...defaults(), ...JSON.parse(raw) } : defaults();
    let ev = [];
    try {
      const rawEv = await env.AB_KV.get("ab_events");
      if (rawEv) ev = JSON.parse(rawEv);
    } catch (e) {}
    const from = url.searchParams.get("from") ? parseInt(url.searchParams.get("from"), 10) || 0 : 0;
    const to = url.searchParams.get("to") ? parseInt(url.searchParams.get("to"), 10) || 0 : 0;
    const COMBOS = ["s1v1","s1v2","s1v3","s2v1","s2v2","s2v3","s3v1","s3v2","s3v3"];
    const DAY_MS = 86400000;
    function utcDayStart(ts){ const d = new Date(ts); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
    let stats = all, mode = "all", partial = false;
    if (from || to) {
      if (from && to && to >= from && to - from <= 93 * DAY_MS) {
        const first = utcDayStart(from), last = utcDayStart(to);
        const days = [];
        for (let t = first; t <= last && days.length <= 93; t += DAY_MS) days.push(new Date(t).toISOString().slice(0, 10));
        const vals = await Promise.all(days.map((d) => env.AB_KV.get("ab_day:" + d).catch(() => null)));
        stats = defaults();
        for (let i = 0; i < days.length; i++) {
          const dStart = first + i * DAY_MS, dEnd = dStart + DAY_MS - 1;
          const full = dStart >= from && dEnd <= to;
          let b = null;
          try { b = vals[i] ? JSON.parse(vals[i]) : null; } catch (e) { b = null; }
          if (b && full) {
            for (const k of COMBOS) { const c = b[k]; if (c) { stats[k].views += c.views | 0; stats[k].clicks += c.clicks | 0; } }
            continue;
          }
          if (!b) partial = true;
          for (const x of ev) {
            if ((from && x.t < from) || (to && x.t > to)) continue;
            if (x.t < dStart || x.t > dEnd) continue;
            if (!stats[x.c]) continue;
            if (x.e === "view") stats[x.c].views++;
            else if (x.e === "click") stats[x.c].clicks++;
          }
        }
        mode = "daily";
      } else {
        stats = defaults();
        for (const x of ev) {
          if ((from && x.t < from) || (to && x.t > to)) continue;
          if (!stats[x.c]) continue;
          if (x.e === "view") stats[x.c].views++;
          else if (x.e === "click") stats[x.c].clicks++;
        }
        mode = "log";
      }
    }
    return new Response(JSON.stringify({ stats, all, synopses: SYNOPSES, previews: PREVIEWS, from, to, events: ev.length, mode, partial }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 500, headers });
  }
}
