/**
 * GET /api/usage?key=YOUR_ADMIN_PASSCODE
 *
 * Returns how often each configured access code has been used. This is a
 * raw JSON endpoint, not a page — open the URL in a browser and read it,
 * or fetch it from a script.
 *
 * Protected by ADMIN_PASSCODE, a separate secret from the tester access
 * codes in APP_PASSCODE. Anyone who has ADMIN_PASSCODE can see when every
 * tester last used the app and how often — set it to something only you
 * know, and don't reuse a tester's code for it.
 */

import { Redis } from "@upstash/redis";
import { readUsage } from "./_usage-lib.js";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Use GET" });
    return;
  }

  const adminPass = process.env.ADMIN_PASSCODE;
  if (!adminPass) {
    res.status(500).json({ error: "ADMIN_PASSCODE is not set on the server. Add it in Vercel's Environment Variables." });
    return;
  }

  const given = (req.query && req.query.key) || req.headers["x-admin-pass"];
  if (given !== adminPass) {
    res.status(401).json({ error: "Bad admin passcode" });
    return;
  }

  const codes = (process.env.APP_PASSCODE || "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  if (codes.length === 0) {
    res.status(200).json({ generatedAt: new Date().toISOString(), testers: [], note: "APP_PASSCODE is empty — nothing to report." });
    return;
  }

  try {
    const testers = await readUsage(redis, codes);
    res.status(200).json({ generatedAt: new Date().toISOString(), testers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not read usage. Is a Redis database connected to this project?" });
  }
}
