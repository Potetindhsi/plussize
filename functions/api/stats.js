// GET /api/stats?password=Mine123 -> aggregated metrics (KV)
// Requires KV binding: AB_KV
const PASSWORD = "Mine123";

const SYNOPSES = {
  1: "The Bride They Should Have Never Underestimated",
  2: "The Plus-Size Bride Who Terrified the Mafia",
  3: "The Bride Who Turned a Mafia Empire Upside Down"
};
const PREVIEWS = {
  1: "1894b701-68b7-431b-b1b8-1e5e2a5fe129.mp4",
  2: "6b8520b0-c849-4196-a69d-84c9f0afc0b1.mp4",
  3: "33c5442a-7f85-4e96-bb9f-e00d7ae99bbd.mp4"
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
