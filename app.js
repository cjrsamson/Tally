import { h, render } from "preact";
import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

/* ============================ storage (IndexedDB) ============================ */

const DB = "tally", STORE = "kv", KEY = "state";

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function loadState() {
  try {
    const db = await openDB();
    return await new Promise((res, rej) => {
      const q = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => rej(q.error);
    });
  } catch { return null; }
}
async function saveState(v) {
  try {
    const db = await openDB();
    return await new Promise((res, rej) => {
      const t = db.transaction(STORE, "readwrite");
      t.objectStore(STORE).put(v, KEY);
      t.oncomplete = () => res(true);
      t.onerror = () => rej(t.error);
    });
  } catch { return false; }
}

/* ============================ constants ============================ */

const todayKey = (d = new Date()) => {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 10);
};
const ACTIVITY = [
  { id: "sedentary", label: "Mostly at a desk", mult: 1.2 },
  { id: "light", label: "Light — walking, a session or two", mult: 1.375 },
  { id: "moderate", label: "Moderate — tennis 3 to 4 times a week", mult: 1.55 },
  { id: "active", label: "Active — training most days", mult: 1.725 },
];
const SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"];
const SLOT_ICON = { Breakfast: "🍳", Lunch: "🥗", Dinner: "🍽️", Snack: "🍎" };
const DEFAULTS = {
  name: "", heightCm: 166, age: 28, sex: "male", startWeight: 72.5,
  goalWeight: 69, stretchWeight: 66.5, activity: "light", weeklyLoss: 0.5,
};

function deriveTargets(p, w0) {
  const w = w0 || p.startWeight;
  const bmr = 10 * w + 6.25 * p.heightCm - 5 * p.age + (p.sex === "female" ? -161 : 5);
  const tdee = bmr * (ACTIVITY.find((a) => a.id === p.activity) || ACTIVITY[1]).mult;
  const floor = p.sex === "female" ? 1200 : 1500;
  const kcal = Math.max(floor, Math.round((tdee - (p.weeklyLoss * 7700) / 7) / 10) * 10);
  const protein = Math.round(w * 1.8), fat = Math.round(w * 0.8);
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, protein, fat,
    carbs: Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 5) * 5) };
}

const norm = (e) => e.base ? e : {
  ...e, base: { kcal: e.kcal || 0, protein: e.protein || 0, carbs: e.carbs || 0, fat: e.fat || 0 },
  servings: 1, ingredients: e.ingredients || [],
};
const tot = (e) => {
  const n = norm(e), s = n.servings || 1;
  return { kcal: Math.round(n.base.kcal * s), protein: Math.round(n.base.protein * s),
    carbs: Math.round(n.base.carbs * s), fat: Math.round(n.base.fat * s) };
};

/* When an ingredient is edited the meal total moves with it. Macros are held
   in the same ratio, which is the honest thing to do when we only know the
   calorie change and not which macro it came from. */
function rescaleTo(b, newKcal) {
  const k = Math.max(0, Math.round(newKcal));
  const old = b.kcal || 0;
  if (old <= 0) return { kcal: k, protein: b.protein || 0, carbs: b.carbs || 0, fat: b.fat || 0 };
  const r = k / old;
  return {
    kcal: k,
    protein: Math.max(0, Math.round((b.protein || 0) * r)),
    carbs: Math.max(0, Math.round((b.carbs || 0) * r)),
    fat: Math.max(0, Math.round((b.fat || 0) * r)),
  };
}

/* ============================ api ============================ */

const PASS_KEY = "tally.pass";
const getPass = () => { try { return localStorage.getItem(PASS_KEY) || ""; } catch { return ""; } };
const setPass = (v) => { try { localStorage.setItem(PASS_KEY, v); } catch {} };

/* The rules that stop it inventing food that isn't on the plate. Sent as a
   system prompt rather than buried in the user turn — it is followed far
   more consistently there. */
const SYSTEM = `You are the nutrition estimator inside a personal calorie tracker. You reply with JSON only — no prose, no markdown fences.

Reading a photograph:
- Report ONLY food you can actually see. Never add an item because it is commonly served with the dish. If a meal usually comes with rice, bread, a salad, a dip or a drink and it is not visible in the frame, it does not exist.
- Do not invent what is hidden beneath or behind the visible food. Estimate the visible layer only, unless the shape of a bowl or wrapper makes the hidden volume genuinely obvious.
- Judge portion size against something visible for scale: the rim of the plate or bowl, a fork, spoon or chopsticks, a hand, a standard glass or a drinks can. State what you used in "basis". If nothing in the frame gives scale, say so in "basis" and lower your confidence.
- Count discrete items — eggs, prawns, dumplings, slices, skewers — only where you can see them. Where items overlap and the count is ambiguous, take the LOWER number.
- Where the image is blurred, cropped, dim, or shot from an angle that hides the depth of the food, reduce confidence rather than filling the gap with a guess.
- Do not describe the cuisine, the crockery or the setting. Only the food.

Numbers:
- Use round, defensible figures. Do not imply a precision you do not have.
- The per-ingredient calories must add up to within 5% of "kcal".
- "kcalLow" and "kcalHigh" are the honest range a careful dietitian would give for this photo. A tight range signals a clear read; a wide one signals a hard call.
- "confidence" is "high" only when the food is fully visible, unambiguous and has a clear scale reference. Otherwise "medium", or "low" when you are largely inferring.

Never comment on the person's body, never shame them, and never suggest skipping a meal to compensate.`;

async function askClaude(content, system) {
  const r = await fetch("/api/estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-tally-pass": getPass() },
    body: JSON.stringify({ content, system: system || SYSTEM }),
  });
  if (r.status === 401) { const e = new Error("auth"); e.auth = true; throw e; }
  if (!r.ok) throw new Error("api " + r.status);
  const d = await r.json();
  const raw = (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const cl = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(cl.slice(cl.indexOf("{"), cl.lastIndexOf("}") + 1));
}

const SHAPE =
  `{"name":"short dish name, max 6 words","kcal":integer,"protein":integer grams,"carbs":integer grams,` +
  `"fat":integer grams,"kcalLow":integer,"kcalHigh":integer,"confidence":"high"|"medium"|"low",` +
  `"basis":"the scale reference you used, max 10 words",` +
  `"ingredients":[{"name":"component","qty":"portion as a person would say it, e.g. 1.5 cups or 120 g","kcal":integer}],` +
  `"note":"one short sentence naming the biggest calorie driver",` +
  `"advice":"one or two sentences of practical guidance"}`;

const dataUrlParts = (u) => {
  if (!u) return null;
  const m = /^data:(.+?);base64,(.*)$/.exec(u);
  return m ? { media: m[1], b64: m[2] } : null;
};

async function shrink(file, max, q) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(max / bmp.width, max / bmp.height, 1);
  const w = Math.round(bmp.width * s), hh = Math.round(bmp.height * s);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = hh;
  cv.getContext("2d").drawImage(bmp, 0, 0, w, hh);
  return cv.toDataURL("image/jpeg", q);
}

