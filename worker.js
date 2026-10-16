// plussizes Worker: static site (./public) + A/B 3x3 API backed by KV.
// KV: dashboard > Worker plussizes > Settings > Bindings > KV namespace, variable AB_KV.
const COMBOS = ["s1v1", "s1v2", "s1v3", "s2v1", "s2v2", "s2v3", "s3v1", "s3v2", "s3v3"];
// Admin password: set ADMIN_PASSWORD as a Worker secret and change it —
// "Mine123" is only a fallback and must NOT be used in production.
const FALLBACK_PASSWORD = "Mine123";
const adminPw = (env) => env.ADMIN_PASSWORD || FALLBACK_PASSWORD;
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

const MAX_EVENTS = 20000;

async function logEvent(env, combo, event) {
  let ev = [];
  try {
    const raw = await env.AB_KV.get("ab_events");
    if (raw) ev = JSON.parse(raw);
  } catch (e) {}
  ev.push({ t: Date.now(), c: combo, e: event });
  if (ev.length > MAX_EVENTS) ev = ev.slice(ev.length - MAX_EVENTS);
  await env.AB_KV.put("ab_events", JSON.stringify(ev));
}

function filterEvents(ev, from, to) {
  return ev.filter(
    (x) => (!from || x.t >= from) && (!to || x.t <= to)
  );
}

function aggregate(ev) {
  const st = defaults();
  for (const x of ev) {
    if (!st[x.c]) continue;
    if (x.e === "view") st[x.c].views++;
    else if (x.e === "click") st[x.c].clicks++;
  }
  return st;
}

// ---------- DAILY BUCKETS (filtro por dia consistente) ----------
// O log bruto (ab_events) perde eventos sob acessos simultâneos e é podado
// em 20 mil — por isso o filtro por dia divergia do acumulado. Estes
// baldes diários (UTC) têm a mesma característica dos contadores gerais,
// então o filtrado passa a bater com o total.
const DAY_MS = 86400000;
const dayKey = (iso) => "ab_day:" + iso;
const utcDayStart = (ts) => {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

async function bumpDay(env, combo, event) {
  try {
    const iso = new Date().toISOString().slice(0, 10);
    const raw = await env.AB_KV.get(dayKey(iso));
    const b = raw ? JSON.parse(raw) : {};
    if (!b[combo]) b[combo] = { views: 0, clicks: 0 };
    if (event === "view") b[combo].views++;
    else b[combo].clicks++;
    await env.AB_KV.put(dayKey(iso), JSON.stringify(b));
  } catch (e) {}
}

// Soma os baldes dos dias UTC totalmente dentro de [from,to].
// Dias de borda (parciais) e dias sem balde usam o log bruto como fallback.
// Retorna {stats, partial} — partial=true se algum dia interior não tinha balde.
async function aggregateByDays(env, ev, from, to) {
  const first = utcDayStart(from);
  const last = utcDayStart(to);
  const days = [];
  for (let t = first; t <= last && days.length <= 93; t += DAY_MS)
    days.push(new Date(t).toISOString().slice(0, 10));
  const vals = await Promise.all(days.map((d) => env.AB_KV.get(dayKey(d)).catch(() => null)));
  const agg = defaults();
  let partial = false;
  for (let i = 0; i < days.length; i++) {
    const dStart = first + i * DAY_MS;
    const dEnd = dStart + DAY_MS - 1;
    const full = dStart >= from && dEnd <= to;
    let b = null;
    try { b = vals[i] ? JSON.parse(vals[i]) : null; } catch (e) { b = null; }
    if (b && full) {
      for (const k of COMBOS) {
        const c = b[k];
        if (c) {
          agg[k].views += c.views | 0;
          agg[k].clicks += c.clicks | 0;
        }
      }
      continue;
    }
    if (!b) partial = true;
    for (const x of ev) {
      if (x.t < from || x.t > to) continue;
      if (x.t < dStart || x.t > dEnd) continue;
      if (!agg[x.c]) continue;
      if (x.e === "view") agg[x.c].views++;
      else if (x.e === "click") agg[x.c].clicks++;
    }
  }
  return { stats: agg, partial };
}

// ---------- CHECKOUT + SALES (NOWPayments, stablecoin payouts) ----------
const PRODUCTS = {
  basic: {
    amount: 5,
    currency: "USD",
    name: "Aurora Vitale — Full Season Access",
    desc: "Full season, lifetime access, all episodes",
    mp_amount: 27.9,
    mp_currency: "BRL",
  },
  premium: {
    amount: 10,
    currency: "USD",
    name: "Premium Pack — Full Catalog Access",
    desc: "Full catalog + daily releases, lifetime access",
    mp_amount: 54.9,
    mp_currency: "BRL",
  },
};

// Order bump (only offered on the $5 page): upgrades access to premium.
const BUMPS = {
  premium_upgrade: {
    name: "PREMIUM UPGRADE — full catalog",
    desc: "Unlock the full catalog + daily releases",
    usd: 5,
    brl: 27.0,
  },
};

const accessOf = (sale) => sale.access || sale.product;
// Configure your content links here (shown on /acesso.html + emailed after payment)
const ACCESS_LINKS = {
  basic: ["https://www.youtube.com/watch?v=TifeDy6MVbE"],
  premium: ["https://www.youtube.com/watch?v=TifeDy6MVbE", "https://cplayapp.com/"],
};
// Button labels for the access email (index-matched to ACCESS_LINKS)
const ACCESS_LABELS = ["\u25B6 Watch now", "\uD83D\uDCF1 Open the app"];

// ---------- META PIXEL + CONVERSIONS API ----------
// Pixel ID é público (vai no HTML). O token abaixo também está no código por
// decisão do dono — quem tiver acesso ao repo consegue ver/usar esse token.
// Se o repo for público e surgirem eventos estranhos, gere um novo token e troque aqui.
const FB_PIXEL_ID = "1387916253326765";
const FB_CAPI_TOKEN_HARDCODED = "EAA0BoaRx5oQBSjIJsFT2uZCmfX6ZBp9Q5PTkenAR4NJUInWNRp6NEnVzmev3fzwyUVy8DcySdK578dVJMXnGWtEy2ganYtgs6GGLXhtoPUbxbOXw9n2Pph0x8bnpLWWuzpZBgKX1Tslyd6g2vAXFJz7ssrmE9XqjixZBK5LUGXQm4RrRWaXPgJn8bwZCqZB6P4HwZDZD";

async function sha256Hex(s) {
  try {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s || "").trim().toLowerCase()));
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    return "";
  }
}

