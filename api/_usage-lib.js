/**
 * Records and reads per-access-code usage. Shared by estimate.js (which
 * writes one entry per successful photo estimate) and usage.js (which
 * reads it back for the admin view).
 *
 * A leading underscore keeps Vercel from turning this into its own route —
 * only estimate.js and usage.js are reachable URLs.
 */

/* The part before the dash in an access code is meant to be a name, e.g.
   "justin-4821" or "mum-9077". Falls back to the whole code if there's no
   dash, so a plain code still shows as something. */
export function displayName(code) {
  const base = String(code || "").split(/[-_]/)[0] || String(code || "");
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "(unknown)";
}

/* How many timestamps we keep per code. Generous for a handful of testers;
   if a code passes this many calls inside its 30-day window the count
   under-reports slightly, which is an acceptable trade for not storing an
   unbounded log. */
const LOG_CAP = 1000;
const RECENT_SHOWN = 20;

/* Called once per successful estimate. Never throws — a logging failure
   must not take down the feature it's watching, so every KV call is
   wrapped and a failure here is swallowed (and noted in the function log)
   rather than surfaced to the person waiting on their meal estimate. */
export async function recordUsage(kv, code) {
  if (!code) return;
  const now = Date.now();
  try {
    await Promise.all([
      kv.hincrby("usage:count", code, 1),
      kv.hset("usage:last", { [code]: now }),
      kv.rpush(`usage:log:${code}`, now),
    ]);
    /* Trimming is best-effort and detached from the write above: a missed
       trim just means a slightly longer list next time, never lost data. */
    kv.ltrim(`usage:log:${code}`, -LOG_CAP, -1).catch(() => {});
  } catch (err) {
    console.error("usage logging failed", err);
  }
}

/* Builds the admin summary for every configured access code, including
   ones that have never been used (so a tester who hasn't opened the app
   yet still shows up, at zero). */
export async function readUsage(kv, codes) {
  const now = Date.now();
  const day = 86400000;

  const [counts, lastSeen] = await Promise.all([
    kv.hgetall("usage:count").catch(() => ({})) || {},
    kv.hgetall("usage:last").catch(() => ({})) || {},
  ]);

  const testers = [];
  for (const code of codes) {
    let log = [];
    try {
      log = await kv.lrange(`usage:log:${code}`, -LOG_CAP, -1);
    } catch { /* no calls logged yet for this code */ }

    const timestamps = (log || []).map(Number).filter(Number.isFinite);
    const total = Number((counts && counts[code]) || 0);
    const last = lastSeen && lastSeen[code] ? Number(lastSeen[code]) : null;

    testers.push({
      code,
      name: displayName(code),
      totalCalls: total,
      last7Days: timestamps.filter((t) => now - t < 7 * day).length,
      last30Days: timestamps.filter((t) => now - t < 30 * day).length,
      lastUsed: last ? new Date(last).toISOString() : null,
      recent: timestamps.slice(-RECENT_SHOWN).reverse().map((t) => new Date(t).toISOString()),
    });
  }

  /* Most recently active first, unused codes trail at the bottom. */
  testers.sort((a, b) => (b.lastUsed || "").localeCompare(a.lastUsed || ""));
  return testers;
}
