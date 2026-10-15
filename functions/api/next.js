// GET /api/next -> true global round-robin 3x3 via KV counter
// Requires KV binding: AB_KV
const COMBOS = ["s1v1","s1v2","s1v3","s2v1","s2v2","s2v3","s3v1","s3v2","s3v3"];

export async function onRequestGet({ env }) {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  try {
    if (!env || !env.AB_KV) {
      return new Response(JSON.stringify({ error: "KV not bound (AB_KV). See CLOUDFLARE-PAGES-SETUP.txt" }), { status: 500, headers });
    }
    let n = parseInt((await env.AB_KV.get("ab_counter")) || "0", 10) || 0;
    const combo = COMBOS[n % COMBOS.length];
    await env.AB_KV.put("ab_counter", String(n + 1));
    return new Response(JSON.stringify({ combo, s: parseInt(combo[1], 10), v: parseInt(combo[3], 10) }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 500, headers });
  }
}
