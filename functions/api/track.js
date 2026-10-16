// POST /api/track {combo:"s1v1", event:"view"|"click"} -> increments KV stats
// Requires KV binding: AB_KV
const VALID = /^s[1-3]v[1-3]$/;

function defaults() {
  const st = {};
  for (let s = 1; s <= 3; s++) for (let v = 1; v <= 3; v++) {
    const k = `s${s}v${v}`;
    st[k] = { s, v, views: 0, clicks: 0 };
  }
  return st;
}

export async function onRequestPost({ request, env }) {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  try {
    if (!env || !env.AB_KV) {
      return new Response(JSON.stringify({ error: "KV not bound (AB_KV)" }), { status: 500, headers });
    }
    const body = await request.json().catch(() => ({}));
    const combo = body.combo || "";
    const event = body.event || "";
    if (!VALID.test(combo) || (event !== "view" && event !== "click")) {
      return new Response(JSON.stringify({ error: "invalid combo/event" }), { status: 400, headers });
    }
    const raw = await env.AB_KV.get("ab_stats");
    const st = raw ? { ...defaults(), ...JSON.parse(raw) } : defaults();
    if (!st[combo]) st[combo] = { s: parseInt(combo[1], 10), v: parseInt(combo[3], 10), views: 0, clicks: 0 };
    if (event === "view") st[combo].views++;
    else st[combo].clicks++;
    await env.AB_KV.put("ab_stats", JSON.stringify(st));
    try {
      const MAX = 20000;
      let ev = [];
      const rawEv = await env.AB_KV.get("ab_events");
      if (rawEv) ev = JSON.parse(rawEv);
      ev.push({ t: Date.now(), c: combo, e: event });
      if (ev.length > MAX) ev = ev.slice(ev.length - MAX);
      await env.AB_KV.put("ab_events", JSON.stringify(ev));
    } catch (e) {}
    try {
      const iso = new Date().toISOString().slice(0, 10);
      const key = "ab_day:" + iso;
      const rawD = await env.AB_KV.get(key);
      const b = rawD ? JSON.parse(rawD) : {};
      if (!b[combo]) b[combo] = { views: 0, clicks: 0 };
      if (event === "view") b[combo].views++;
      else b[combo].clicks++;
      await env.AB_KV.put(key, JSON.stringify(b));
    } catch (e) {}
    return new Response(JSON.stringify({ ok: true }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 500, headers });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" } });
}
