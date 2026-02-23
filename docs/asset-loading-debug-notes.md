# Asset loading debug notes (Devvit + Reddit CSP)

## Actionable errors (fix these)

- `Fetch API cannot load data:model/gltf-binary;base64,... Refused to connect because it violates the document's Content Security Policy.`
- `Failed to load <model> model: TypeError: Failed to fetch. Refused to connect because it violates the document's Content Security Policy.`

If these appear, GLB URLs are being inlined or rewritten to `data:` and must be emitted as external files.

## Expected noise (usually ignore for model loading)

- `net::ERR_BLOCKED_BY_CLIENT` for Reddit ad pixel URLs.
- `Fetch failed loading: https://w3-reporting.reddit.com/...`
- `Fetch failed loading: https://www.google.com/recaptcha/...`
- Generic `connect-src` CSP blocks for non-whitelisted analytics/reporting endpoints.
- PWA/browser warnings (e.g. `apple-mobile-web-app-capable` deprecation, banner prompt warnings).

These are common in Reddit playtest contexts and are not root cause for GLB model failures unless they explicitly mention your model URLs.

## Quick pass/fail checklist

- Pass: model requests resolve as external `.glb` files under the app's emitted assets.
- Pass: no `data:model/gltf-binary` in console.
- Pass: no `Failed to load <model> model` errors for ground/path/rock/wall/tower/coin/mob/castle.