/* ============================ ring ============================ */

function Ring({ size, stroke, pct, color, track = "#EFF1EC", children }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct || 0));
  return html`
    <div class="rw" style=${{ width: size + "px", height: size + "px" }}>
      <svg width=${size} height=${size} style="transform:rotate(-90deg)">
        <circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" stroke=${track} stroke-width=${stroke} />
        <circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" stroke=${color} stroke-width=${stroke}
          stroke-linecap="round" stroke-dasharray=${c} stroke-dashoffset=${c * (1 - p)} class="ringbar" />
      </svg>
      <div class="rm">${children}</div>
    </div>`;
}

/* ============================ confidence chip ============================ */

const CONF = {
  high: { bg: "#F1FBDD", fg: "#31450A", label: "Clear read" },
  medium: { bg: "#FFF6E5", fg: "#6B4A08", label: "Rough estimate" },
  low: { bg: "#FEEDED", fg: "#7A1F22", label: "Hard to judge" },
};

function Confidence({ level, low, high, servings = 1 }) {
  const c = CONF[level] || CONF.medium;
  const spread = low && high && high > low;
  return html`
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px">
      <span class="conf" style=${{ background: c.bg, color: c.fg }}>${c.label}</span>
      ${spread && html`<span class="note" style="font-size:12px">
        likely ${Math.round(low * servings)}–${Math.round(high * servings)} cal
      </span>`}
    </div>`;
}

/* ============================ editable ingredients ============================ */

function IngredientList({ ings, base, servings, onChange }) {
  const [edit, setEdit] = useState(-1);
  const [draft, setDraft] = useState(null);
  const list = ings || [];

  const open = (i) => { setDraft({ ...list[i] }); setEdit(i); };

  const commit = (next) => {
    const before = list.reduce((a, g) => a + (parseFloat(g.kcal) || 0), 0);
    const after = next.reduce((a, g) => a + (parseFloat(g.kcal) || 0), 0);
    onChange({ ingredients: next, base: rescaleTo(base, (base.kcal || 0) + (after - before)) });
    setEdit(-1); setDraft(null);
  };

  const saveRow = () => {
    const next = list.slice();
    next[edit] = { name: (draft.name || "").trim() || "Item", qty: (draft.qty || "").trim(),
      kcal: Math.max(0, Math.round(parseFloat(draft.kcal) || 0)) };
    commit(next);
  };
  const removeRow = () => commit(list.filter((_, i) => i !== edit));
  const addRow = () => {
    const next = [...list, { name: "", qty: "", kcal: 0 }];
    onChange({ ingredients: next, base });
    setDraft({ name: "", qty: "", kcal: 0 });
    setEdit(next.length - 1);
  };

  return html`
    <div style="margin-top:16px">
      <div style="display:flex;align-items:baseline;justify-content:space-between">
        <div class="lab" style="margin:0">What's in it</div>
        <span class="note" style="font-size:11.5px">Tap any line to correct it</span>
      </div>

      ${list.map((g, i) => edit === i && draft
        ? html`
          <div class="ined" key=${"e" + i}>
            <input class="in2" placeholder="Ingredient" value=${draft.name}
              onInput=${(ev) => setDraft({ ...draft, name: ev.target.value })} />
            <div style="display:flex;gap:8px;margin-top:8px">
              <input class="in2" style="flex:1.6" placeholder="How much, e.g. 1 cup" value=${draft.qty}
                onInput=${(ev) => setDraft({ ...draft, qty: ev.target.value })} />
              <input class="in2" style="flex:1;text-align:center" type="number" inputmode="numeric"
                placeholder="cal" value=${draft.kcal}
                onInput=${(ev) => setDraft({ ...draft, kcal: ev.target.value })} />
            </div>
            <div style="display:flex;gap:8px;margin-top:10px">
              <button class="mini" style="flex:1;color:#E5484D" onClick=${removeRow}>Remove</button>
              <button class="mini" style=${{ flex: 1, background: "#14171A", color: "#fff", border: "none" }}
                onClick=${saveRow}>Done</button>
            </div>
          </div>`
        : html`
          <button class="ingb" key=${"r" + i} onClick=${() => open(i)}>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:14px">${g.name || "Untitled"}</div>
              ${g.qty && html`<div class="note" style="font-size:12px">${g.qty}</div>`}
            </div>
            <div class="d" style="font-weight:700;font-size:14px">${Math.round((parseFloat(g.kcal) || 0) * servings)} cal</div>
            <span style="color:#C3C8CC;font-size:15px">✎</span>
          </button>`)}

      <button class="addb" onClick=${addRow}>+ Add something it missed</button>
    </div>`;
}

/* ============================ app ============================ */

