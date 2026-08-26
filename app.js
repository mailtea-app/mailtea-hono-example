/**
 * A small send API built on Hono and the Mailtea SDK.
 *
 * Nothing in this file is Node-specific: `server.js` is the only file that
 * imports a runtime adapter, so this same `app` is what you export from a
 * Cloudflare Worker, a Bun or Deno server, or a Vercel function.
 */
import { Hono } from "hono";
import { env } from "hono/adapter";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { Mailtea, MailteaError } from "mailtea-sdk";

/** Mailtea caps a single message at 50 recipients across to + cc + bcc. */
const MAX_RECIPIENTS = 50;

export const app = new Hono();

/**
 * Built per request rather than once at import time: Workers hands secrets to
 * the handler in `c.env`, Node keeps them in `process.env`, and `env()` reads
 * whichever the current runtime uses. That is what keeps this file portable.
 * The client is a thin wrapper around `fetch`, so this costs nothing.
 */
function mailtea(c) {
  const { MAILTEA_API_KEY, MAILTEA_API_BASE_URL } = env(c);

  return new Mailtea(MAILTEA_API_KEY, {
    // Only needed for local dev or a self-hosted Mailtea. Omit in production.
    baseUrl: MAILTEA_API_BASE_URL
  });
}

/**
 * Hono's own validator: a plain function, no schema library. These are cheap
 * checks that save a round-trip. Mailtea still does the authoritative
 * validation — address syntax, domain verification, suppression list — so
 * there is no reason to restate its rules here.
 */
const validateSend = validator("json", (body, c) => {
  const { to, subject, html, text } = body ?? {};
  const recipients = Array.isArray(to) ? to : [to];
  const problems = [];

  const addressed =
    recipients.length > 0 &&
    recipients.every((address) => typeof address === "string" && address.includes("@"));

  if (!addressed) {
    problems.push('"to" must be an email address, or a non-empty array of them');
  } else if (recipients.length > MAX_RECIPIENTS) {
    problems.push(`"to" accepts at most ${MAX_RECIPIENTS} addresses`);
  }
  if (typeof subject !== "string" || subject.trim() === "") {
    problems.push('"subject" is required');
  }

  const hasHtml = typeof html === "string" && html !== "";
  const hasText = typeof text === "string" && text !== "";
  if (!hasHtml && !hasText) {
    problems.push('one of "html" or "text" is required');
  }

  if (problems.length > 0) {
    return c.json({ error: "Invalid request body", problems }, 400);
  }

  // Whatever this returns is what `c.req.valid("json")` hands the handler, so
  // the handler never sees an unchecked field.
  return {
    to: recipients,
    subject,
    html: hasHtml ? html : undefined,
    text: hasText ? text : undefined
  };
});

app.post("/send", validateSend, async (c) => {
  const { to, subject, html, text } = c.req.valid("json");
  const { MAILTEA_FROM } = env(c);

  const { id } = await mailtea(c).emails.send({
    // The From address is server config, never request input: it has to be an
    // address on a domain you have verified in Mailtea.
    from: MAILTEA_FROM,
    to,
    subject,
    html,
    text
  });

  // Accepted, not delivered — delivery is asynchronous. Poll /emails/:id, or
  // subscribe to webhooks, to find out how it ended.
  return c.json({ id }, 202);
});

app.get("/emails/:id", async (c) => {
  const email = await mailtea(c).emails.get(c.req.param("id"));

  return c.json({
    id: email.id,
    status: email.status, // queued, sent, delivered, bounced, complained, failed
    subject: email.subject,
    created_at: email.created_at
  });
});

app.onError((err, c) => {
  if (err instanceof MailteaError) {
    // A status of 0 means the SDK never reached the API — no key configured,
    // no global fetch. That one is our fault, not the caller's, so it is a 500
    // and the message stays in the log rather than describing our own setup to
    // whoever called us.
    if (err.status === 0) {
      console.error(`Mailtea client misconfigured: ${err.message}`);
      return c.json({ error: "Internal Server Error" }, 500);
    }

    // Otherwise Mailtea already chose the right status — 422 for a bad payload,
    // 429 when rate limited — so forward it instead of flattening to 500.
    return c.json({ error: err.message, code: err.code }, err.status >= 400 ? err.status : 500);
  }

  // Hono raises these itself, a malformed JSON body being the common one, and
  // they already carry the status and message they should be answered with.
  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  console.error(err);
  return c.json({ error: "Internal Server Error" }, 500);
});