function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    ""
  );
}

function cookieVal(request, name) {
  try {
    const c = request.headers.get("cookie") || "";
    const m = c.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  } catch (e) {
    return "";
  }
}

// Dispara evento server-side (não quebra o checkout se a Meta falhar).
async function fbSendEvent(env, request, opts) {
  const token = env.FB_CAPI_TOKEN || env.FB_TOKEN || FB_CAPI_TOKEN_HARDCODED;
  if (!token) return { skipped: "no FB_CAPI_TOKEN secret" };
  try {
    const fb = (opts && opts.fb) || {};
    const fbp = fb.fbp || cookieVal(request, "_fbp") || "";
    const fbc = fb.fbc || cookieVal(request, "_fbc") || "";
    const emHash = opts.email ? await sha256Hex(opts.email) : "";
    const fnHash = opts.firstName ? await sha256Hex(opts.firstName) : "";
    const lnHash = opts.lastName ? await sha256Hex(opts.lastName) : "";
    const user_data = {
      client_ip_address: clientIp(request),
      client_user_agent: request.headers.get("user-agent") || "",
      ...(fbp ? { fbp } : {}),
      ...(fbc ? { fbc } : {}),
      ...(emHash ? { em: [emHash] } : {}),
      ...(fnHash ? { fn: [fnHash] } : {}),
      ...(lnHash ? { ln: [lnHash] } : {}),
    };
    const payload = {
      data: [
        {
          event_name: opts.event_name,
          event_time: Math.floor(Date.now() / 1000),
          event_id: opts.event_id || undefined,
          action_source: "website",
          event_source_url: fb.event_source_url || opts.event_source_url || "",
          user_data,
          custom_data: opts.custom_data || {},
        },
      ],
    };
    const r = await fetch(
      "https://graph.facebook.com/v19.0/" + FB_PIXEL_ID + "/events?access_token=" + encodeURIComponent(token),
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }
    );
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, resp: JSON.stringify(j).slice(0, 300) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

function fbFire(env, ctx, request, opts) {
  try {
    const p = fbSendEvent(env, request, opts);
    if (ctx && ctx.waitUntil) ctx.waitUntil(p.catch(() => ({})));
    else p.catch(() => ({}));
  } catch (e) {}
}

function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

const MAX_SALES = 5000;

function orderId() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return (
    "ORD-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase().slice(0, 6)
  );
}

