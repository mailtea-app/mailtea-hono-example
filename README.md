# Mailtea + Hono Example

This example shows how to use [Mailtea](https://mailtea.app) with Hono to expose
a small HTTP API that sends an email and reports its delivery status.

## Prerequisites

To get the most out of this guide, you'll need to:

- [Create an API key](https://studio.mailtea.app/api-keys)
- [Verify your domain](https://docs.mailtea.app/docs/documentation/domains)

## Instructions

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and add your API key:
   ```bash
   cp .env.example .env
   ```
   Set `MAILTEA_FROM` too — it has to be an address on a domain you have
   verified in Mailtea.
3. Run it:
   ```bash
   npm start
   ```
4. Send an email:
   ```bash
   curl -X POST http://localhost:3000/send \
     -H 'Content-Type: application/json' \
     -d '{"to":"reader@example.com","subject":"Hello","html":"<p>Sent with Mailtea.</p>"}'
   ```
   ```json
   { "id": "txemail_2f1c9b0a4d5e4f8ab3c6d7e8f9a0b1c2" }
   ```
5. Check how it went:
   ```bash
   curl http://localhost:3000/emails/txemail_2f1c9b0a4d5e4f8ab3c6d7e8f9a0b1c2
   ```
   ```json
   {
     "id": "txemail_2f1c9b0a4d5e4f8ab3c6d7e8f9a0b1c2",
     "status": "delivered",
     "subject": "Hello",
     "created_at": "2026-01-01T00:00:00.000Z"
   }
   ```

## What this example covers

- `POST /send` — sending through the `mailtea-sdk` client
- Request validation with Hono's built-in `validator`, a plain function rather
  than a schema library
- `GET /emails/:id` — reading a message's delivery status back
- `app.onError` mapping a `MailteaError` onto the status Mailtea chose, so a
  rate limit reaches your caller as a 429 rather than a 500
- Reading configuration through `hono/adapter`'s `env()` instead of
  `process.env`, which is what makes the app portable

## Runs anywhere Hono runs

`app.js` imports no runtime adapter, so the same app runs unchanged on
Cloudflare Workers, Bun, Deno and Vercel. `server.js` is the only Node-specific
file:

```js
import { serve } from "@hono/node-server";
serve({ fetch: app.fetch, port: 3000 });        // Node
export default app;                              // Cloudflare Workers
export default { fetch: app.fetch };             // Bun
Deno.serve(app.fetch);                           // Deno
export default handle(app);                      // Vercel, via `hono/vercel`
```

On Workers, set `MAILTEA_API_KEY` with `wrangler secret put` and put
`MAILTEA_FROM` — configuration, not a secret — under `[vars]` in
`wrangler.toml`. `env(c)` reads both from the request bindings there and from
`process.env` on Node, with no change to the handler. Workers also needs
`compatibility_flags = ["nodejs_compat"]`: `mailtea-sdk` imports Node's
`crypto` for its webhook-signature helpers, so the bundle needs Node built-ins
even though the send path itself is pure `fetch`.

## Tests

```bash
npm test
```

The tests run against a bundled mock Mailtea server, so they need no API key
and make no network calls. They drive the app through Hono's `app.request()`
helper, which exercises the real routing and middleware without opening a
socket.

## Learn more

- [Documentation](https://docs.mailtea.app)
- [API reference](https://docs.mailtea.app/docs/api-reference)
- [Node.js SDK](https://github.com/mailtea-app/mailtea-node) ·
  [Python SDK](https://github.com/mailtea-app/mailtea-python) ·
  [MCP server](https://github.com/mailtea-app/mailtea-mcp)
