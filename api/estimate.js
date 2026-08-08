/**
 * POST /api/estimate
 * Body: { content: [ ...Anthropic message content blocks ], system?: string }
 *
 * Keeps ANTHROPIC_API_KEY on the server. The browser never sees it.
 * Requires the x-tally-pass header to match APP_PASSCODE, so a stranger
 * who finds this URL cannot spend your credit.
 */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  const passcode = process.env.APP_PASSCODE;
  if (passcode && req.headers["x-tally-pass"] !== passcode) {
    res.status(401).json({ error: "Bad passcode" });
    return;
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server" });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const content = body && body.content;
  if (!Array.isArray(content) || content.length === 0) {
    res.status(400).json({ error: "content must be a non-empty array" });
    return;
  }

  // Guard against a huge payload being relayed
  const size = JSON.stringify(content).length;
  if (size > 8_000_000) {
    res.status(413).json({ error: "Payload too large" });
    return;
  }

  const payload = {
    model: process.env.MODEL || "claude-sonnet-4-6",
    max_tokens: 1500,
    // Estimation should be repeatable: the same plate should not swing
    // 200 calories between two attempts.
    temperature: 0,
    messages: [{ role: "user", content }],
  };
  if (typeof body.system === "string" && body.system.trim()) {
    payload.system = body.system;
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json();
    if (!r.ok) {
      console.error("Anthropic error", r.status, data);
      // Never reuse 401 here — the browser reads 401 as "wrong passcode".
      const status = r.status === 429 ? 429 : 502;
      res.status(status).json({ error: (data && data.error && data.error.message) || "Upstream error" });
      return;
    }
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Could not reach the model" });
  }
}
