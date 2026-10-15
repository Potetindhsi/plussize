// GET /api/stats?password=Mine123 -> aggregated metrics (KV)
// Requires KV binding: AB_KV
const PASSWORD = "Mine123";

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
    if (url.searchParams.get("password") !== PASSWORD) {
      return new Response(JSON.stringify({ error: "wrong password" }), { status: 401, headers });
    }
    if (!env || !env.AB_KV) {
      return new Response(JSON.stringify({ error: "KV not bound (AB_KV)" }), { status: 500, headers });
    }
    const raw = await env.AB_KV.get("ab_stats");
    const stats = raw ? { ...defaults(), ...JSON.parse(raw) } : defaults();
    return new Response(JSON.stringify({ stats, synopses: SYNOPSES, previews: PREVIEWS }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 500, headers });
  }
}
