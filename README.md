# plussize — EN landing + A/B 3×3 (Cloudflare Worker)

Deployed as Worker `plussizes` (Git integration, `npx wrangler deploy`):

- `public/index.html` — EN landing, USD ($5 page / $10 popup), 3 synopses × 3 VEED previews, global round-robin via `/api/next`, tracking via `/api/track`
- `public/metricasab.html` — dashboard (password `Mine123`), reads `/api/stats`
- `public/assets/testimonial-1.webp`, `testimonial-2.webp`
- `worker.js` + `wrangler.toml` — Worker (static assets `./public` + API). KV binding `AB_KV` added via dashboard, not in toml.
- `functions/api/*` — Pages Functions mirror (only used if a Pages project is created from this repo; output dir would be `public/`).

KV setup: Storage & databases > KV > create `AB_METRICS`, then Worker plussizes > Settings > Bindings > KV namespace, variable `AB_KV`. Redeploy after.
