// plussizes Worker: static site (./public) + A/B 3x3 API backed by KV.
// KV: dashboard > Worker plussizes > Settings > Bindings > KV namespace, variable AB_KV.
const COMBOS = ["s1v1", "s1v2", "s1v3", "s2v1", "s2v2", "s2v3", "s3v1", "s3v2", "s3v3"];
const PASSWORD = "Mine123";
const VALID = /^s[1-3]v[1-3]$/;

const SYNOPSES = {
  1: "The Bride They Should Have Never Underestimated",
  2: "The Plus-Size Bride Who Terrified the Mafia",
  3: "The Bride Who Turned a Mafia Empire Upside Down",
};
const PREVIEWS = {
  1: "tiktok 7687159415908125985",
  2: "tiktok 7687509802456534305",
  3: "tiktok 7687523753533689121",
};

function defaults() {
  const st = {};
  for (let s = 1; s <= 3; s++)
    for (let v = 1; v <= 3; v++) {
      const k = `s${s}v${v}`;
      st[k] = { s, v, views: 0, clicks: 0 };
    }
  return st;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

async function readStats(env) {
  const raw = await env.AB_KV.get("ab_stats");
  return raw ? { ...defaults(), ...JSON.parse(raw) } : defaults();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/next") {
      if (!env.AB_KV) return json({ error: "KV not bound (AB_KV)" }, 500);
      try {
        const n = parseInt((await env.AB_KV.get("ab_counter")) || "0", 10) || 0;
        const combo = COMBOS[n % COMBOS.length];
        await env.AB_KV.put("ab_counter", String(n + 1));
        return json({ combo, s: parseInt(combo[1], 10), v: parseInt(combo[3], 10) });
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 500);
      }
    }

    if (url.pathname === "/api/track") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": "content-type",
          },
        });
      }
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (!env.AB_KV) return json({ error: "KV not bound (AB_KV)" }, 500);
      try {
        const body = await request.json().catch(() => ({}));
        const combo = body.combo || "";
        const event = body.event || "";
        if (!VALID.test(combo) || (event !== "view" && event !== "click"))
          return json({ error: "invalid combo/event" }, 400);
        const st = await readStats(env);
        if (event === "view") st[combo].views++;
        else st[combo].clicks++;
        await env.AB_KV.put("ab_stats", JSON.stringify(st));
        return json({ ok: true });
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 500);
      }
    }

    if (url.pathname === "/api/stats") {
      if (url.searchParams.get("password") !== PASSWORD)
        return json({ error: "wrong password" }, 401);
      if (!env.AB_KV) return json({ error: "KV not bound (AB_KV)" }, 500);
      try {
        return json({ stats: await readStats(env), synopses: SYNOPSES, previews: PREVIEWS });
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
