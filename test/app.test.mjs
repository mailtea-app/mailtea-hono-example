import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { app } from "../app.js";
import { startMockMailtea } from "./mock-mailtea.mjs";

const FROM = "Acme <hello@acme.com>";

let mock;

before(async () => {
  mock = await startMockMailtea();

  // The app reads its config per request, so aiming it at the mock server is
  // only a matter of environment — no module has to be stubbed.
  process.env.MAILTEA_API_KEY = "mt_pat_test_key";
  process.env.MAILTEA_API_BASE_URL = mock.url;
  process.env.MAILTEA_FROM = FROM;
});

after(() => mock.close());

/** `app.request()` runs the real routing and middleware, without a socket. */
function postSend(body) {
  return app.request("/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

test("POST /send delivers the message to Mailtea and returns its id", async () => {
  const res = await postSend({
    to: "reader@acme.com",
    subject: "Hello from Hono",
    html: "<p>Sent with Mailtea.</p>"
  });

  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { id: "txemail_00000000000000000000000000000000" });

  const sent = mock.last;
  assert.equal(sent.method, "POST");
  assert.equal(sent.path, "/v1/emails");
  assert.match(sent.authorization, /^Bearer .+/);
  assert.equal(sent.body.from, FROM);
  assert.deepEqual(sent.body.to, ["reader@acme.com"]);
  assert.equal(sent.body.subject, "Hello from Hono");
  assert.equal(sent.body.html, "<p>Sent with Mailtea.</p>");
});

test("POST /send rejects an invalid body before spending a request", async () => {
  const requestsBefore = mock.requests.length;

  const res = await postSend({ to: "not-an-address", subject: "" });

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), {
    error: "Invalid request body",
    problems: [
      '"to" must be an email address, or a non-empty array of them',
      '"subject" is required',
      'one of "html" or "text" is required'
    ]
  });
  assert.equal(mock.requests.length, requestsBefore, "nothing should reach Mailtea");
});

test("POST /send rejects an empty or oversized recipient list", async () => {
  const requestsBefore = mock.requests.length;

  const empty = await postSend({ to: [], subject: "Hi", text: "Hi" });
  assert.equal(empty.status, 400);
  assert.deepEqual((await empty.json()).problems, [
    '"to" must be an email address, or a non-empty array of them'
  ]);

  const tooMany = await postSend({
    to: Array.from({ length: 51 }, (_, i) => `reader${i}@acme.com`),
    subject: "Hi",
    text: "Hi"
  });
  assert.equal(tooMany.status, 400);
  assert.deepEqual((await tooMany.json()).problems, ['"to" accepts at most 50 addresses']);

  assert.equal(mock.requests.length, requestsBefore, "nothing should reach Mailtea");
});

test("POST /send answers 400 on a malformed JSON body", async () => {
  const res = await app.request("/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not json"
  });

  assert.equal(res.status, 400);
});

test("GET /emails/:id reports the delivery status", async () => {
  const res = await app.request("/emails/txemail_00000000000000000000000000000000");

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    id: "txemail_00000000000000000000000000000000",
    status: "delivered",
    subject: "Mock email",
    created_at: "2026-01-01T00:00:00.000Z"
  });

  assert.equal(mock.last.method, "GET");
  assert.equal(mock.last.path, "/v1/emails/txemail_00000000000000000000000000000000");
  assert.match(mock.last.authorization, /^Bearer .+/);
});

test("a Mailtea error keeps its own status instead of becoming a 500", async () => {
  // The mock 404s any route it does not know, which is the cheapest way to get
  // a real MailteaError through the SDK and into app.onError.
  const baseUrl = process.env.MAILTEA_API_BASE_URL;
  process.env.MAILTEA_API_BASE_URL = `${baseUrl}/typo`;

  try {
    const res = await postSend({ to: "reader@acme.com", subject: "Hi", text: "Hi" });

    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "Not Found");
  } finally {
    process.env.MAILTEA_API_BASE_URL = baseUrl;
  }
});

test("a missing API key fails as a 500, without reaching Mailtea", async () => {
  const apiKey = process.env.MAILTEA_API_KEY;
  delete process.env.MAILTEA_API_KEY;
  const requestsBefore = mock.requests.length;

  // Our own misconfiguration is logged, not narrated back to the caller.
  const logged = [];
  const consoleError = console.error;
  console.error = (...args) => logged.push(args.join(" "));

  try {
    const res = await postSend({ to: "reader@acme.com", subject: "Hi", text: "Hi" });

    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "Internal Server Error" });
    assert.equal(mock.requests.length, requestsBefore);
    assert.match(logged.join("\n"), /Missing Mailtea API key/);
  } finally {
    console.error = consoleError;
    process.env.MAILTEA_API_KEY = apiKey;
  }
});
