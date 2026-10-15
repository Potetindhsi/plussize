# plussize — EN landing + A/B 3×3 (Cloudflare Pages)

Static site (no PHP on Pages):

- `index.html` — EN landing, USD ($5 page / $10 popup), 3 synopses × 3 VEED previews, global round-robin via `/api/next`, tracking via `/api/track`
- `metricasab.html` — dashboard (password `Mine123`), reads `/api/stats`
- `assets/testimonial-1.webp`, `assets/testimonial-2.webp`
- `functions/api/next.js`, `track.js`, `stats.js` — Pages Functions + KV (`AB_KV`)

KV setup: create namespace `AB_METRICS`, bind as `AB_KV` in Pages → Settings → Functions, then Redeploy.