export function App() {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState(DEFAULTS);
  const [days, setDays] = useState({});
  const [weights, setWeights] = useState([]);
  const [sel, setSel] = useState(todayKey());
  const [tab, setTab] = useState("home");
  const [sheet, setSheet] = useState(false);
  const [detail, setDetail] = useState(null);
  const [needPass, setNeedPass] = useState(false);

  useEffect(() => {
    (async () => {
      const d = await loadState();
      if (d) {
        setProfile({ ...DEFAULTS, ...(d.profile || {}) });
        setDays(d.days || {});
        setWeights(d.weights || []);
      }
      setReady(true);
    })();
  }, []);

  const save = useCallback((patch) => {
    const next = { profile, days, weights, ...patch };
    if (patch.profile) setProfile(patch.profile);
    if (patch.days) setDays(patch.days);
    if (patch.weights) setWeights(patch.weights);
    saveState(next);
  }, [profile, days, weights]);

  const weight = weights.length ? weights[weights.length - 1].kg : profile.startWeight;
  const T = deriveTargets(profile, weight);
  const entries = (days[sel] || []).map(norm);
  const sum = entries.reduce((a, e) => {
    const t = tot(e);
    return { kcal: a.kcal + t.kcal, protein: a.protein + t.protein, carbs: a.carbs + t.carbs, fat: a.fat + t.fat };
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  const left = T.kcal - sum.kcal, over = left < 0;
  const dayTotal = (k) => (days[k] || []).reduce((a, e) => a + tot(e).kcal, 0);

  const strip = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = todayKey(d);
    strip.push({ k, n: d.getDate(), l: d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3), tot: dayTotal(k) });
  }

  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    if ((days[todayKey(d)] || []).length > 0) streak++;
    else if (i > 0) break;
  }

  const addEntry = (e) => {
    save({ days: { ...days, [sel]: [...(days[sel] || []), { ...e, id: Date.now(), at: new Date().toISOString() }] } });
    setSheet(false);
  };
  const patchEntry = (id, patch) =>
    save({ days: { ...days, [sel]: (days[sel] || []).map((e) => (e.id === id ? { ...norm(e), ...patch } : e)) } });
  const delEntry = (id) => {
    save({ days: { ...days, [sel]: (days[sel] || []).filter((e) => e.id !== id) } });
    setDetail(null);
  };

  /* Merge a backup in rather than overwrite, so nothing logged on this
     device since the backup was taken gets lost. Meals are matched on id,
     weigh-ins on date plus value. */
  const importBackup = (data) => {
    const nd = { ...days };
    Object.entries(data.days || {}).forEach(([k, arr]) => {
      if (!Array.isArray(arr)) return;
      const have = nd[k] || [];
      const ids = new Set(have.map((e) => e.id));
      nd[k] = [...have, ...arr.filter((e) => e && !ids.has(e.id))]
        .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
    });
    const seen = new Set(weights.map((w) => w.d + ":" + w.kg));
    const nw = [...weights, ...(data.weights || []).filter((w) => w && w.d && !seen.has(w.d + ":" + w.kg))]
      .sort((a, b) => String(a.d).localeCompare(String(b.d)))
      .slice(-800);
    save({ profile: { ...profile, ...(data.profile || {}) }, days: nd, weights: nw });
  };

  if (!ready) return html`<div class="wrap" style="padding-top:60px"><span class="note">Loading…</span></div>`;

  const liveDetail = detail ? entries.find((e) => e.id === detail) : null;

  const hr = new Date().getHours();
  const timeGreet = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
  const greeting = profile.name ? timeGreet + ", " + profile.name : timeGreet;
  const isToday = sel === todayKey();
  const subline = !isToday
    ? "Looking back at " + new Date(sel + "T00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
    : entries.length === 0
      ? "Nothing logged yet today. " + T.kcal + " calories to play with."
      : over
        ? Math.abs(left) + " over budget today."
        : left + " calories left for today.";

  return html`
    <div>
      <div class="wrap">
        <div class="top">
          <div class="brand">tally<span style="color:#C4F04A">.</span></div>
          <div class="streak">🔥 ${streak}</div>
        </div>

        ${tab === "home" && html`
          <div class="hello">${greeting}</div>
          <div class="hello-s">${subline}</div>

          <div class="strip">
            ${strip.map((d) => html`
              <button key=${d.k} class="day" data-on=${sel === d.k ? "1" : "0"} onClick=${() => setSel(d.k)}>
                <div class="day-l">${d.l}</div>
                <div style="display:flex;justify-content:center;margin-top:4px">
                  <${Ring} size=${34} stroke=${3} pct=${d.tot / T.kcal}
                    color=${d.tot === 0 ? "transparent" : d.tot > T.kcal ? "#E5484D" : "#C4F04A"}
                    track=${sel === d.k ? "rgba(255,255,255,.22)" : "#E7EAE3"}>
                    <span class="d" style=${{ fontWeight: 700, fontSize: "13px", color: sel === d.k ? "#fff" : "#14171A" }}>${d.n}</span>
                  <//>
                </div>
              </button>`)}
          </div>

          <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:14px">
            <div>
              <div class="d" style=${{ fontWeight: 800, fontSize: "42px", lineHeight: 1, color: over ? "#E5484D" : null }}>
                ${sum.kcal}<span style="font-size:21px;color:#9CA3AF">/${T.kcal}</span>
              </div>
              <div class="note" style="margin-top:7px;font-weight:500">Calories eaten</div>
              <div class="note" style="font-size:12px;margin-top:2px">
                ${over ? Math.abs(left) + " over budget" : left + " left"}
              </div>
            </div>
            <${Ring} size=${92} stroke=${9} pct=${sum.kcal / T.kcal} color=${over ? "#E5484D" : "#14171A"}>
              <span style="font-size:22px">🔥</span>
            <//>
          </div>

          <div class="macros">
            ${[["Protein", sum.protein, T.protein, "#FF6B4A", "🍗"],
               ["Carbs", sum.carbs, T.carbs, "#FFB020", "🌾"],
               ["Fat", sum.fat, T.fat, "#4A9DFF", "🥑"]].map(([n, v, t, c, ic]) => html`
              <div class="macro" key=${n}>
                <div class="macro-n">${Math.round(v)}<span style="color:#9CA3AF;font-weight:600">/${t}g</span></div>
                <div class="macro-l">${n} eaten</div>
                <div style="display:flex;justify-content:center;margin-top:9px">
                  <${Ring} size=${54} stroke=${6} pct=${v / t} color=${c}><span style="font-size:16px">${ic}</span><//>
                </div>
              </div>`)}
          </div>

          <div style="margin-top:24px;display:flex;align-items:baseline;justify-content:space-between">
            <div class="h">Recently logged</div>
            <span class="note">${entries.length}</span>
          </div>

          ${entries.length === 0
            ? html`<div class="card empty">
                <div style="font-size:30px">🥑</div>
                <div style="margin-top:10px;font-weight:600;color:#14171A">Nothing logged yet</div>
                <div class="note" style="margin-top:5px">Tap + to snap a plate, pick a photo, or just describe what you're having.</div>
              </div>`
            : entries.map((e) => {
                const t = tot(e);
                return html`
                  <button class="meal" key=${e.id} onClick=${() => setDetail(e.id)}>
                    ${e.thumb
                      ? html`<img src=${e.thumb} alt="" class="thumb" />`
                      : html`<div class="thumb thumb-ph">${SLOT_ICON[e.slot] || "🍽️"}</div>`}
                    <div style="flex:1;min-width:0">
                      <div class="meal-n">${e.name}${(e.servings || 1) !== 1 ? " ×" + e.servings : ""}</div>
                      <div class="tags">
                        <span class="tag">🔥 ${t.kcal}</span>
                        <span class="tag"><i class="tagdot" style="background:#FF6B4A"></i>${t.protein}g</span>
                        <span class="tag"><i class="tagdot" style="background:#FFB020"></i>${t.carbs}g</span>
                        <span class="tag"><i class="tagdot" style="background:#4A9DFF"></i>${t.fat}g</span>
                      </div>
                      <div class="note" style="font-size:11.5px;margin-top:5px">
                        ${e.slot} · ${new Date(e.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </div>
                    </div>
                    <span style="color:#C3C8CC;font-size:20px">›</span>
                  </button>`;
              })}
        `}

        ${tab === "progress" && html`<${Progress} days=${days} weights=${weights} profile=${profile} T=${T}
          weight=${weight} dayTotal=${dayTotal}
          onLog=${(kg) => save({ weights: [...weights, { d: todayKey(), kg }].slice(-800) })} />`}

        ${tab === "profile" && html`<${Profile} profile=${profile} weight=${weight}
          days=${days} weights=${weights}
          onSave=${(p) => save({ profile: p })}
          onImport=${importBackup}
          onWipe=${() => { saveState({ profile: DEFAULTS, days: {}, weights: [] }); setDays({}); setWeights([]); setProfile(DEFAULTS); }} />`}
      </div>

      <div class="nav">
        <div class="navin">
          <div class="navpill">
            <button class="navbtn" data-on=${tab === "home" ? "1" : "0"} onClick=${() => setTab("home")}><span style="font-size:17px">⌂</span>Home</button>
            <button class="navbtn" data-on=${tab === "progress" ? "1" : "0"} onClick=${() => setTab("progress")}><span style="font-size:17px">◪</span>Progress</button>
            <button class="navbtn" data-on=${tab === "profile" ? "1" : "0"} onClick=${() => setTab("profile")}><span style="font-size:17px">☺</span>Profile</button>
          </div>
          <button class="fab" onClick=${() => { setSel(todayKey()); setTab("home"); setSheet(true); }} aria-label="Add a meal">+</button>
        </div>
      </div>

      ${sheet && html`<${LogSheet} onClose=${() => setSheet(false)} onAdd=${addEntry}
        eaten=${sum.kcal} budget=${T.kcal} proteinLeft=${Math.max(0, T.protein - sum.protein)}
        onNeedPass=${() => setNeedPass(true)} />`}

      ${liveDetail && html`<${MealDetail} e=${liveDetail} onClose=${() => setDetail(null)}
        onPatch=${(p) => patchEntry(liveDetail.id, p)} onDelete=${() => delEntry(liveDetail.id)}
        onNeedPass=${() => setNeedPass(true)} />`}

      ${needPass && html`<${PassSheet} onClose=${() => setNeedPass(false)} />`}
    </div>`;
}