async function readSales(env) {
  try {
    const raw = await env.AB_KV.get("sales");
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

async function writeSales(env, sales) {
  if (sales.length > MAX_SALES) sales = sales.slice(sales.length - MAX_SALES);
  await env.AB_KV.put("sales", JSON.stringify(sales));
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
    return o;
  }
  return v;
}

async function verifyNowSig(body, sigHex, secret) {
  try {
    const msg = JSON.stringify(sortKeys(body));
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
    const hex = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
    return hex.toLowerCase() === String(sigHex || "").toLowerCase();
  } catch (e) {
    return false;
  }
}

function accessButtonsHTML(lvl) {
  const urls = ACCESS_LINKS[lvl] || [];
  const btn =
    "display:inline-block;padding:13px 26px;margin:5px 8px 5px 0;background:#dd3b32;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-family:Arial,sans-serif;font-size:15px";
  return urls
    .map((u, i) => `<a href="${u}" style="${btn}">${ACCESS_LABELS[i] || "Open"}</a>`)
    .join("");
}

async function sendAccessEmail(env, sale) {
  const lvl = accessOf(sale);
  const subj = "Your access is ready — " + sale.productName;
  const html =
    `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#111418">` +
    `<h2 style="color:#111418">Payment confirmed \u2705</h2>` +
    `<p>Hi ${sale.name},</p>` +
    `<p>Thanks for your order <b>${sale.id}</b>. Tap below to start watching:</p>` +
    `<p>${accessButtonsHTML(lvl)}</p>` +
    `<p style="color:#6B7280;font-size:12px">Need help? Just reply to this email.</p>` +
    `</div>`;
  // Option A (no domain, no phone): Mailjet single sender (free 200/day).
  // Mailjet > Account > Senders & Domains > add ONE email, confirm it,
  // then API Keys (public + private). Secrets: MJ_PUBLIC, MJ_PRIVATE, MJ_FROM
  // (MAILJET_PUBLIC / MAILJET_PRIVATE / MAILJET_FROM also accepted).
  const mjPub = env.MJ_PUBLIC || env.MAILJET_PUBLIC;
  const mjPriv = env.MJ_PRIVATE || env.MAILJET_PRIVATE;
  const mjFrom = env.MJ_FROM || env.MAILJET_FROM;
  if (mjPub && mjPriv && mjFrom) {
    try {
      const key = btoa(mjPub + ":" + mjPriv);
      const r = await fetch("https://api.mailjet.com/v3.1/send", {
        method: "POST",
        headers: { Authorization: "Basic " + key, "content-type": "application/json" },
        body: JSON.stringify({
          Messages: [
            {
              From: { Email: mjFrom, Name: "Access" },
              To: [{ Email: sale.email, Name: sale.name }],
              Subject: subj,
              HTMLPart: html,
            },
          ],
        }),
      });
      if (r.ok) return { sent: true, id: "mailjet" };
      const j = await r.json().catch(() => ({}));
      return { sent: false, reason: "mailjet:" + JSON.stringify(j).slice(0, 180) };
    } catch (e) {}
  }
  // Option B: SendGrid Single Sender (free 100/day).
  // SendGrid > Settings > Sender Authentication > Single Sender > verify 1 email,
  // then Settings > API Keys > create key. Secrets: SENDGRID_API_KEY + SENDGRID_FROM.
  if (env.SENDGRID_API_KEY && env.SENDGRID_FROM) {
    try {
      const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { Authorization: "Bearer " + env.SENDGRID_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: sale.email, name: sale.name }] }],
          from: { email: env.SENDGRID_FROM, name: "Access" },
          subject: subj,
          content: [{ type: "text/html", value: html }],
        }),
      });
      if (r.ok || r.status === 202) return { sent: true, id: "sendgrid" };
    } catch (e) {}
  }
  // Option C: Brevo single sender (free 300/day).
  // Secrets: BREVO_API_KEY + BREVO_FROM.
  if (env.BREVO_API_KEY && env.BREVO_FROM) {
    try {
      const r = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({
          sender: { email: env.BREVO_FROM, name: "Access" },
          to: [{ email: sale.email, name: sale.name }],
          subject: subj,
          htmlContent: html,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return { sent: true, id: j.messageId || "brevo" };
    } catch (e) {}
  }
  // Option D: Resend (needs verified domain for non-owner recipients).
  if (!env.RESEND_API_KEY) return { sent: false, reason: "no email provider key" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM || "Access <onboarding@resend.dev>",
        to: sale.email,
        subject: subj,
        html,
      }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { sent: true, id: j.id } : { sent: false, reason: JSON.stringify(j).slice(0, 200) };
  } catch (e) {
    return { sent: false, reason: String((e && e.message) || e).slice(0, 200) };
  }
}

