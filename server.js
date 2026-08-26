/**
 * The Node entry point — and the only file in this example that is tied to a
 * runtime. On Cloudflare Workers this is `export default app`, on Bun
 * `export default { fetch: app.fetch }`, on Deno `Deno.serve(app.fetch)`.
 */
import { serve } from "@hono/node-server";

import { app } from "./app.js";

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) }, ({ port }) => {
  console.log(`Listening on http://localhost:${port}`);
});