/* ============================ passcode ============================ */

function PassSheet({ onClose }) {
  const ref = useRef(null);
  return html`
    <div class="scrim" onClick=${onClose}>
      <div class="sheet" onClick=${(e) => e.stopPropagation()}>
        <div class="grab"></div>
        <div class="h">Enter your passcode</div>
        <div class="note" style="margin-top:8px">
          This is the passcode you set on the server when you deployed. It stops anyone else who finds
          this address from spending your API credit.
        </div>
        <input class="in" style="margin-top:14px" type="password" ref=${ref} autofocus
          onKeyDown=${(e) => { if (e.key === "Enter") { setPass(e.target.value.trim()); onClose(); } }} />
        <button class="b" style="margin-top:10px"
          onClick=${() => { if (ref.current) setPass(ref.current.value.trim()); onClose(); }}>Save passcode</button>
      </div>
    </div>`;
}

/* ============================ log sheet ============================ */

function LogSheet({ onClose, onAdd, eaten, budget, proteinLeft, onNeedPass }) {
  const guess = () => { const h = new Date().getHours(); return h < 11 ? "Breakfast" : h < 16 ? "Lunch" : h < 22 ? "Dinner" : "Snack"; };
  const [typing, setTyping] = useState(false);
  const [isLabel, setIsLabel] = useState(false);
  const [slot, setSlot] = useState(guess);
  const [text, setText] = useState("");
  const [img, setImg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [base, setBase] = useState(null);
  const [servings, setServings] = useState(1);
  const camRef = useRef(null);
  const galRef = useRef(null);

  const m = base && {
    kcal: Math.round(base.kcal * servings), protein: Math.round(base.protein * servings),
    carbs: Math.round(base.carbs * servings), fat: Math.round(base.fat * servings),
  };

  const pick = async (file) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) { setErr("That isn't an image."); return; }
    setErr("");
    try {
      const full = await shrink(file, 1100, 0.82);
      const thumb = await shrink(file, 320, 0.6);
      const p = dataUrlParts(full);
      setImg({ b64: p.b64, media: p.media, url: full, thumb });
    } catch { setErr("Couldn't read that photo. Try another."); }
  };

  const run = async () => {
    if (!img && !text.trim()) return;
    setBusy(true); setErr(""); setBase(null); setServings(1);
    try {
      const parts = [];
      if (img) parts.push({ type: "image", source: { type: "base64", media_type: img.media, data: img.b64 } });

      const task = isLabel
        ? "This is a photograph of a nutrition label or packaging. Read the printed panel and return the values for ONE serving exactly as printed — do not adjust them. If the person's note names a different amount, scale to that. Put the serving size in \"basis\" and set confidence to \"high\" if the panel is legible."
        : img
          ? "Estimate the nutrition of the food in this photograph, at the portion shown. Assume normal cooking — the oil, butter and sauce a kitchen would actually use — unless the person says otherwise. If it looks like restaurant or takeaway food, lean to the higher end."
          : "Estimate the nutrition of the meal described below, at one normal portion. Assume normal home cooking unless stated otherwise. Set \"basis\" to \"described, not seen\" and confidence to \"medium\" at best.";

      const situation =
        `\n\nBudget context: they have ${Math.max(0, budget - eaten)} calories left of a ${budget} budget today and still need about ${proteinLeft}g of protein. ` +
        `In "advice", give one or two sentences of practical, non-judgemental guidance: whether this fits, and if not, the single most effective change — a smaller portion, leaving one component, swapping the side, skipping the drink.`;

      parts.push({
        type: "text",
        text: task + (text.trim() ? ` The person adds: "${text.trim()}"` : "") + situation +
          `\n\nReply with ONLY this JSON object:\n` + SHAPE + `\n` +
          `List between 2 and 8 ingredients, covering everything you can see and nothing you cannot.`,
      });

      const p = await askClaude(parts);
      const kc = Math.max(0, Math.round(p.kcal || 0));
      setBase({
        name: p.name || "Meal",
        kcal: kc, protein: Math.max(0, Math.round(p.protein || 0)),
        carbs: Math.max(0, Math.round(p.carbs || 0)), fat: Math.max(0, Math.round(p.fat || 0)),
        kcalLow: Math.max(0, Math.round(p.kcalLow || kc)), kcalHigh: Math.max(0, Math.round(p.kcalHigh || kc)),
        confidence: CONF[p.confidence] ? p.confidence : "medium",
        basis: p.basis || "",
        ingredients: Array.isArray(p.ingredients) ? p.ingredients.slice(0, 8) : [],
        note: p.note || "", advice: p.advice || "",
      });
    } catch (e) {
      if (e && e.auth) { onNeedPass(); setErr("Passcode needed before it can estimate."); }
      else setErr("That didn't come back. Try again, or type the numbers in yourself.");
      setBase({ name: text.trim() || "Meal", kcal: 0, protein: 0, carbs: 0, fat: 0,
        kcalLow: 0, kcalHigh: 0, confidence: "low", basis: "", ingredients: [], note: "", advice: "" });
    }
    setBusy(false);
  };

  const projected = eaten + (m ? m.kcal : 0), after = budget - projected;
  const key = after >= 150 ? "fits" : after >= 0 ? "tight" : "over";
  const V = {
    fits: { bg: "#F1FBDD", fg: "#31450A", ac: "#7CA81C", head: "Go for it" },
    tight: { bg: "#FFF6E5", fg: "#6B4A08", ac: "#E39A18", head: "Cutting it fine" },
    over: { bg: "#FEEDED", fg: "#7A1F22", ac: "#E5484D", head: "Puts you over" },
  }[key];
  const max = Math.max(budget, projected);

  const reset = () => { setBase(null); setImg(null); setText(""); setTyping(false); setIsLabel(false); setErr(""); };

  return html`
    <div class="scrim" onClick=${onClose}>
      <div class="sheet" onClick=${(e) => e.stopPropagation()}>
        <div class="grab"></div>

        <input ref=${camRef} type="file" accept="image/*" capture="environment" style="display:none"
          onChange=${(e) => { pick(e.target.files && e.target.files[0]); e.target.value = ""; }} />
        <input ref=${galRef} type="file" accept="image/*" style="display:none"
          onChange=${(e) => { pick(e.target.files && e.target.files[0]); e.target.value = ""; }} />

        ${!m && html`
          <div>
            <div class="h">What are you having?</div>

            ${img
              ? html`
                <div style="margin-top:13px;position:relative">
                  <img src=${img.url} alt="" style="width:100%;max-height:210px;object-fit:cover;border-radius:20px" />
                  <button class="x" style="position:absolute;top:10px;right:10px;background:rgba(20,23,26,.7);color:#fff"
                    onClick=${() => setImg(null)}>×</button>
                </div>`
              : html`
                <div>
                  <button class="bigb" onClick=${() => camRef.current && camRef.current.click()}>
                    <div class="bigb-i">📷</div>
                    <div><div class="bigb-t">Snap the plate</div><div class="bigb-s">Straight to the camera</div></div>
                  </button>
                  <button class="bigb" onClick=${() => galRef.current && galRef.current.click()}>
                    <div class="bigb-i">🖼️</div>
                    <div><div class="bigb-t">Choose a photo</div><div class="bigb-s">From your camera roll</div></div>
                  </button>
                  ${!typing && html`
                    <button class="bigb" onClick=${() => setTyping(true)}>
                      <div class="bigb-i">✏️</div>
                      <div><div class="bigb-t">Just describe it</div><div class="bigb-s">No photo needed</div></div>
                    </button>`}
                </div>`}

            ${(img || typing) && html`
              <input class="in" style="margin-top:11px" autofocus=${typing && !img}
                placeholder=${isLabel ? "How much of it are you having?" : img ? "Anything it can't see? Optional" : "Chicken machboos with rice"}
                value=${text} onInput=${(e) => setText(e.target.value)}
                onKeyDown=${(e) => { if (e.key === "Enter" && !busy) run(); }} />`}

            ${img && html`
              <div style="display:flex;gap:6px;margin-top:10px">
                <button class="pill" data-on=${!isLabel ? "1" : "0"} onClick=${() => setIsLabel(false)}>🍽️ It's food</button>
                <button class="pill" data-on=${isLabel ? "1" : "0"} onClick=${() => setIsLabel(true)}>🏷️ It's a label</button>
              </div>`}

            ${(img || typing) && html`
              <button class="b" style="margin-top:11px" onClick=${run} disabled=${busy || (!img && !text.trim())}>
                ${busy ? html`<span class="spin"></span>Working it out` : "Work out the calories"}
              </button>`}

            ${err && html`<div class="err">${err}</div>`}
          </div>`}

        ${m && html`
          <div>
            <div class="verdict" style=${{ background: V.bg, color: V.fg, marginTop: 0 }}>
              <div class="vhead">${V.head}${key === "over" ? " by " + Math.abs(after) : ""}</div>
              <div class="vsub">${base.name}, about <strong>${m.kcal} cal</strong>. That would put you at ${projected} of ${budget}${after >= 0 ? ", with " + after + " left for the day." : "."}</div>
              <div class="track">
                <div style=${{ width: (eaten / max) * 100 + "%", background: V.ac, opacity: .4 }}></div>
                <div style=${{ width: (m.kcal / max) * 100 + "%", background: V.ac }}></div>
                <div class="mark" style=${{ left: (budget / max) * 100 + "%" }}></div>
              </div>
              ${base.advice && html`<div class="vsub">${base.advice}</div>`}
              ${proteinLeft > 0 && m.protein >= proteinLeft * 0.4 && html`<div class="vsub">Strong on protein: ${m.protein}g of the ${proteinLeft}g you still need.</div>`}
            </div>

            <${Confidence} level=${base.confidence} low=${base.kcalLow} high=${base.kcalHigh} servings=${servings} />
            ${base.basis && html`<div class="note" style="font-size:12px;margin-top:6px">Judged against ${base.basis}.</div>`}

            <div style="margin-top:15px;display:flex;gap:10px;align-items:center">
              ${img && html`<img src=${img.thumb} alt="" style="width:52px;height:52px;border-radius:15px;object-fit:cover;flex:none" />`}
              <input class="in" style="flex:1;min-width:0" value=${base.name} onInput=${(e) => setBase({ ...base, name: e.target.value })} />
              <div class="step">
                <button class="stepb" onClick=${() => setServings((s) => Math.max(0.25, Math.round((s - 0.25) * 100) / 100))} disabled=${servings <= 0.25}>−</button>
                <span class="stepv">${servings}</span>
                <button class="stepb" onClick=${() => setServings((s) => Math.min(10, s + 0.25))}>+</button>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:10px">
              ${[["kcal", "Cal"], ["protein", "Protein"], ["carbs", "Carbs"], ["fat", "Fat"]].map(([k, l]) => html`
                <div key=${k}>
                  <label class="lab">${l}</label>
                  <input class="in" style="padding:12px 6px;border-radius:13px;text-align:center" type="number" inputmode="numeric"
                    value=${m[k]} onInput=${(e) => {
                      const n = Math.max(0, parseInt(e.target.value || "0", 10));
                      setBase({ ...base, [k]: Math.round(n / servings) });
                    }} />
                </div>`)}
            </div>

            <${IngredientList} ings=${base.ingredients} servings=${servings}
              base=${{ kcal: base.kcal, protein: base.protein, carbs: base.carbs, fat: base.fat }}
              onChange=${({ ingredients, base: nb }) => setBase({ ...base, ...nb, ingredients })} />

            ${base.note && html`<div class="note" style="margin-top:11px">${base.note}</div>`}

            <div style="margin-top:16px">
              <div class="lab">When was this?</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                ${SLOTS.map((s) => html`<button class="pill" key=${s} data-on=${slot === s ? "1" : "0"} onClick=${() => setSlot(s)}>${s}</button>`)}
              </div>
            </div>

            <button class="b b3" style="margin-top:16px" onClick=${() => onAdd({
              name: base.name, slot, servings,
              base: { kcal: base.kcal, protein: base.protein, carbs: base.carbs, fat: base.fat },
              ingredients: base.ingredients || [], note: base.note || "", thumb: img ? img.thumb : null,
            })}>
              Log it · ${m.kcal} cal
            </button>
            <button class="b b2" style="margin-top:8px" onClick=${onClose}>Just checking — don't log it</button>
            <button class="b b2" style="margin-top:8px" onClick=${reset}>Start again</button>
          </div>`}
      </div>
    </div>`;
}