export default {
  async fetch(request, env, ctx) {
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
        try {
          await logEvent(env, combo, event);
        } catch (e) {}
        try {
          await bumpDay(env, combo, event);
        } catch (e) {}
        return json({ ok: true });
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 500);
      }
    }

    if (url.pathname === "/api/stats") {
      if (url.searchParams.get("password") !== adminPw(env))
        return json({ error: "wrong password" }, 401);
      if (!env.AB_KV) return json({ error: "KV not bound (AB_KV)" }, 500);
      try {
        const all = await readStats(env);
        let ev = [];
        try {
          const raw = await env.AB_KV.get("ab_events");
          if (raw) ev = JSON.parse(raw);
        } catch (e) {}
        const q = url.searchParams;
        const from = q.get("from") ? parseInt(q.get("from"), 10) || 0 : 0;
        const to = q.get("to") ? parseInt(q.get("to"), 10) || 0 : 0;
        let stats = all, mode = "all", partial = false;
        if (from || to) {
          if (from && to && to >= from && to - from <= 93 * DAY_MS) {
            const r = await aggregateByDays(env, ev, from, to);
            stats = r.stats; partial = r.partial; mode = "daily";
          } else {
            stats = aggregate(filterEvents(ev, from, to)); mode = "log";
          }
        }
        return json({
          stats,
          all,
          synopses: SYNOPSES,
          previews: PREVIEWS,
          from,
          to,
          events: ev.length,
          mode,
          partial,
        });
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 500);
      }
    }

    // POST /api/checkout {product:"basic"|"premium", name, email, utms, ab}
    if (url.pathname === "/api/checkout") {
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (!env.AB_KV) return json({ error: "KV not bound (AB_KV)" }, 500);
      try {
        const body = await request.json().catch(() => ({}));
        const product = body.product === "premium" ? "premium" : "basic";
        const name = String(body.name || "").trim().slice(0, 80);
        const email = String(body.email || "").trim().toLowerCase().slice(0, 120);
        const phone = String(body.phone || "").replace(/\D/g, "").slice(0, 20);
        if (name.length < 2) return json({ error: "name required" }, 400);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          return json({ error: "valid email required" }, 400);
        const u = body.utms && typeof body.utms === "object" ? body.utms : {};
        const want = body.provider === "nowpayments" ? "nowpayments" : body.provider === "mercadopago" ? "mercadopago" : "";
        const provider = want || (env.MP_ACCESS_TOKEN ? "mercadopago" : "nowpayments");
        const reqBumps = Array.isArray(body.bumps) ? body.bumps.filter((b) => BUMPS[b]) : [];
        // bump only valid on basic page; premium already includes everything
        const bumps = product === "basic" ? reqBumps : [];
        const access = bumps.includes("premium_upgrade") ? "premium" : product;
        const usdTotal = PRODUCTS[product].amount + bumps.reduce((t, b) => t + BUMPS[b].usd, 0);
        const brlTotal = Math.round((PRODUCTS[product].mp_amount + bumps.reduce((t, b) => t + BUMPS[b].brl, 0)) * 100) / 100;
        const sale = {
          id: orderId(),
          ts: Date.now(),
          name,
          email,
          phone,
          product,
          productName: PRODUCTS[product].name,
          amount: provider === "mercadopago" ? brlTotal : usdTotal,
          currency: provider === "mercadopago" ? PRODUCTS[product].mp_currency : PRODUCTS[product].currency,
          usd_ref: usdTotal,
          provider,
          bumps,
          access,
          status: "pending",
          utms: {
            source: String(u.source || "").slice(0, 80),
            medium: String(u.medium || "").slice(0, 80),
            campaign: String(u.campaign || "").slice(0, 80),
            term: String(u.term || "").slice(0, 80),
            content: String(u.content || "").slice(0, 80),
            ab: VALID.test(body.ab) ? body.ab : "",
          },
          invoice_id: "",
          pay_currency: "",
          tx: "",
          email_status: "",
        };
        // deferred:true -> only saves the pending order (transparent card flow charges after)
        // CAPI: InitiateCheckout server-side (order criado)
        if (body.deferred === true) {
          const all = await readSales(env);
          all.push(sale);
          await writeSales(env, all);
          fbFire(env, ctx, request, {
            event_name: "InitiateCheckout",
            event_id: (body.fb && body.fb.initiate_event_id) || (sale.id + ":initiate"),
            fb: body.fb || {},
            event_source_url: (body.fb && body.fb.event_source_url) || url.origin + (product === "premium" ? "/checkout-10.html" : "/checkout-5.html"),
            email: sale.email,
            ...splitName(sale.name),
            custom_data: { value: usdTotal, currency: "USD", content_ids: [product], content_type: "product", order_id: sale.id },
          });
          return json({ ok: true, order_id: sale.id, amount: sale.amount, currency: sale.currency });
        }
        const origin = url.origin;
        // ---- Mercado Pago Checkout Pro (BRL settlement) ----
        if (provider === "mercadopago") {
          if (!env.MP_ACCESS_TOKEN)
            return json({ error: "payments not configured (MP_ACCESS_TOKEN)", order_id: sale.id }, 500);
          const mpItems = [
            {
              title: PRODUCTS[product].name,
              description: PRODUCTS[product].desc,
              quantity: 1,
              currency_id: PRODUCTS[product].mp_currency,
              unit_price: PRODUCTS[product].mp_amount,
            },
          ];
          for (const b of bumps) {
            mpItems.push({
              title: BUMPS[b].name,
              description: BUMPS[b].desc,
              quantity: 1,
              currency_id: PRODUCTS[product].mp_currency,
              unit_price: BUMPS[b].brl,
            });
          }
          const pref = await fetch("https://api.mercadopago.com/checkout/preferences", {
            method: "POST",
            headers: { Authorization: "Bearer " + env.MP_ACCESS_TOKEN, "content-type": "application/json" },
            body: JSON.stringify({
              items: mpItems,
              payer: { name, email },
              back_urls: {
                success: origin + "/acesso.html?order=" + encodeURIComponent(sale.id),
                failure: origin + (product === "premium" ? "/checkout-10.html" : "/checkout-5.html"),
                pending: origin + "/acesso.html?order=" + encodeURIComponent(sale.id),
              },
              auto_return: "approved",
              notification_url: origin + "/api/webhook/mercadopago",
              external_reference: sale.id,
              metadata: {
                ab: sale.utms.ab,
                utm_source: sale.utms.source,
                utm_medium: sale.utms.medium,
                utm_campaign: sale.utms.campaign,
              },
            }),
          });
          const prefJ = await pref.json().catch(() => ({}));
          if (!pref.ok || !prefJ.init_point) {
            sale.status = "invoice_failed";
            sale.email_status = JSON.stringify(prefJ).slice(0, 200);
            const all = await readSales(env);
            all.push(sale);
            await writeSales(env, all);
            return json({ error: "mercadopago preference failed", detail: JSON.stringify(prefJ).slice(0, 300) }, 502);
          }
          sale.invoice_id = String(prefJ.id || "");
          const allMp = await readSales(env);
          allMp.push(sale);
          await writeSales(env, allMp);
          fbFire(env, ctx, request, {
            event_name: "InitiateCheckout",
            event_id: (body.fb && body.fb.initiate_event_id) || (sale.id + ":initiate"),
            fb: body.fb || {},
            event_source_url: (body.fb && body.fb.event_source_url) || origin + (product === "premium" ? "/checkout-10.html" : "/checkout-5.html"),
            email: sale.email,
            ...splitName(sale.name),
            custom_data: { value: usdTotal, currency: "USD", content_ids: [product], content_type: "product", order_id: sale.id },
          });
          return json({ ok: true, order_id: sale.id, init_point: prefJ.init_point });
        }
        // ---- NOWPayments (crypto / card-via-partner, stablecoin payouts) ----
        if (!env.NOWPAYMENTS_API_KEY)
          return json({ error: "payments not configured (NOWPAYMENTS_API_KEY)", order_id: sale.id }, 500);
        const inv = await fetch("https://api.nowpayments.io/v1/invoice", {
          method: "POST",
          headers: { "x-api-key": env.NOWPAYMENTS_API_KEY, "content-type": "application/json" },
          body: JSON.stringify({
            price_amount: usdTotal,
            price_currency: PRODUCTS[product].currency.toLowerCase(),
            order_id: sale.id,
            order_description: PRODUCTS[product].desc,
            ipn_callback_url: origin + "/api/webhook/nowpayments",
            success_url: origin + "/acesso.html?order=" + encodeURIComponent(sale.id),
            cancel_url: origin + (product === "premium" ? "/checkout-10.html" : "/checkout-5.html"),
          }),
        });
        const invJ = await inv.json().catch(() => ({}));
        if (!inv.ok || !invJ.id) {
          sale.status = "invoice_failed";
          sale.email_status = JSON.stringify(invJ).slice(0, 200);
          const all = await readSales(env);
          all.push(sale);
          await writeSales(env, all);
          return json({ error: "invoice failed", detail: JSON.stringify(invJ).slice(0, 300) }, 502);
        }
        sale.invoice_id = String(invJ.id);
        const all = await readSales(env);
        all.push(sale);
        await writeSales(env, all);
        fbFire(env, ctx, request, {
          event_name: "InitiateCheckout",
          event_id: (body.fb && body.fb.initiate_event_id) || (sale.id + ":initiate"),
          fb: body.fb || {},
          event_source_url: (body.fb && body.fb.event_source_url) || origin + (product === "premium" ? "/checkout-10.html" : "/checkout-5.html"),
          email: sale.email,
          ...splitName(sale.name),
          custom_data: { value: usdTotal, currency: "USD", content_ids: [product], content_type: "product", order_id: sale.id },
        });
        const payUrl = invJ.invoice_url || "https://nowpayments.io/payment/?iid=" + invJ.id;
        return json({ ok: true, order_id: sale.id, invoice_url: payUrl });
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 500);
      }
    }

    // POST /api/pay/card {order_id, card_token, payment_method_id, installments, cpf}
    // Transparent Mercado Pago charge (buyer stays on page). BRL settlement.
    if (url.pathname === "/api/pay/card") {
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (!env.AB_KV) return json({ error: "KV not bound" }, 500);
      if (!env.MP_ACCESS_TOKEN) return json({ error: "payments not configured" }, 500);
      try {
        const body = await request.json().catch(() => ({}));
        const orderId = String(body.order_id || "");
        const token = String(body.card_token || "");
        const pmId = String(body.payment_method_id || "");
        const cpf = String(body.cpf || "").replace(/\D/g, "").slice(0, 11);
        const inst = Math.max(1, Math.min(12, parseInt(body.installments, 10) || 1));
        if (!orderId || !token) return json({ error: "order/token required" }, 400);
        // CPF optional: Brazilians send it (MP requires it for BR cards);
        // foreign buyers omit it and MP decides on its own risk rules.
        const sales = await readSales(env);
        const s = sales.find((x) => x.id === orderId);
        if (!s) return json({ error: "order not found" }, 404);
        if (s.status === "paid") return json({ ok: true, status: "approved", order_id: s.id });
        // CAPI: AddPaymentInfo (tentou pagar)
        fbFire(env, ctx, request, {
          event_name: "AddPaymentInfo",
          event_id: (body.fb && body.fb.addpay_event_id) || (s.id + ":addpay"),
          fb: body.fb || {},
          event_source_url: (body.fb && body.fb.event_source_url) || "",
          email: s.email,
          ...splitName(s.name),
          custom_data: { value: Number(s.usd_ref || 0), currency: "USD", content_ids: [s.product], content_type: "product", order_id: s.id },
        });
        const pr = await fetch("https://api.mercadopago.com/v1/payments", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + env.MP_ACCESS_TOKEN,
            "content-type": "application/json",
            "X-Idempotency-Key": (crypto.randomUUID ? crypto.randomUUID() : orderId + "-" + Date.now()),
          },
          body: JSON.stringify({
            transaction_amount: Number(s.amount),
            token,
            description: s.productName + (s.bumps && s.bumps.length ? " + " + s.bumps.join(",") : ""),
            installments: inst,
            ...(pmId ? { payment_method_id: pmId } : {}),
            payer: {
              email: s.email,
              ...(cpf.length === 11 ? { identification: { type: "CPF", number: cpf } } : {}),
            },
            external_reference: s.id,
            notification_url: new URL(request.url).origin + "/api/webhook/mercadopago",
            metadata: { ab: (s.utms || {}).ab || "", utm_source: (s.utms || {}).source || "" },
          }),
        });
        const pay = await pr.json().catch(() => ({}));
        s.tx = String(pay.id || s.tx || "");
        const status = String(pay.status || "").toLowerCase();
        if (status === "approved" || status === "authorized") {
          s.status = "paid";
          s.paid_ts = Date.now();
          const em = await sendAccessEmail(env, s);
          s.email_status = em.sent ? "sent:" + (em.id || "") : "failed:" + (em.reason || "");
          await writeSales(env, sales);
          // CAPI: Purchase (pagamento aprovado) — event_id = order id p/ deduplicar com o browser
          fbFire(env, ctx, request, {
            event_name: "Purchase",
            event_id: s.id,
            fb: body.fb || {},
            event_source_url: (body.fb && body.fb.event_source_url) || "",
            email: s.email,
            ...splitName(s.name),
            custom_data: { value: Number(s.usd_ref || s.amount || 0), currency: "USD", content_ids: [s.product], content_type: "product", order_id: s.id },
          });
          return json({ ok: true, status: "approved", order_id: s.id });
        }
        s.status = "mp:" + (status || "rejected");
        s.email_status = JSON.stringify(pay).slice(0, 200);
        await writeSales(env, sales);
        return json({ ok: false, status: status || "rejected", order_id: s.id, detail: String(pay.status_detail || status) }, 402);
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 500);
      }
    }

    // /api/webhook/mercadopago (?topic=payment&id= | JSON {type,data.id})
    if (url.pathname === "/api/webhook/mercadopago") {
      if (!env.AB_KV) return json({ error: "KV not bound" }, 500);
      try {
        const q = url.searchParams;
        const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
        const payId =
          q.get("id") || q.get("data.id") || (body.data && body.data.id) || body.id || "";
        if (!payId) return json({ ok: true, note: "no payment id (test ping?)" });
        if (!env.MP_ACCESS_TOKEN) return json({ error: "MP not configured" }, 500);
        const pr = await fetch("https://api.mercadopago.com/v1/payments/" + encodeURIComponent(payId), {
          headers: { Authorization: "Bearer " + env.MP_ACCESS_TOKEN },
        });
        const pay = await pr.json().catch(() => ({}));
        if (!pr.ok) return json({ error: "mp fetch failed", detail: JSON.stringify(pay).slice(0, 200) }, 502);
        const orderId = String(pay.external_reference || "");
        const status = String(pay.status || "").toLowerCase();
        const sales = await readSales(env);
        const s = sales.find((x) => x.id === orderId);
        if (!s) return json({ ok: true, note: "order not found" });
        s.tx = String(pay.id || "");
        s.pay_currency = String(pay.currency_id || s.currency);
        s.mp_detail = String(pay.status_detail || "");
        if (status === "approved" && s.status !== "paid") {
          s.status = "paid";
          s.paid_ts = Date.now();
          const em = await sendAccessEmail(env, s);
          s.email_status = em.sent ? "sent:" + (em.id || "") : "failed:" + (em.reason || "");
          await writeSales(env, sales);
          // CAPI: Purchase via webhook (cobre Checkout Pro / redirect, sem browser)
          fbFire(env, ctx, request, {
            event_name: "Purchase",
            event_id: s.id,
            fb: {},
            event_source_url: url.origin + "/acesso.html?order=" + encodeURIComponent(s.id),
            email: s.email,
            ...splitName(s.name),
            custom_data: { value: Number(s.usd_ref || s.amount || 0), currency: "USD", content_ids: [s.product], content_type: "product", order_id: s.id },
          });
        } else if (s.status !== "paid") {
          s.status = "mp:" + status;
          await writeSales(env, sales);
        }
        return json({ ok: true });
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 500);
      }
    }

    // POST /api/webhook/nowpayments (NOWPayments IPN)
    if (url.pathname === "/api/webhook/nowpayments") {
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (!env.AB_KV) return json({ error: "KV not bound" }, 500);
      try {
        const body = await request.json().catch(() => null);
        if (!body) return json({ error: "bad json" }, 400);
        const sig = request.headers.get("x-nowpayments-sig") || "";
        if (!env.NOWPAYMENTS_IPN_SECRET || !(await verifyNowSig(body, sig, env.NOWPAYMENTS_IPN_SECRET)))
          return json({ error: "bad signature" }, 401);
        const orderId = String(body.order_id || "");
        const status = String(body.payment_status || "").toLowerCase();
        const sales = await readSales(env);
        const s = sales.find((x) => x.id === orderId);
        if (!s) return json({ ok: true, note: "order not found" });
        s.pay_currency = String(body.pay_currency || "");
        s.tx = String(body.payment_id || body.id || "");
        if ((status === "finished" || status === "confirmed") && s.status !== "paid") {
          s.status = "paid";
          s.paid_ts = Date.now();
          const em = await sendAccessEmail(env, s);
          s.email_status = em.sent ? "sent:" + (em.id || "") : "failed:" + (em.reason || "");
          await writeSales(env, sales);
          // CAPI: Purchase via NOWPayments IPN
          fbFire(env, ctx, request, {
            event_name: "Purchase",
            event_id: s.id,
            fb: {},
            event_source_url: url.origin + "/acesso.html?order=" + encodeURIComponent(s.id),
            email: s.email,
            ...splitName(s.name),
            custom_data: { value: Number(s.usd_ref || s.amount || 0), currency: "USD", content_ids: [s.product], content_type: "product", order_id: s.id },
          });
        } else if (s.status !== "paid") {
          s.status = "ipn:" + status;
          await writeSales(env, sales);
        }
        return json({ ok: true });
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 500);
      }
    }

    // GET /api/sales?password=Mine123&from=&to=&product=&status=
    if (url.pathname === "/api/sales") {
      if (url.searchParams.get("password") !== adminPw(env))
        return json({ error: "wrong password" }, 401);
      if (!env.AB_KV) return json({ error: "KV not bound (AB_KV)" }, 500);
      try {
        const q = url.searchParams;
        const from = q.get("from") ? parseInt(q.get("from"), 10) || 0 : 0;
        const to = q.get("to") ? parseInt(q.get("to"), 10) || 0 : 0;
        const pf = q.get("product") || "";
        const sf = q.get("status") || "";
        const all = await readSales(env);
        const sales = all.filter(
          (x) =>
            (!from || x.ts >= from) &&
            (!to || x.ts <= to) &&
            (!pf || x.product === pf) &&
            (!sf || x.status === sf)
        ).sort((a, b) => b.ts - a.ts);
        let revenue = 0;
        for (const x of sales) if (x.status === "paid") revenue += Number(x.amount) || 0;
        return json({ sales, total: sales.length, paid: sales.filter((x) => x.status === "paid").length, revenue });
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 500);
      }
    }

    // POST /api/resend?password=...&order=ORD-...  (manually re-send access email)
    if (url.pathname === "/api/resend") {
      if (url.searchParams.get("password") !== adminPw(env))
        return json({ error: "wrong password" }, 401);
      if (!env.AB_KV) return json({ error: "KV not bound (AB_KV)" }, 500);
      try {
        const order = url.searchParams.get("order") || "";
        const all = await readSales(env);
        const s = all.find((x) => x.id === order);
        if (!s) return json({ error: "order not found" }, 404);
        const em = await sendAccessEmail(env, s);
        s.email_status = em.sent ? "sent:" + em.id : "failed:" + (em.reason || "?");
        await writeSales(env, all);
        return json({ ok: !!em.sent, result: s.email_status });
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 500);
      }
    }

    // GET /api/access?order=ORD-...  or ?email=
    if (url.pathname === "/api/access") {
      if (!env.AB_KV) return json({ error: "KV not bound" }, 500);
      try {
        const q = url.searchParams;
        const order = q.get("order") || "";
        const email = (q.get("email") || "").trim().toLowerCase();
        const all = await readSales(env);
        const found = all.filter(
          (x) =>
            x.status === "paid" &&
            ((order && x.id === order) || (email && x.email === email))
        );
        if (!found.length) return json({ error: "no paid order found" }, 404);
        const latest = found[found.length - 1];
        const lvl = accessOf(latest);
        return json({
          ok: true,
          name: latest.name,
          product: latest.product,
          productName: latest.productName,
          access: lvl,
          links: ACCESS_LINKS[lvl] || [],
        });
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 500);
      }
    }

    try {
      return await env.ASSETS.fetch(request);
    } catch (e) {
      return new Response("Not found", {
        status: 404,
        headers: { "content-type": "text/plain" },
      });
    }
  },
};
