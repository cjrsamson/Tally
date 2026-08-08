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
  heightCm: 166, age: 28, sex: "male", startWeight: 72.5,
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

/* ============================ api ============================ */

const PASS_KEY = "tally.pass";
const getPass = () => { try { return localStorage.getItem(PASS_KEY) || ""; } catch { return ""; } };
const setPass = (v) => { try { localStorage.setItem(PASS_KEY, v); } catch {} };

async function askClaude(content) {
  const r = await fetch("/api/estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-tally-pass": getPass() },
    body: JSON.stringify({ content }),
  });
  if (r.status === 401) { const e = new Error("auth"); e.auth = true; throw e; }
  if (!r.ok) throw new Error("api " + r.status);
  const d = await r.json();
  const raw = (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const cl = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(cl.slice(cl.indexOf("{"), cl.lastIndexOf("}") + 1));
}

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

  if (!ready) return html`<div class="wrap" style="padding-top:60px"><span class="note">Loading…</span></div>`;

  const liveDetail = detail ? entries.find((e) => e.id === detail) : null;

  return html`
    <div>
      <div class="wrap">
        <div class="top">
          <div class="brand">tally<span style="color:#C4F04A">.</span></div>
          <div class="streak">🔥 ${streak}</div>
        </div>

        ${tab === "home" && html`
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
                <div class="note" style="margin-top:5px">Tap + to scan a meal, read a label, or check one before you eat it.</div>
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
  const [mode, setMode] = useState("check");
  const [scan, setScan] = useState("meal");
  const [slot, setSlot] = useState(guess);
  const [text, setText] = useState("");
  const [img, setImg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [base, setBase] = useState(null);
  const [servings, setServings] = useState(1);
  const fileRef = useRef(null);

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

      const task = scan === "label"
        ? "This is a photograph of a nutrition label or packaging. Read the panel and return the values for ONE serving as printed. If the person's note gives a different amount, scale to that. Put the serving size in \"note\"."
        : "Estimate the nutrition of this meal at one normal portion. Judge portion size from visible references like the plate, cutlery, a hand or a cup. Assume normal cooking with typical oil and sauces unless stated otherwise. If it looks like restaurant or takeaway food, assume the higher end of the range.";

      const situation = mode === "check"
        ? `\n\nContext: they have not eaten this yet and are deciding. They have ${Math.max(0, budget - eaten)} calories left of a ${budget} budget today and still need about ${proteinLeft}g of protein. In "advice", give one or two sentences of practical, non-judgemental guidance: whether it fits, and if not, the single most effective change (smaller portion, leave one component, swap the side, skip the drink). Never shame them and never suggest skipping a meal to compensate.`
        : "";

      parts.push({
        type: "text",
        text: task + (text.trim() ? ` The person adds: "${text.trim()}"` : "") + situation +
          `\n\nReply with ONLY a JSON object, no markdown fences and no other text:\n` +
          `{"name":"short dish name, max 6 words","kcal":integer,"protein":integer grams,"carbs":integer grams,"fat":integer grams,` +
          `"ingredients":[{"name":"component","qty":"portion as a person would say it, e.g. 1.5 cups or 120 g","kcal":integer}],` +
          `"note":"one short sentence naming the biggest calorie driver"` +
          (mode === "check" ? `,"advice":"one or two sentences of practical guidance"` : "") + `}\n` +
          `List between 2 and 8 ingredients that together account for the calories.`,
      });

      const p = await askClaude(parts);
      setBase({
        name: p.name || "Meal",
        kcal: Math.max(0, Math.round(p.kcal || 0)), protein: Math.max(0, Math.round(p.protein || 0)),
        carbs: Math.max(0, Math.round(p.carbs || 0)), fat: Math.max(0, Math.round(p.fat || 0)),
        ingredients: Array.isArray(p.ingredients) ? p.ingredients.slice(0, 8) : [],
        note: p.note || "", advice: p.advice || "",
      });
    } catch (e) {
      if (e && e.auth) { onNeedPass(); setErr("Passcode needed before it can estimate."); }
      else setErr("That didn't come back. Try again, or type the numbers in yourself.");
      setBase({ name: text.trim() || "Meal", kcal: 0, protein: 0, carbs: 0, fat: 0, ingredients: [], note: "", advice: "" });
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

  return html`
    <div class="scrim" onClick=${onClose}>
      <div class="sheet" onClick=${(e) => e.stopPropagation()}>
        <div class="grab"></div>

        <div class="seg">
          <button class="segb" data-on=${mode === "check" ? "1" : "0"} onClick=${() => { setMode("check"); setBase(null); }}>Should I eat it?</button>
          <button class="segb" data-on=${mode === "log" ? "1" : "0"} onClick=${() => { setMode("log"); setBase(null); }}>Already ate it</button>
        </div>

        <div style="display:flex;gap:6px;margin-top:12px">
          <button class="pill" data-on=${scan === "meal" ? "1" : "0"} onClick=${() => setScan("meal")}>🍽️ Scan food</button>
          <button class="pill" data-on=${scan === "label" ? "1" : "0"} onClick=${() => setScan("label")}>🏷️ Nutrition label</button>
        </div>

        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
          ${SLOTS.map((s) => html`<button class="pill" key=${s} data-on=${slot === s ? "1" : "0"} onClick=${() => setSlot(s)}>${s}</button>`)}
        </div>

        ${img && html`
          <div style="margin-top:13px;position:relative">
            <img src=${img.url} alt="" style="width:100%;max-height:200px;object-fit:cover;border-radius:20px" />
            <button class="x" style="position:absolute;top:10px;right:10px;background:rgba(20,23,26,.7);color:#fff"
              onClick=${() => { setImg(null); if (fileRef.current) fileRef.current.value = ""; }}>×</button>
          </div>`}

        <input ref=${fileRef} type="file" accept="image/*" capture="environment" style="display:none"
          onChange=${(e) => pick(e.target.files && e.target.files[0])} />

        ${!img && html`<button class="b b2" style="margin-top:13px" onClick=${() => fileRef.current && fileRef.current.click()}>
          📷 ${scan === "label" ? "Photograph the label" : "Snap the plate"}
        </button>`}

        <input class="in" style="margin-top:9px"
          placeholder=${scan === "label" ? "How much of it are you having?" : "Chicken machboos with rice"}
          value=${text} onInput=${(e) => setText(e.target.value)}
          onKeyDown=${(e) => { if (e.key === "Enter" && !busy) run(); }} />

        <button class="b" style="margin-top:9px" onClick=${run} disabled=${busy || (!img && !text.trim())}>
          ${busy ? html`<span class="spin"></span>Working it out` : mode === "check" ? "Check against today" : "Get the numbers"}
        </button>

        ${err && html`<div class="err">${err}</div>`}

        ${m && html`
          <div>
            ${mode === "check" && html`
              <div class="verdict" style=${{ background: V.bg, color: V.fg }}>
                <div class="vhead">${V.head}${key === "over" ? " by " + Math.abs(after) : ""}</div>
                <div class="vsub">${base.name}, about <strong>${m.kcal} cal</strong>. You'd be at ${projected} of ${budget}${after >= 0 ? ", with " + after + " left for the day." : "."}</div>
                <div class="track">
                  <div style=${{ width: (eaten / max) * 100 + "%", background: V.ac, opacity: .4 }}></div>
                  <div style=${{ width: (m.kcal / max) * 100 + "%", background: V.ac }}></div>
                  <div class="mark" style=${{ left: (budget / max) * 100 + "%" }}></div>
                </div>
                ${base.advice && html`<div class="vsub">${base.advice}</div>`}
                ${proteinLeft > 0 && m.protein >= proteinLeft * 0.4 && html`<div class="vsub">Strong on protein: ${m.protein}g of the ${proteinLeft}g you still need.</div>`}
              </div>`}

            <div style="margin-top:15px;display:flex;gap:10px;align-items:center">
              <input class="in" style="flex:1" value=${base.name} onInput=${(e) => setBase({ ...base, name: e.target.value })} />
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

            ${base.ingredients && base.ingredients.length > 0 && html`
              <div style="margin-top:16px">
                <div class="lab">What's in it</div>
                ${base.ingredients.map((g, i) => html`
                  <div class="ing" key=${i}>
                    <div style="flex:1">
                      <div style="font-weight:600;font-size:14px">${g.name}</div>
                      <div class="note" style="font-size:12px">${g.qty}</div>
                    </div>
                    <div class="d" style="font-weight:700;font-size:14px">${Math.round((g.kcal || 0) * servings)} cal</div>
                  </div>`)}
              </div>`}

            ${base.note && html`<div class="note" style="margin-top:11px">${base.note}</div>`}

            <button class="b b3" style="margin-top:14px" onClick=${() => onAdd({
              name: base.name, slot, servings,
              base: { kcal: base.kcal, protein: base.protein, carbs: base.carbs, fat: base.fat },
              ingredients: base.ingredients || [], note: base.note || "", thumb: img ? img.thumb : null,
            })}>
              ${mode === "check" ? "Eat it · log " + m.kcal + " cal" : "Add " + m.kcal + " cal"}
            </button>
            ${mode === "check" && html`<button class="b b2" style="margin-top:8px" onClick=${onClose}>Skip it</button>`}
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
          `Revise the estimate for ONE serving accordingly. Reply with ONLY a JSON object, no markdown fences:\n` +
          `{"name":"short dish name","kcal":integer,"protein":integer,"carbs":integer,"fat":integer,` +
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

        ${e.ingredients && e.ingredients.length > 0 && html`
          <div style="margin-top:20px">
            <div class="h" style="font-size:15px">Ingredients</div>
            ${e.ingredients.map((g, i) => html`
              <div class="ing" key=${i}>
                <div style="flex:1">
                  <div style="font-weight:600;font-size:14px">${g.name}</div>
                  <div class="note" style="font-size:12px">${g.qty}</div>
                </div>
                <div class="d" style="font-weight:700;font-size:14px">${Math.round((g.kcal || 0) * s)} cal</div>
              </div>`)}
          </div>`}

        ${e.note && html`<div class="note" style="margin-top:14px">${e.note}</div>`}

        ${fixing
          ? html`<div style="margin-top:18px">
              <label class="lab">What did it get wrong?</label>
              <input class="in" autofocus placeholder="No dressing, and the portion was double"
                value=${fixText} onInput=${(ev) => setFixText(ev.target.value)}
                onKeyDown=${(ev) => { if (ev.key === "Enter" && !busy) applyFix(); }} />
              ${err && html`<div class="err">${err}</div>`}
              <button class="b" style="margin-top:10px" onClick=${applyFix} disabled=${busy || !fixText.trim()}>
                ${busy ? html`<span class="spin"></span>Recalculating` : "Update the estimate"}
              </button>
              <button class="b b2" style="margin-top:8px" onClick=${() => { setFixing(false); setErr(""); }}>Cancel</button>
            </div>`
          : html`<div style="display:flex;gap:9px;margin-top:20px">
              <button class="b b2" onClick=${() => setFixing(true)}>✦ Fix results</button>
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

function Profile({ profile, weight, days, weights, onSave, onWipe }) {
  const [p, setP] = useState(profile);
  const [confirm, setConfirm] = useState(false);
  const t = deriveTargets(p, weight);
  const dirty = JSON.stringify(p) !== JSON.stringify(profile);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ profile, days, weights }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tally-" + todayKey() + ".json";
    a.click();
  };

  return html`
    <div style="padding-top:6px">
      <div class="card">
        <div class="h">Your plan</div>
        <div style="margin-top:15px">
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