/* ============================ meal detail ============================ */

function MealDetail({ e, onClose, onPatch, onDelete, onNeedPass }) {
  const [fixing, setFixing] = useState(false);
  const [fixText, setFixText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const t = tot(e), s = e.servings || 1;

  const applyFix = async () => {
    if (!fixText.trim()) return;
    setBusy(true); setErr("");
    try {
      const parts = [];
      const im = dataUrlParts(e.thumb);
      if (im) parts.push({ type: "image", source: { type: "base64", media_type: im.media, data: im.b64 } });
      parts.push({
        type: "text",
        text: `A meal was logged as "${e.name}" with this estimate for one serving: ${e.base.kcal} calories, ` +
          `${e.base.protein}g protein, ${e.base.carbs}g carbs, ${e.base.fat}g fat.` +
          (e.ingredients && e.ingredients.length ? ` Ingredients: ${e.ingredients.map((g) => g.name + " (" + g.qty + ")").join(", ")}.` : "") +
          `\n\nThe person says the estimate is wrong: "${fixText.trim()}"\n\n` +
          `Trust what they say over what the photograph appears to show — they were there. ` +
          `Revise the estimate for ONE serving accordingly. Reply with ONLY this JSON object:\n` +
          `{"name":"short dish name","kcal":integer,"protein":integer,"carbs":integer,"fat":integer,` +
          `"kcalLow":integer,"kcalHigh":integer,"confidence":"high"|"medium"|"low",` +
          `"ingredients":[{"name":"component","qty":"portion","kcal":integer}],"note":"one sentence on what changed"}`,
      });
      const p = await askClaude(parts);
      onPatch({
        name: p.name || e.name,
        base: {
          kcal: Math.max(0, Math.round(p.kcal || 0)), protein: Math.max(0, Math.round(p.protein || 0)),
          carbs: Math.max(0, Math.round(p.carbs || 0)), fat: Math.max(0, Math.round(p.fat || 0)),
        },
        ingredients: Array.isArray(p.ingredients) ? p.ingredients.slice(0, 8) : e.ingredients,
        note: p.note || "",
      });
      setFixing(false); setFixText("");
    } catch (ex) {
      if (ex && ex.auth) { onNeedPass(); setErr("Passcode needed."); }
      else setErr("Couldn't revise it. Try again, or edit the numbers by hand.");
    }
    setBusy(false);
  };

  return html`
    <div class="scrim" onClick=${onClose}>
      <div class="sheet sheet-full" onClick=${(ev) => ev.stopPropagation()}>
        ${e.thumb
          ? html`<div style="margin:0 -18px;position:relative">
              <img src=${e.thumb} alt="" style="width:100%;height:230px;object-fit:cover" />
              <button class="x" style="position:absolute;top:14px;left:14px;background:rgba(20,23,26,.65);color:#fff;width:34px;height:34px"
                onClick=${onClose}>←</button>
            </div>`
          : html`<div style="padding-top:12px"><div class="grab"></div></div>`}

        <div style="padding-top:18px;display:flex;gap:12px;align-items:flex-start">
          <div style="flex:1">
            <div class="d" style="font-weight:700;font-size:21px;line-height:1.15">${e.name}</div>
            <div class="note" style="font-size:12px;margin-top:5px">
              ${e.slot} · ${new Date(e.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </div>
          </div>
          <div class="step">
            <button class="stepb" onClick=${() => onPatch({ servings: Math.max(0.25, Math.round((s - 0.25) * 100) / 100) })} disabled=${s <= 0.25}>−</button>
            <span class="stepv">${s}</span>
            <button class="stepb" onClick=${() => onPatch({ servings: Math.min(10, s + 0.25) })}>+</button>
          </div>
        </div>

        <div class="card" style="display:flex;align-items:center;gap:14px;margin-top:16px">
          <span style="font-size:24px">🔥</span>
          <div>
            <div class="note" style="font-weight:500">Calories</div>
            <div class="d" style="font-weight:800;font-size:32px;line-height:1.1">${t.kcal}</div>
          </div>
        </div>

        <div class="macros">
          ${[["Protein", t.protein, "#FF6B4A", "🍗"], ["Carbs", t.carbs, "#FFB020", "🌾"], ["Fat", t.fat, "#4A9DFF", "🥑"]].map(([n, v, c, ic]) => html`
            <div class="macro" key=${n} style="padding:14px 6px">
              <div style="font-size:15px">${ic}</div>
              <div class="macro-l" style="margin-top:4px">${n}</div>
              <div class="macro-n" style=${{ color: c, marginTop: "3px" }}>${v}g</div>
            </div>`)}
        </div>

        <${IngredientList} ings=${e.ingredients} servings=${s} base=${e.base}
          onChange=${({ ingredients, base }) => onPatch({ ingredients, base })} />

        ${e.note && html`<div class="note" style="margin-top:14px">${e.note}</div>`}

        ${fixing
          ? html`<div style="margin-top:18px">
              <label class="lab">Tell it what's wrong</label>
              <input class="in" autofocus placeholder="No dressing, and the portion was double"
                value=${fixText} onInput=${(ev) => setFixText(ev.target.value)}
                onKeyDown=${(ev) => { if (ev.key === "Enter" && !busy) applyFix(); }} />
              <div class="note" style="font-size:12px;margin-top:8px">
                Best for whole-dish corrections. For one item, tap it in the list above.
              </div>
              ${err && html`<div class="err">${err}</div>`}
              <button class="b" style="margin-top:10px" onClick=${applyFix} disabled=${busy || !fixText.trim()}>
                ${busy ? html`<span class="spin"></span>Recalculating` : "Update the estimate"}
              </button>
              <button class="b b2" style="margin-top:8px" onClick=${() => { setFixing(false); setErr(""); }}>Cancel</button>
            </div>`
          : html`<div style="display:flex;gap:9px;margin-top:20px">
              <button class="b b2" onClick=${() => setFixing(true)}>✦ Redo the whole thing</button>
              <button class="b" onClick=${onClose}>Done</button>
            </div>`}

        <button class="b b2" style="margin-top:9px;color:#E5484D" onClick=${onDelete}>Delete this meal</button>
      </div>
    </div>`;
}

/* ============================ progress ============================ */

function Progress({ days, weights, profile, T, weight, dayTotal, onLog }) {
  const [val, setVal] = useState("");
  const [range, setRange] = useState(90);

  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = todayKey(d);
    week.push({ k, tot: dayTotal(k), l: d.toLocaleDateString(undefined, { weekday: "narrow" }), logged: (days[k] || []).length > 0 });
  }
  const max = Math.max(T.kcal * 1.3, ...week.map((w) => w.tot), 1);
  const logged = week.filter((w) => w.tot > 0);
  const avg = logged.length ? Math.round(logged.reduce((a, w) => a + w.tot, 0) / logged.length) : 0;

  const prev = [];
  for (let i = 13; i >= 7; i--) { const d = new Date(); d.setDate(d.getDate() - i); prev.push(dayTotal(todayKey(d))); }
  const pl = prev.filter((x) => x > 0);
  const prevAvg = pl.length ? Math.round(pl.reduce((a, b) => a + b, 0) / pl.length) : 0;
  const delta = prevAvg && avg ? Math.round(((avg - prevAvg) / prevAvg) * 100) : 0;

  const start = profile.startWeight, goal = profile.goalWeight;
  const prog = start === goal ? 1 : Math.max(0, Math.min(1, (start - weight) / (start - goal)));

  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - range);
  const pts = range === 9999 ? weights : weights.filter((p) => new Date(p.d) >= cutoff);
  const ys = pts.map((p) => p.kg);
  const lo = Math.min(goal - 0.5, ...(ys.length ? ys : [weight]), weight);
  const hi = Math.max(...(ys.length ? ys : [weight]), weight, start);
  const yF = (v) => 46 - ((v - lo) / Math.max(0.1, hi - lo)) * 40 - 3;
  const path = pts.length > 1
    ? pts.map((p, i) => (i ? "L" : "M") + ((i / (pts.length - 1)) * 100).toFixed(1) + "," + yF(p.kg).toFixed(1)).join(" ")
    : "";

  let streak = 0;
  for (let i = 0; i < 400; i++) { const d = new Date(); d.setDate(d.getDate() - i); if ((days[todayKey(d)] || []).length > 0) streak++; else if (i > 0) break; }

  const submit = () => { const n = parseFloat(val); if (!isFinite(n) || n < 35 || n > 250) return; onLog(Math.round(n * 10) / 10); setVal(""); };

  return html`
    <div style="padding-top:6px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
        <div class="card" style="margin:0;padding:17px">
          <div class="note" style="font-size:12px;font-weight:500">Your weight</div>
          <div class="d" style="font-weight:800;font-size:26px;margin-top:3px">${weight.toFixed(1)} <span style="font-size:14px;color:#9CA3AF">kg</span></div>
          <div style="height:6px;background:#EFF1EC;border-radius:99px;margin-top:11px;overflow:hidden">
            <div style=${{ width: prog * 100 + "%", height: "100%", background: "#C4F04A", borderRadius: "99px" }}></div>
          </div>
          <div class="note" style="font-size:11.5px;margin-top:7px">Goal ${goal} kg · ${Math.round(prog * 100)}%</div>
        </div>

        <div class="card" style="margin:0;padding:17px;text-align:center">
          <div style="font-size:26px">🔥</div>
          <div class="d" style="font-weight:800;font-size:22px;margin-top:2px">${streak} day${streak === 1 ? "" : "s"}</div>
          <div class="note" style="font-size:11.5px">logged in a row</div>
          <div class="wk">
            ${week.map((w) => html`
              <div class="wkd" key=${w.k}>
                <div style="font-size:9.5px;color:#9CA3AF;font-weight:700">${w.l}</div>
                <div class="wkc" style=${{ background: w.logged ? "#C4F04A" : "#F1F3EE", color: w.logged ? "#1B2408" : "#C3C8CC" }}>
                  ${w.logged ? "✓" : ""}
                </div>
              </div>`)}
          </div>
        </div>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div class="h">Weight progress</div>
          <span class="pill" style="padding:5px 11px;font-size:11.5px">⚑ ${Math.round(prog * 100)}% of goal</span>
        </div>

        ${pts.length > 1
          ? html`<svg viewBox="0 0 100 46" preserveAspectRatio="none" style="width:100%;height:92px;margin-top:16px;overflow:visible">
              <line x1="0" y1=${yF(goal)} x2="100" y2=${yF(goal)} stroke="#C4F04A" stroke-width="2" stroke-dasharray="4 4" vector-effect="non-scaling-stroke" />
              <path d=${path} fill="none" stroke="#14171A" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" />
            </svg>`
          : html`<div class="note" style="margin-top:14px">Log your weight twice and the trend line appears here.</div>`}

        <div class="seg" style="margin-top:14px">
          ${[[30, "30D"], [90, "90D"], [365, "1Y"], [9999, "ALL"]].map(([v, l]) => html`
            <button class="segb" key=${l} data-on=${range === v ? "1" : "0"} onClick=${() => setRange(v)} style="font-size:12px">${l}</button>`)}
        </div>

        <div style="display:flex;gap:8px;margin-top:14px">
          <input class="in" type="number" step="0.1" inputmode="decimal" placeholder="Weigh in, kg" value=${val}
            onInput=${(e) => setVal(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") submit(); }} />
          <button class="b" style="width:auto;padding:14px 24px" onClick=${submit} disabled=${!val}>Log</button>
        </div>
      </div>

      <div class="card">
        <div class="h">Daily average calories</div>
        <div style="display:flex;align-items:baseline;gap:9px;margin-top:8px">
          <span class="d" style="font-weight:800;font-size:34px">${avg || "—"}</span>
          ${delta !== 0 && html`<span style=${{ fontWeight: 700, fontSize: "13px", color: delta < 0 ? "#5C8C52" : "#E5484D" }}>
            ${delta < 0 ? "↓" : "↑"}${Math.abs(delta)}%
          </span>`}
          <span class="note" style="font-size:12px">vs last week</span>
        </div>

        <div style="position:relative;margin-top:18px">
          <div style=${{ position: "absolute", left: 0, right: 0, borderTop: "2px dashed #E5E8E0", bottom: (T.kcal / max) * 92 + "px" }}></div>
          <div class="bars">
            ${week.map((w) => html`
              <div key=${w.k} style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%">
                <div class="bar" style=${{ height: Math.max(5, (w.tot / max) * 92) + "px", background: w.tot === 0 ? "#EFF1EC" : w.tot > T.kcal ? "#E5484D" : "#C4F04A" }}></div>
              </div>`)}
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          ${week.map((w) => html`<div key=${w.k} style="flex:1;text-align:center;font-size:11px;color:#9CA3AF;font-weight:600">${w.l}</div>`)}
        </div>
        <div class="note" style="margin-top:13px">
          Dashed line is your ${T.kcal} budget. Judge yourself on the week, not the day.
        </div>
      </div>
    </div>`;
}

/* ============================ profile ============================ */

function Profile({ profile, weight, days, weights, onSave, onImport, onWipe }) {
  const [p, setP] = useState(profile);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(null);
  const [impErr, setImpErr] = useState("");
  const [done, setDone] = useState("");
  const fileRef = useRef(null);
  const t = deriveTargets(p, weight);
  const dirty = JSON.stringify(p) !== JSON.stringify(profile);

  const exportJson = async () => {
    const text = JSON.stringify({ profile, days, weights }, null, 2);
    const filename = "tally-" + todayKey() + ".json";
    /* On an iPhone the app runs full screen with no download bar, so a plain
       link click can vanish silently. The share sheet is the reliable route;
       fall back to a download everywhere else. */
    try {
      const file = new File([text], filename, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "tally backup" });
        return;
      }
    } catch { /* cancelled or unsupported — fall through */ }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = filename;
    a.click();
  };

  const readBackup = async (file) => {
    setImpErr(""); setDone("");
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== "object" || (!data.days && !data.weights)) {
        setImpErr("That doesn't look like a tally backup."); return;
      }
      const dayKeys = Object.keys(data.days || {});
      const meals = dayKeys.reduce((a, k) => a + (Array.isArray(data.days[k]) ? data.days[k].length : 0), 0);
      setPending({ data, meals, dayKeys: dayKeys.length, weighIns: (data.weights || []).length });
    } catch {
      setImpErr("Couldn't read that file. Make sure it's the .json backup.");
    }
  };

  return html`
    <div style="padding-top:6px">
      <div class="card">
        <div class="h">Your plan</div>
        <div style="margin-top:15px">
          <label class="lab">What should it call you?</label>
          <input class="in" placeholder="Your first name" value=${p.name || ""}
            onInput=${(e) => setP({ ...p, name: e.target.value })} />
        </div>
        <div style="margin-top:13px">
          <label class="lab">How much you move</label>
          <select class="in" value=${p.activity} onChange=${(e) => setP({ ...p, activity: e.target.value })}>
            ${ACTIVITY.map((a) => html`<option key=${a.id} value=${a.id}>${a.label}</option>`)}
          </select>
        </div>
        <div style="margin-top:13px">
          <label class="lab">Pace</label>
          <select class="in" value=${String(p.weeklyLoss)} onChange=${(e) => setP({ ...p, weeklyLoss: parseFloat(e.target.value) })}>
            <option value="0.25">0.25 kg a week — gradual</option>
            <option value="0.5">0.5 kg a week — steady</option>
            <option value="0.75">0.75 kg a week — demanding</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:13px">
          <div><label class="lab">Goal kg</label>
            <input class="in" type="number" step="0.5" value=${p.goalWeight} onInput=${(e) => setP({ ...p, goalWeight: parseFloat(e.target.value) || p.goalWeight })} /></div>
          <div><label class="lab">Stretch kg</label>
            <input class="in" type="number" step="0.5" value=${p.stretchWeight} onInput=${(e) => setP({ ...p, stretchWeight: parseFloat(e.target.value) || p.stretchWeight })} /></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:13px">
          <div><label class="lab">Height cm</label>
            <input class="in" type="number" value=${p.heightCm} onInput=${(e) => setP({ ...p, heightCm: parseInt(e.target.value || "0", 10) || p.heightCm })} /></div>
          <div><label class="lab">Age</label>
            <input class="in" type="number" value=${p.age} onInput=${(e) => setP({ ...p, age: parseInt(e.target.value || "0", 10) || p.age })} /></div>
        </div>
        <button class="b b3" style="margin-top:17px" disabled=${!dirty} onClick=${() => onSave(p)}>${dirty ? "Save plan" : "Saved"}</button>
      </div>

      <div class="card">
        <div class="h">Your numbers</div>
        <div style="margin-top:10px">
          ${[["Resting burn", t.bmr + " cal"], ["Daily burn", t.tdee + " cal"], ["Eat each day", t.kcal + " cal"],
             ["Protein", t.protein + " g"], ["Fat", t.fat + " g"], ["Carbs", t.carbs + " g"]].map(([k, v], i) => html`
            <div key=${k} style=${{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "11px 0", borderBottom: i === 5 ? "none" : "1px solid #F0F2ED" }}>
              <span class="note" style="font-weight:500">${k}</span>
              <span class="d" style=${{ fontWeight: 700, fontSize: (i === 2 ? 21 : 16) + "px" }}>${v}</span>
            </div>`)}
        </div>
        <div class="note" style="margin-top:12px">
          Protein protects muscle while the weight comes off. Hit it first and let carbs and fat move around it.
          The plan never drops below 1,500 calories.
        </div>
      </div>

      <div class="card">
        <div class="h">Your data</div>
        <div class="note" style="margin-top:8px">
          Everything lives on this phone. Nothing is stored on the server. Export a backup before you
          clear your browser data or change device.
        </div>
        <button class="b b2" style="margin-top:13px" onClick=${exportJson}>Export a backup</button>

        <input ref=${fileRef} type="file" accept="application/json,.json" style="display:none"
          onChange=${(e) => { readBackup(e.target.files && e.target.files[0]); e.target.value = ""; }} />

        ${pending
          ? html`
            <div style="background:var(--bg);border-radius:18px;padding:15px;margin-top:8px">
              <div style="font-weight:700;font-size:14.5px">Restore this backup?</div>
              <div class="note" style="margin-top:6px">
                ${"It holds " + pending.meals + " meal" + (pending.meals === 1 ? "" : "s") +
                  " across " + pending.dayKeys + " day" + (pending.dayKeys === 1 ? "" : "s") +
                  " and " + pending.weighIns + " weigh-in" + (pending.weighIns === 1 ? "" : "s") +
                  ". Anything already on this phone stays — the two are merged."}
              </div>
              <button class="b b3" style="margin-top:12px" onClick=${() => {
                onImport(pending.data);
                setDone("Restored " + pending.meals + " meals.");
                setPending(null);
              }}>Merge it in</button>
              <button class="b b2" style="margin-top:8px" onClick=${() => setPending(null)}>Cancel</button>
            </div>`
          : html`<button class="b b2" style="margin-top:8px" onClick=${() => fileRef.current && fileRef.current.click()}>Restore from a backup</button>`}

        ${impErr && html`<div class="err">${impErr}</div>`}
        ${done && html`<div class="note" style="margin-top:10px;color:#5C8C52;font-weight:600">${done}</div>`}

        <button class="b b2" style="margin-top:8px" onClick=${() => { setPass(""); location.reload(); }}>Change passcode</button>
        ${confirm
          ? html`<div style="margin-top:8px">
              <button class="b" style="background:#E5484D" onClick=${() => { onWipe(); setConfirm(false); }}>Yes, erase everything</button>
              <button class="b b2" style="margin-top:8px" onClick=${() => setConfirm(false)}>Cancel</button>
            </div>`
          : html`<button class="b b2" style="margin-top:8px;color:#E5484D" onClick=${() => setConfirm(true)}>Erase all data</button>`}
      </div>
    </div>`;
}

/* ============================ mount ============================ */

if (typeof document !== "undefined") {
  render(html`<${App} />`, document.getElementById("app"));
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
}
