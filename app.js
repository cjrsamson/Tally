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
/* ============================ language ============================ */

const LANGS = [{ id: "en", label: "English" }, { id: "uk", label: "Українська" }];
const LANG_KEY = "tally.lang";
let LANG = "en";

/* Falls back to the phone's own language on a fresh install, so someone
   whose iPhone is in Ukrainian never has to find the setting first. */
const detectLang = () => {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && LANGS.some((l) => l.id === saved)) return saved;
  } catch {}
  const nav = ((navigator.languages && navigator.languages[0]) || navigator.language || "").toLowerCase();
  return nav.startsWith("uk") ? "uk" : "en";
};

function setLang(l) {
  LANG = LANGS.some((x) => x.id === l) ? l : "en";
  try { localStorage.setItem(LANG_KEY, LANG); } catch {}
  if (typeof document !== "undefined") document.documentElement.lang = LANG;
}

/* Weekday names, month names and times come from the platform, so they
   need the locale as well — a Ukrainian screen with English weekday
   abbreviations reads like a half-finished job. */
const LOCALE = () => (LANG === "uk" ? "uk-UA" : undefined);

/* Ukrainian chooses between three forms depending on the number, where
   English only ever needs two: 1 день, 2 дні, 5 днів. */
function plural(n, forms) {
  if (LANG === "uk") {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b === 1) return forms[0];
    if (b >= 2 && b <= 4) return forms[1];
    return forms[2];
  }
  return n === 1 ? forms[0] : forms[1];
}

/* Any missing Ukrainian key falls through to English rather than showing
   a raw key, so a gap degrades into a readable screen. */
function t(key, vars) {
  let s = (STR[LANG] || STR.en)[key];
  if (s === undefined) s = STR.en[key];
  if (s === undefined) return key;
  if (Array.isArray(s)) return s;
  if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
  return s;
}
const tp = (key, n) => plural(n, t(key));

/* Decimal separator for displayed numbers. Inputs stay type="number" and
   are handled by the browser. */
const dec = (n, places = 1) => {
  const s = Number(n).toFixed(places);
  return LANG === "uk" ? s.replace(".", ",") : s;
};

/* Four-figure calorie numbers are much easier to read grouped. Only used
   where a number is being presented for reading, never in an input. */
const num = (n) => {
  try { return Number(n).toLocaleString(LOCALE()); } catch { return String(n); }
};

/* Weights and paces carry a decimal only when there is one to carry, so a
   goal of 68 kg reads as "68" and not "68.0". */
const kgs = (n) => {
  const v = Math.round(Number(n) * 100) / 100;
  const s = Number.isInteger(v) ? String(v) : String(v);
  return LANG === "uk" ? s.replace(".", ",") : s;
};

const STR = {
  en: {
    /* — language and appearance — */
    lang_h: "Language",
    lang_note: "Meal names and the advice tally writes back come out in the language you pick here.",
    appearance_h: "Appearance",
    appearance_note: "Left on Automatic, tally follows whatever your phone is set to and switches with it.",
    theme_system: "Automatic", theme_light: "Light", theme_dark: "Dark",

    /* — activity and meal slots — */
    act_sedentary: "Mostly sitting — desk job, drive or sit most of the day",
    act_light: "A bit of walking — errands, part of the commute on foot",
    act_moderate: "On my feet a good part of the day",
    act_active: "Moving all day — physical or manual work",
    eff_light: "Easy — brisk walking, gentle swim, light weights",
    eff_moderate: "Moderate — jogging, tennis, an ordinary gym session",
    eff_hard: "Hard — running, intervals, heavy lifting",
    slot_Breakfast: "Breakfast", slot_Lunch: "Lunch", slot_Dinner: "Dinner", slot_Snack: "Snack",

    /* — confidence and verdict — */
    conf_high: "Clear read", conf_medium: "Rough estimate",
    conf_low: "Hard to judge", conf_repeat: "Repeated from an earlier day",
    conf_likely: "likely {low}–{high} cal",
    v_fits: "Go for it", v_tight: "Cutting it fine", v_over: "Puts you over",

    /* — units — */
    u_cal: "cal", u_g: "g", u_kg: "kg",
    m_cal: "Cal", m_protein: "Protein", m_carbs: "Carbs",
    m_fat: "Fat", m_sugar: "Sugar", m_fibre: "Fibre",
    macro_eaten: "{name} eaten",
    days: ["day", "days"], meals: ["meal", "meals"],
    dayw: ["day", "days"], weighins: ["weigh-in", "weigh-ins"],

    /* — home — */
    loading: "Loading…",
    greet_morning: "Good morning", greet_afternoon: "Good afternoon", greet_evening: "Good evening",
    greet_named: "{greet}, {name}",
    bday: "Happy birthday", bday_named: "Happy birthday, {name}",
    sub_pastday: "{date} · {eaten} of {target}. Tap + to add to this day.",
    sub_empty: "Nothing logged yet today. {n} calories to play with.",
    sub_over: "{n} over budget today.",
    sub_left: "{n} calories left for today.",
    week_this: "This week", week_return: "back to today",
    week_prev: "Previous week", week_next: "Next week",
    cal_eaten: "Calories eaten", cal_over: "{n} over budget", cal_left: "{n} left",
    carbs_h: "Carbs, in more detail", carbs_total: "{n}g total",
    ofwhich_fibre: "Of which fibre", ofwhich_sugar: "Of which sugar",
    fibre_sub: "Aim to reach this",
    sugar_sub: "Try to stay under", sugar_over: "Over the daily guide",
    carbs_note: "Fibre is the part of a carb that feeds you slowly — hitting it is what makes a carb a good one. Sugar counts what's in fruit and milk as well as what's added, so a day of whole fruit can read high and still be fine.",
    recent_h: "Recently logged",
    empty_h: "Nothing logged yet",
    empty_s: "Tap + to snap a plate, pick a photo, or just describe what you're having.",
    nav_home: "Home", nav_progress: "Progress", nav_profile: "Profile",
    aria_add: "Add a meal",

    /* — numbers grid and ingredients — */
    num_note: "Adjust protein, carbs or fat and the calories recalculate themselves. Sugar and fibre are counted inside the carb figure, not on top of it.",
    ing_h: "What's in it", ing_tap: "Tap any line to correct it",
    ing_add: "+ Add something it missed",
    ing_name_ph: "Ingredient, e.g. olive oil",
    ing_amt_ph: "120", ing_unit_ph: "g, cups, slices", ing_cal_ph: "cal",
    ing_scales: "Change the amount and the calories follow it.",
    ing_blank: "Leave the calories blank and tally can work them out.",
    ing_lookup: "✦ Work out the calories", ing_looking: "Looking up",
    ing_addit: "Add it", ing_done: "Done", ing_remove: "Remove", ing_cancel: "Cancel",
    ing_untitled: "Untitled",
    ing_breakdown: "{p}g protein · {c}g carbs · {f}g fat · {s}g sugar · {fb}g fibre",
    ing_err_pass: "Passcode needed before it can look that up.",
    ing_err: "Couldn't look that one up. Type the calories in instead.",

    /* — onboarding — */
    ob_welcome_h: "Welcome to tally",
    ob_welcome_s: "A calorie tracker you can point at your food. First, a few questions so the numbers are yours and not someone else's.",
    ob_name_l: "What should it call you?", ob_name_ph: "First name",
    ob_private: "Everything you log stays on this phone. Nothing is uploaded, and nobody else can see it — not even the person who shared this with you.",
    ob_about_h: "About you",
    ob_about_s: "Your date of birth, height and sex go into the equation that estimates what your body burns at rest.",
    ob_dob_l: "Date of birth",
    ob_dob_note: "tally works your age out from this, so it stays right as the years pass.",
    ob_dob_age: "That makes you {age}. Your target will adjust itself on your birthday.",
    ob_height_l: "Height (cm)",
    ob_sex_l: "Which does the formula fit better?", ob_male: "Male", ob_female: "Female",
    ob_young_h: "tally isn't built for under 18s.",
    ob_young_s: "The equation it uses is for adult bodies, and calorie targets for someone still growing are something a doctor should set — not an app. If you'd like help with eating well, a GP or a school nurse is the right place to start.",
    ob_weight_h: "Where you are, where you're heading",
    ob_weight_s: "Weigh yourself in the morning if you can — it's the most consistent time.",
    ob_now_l: "Weight now (kg)", ob_goal_l: "Goal (kg)",
    ob_goal_high: "tally is set up for losing weight, so your goal needs to be below where you are now.",
    ob_lean: "You're already at the lean end of the healthy range for your height. Losing more isn't something to take on without talking to a doctor first.",
    ob_goal_low: "{goal} kg is below the healthy weight range for {cm} cm — that range starts around {floor} kg. You can carry on, but it's worth a conversation with a doctor before aiming there.",
    ob_move_h: "An ordinary day",
    ob_move_s: "Exercise is asked about on the next screen, so leave it out of this one — this is only the walking, standing and moving about you'd do anyway. Be honest rather than optimistic: an overestimate here inflates your budget every single day.",
    ob_ex_h: "Training",
    ob_ex_s: "Counted separately so it can be counted properly. It's averaged over the whole week, so two hard hours on a Saturday shows up as a little extra on every day.",
    ob_ex_days_l: "Sessions a week",
    ob_ex_mins_l: "Minutes in a typical one",
    ob_ex_effort_l: "How hard, usually?",
    ob_ex_none: "Nothing to add — your target comes from your ordinary day alone.",
    ob_bf_l: "Body fat %, if you know it",
    ob_bf_ph: "Optional",
    ob_bf_range: "That needs to be between 5 and 60, or left blank.",
    ob_bf_note: "Leave it blank unless you have a real reading from a scale, a caliper or a scan. With one, tally uses Katch-McArdle instead, which works off lean mass and is the more accurate of the two — particularly if you're notably lean or carrying more than average. A guess is worse than nothing here.",
    ob_pace_l: "How fast do you want it to come off?",
    ob_pace_25: "0.25 kg a week — gradual, barely noticeable",
    ob_pace_50: "0.5 kg a week — steady, the usual choice",
    ob_pace_75: "0.75 kg a week — demanding, harder to stick to",
    ob_plan_h: "Here's your plan",
    ob_plan_s: "The whole sum is below, so you can see where every calorie came from rather than take the total on trust.",
    plan_fibre: "— of which fibre, at least", plan_sugar: "— of which sugar, at most",

    /* — the working-out — */
    plan_how_h: "Where this number comes from",
    calc_rest: "Resting burn",
    calc_rest_mifflin: "Mifflin-St Jeor — from your age, height, weight and sex",
    calc_rest_katch: "Katch-McArdle — from your lean mass, using the body fat figure you gave",
    calc_living: "Moving about your day",
    calc_ex: "Training",
    calc_ex_s: "{days} × {mins} min, {effort}, averaged across the week",
    calc_ex_none: "None — nothing added",
    calc_maintain: "To stay at {kg} kg",
    calc_maintain_s: "Eat about this much and your weight holds where it is",
    calc_deficit: "Less, for {pace} kg a week",
    calc_deficit_s: "A kilo of fat holds roughly 7,700 calories, so {pace} kg in a week works out at {n} fewer a day",
    calc_target: "Eat each day",
    calc_reach: "Hold to that and you'd be at {goal} kg in about {n} — around {date}.",
    calc_floor: "Your pace asked for {want} fewer a day, but that would take you under {floor} calories and tally won't go there. It's holding {got} back instead, so expect nearer {kg} kg a week.",
    calc_sessions: ["session", "sessions"],
    weeksw: ["week", "weeks"],
    calc_note: "These are estimates, not measurements. The resting burn is an equation, not a reading, and the activity figures are averages — real people land anywhere from 10% either side. Treat the number as a starting point: if the scale isn't moving the way this says it should after a fortnight of honest logging, the number is wrong and not you. Adjust it.",
    ob_code_l: "Access code", ob_code_ph: "The code you were sent",
    ob_code_note: "Whoever shared tally with you will have sent a code. It lets the app read your photos and costs them a little each time, which is why it's not open to everyone. You can add it later if you don't have it yet.",
    ob_medical: "These are estimates, not medical advice. If you're pregnant, managing a health condition, or have a history of disordered eating, talk to a doctor before following a calorie target.",
    ob_back: "Back", ob_continue: "Continue", ob_start: "Start tracking",

    /* — passcode — */
    pass_h: "Enter your passcode",
    pass_note: "This is the passcode you set on the server when you deployed. It stops anyone else who finds this address from spending your API credit.",
    pass_save: "Save passcode",

    /* — log sheet — */
    log_h: "What are you having?",
    log_forday: "This will be logged to {day}.",
    log_snap_t: "Snap the plate", log_snap_s: "Straight to the camera",
    log_pick_t: "Choose a photo", log_pick_s: "From your camera roll",
    log_type_t: "Just describe it", log_type_s: "No photo needed",
    log_again_t: "Had it before", log_again_s: "Copy a meal from yesterday or earlier",
    rep_h: "Something you've had before", rep_back: "Back",
    rep_note: "Tap a meal to log it again — you can change the portion first. \"Add all\" puts a whole day back in one go.",
    rep_all: "Add all: {n}", rep_yesterday: "Yesterday",
    log_ph_label: "How much of it are you having?",
    log_ph_photo: "Anything it can't see? Optional",
    log_ph_text: "Chicken machboos with rice",
    log_isfood: "🍽️ It's food", log_islabel: "🏷️ It's a label",
    log_run: "Work out the calories", log_running: "Working it out",
    log_err_pass: "Passcode needed before it can estimate.",
    log_err: "That didn't come back. Try again, or type the numbers in yourself.",
    log_notimage: "That isn't an image.",
    log_badphoto: "Couldn't read that photo. Try another.",
    v_over_by: " by {n}",
    v_line: "{name}, about",
    v_line2: "That would put you at {done} of {budget}",
    v_left: ", with {n} left for the day.",
    v_stop: ".",
    v_protein: "Strong on protein: {n}g of the {need}g you still need.",
    v_basis: "Judged against {basis}.",
    log_when: "When was this?",
    log_it: "Log it · {n} cal",
    log_justchecking: "Just checking — don't log it",
    log_restart: "Start again",
    meal_default: "Meal",

    /* — meal detail — */
    md_calories: "Calories",
    md_numbers: "The numbers, per serving × {n}",
    md_doneedit: "Done editing", md_edit: "✎ Edit these numbers",
    md_fix_l: "Tell it what's wrong",
    md_fix_ph: "No dressing, and the portion was double",
    md_fix_note: "Best for whole-dish corrections. For one item, tap it in the list above.",
    md_fix_go: "Update the estimate", md_fixing: "Recalculating",
    md_cancel: "Cancel", md_redo: "✦ Redo the whole thing", md_done: "Done",
    md_delete: "Delete this meal",
    md_err_pass: "Passcode needed.",
    md_err: "Couldn't revise it. Try again, or edit the numbers by hand.",

    /* — progress — */
    pr_weight: "Your weight",
    pr_goal: "Goal {kg} kg · {pct}%",
    pr_streak: "{n} {unit}", pr_streak_s: "logged in a row",
    pr_chart_h: "Weight progress", pr_ofgoal: "⚑ {pct}% of goal",
    pr_needmore: "Log your weight twice and the trend line appears here.",
    pr_weigh_ph: "Weigh in, kg", pr_log: "Log",
    pr_avg_h: "Daily average calories", pr_vs: "vs last week",
    pr_dashed: "Dashed line is your {n} budget. Judge yourself on the week, not the day.",

    /* — profile — */
    pf_plan_h: "Your plan",
    pf_name_l: "What should it call you?", pf_name_ph: "Your first name",
    pf_move_l: "An ordinary day, exercise aside",
    pf_ex_days_l: "Sessions a week",
    pf_ex_mins_l: "Minutes each",
    pf_ex_effort_l: "How hard",
    pf_bf_l: "Body fat %",
    pf_bf_ph: "Optional",
    pf_bf_note: "Only fill this in from a real reading. With one, tally switches to Katch-McArdle, which is the more accurate equation.",
    pf_pace_l: "Pace",
    pf_pace_25: "0.25 kg a week — gradual", pf_pace_50: "0.5 kg a week — steady",
    pf_pace_75: "0.75 kg a week — demanding",
    pf_goal_l: "Goal kg", pf_stretch_l: "Stretch kg", pf_height_l: "Height cm",
    pf_dob_l: "Date of birth",
    pf_dob_set: "You're {age}. tally recalculates this itself, so your target moves on your birthday.",
    pf_dob_unset: "Set this and tally will keep your age up to date on its own. Until then it's using {age}.",
    pf_low: "{goal} kg is below the healthy range for {cm} cm, which starts around {floor} kg. Worth raising with a doctor.",
    pf_save: "Save plan", pf_saved: "Saved",
    pf_numbers_h: "Your numbers",
    pf_numbers_note: "Protein protects muscle while the weight comes off. Hit it first and let carbs and fat move around it. The plan never drops below {floor} calories.",
    pf_data_h: "Your data",
    pf_data_note: "Everything lives on this phone. Nothing is stored on the server. Export a backup before you clear your browser data or change device.",
    pf_export: "Export a backup", pf_restore: "Restore from a backup",
    pf_restore_h: "Restore this backup?",
    pf_restore_s: "It holds {meals}, across {days} and {weighins}. Anything already on this phone stays — the two are merged.",
    pf_merge: "Merge it in", pf_cancel: "Cancel",
    pf_restored: "Restored {n}.",
    pf_notbackup: "That doesn't look like a tally backup.",
    pf_badfile: "Couldn't read that file. Make sure it's the .json backup.",
    pf_erase: "Erase all data", pf_erase_yes: "Yes, erase everything",
  },

  uk: {
    lang_h: "Мова",
    lang_note: "Назви страв і поради, які пише tally, будуть тією мовою, яку ви оберете тут.",
    appearance_h: "Оформлення",
    appearance_note: "У режимі «Автоматично» tally бере налаштування вашого телефона і змінюється разом із ним.",
    theme_system: "Автоматично", theme_light: "Світла", theme_dark: "Темна",

    act_sedentary: "Переважно сиджу — офіс, авто, майже без ходьби",
    act_light: "Трохи ходьби — справи, частина дороги пішки",
    act_moderate: "Чималу частину дня на ногах",
    act_active: "Увесь день у русі — фізична робота",
    eff_light: "Легко — швидка ходьба, спокійний басейн, легкі ваги",
    eff_moderate: "Помірно — біг підтюпцем, теніс, звичайне тренування",
    eff_hard: "Важко — біг, інтервали, важкі ваги",
    slot_Breakfast: "Сніданок", slot_Lunch: "Обід", slot_Dinner: "Вечеря", slot_Snack: "Перекус",

    conf_high: "Добре видно", conf_medium: "Приблизна оцінка",
    conf_low: "Важко визначити", conf_repeat: "Повтор із попереднього дня",
    conf_likely: "імовірно {low}–{high} ккал",
    v_fits: "Можна сміливо", v_tight: "Майже впритул", v_over: "Виходить за межу",

    u_cal: "ккал", u_g: "г", u_kg: "кг",
    m_cal: "Ккал", m_protein: "Білки", m_carbs: "Вуглеводи",
    m_fat: "Жири", m_sugar: "Цукор", m_fibre: "Клітковина",
    macro_eaten: "{name} спожито",
    days: ["день", "дні", "днів"], meals: ["страва", "страви", "страв"],
    dayw: ["день", "дні", "днів"], weighins: ["зважування", "зважування", "зважувань"],

    loading: "Завантаження…",
    greet_morning: "Доброго ранку", greet_afternoon: "Доброго дня", greet_evening: "Доброго вечора",
    greet_named: "{greet}, {name}",
    bday: "З днем народження", bday_named: "З днем народження, {name}",
    sub_pastday: "{date} · {eaten} з {target}. Натисніть +, щоб додати до цього дня.",
    sub_empty: "Сьогодні ще нічого не записано. У вас {n} ккал на день.",
    sub_over: "Сьогодні перевищення на {n} ккал.",
    sub_left: "Залишилось {n} ккал на сьогодні.",
    week_this: "Цей тиждень", week_return: "до сьогодні",
    week_prev: "Попередній тиждень", week_next: "Наступний тиждень",
    cal_eaten: "Спожито калорій", cal_over: "перевищення на {n}", cal_left: "залишилось {n}",
    carbs_h: "Вуглеводи докладніше", carbs_total: "усього {n} г",
    ofwhich_fibre: "З них клітковина", ofwhich_sugar: "З них цукор",
    fibre_sub: "Бажано дійти до цієї межі",
    sugar_sub: "Бажано не перевищувати", sugar_over: "Більше за денний орієнтир",
    carbs_note: "Клітковина — та частина вуглеводів, що засвоюється повільно; саме вона робить вуглеводи корисними. У цукор рахується і той, що природно є у фруктах та молоці, тому день із великою кількістю фруктів може показати багато цукру — і це нормально.",
    recent_h: "Останні записи",
    empty_h: "Ще нічого не записано",
    empty_s: "Натисніть +, щоб сфотографувати тарілку, вибрати фото або просто описати страву словами.",
    nav_home: "Головна", nav_progress: "Прогрес", nav_profile: "Профіль",
    aria_add: "Додати страву",

    num_note: "Змініть білки, вуглеводи або жири — і калорії перерахуються самі. Цукор і клітковина входять до вуглеводів, а не додаються до них.",
    ing_h: "Що всередині", ing_tap: "Натисніть на рядок, щоб виправити",
    ing_add: "+ Додати те, чого бракує",
    ing_name_ph: "Інгредієнт, напр. оливкова олія",
    ing_amt_ph: "120", ing_unit_ph: "г, склянки, скибки", ing_cal_ph: "ккал",
    ing_scales: "Змініть кількість — і калорії зміняться слідом.",
    ing_blank: "Залиште поле калорій порожнім, і tally порахує сам.",
    ing_lookup: "✦ Порахувати калорії", ing_looking: "Шукаю",
    ing_addit: "Додати", ing_done: "Готово", ing_remove: "Прибрати", ing_cancel: "Скасувати",
    ing_untitled: "Без назви",
    ing_breakdown: "{p} г білків · {c} г вуглеводів · {f} г жирів · {s} г цукру · {fb} г клітковини",
    ing_err_pass: "Щоб це порахувати, потрібен код доступу.",
    ing_err: "Не вдалося знайти. Введіть калорії вручну.",

    ob_welcome_h: "Вітаємо у tally",
    ob_welcome_s: "Лічильник калорій, який досить навести на їжу. Спершу кілька запитань, щоб цифри були саме вашими.",
    ob_name_l: "Як до вас звертатися?", ob_name_ph: "Ім'я",
    ob_private: "Усе, що ви записуєте, лишається на цьому телефоні. Нічого не надсилається на сервер, і ніхто інший цього не бачить — навіть той, хто поділився з вами застосунком.",
    ob_about_h: "Про вас",
    ob_about_s: "Дата народження, зріст і стать потрібні для формули, що оцінює, скільки ваше тіло витрачає у спокої.",
    ob_dob_l: "Дата народження",
    ob_dob_note: "tally сам рахує ваш вік із цієї дати, тож він завжди буде правильний.",
    ob_dob_age: "Отже, вам {age}. Ваша норма оновиться у день народження.",
    ob_height_l: "Зріст (см)",
    ob_sex_l: "Яка формула вам підходить?", ob_male: "Чоловіча", ob_female: "Жіноча",
    ob_young_h: "tally не призначений для осіб до 18 років.",
    ob_young_s: "Формула розрахована на доросле тіло, а норму калорій для того, хто ще росте, має визначати лікар, а не застосунок. Якщо потрібна допомога з харчуванням, почніть із сімейного лікаря.",
    ob_weight_h: "Де ви зараз і куди прямуєте",
    ob_weight_s: "Зважуйтеся вранці, якщо є така змога — це найстабільніший час.",
    ob_now_l: "Вага зараз (кг)", ob_goal_l: "Ціль (кг)",
    ob_goal_high: "tally налаштований на зниження ваги, тому ціль має бути меншою за теперішню вагу.",
    ob_lean: "Ви вже у нижній частині здорового діапазону для свого зросту. Худнути далі варто лише після розмови з лікарем.",
    ob_goal_low: "{goal} кг — це нижче за здоровий діапазон для зросту {cm} см; він починається приблизно з {floor} кг. Ви можете продовжити, але спершу варто порадитися з лікарем.",
    ob_move_h: "Звичайний день",
    ob_move_s: "Про тренування запитаємо на наступному екрані, тож сюди їх не рахуйте — тут лише ходьба, стояння та рух, які є у вас і без спорту. Оцініть чесно, а не оптимістично: завищена оцінка щодня збільшуватиме вашу норму.",
    ob_ex_h: "Тренування",
    ob_ex_s: "Рахуємо окремо, щоб порахувати як слід. Результат усереднюється на весь тиждень, тож дві важкі години в суботу додають потроху до кожного дня.",
    ob_ex_days_l: "Тренувань на тиждень",
    ob_ex_mins_l: "Хвилин за одне",
    ob_ex_effort_l: "Наскільки важко зазвичай?",
    ob_ex_none: "Нічого додавати — ваша норма спирається лише на звичайний день.",
    ob_bf_l: "Відсоток жиру, якщо знаєте",
    ob_bf_ph: "Необов’язково",
    ob_bf_range: "Має бути від 5 до 60 або порожнє.",
    ob_bf_note: "Залишіть порожнім, якщо не маєте справжнього вимірювання — вагами, каліпером чи скануванням. Якщо маєте, tally перейде на формулу Кетча-Макардла, яка рахує від сухої маси й точніша, особливо якщо ви дуже худі або маєте більше жиру за середнє. Здогад тут гірший за порожнє поле.",
    ob_pace_l: "Як швидко хочете худнути?",
    ob_pace_25: "0,25 кг на тиждень — поступово, майже непомітно",
    ob_pace_50: "0,5 кг на тиждень — рівно, звичайний вибір",
    ob_pace_75: "0,75 кг на тиждень — вимогливо, важче витримати",
    ob_plan_h: "Ось ваш план",
    ob_plan_s: "Нижче — увесь розрахунок, щоб ви бачили, звідки взялася кожна калорія, а не просто вірили підсумку.",
    plan_fibre: "— з них клітковини, щонайменше", plan_sugar: "— з них цукру, не більше",

    plan_how_h: "Звідки взялося це число",
    calc_rest: "Витрати у спокої",
    calc_rest_mifflin: "Міффлін-Сан Жеор — з віку, зросту, ваги та статі",
    calc_rest_katch: "Кетч-Макардл — із сухої маси, за вказаним відсотком жиру",
    calc_living: "Рух протягом дня",
    calc_ex: "Тренування",
    calc_ex_s: "{days} × {mins} хв, {effort}, усереднено на тиждень",
    calc_ex_none: "Немає — нічого не додано",
    calc_maintain: "Щоб триматися на {kg} кг",
    calc_maintain_s: "Їжте приблизно стільки — і вага стоятиме на місці",
    calc_deficit: "Мінус, щоб втрачати {pace} кг на тиждень",
    calc_deficit_s: "У кілограмі жиру приблизно 7700 ккал, тож {pace} кг за тиждень — це на {n} менше щодня",
    calc_target: "Їсти щодня",
    calc_reach: "Дотримуйтеся — і будете на {goal} кг приблизно за {n}, десь {date}.",
    calc_floor: "Обраний темп вимагав на {want} менше щодня, але це опустило б вас нижче {floor} ккал, а туди tally не йде. Замість цього віднімається {got}, тож очікуйте радше {kg} кг на тиждень.",
    calc_sessions: ["тренування", "тренування", "тренувань"],
    weeksw: ["тиждень", "тижні", "тижнів"],
    calc_note: "Це оцінки, а не вимірювання. Витрати у спокої — формула, а не показник приладу, а цифри активності усереднені: реальні люди відхиляються приблизно на 10% в обидва боки. Сприймайте число як відправну точку. Якщо після двох тижнів чесного обліку вага йде не так, як тут написано, помиляється число, а не ви — виправте його.",
    ob_code_l: "Код доступу", ob_code_ph: "Код, який вам надіслали",
    ob_code_note: "Той, хто поділився з вами tally, мав надіслати код. Він дозволяє застосунку розпізнавати ваші фото і щоразу трохи коштує власнику — тому доступ не відкритий для всіх. Код можна ввести й пізніше.",
    ob_medical: "Це оцінки, а не медичні поради. Якщо ви вагітні, маєте хронічне захворювання або в минулому були розлади харчової поведінки, порадьтеся з лікарем, перш ніж дотримуватися норми калорій.",
    ob_back: "Назад", ob_continue: "Далі", ob_start: "Почати",

    pass_h: "Введіть код доступу",
    pass_note: "Це код, який ви задали на сервері під час розгортання. Він не дає стороннім витрачати ваш ліміт API.",
    pass_save: "Зберегти код",

    log_h: "Що ви їсте?",
    log_forday: "Запис буде додано до дня: {day}.",
    log_snap_t: "Сфотографувати", log_snap_s: "Одразу камера",
    log_pick_t: "Вибрати фото", log_pick_s: "З галереї",
    log_type_t: "Просто описати", log_type_s: "Фото не потрібне",
    log_again_t: "Уже це їли", log_again_s: "Скопіювати страву з учора або раніше",
    rep_h: "Те, що ви вже їли", rep_back: "Назад",
    rep_note: "Натисніть на страву, щоб записати її знову — порцію можна змінити. «Додати всі» повертає цілий день одним дотиком.",
    rep_all: "Додати всі: {n}", rep_yesterday: "Учора",
    log_ph_label: "Скільки ви з'їсте?",
    log_ph_photo: "Щось, чого не видно на фото? Необов'язково",
    log_ph_text: "Курка з рисом",
    log_isfood: "🍽️ Це їжа", log_islabel: "🏷️ Це етикетка",
    log_run: "Порахувати калорії", log_running: "Рахую",
    log_err_pass: "Щоб зробити оцінку, потрібен код доступу.",
    log_err: "Відповідь не надійшла. Спробуйте ще раз або введіть цифри вручну.",
    log_notimage: "Це не зображення.",
    log_badphoto: "Не вдалося прочитати це фото. Спробуйте інше.",
    v_over_by: " на {n}",
    v_line: "{name}, приблизно",
    v_line2: "Разом вийде {done} з {budget}",
    v_left: ", залишиться {n} на день.",
    v_stop: ".",
    v_protein: "Багато білка: {n} г із {need} г, яких вам ще бракує.",
    v_basis: "Оцінено за орієнтиром: {basis}.",
    log_when: "Коли це було?",
    log_it: "Записати · {n} ккал",
    log_justchecking: "Просто дивлюся — не записувати",
    log_restart: "Почати спочатку",
    meal_default: "Страва",

    md_calories: "Калорії",
    md_numbers: "Цифри, порція × {n}",
    md_doneedit: "Готово", md_edit: "✎ Змінити цифри",
    md_fix_l: "Що не так?",
    md_fix_ph: "Без заправки, і порція була подвійна",
    md_fix_note: "Підходить для виправлень щодо всієї страви. Щоб змінити один інгредієнт, натисніть на нього у списку вище.",
    md_fix_go: "Оновити оцінку", md_fixing: "Перераховую",
    md_cancel: "Скасувати", md_redo: "✦ Перерахувати заново", md_done: "Готово",
    md_delete: "Видалити цю страву",
    md_err_pass: "Потрібен код доступу.",
    md_err: "Не вдалося перерахувати. Спробуйте ще раз або змініть цифри вручну.",

    pr_weight: "Ваша вага",
    pr_goal: "Ціль {kg} кг · {pct}%",
    pr_streak: "{n} {unit}", pr_streak_s: "поспіль із записами",
    pr_chart_h: "Зміна ваги", pr_ofgoal: "⚑ {pct}% до цілі",
    pr_needmore: "Запишіть вагу двічі — і тут з'явиться лінія тренду.",
    pr_weigh_ph: "Зважування, кг", pr_log: "Записати",
    pr_avg_h: "Середні калорії за день", pr_vs: "проти минулого тижня",
    pr_dashed: "Пунктир — ваша норма {n} ккал. Оцінюйте себе за тижнем, а не за одним днем.",

    pf_plan_h: "Ваш план",
    pf_name_l: "Як до вас звертатися?", pf_name_ph: "Ваше ім'я",
    pf_move_l: "Звичайний день, без тренувань",
    pf_ex_days_l: "Тренувань на тиждень",
    pf_ex_mins_l: "Хвилин за одне",
    pf_ex_effort_l: "Наскільки важко",
    pf_bf_l: "Жир, %",
    pf_bf_ph: "Необов’язково",
    pf_bf_note: "Заповнюйте лише за справжнім вимірюванням. Тоді tally перейде на формулу Кетча-Макардла — точнішу з двох.",
    pf_pace_l: "Темп",
    pf_pace_25: "0,25 кг на тиждень — поступово", pf_pace_50: "0,5 кг на тиждень — рівно",
    pf_pace_75: "0,75 кг на тиждень — вимогливо",
    pf_goal_l: "Ціль, кг", pf_stretch_l: "Бажана, кг", pf_height_l: "Зріст, см",
    pf_dob_l: "Дата народження",
    pf_dob_set: "Вам {age}. tally рахує це сам, тож норма оновиться у ваш день народження.",
    pf_dob_unset: "Вкажіть дату, і tally сам оновлюватиме ваш вік. Поки що використовується {age}.",
    pf_low: "{goal} кг — нижче за здоровий діапазон для зросту {cm} см, який починається приблизно з {floor} кг. Варто обговорити з лікарем.",
    pf_save: "Зберегти план", pf_saved: "Збережено",
    pf_numbers_h: "Ваші цифри",
    pf_numbers_note: "Білок зберігає м'язи, поки йде вага. Тримайте його насамперед, а вуглеводи та жири підлаштовуйте навколо нього. План ніколи не опускається нижче {floor} ккал.",
    pf_data_h: "Ваші дані",
    pf_data_note: "Усе зберігається на цьому телефоні. На сервері нічого немає. Зробіть резервну копію, перш ніж очищати дані браузера або міняти телефон.",
    pf_export: "Зберегти резервну копію", pf_restore: "Відновити з копії",
    pf_restore_h: "Відновити цю копію?",
    pf_restore_s: "У ній {meals} за {days} і {weighins}. Усе, що вже є на цьому телефоні, залишиться — дані об'єднаються.",
    pf_merge: "Об'єднати", pf_cancel: "Скасувати",
    pf_restored: "Відновлено: {n}.",
    pf_notbackup: "Це не схоже на резервну копію tally.",
    pf_badfile: "Не вдалося прочитати файл. Переконайтеся, що це резервна копія .json.",
    pf_erase: "Стерти всі дані", pf_erase_yes: "Так, стерти все",
  },
};

/* ACTIVITY is now only the *baseline* — how much you move going about an
   ordinary day, with no deliberate exercise in it at all. Exercise used to
   be smuggled into these multipliers, which is the single biggest source of
   error in a calorie target: one tap covered everything from a desk job with
   a dog to a desk job plus five gym sessions, and the gap between those two
   is 400 calories a day. It is asked for separately now. */
const ACTIVITY = [
  { id: "sedentary", key: "act_sedentary", mult: 1.2 },
  { id: "light", key: "act_light", mult: 1.35 },
  { id: "moderate", key: "act_moderate", mult: 1.5 },
  { id: "active", key: "act_active", mult: 1.7 },
];

/* Exercise is costed in METs — the standard multiple-of-resting-burn table.
   A MET is subtracted from each because the baseline multiplier above is
   already paying for the resting calories you'd have burned during that
   hour anyway; counting them twice inflates the budget. */
const EFFORT = [
  { id: "light", key: "eff_light", met: 4 },
  { id: "moderate", key: "eff_moderate", met: 6 },
  { id: "hard", key: "eff_hard", met: 9 },
];

/* Calories in a kilogram of body fat. 7,700 is the figure the equation the
   rest of the app uses is built on. */
const KCAL_PER_KG = 7700;

const SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"];
const SLOT_ICON = { Breakfast: "🍳", Lunch: "🥗", Dinner: "🍽️", Snack: "🍎" };
const DEFAULTS = {
  onboarded: false,
  name: "", heightCm: 170, dob: "", age: 30, sex: "male", startWeight: 75,
  goalWeight: 72, stretchWeight: 70, activity: "light", weeklyLoss: 0.5,
  exDays: 0, exMins: 45, exEffort: "moderate", bodyFat: null,
  theme: "system", lang: "en",
};

/* Profiles written before exercise was asked about separately have it baked
   into their activity choice. Pulling it back out keeps their target roughly
   where it was instead of silently dropping a few hundred calories. */
const OLD_ACTIVITY_SPLIT = {
  sedentary: { activity: "sedentary", exDays: 0, exMins: 45, exEffort: "moderate" },
  light: { activity: "light", exDays: 2, exMins: 30, exEffort: "light" },
  moderate: { activity: "light", exDays: 4, exMins: 60, exEffort: "moderate" },
  active: { activity: "moderate", exDays: 5, exMins: 60, exEffort: "moderate" },
};
function migrateActivity(p) {
  if (!p || p.exDays !== undefined) return p;
  const split = OLD_ACTIVITY_SPLIT[p.activity] || OLD_ACTIVITY_SPLIT.light;
  return { ...p, ...split };
}

/* ---------------------------------------------------------------- theme */

const THEME_KEY = "tally.theme";

/* The choice is written to localStorage as well as the profile. IndexedDB
   can only be read after the first paint, and a dark-phone user should not
   get a white flash on every launch — index.html reads this synchronously. */
function applyTheme(t) {
  const mode = t === "light" || t === "dark" ? t : "system";
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
  try { localStorage.setItem(THEME_KEY, mode); } catch {}
  const dark = mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0E1113" : "#F7F8F5");
}

/* ------------------------------------------------------------------ age */

/* Age is derived from the date of birth on every render, so a birthday
   quietly moves the calorie target the next morning. Anyone onboarded
   before dob existed keeps their typed age until they fill one in. */
function ageFromDob(dob) {
  if (!dob) return null;
  const b = new Date(dob + "T00:00:00");
  if (isNaN(b)) return null;
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return a >= 0 && a < 130 ? a : null;
}
const ageOf = (p) => {
  const a = ageFromDob(p && p.dob);
  return a === null ? ((p && p.age) || 30) : a;
};
/* Is today the birthday? Used for one small greeting, nothing more. */
const isBirthday = (p) => {
  if (!p || !p.dob) return false;
  const b = new Date(p.dob + "T00:00:00"), n = new Date();
  return !isNaN(b) && b.getMonth() === n.getMonth() && b.getDate() === n.getDate();
};

/* Used to keep goals inside a sane range. Not a diagnosis — just the
   standard healthy-weight band for a height. */
const bmiOf = (kg, cm) => kg / Math.pow((cm || 1) / 100, 2);
const minHealthyKg = (cm) => Math.round(18.5 * Math.pow((cm || 1) / 100, 2) * 10) / 10;

function deriveTargets(p0, w0) {
  const p = migrateActivity(p0);
  const w = w0 || p.startWeight;

  /* Resting burn. Mifflin-St Jeor is the default because it only needs
     things everybody knows about themselves. If a body fat percentage has
     been entered, Katch-McArdle is used instead: it works off lean mass
     rather than total weight, which makes it markedly more accurate at both
     ends — a lean, heavy person and a heavier, less lean one can share a
     weight and not a resting burn. */
  const bf = typeof p.bodyFat === "number" && p.bodyFat >= 5 && p.bodyFat <= 60 ? p.bodyFat : null;
  const mifflin = 10 * w + 6.25 * p.heightCm - 5 * ageOf(p) + (p.sex === "female" ? -161 : 5);
  const bmr = bf === null ? mifflin : 370 + 21.6 * (w * (1 - bf / 100));
  const method = bf === null ? "mifflin" : "katch";

  /* Everything you burn moving about an ordinary day, exercise excluded. */
  const mult = (ACTIVITY.find((a) => a.id === p.activity) || ACTIVITY[1]).mult;
  const living = bmr * (mult - 1);

  /* And exercise on top, averaged flat across the week. */
  const met = (EFFORT.find((e) => e.id === p.exEffort) || EFFORT[1]).met;
  const exDays = Math.max(0, Math.min(7, p.exDays || 0));
  const exMins = Math.max(0, Math.min(300, p.exMins || 0));
  const exercise = ((met - 1) * 3.5 * w / 200) * exMins * exDays / 7;

  const tdee = bmr + living + exercise;

  /* The deficit the chosen pace asks for, and the deficit actually applied
     once the floor has had its say. They differ for anyone whose pace would
     take them under it, and the app would rather be honest about that than
     quietly promise a rate it isn't delivering. */
  const wantDeficit = (p.weeklyLoss * KCAL_PER_KG) / 7;
  const floor = p.sex === "female" ? 1200 : 1500;
  const kcal = Math.max(floor, Math.round((tdee - wantDeficit) / 10) * 10);
  const deficit = Math.max(0, Math.round(tdee) - kcal);

  const protein = Math.round(w * 1.8), fat = Math.round(w * 0.8);
  /* Carbs take whatever calories protein and fat leave behind, converted to
     grams at 4 cal per gram, then rounded to the nearest 5. */
  const carbCals = kcal - protein * 4 - fat * 9;
  return {
    bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, protein, fat,
    /* The sum, kept so the app can show its working rather than just
       announcing a number and hoping it's believed. */
    /* Living is derived by subtraction rather than rounded on its own, so
       the three rows visibly add to the maintenance figure. Nothing erodes
       trust in a number like a column that doesn't sum. */
    method, exercise: Math.round(exercise),
    living: Math.round(tdee) - Math.round(bmr) - Math.round(exercise),
    maintain: Math.round(tdee), deficit,
    wantDeficit: Math.round(wantDeficit),
    atFloor: deficit < Math.round(wantDeficit) - 5,
    floor,
    /* What the applied deficit actually works out to per week, which is the
       chosen pace unless the floor clipped it. */
    weeklyKg: Math.round(((deficit * 7) / KCAL_PER_KG) * 100) / 100,
    carbs: Math.max(0, Math.round(carbCals / 4 / 5) * 5),
    /* Fibre: 14 g per 1,000 calories, the figure dietary guidelines use,
       with a sensible floor. Sugar: the WHO's suggested ceiling of 10% of
       calories. Fibre is a target to reach, sugar a limit to stay under. */
    fibre: Math.max(25, Math.round((14 * kcal) / 1000)),
    sugar: Math.round((kcal * 0.1) / 4 / 5) * 5,
  };
}

/* Every macro the app tracks, in one place, so nothing gets forgotten when
   a meal is scaled, rescaled, summed or repeated. */
const MACROS = ["protein", "carbs", "fat", "sugar", "fibre"];
const zeroBase = () => ({ kcal: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fibre: 0 });

const norm = (e) => {
  const b = e.base
    ? { ...zeroBase(), ...e.base }
    : { ...zeroBase(), kcal: e.kcal || 0, protein: e.protein || 0, carbs: e.carbs || 0, fat: e.fat || 0 };
  return { ...e, base: b, servings: e.servings || 1, ingredients: e.ingredients || [] };
};
const tot = (e) => {
  const n = norm(e), s = n.servings || 1, o = { kcal: Math.round(n.base.kcal * s) };
  MACROS.forEach((k) => { o[k] = Math.round((n.base[k] || 0) * s); });
  return o;
};

/* Calories implied by the macros. Fibre and sugar are components of the
   carbohydrate figure, not additions to it, so they never appear here. */
const kcalFromMacros = (b) =>
  Math.max(0, Math.round((b.protein || 0) * 4 + (b.carbs || 0) * 4 + (b.fat || 0) * 9));

/* When an ingredient is edited the meal total moves with it. Macros are held
   in the same ratio, which is the honest thing to do when we only know the
   calorie change and not which macro it came from. */
function rescaleTo(b, newKcal) {
  const k = Math.max(0, Math.round(newKcal));
  const old = b.kcal || 0;
  const out = { ...zeroBase(), ...b, kcal: k };
  if (old <= 0) return out;
  const r = k / old;
  MACROS.forEach((m) => { out[m] = Math.max(0, Math.round((b[m] || 0) * r)); });
  return out;
}

/* Adding or removing an ingredient whose own macros are known should move
   the meal by exactly those macros rather than scaling everything in
   proportion — proportional is only the fallback when all we have is a
   calorie figure. */
function shiftBy(b, m, sign) {
  const out = { ...zeroBase(), ...b };
  out.kcal = Math.max(0, Math.round((b.kcal || 0) + sign * (m.kcal || 0)));
  MACROS.forEach((k) => { out[k] = Math.max(0, Math.round((b[k] || 0) + sign * (m[k] || 0))); });
  return out;
}

/* ============================ api ============================ */

const PASS_KEY = "tally.pass";
const getPass = () => { try { return localStorage.getItem(PASS_KEY) || ""; } catch { return ""; } };
const setPass = (v) => { try { localStorage.setItem(PASS_KEY, v); } catch {} };

/* The rules that stop it inventing food that isn't on the plate. Sent as a
   system prompt rather than buried in the user turn — it is followed far
   more consistently there. */
/* The model has to be told which language to write in, or a Ukrainian
   screen fills up with English dish names and advice. This covers only the
   free-text fields — the JSON keys stay English so parsing is unaffected. */
const langRule = () =>
  LANG === "uk"
    ? ` Write every human-readable value — the dish name, the ingredient names, the portion descriptions, the basis, the note and the advice — in Ukrainian. Use Ukrainian food names as a Ukrainian speaker would say them. Keep the JSON keys themselves in English exactly as specified.`
    : "";

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
- "carbs" is TOTAL carbohydrate. "sugar" and "fibre" are both parts of that total, not additions to it, so each must be less than or equal to "carbs".
- "sugar" means total sugars — the ones naturally present in fruit, milk and vegetables as well as any added. "fibre" is dietary fibre.
- Where a food plainly has almost none of one of them, say 0 rather than padding the figure. Whole grains, pulses, vegetables and fruit skins carry the fibre; drinks, sauces, desserts and fruit carry the sugar.
- The per-ingredient calories must add up to within 5% of "kcal".
- "kcalLow" and "kcalHigh" are the honest range a careful dietitian would give for this photo. A tight range signals a clear read; a wide one signals a hard call.
- "confidence" is "high" only when the food is fully visible, unambiguous and has a clear scale reference. Otherwise "medium", or "low" when you are largely inferring.

Never comment on the person's body, never shame them, and never suggest skipping a meal to compensate.`;

async function askClaude(content, system) {
  const r = await fetch("/api/estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-tally-pass": getPass() },
    /* Appended per call rather than baked into SYSTEM, because the language
       can change between one estimate and the next. */
    body: JSON.stringify({ content, system: (system || SYSTEM) + langRule() }),
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
  `"fat":integer grams,"sugar":integer grams of total sugars,"fibre":integer grams of fibre,` +
  `"kcalLow":integer,"kcalHigh":integer,"confidence":"high"|"medium"|"low",` +
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

/* Colours are set through `style` rather than the `stroke` attribute:
   var() is not resolved inside SVG presentation attributes, which would
   have left every ring black the moment the palette moved to variables. */
function Ring({ size, stroke, pct, color, track = "var(--track)", children }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct || 0));
  return html`
    <div class="rw" style=${{ width: size + "px", height: size + "px" }}>
      <svg width=${size} height=${size} style="transform:rotate(-90deg)">
        <circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" style=${{ stroke: track }} stroke-width=${stroke} />
        <circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" style=${{ stroke: color }} stroke-width=${stroke}
          stroke-linecap="round" stroke-dasharray=${c} stroke-dashoffset=${c * (1 - p)} class="ringbar" />
      </svg>
      <div class="rm">${children}</div>
    </div>`;
}

/* ============================ confidence chip ============================ */

const CONF = {
  high: { bg: "var(--okBg)", fg: "var(--okFg)", key: "conf_high" },
  medium: { bg: "var(--warnBg)", fg: "var(--warnFg)", key: "conf_medium" },
  low: { bg: "var(--stopBg)", fg: "var(--stopFg)", key: "conf_low" },
  /* Not a model output — set when a meal is copied from an earlier day, so
     the chip doesn't claim a fresh reading it never made. */
  repeat: { bg: "var(--track)", fg: "var(--ink)", key: "conf_repeat" },
};

function Confidence({ level, low, high, servings = 1 }) {
  const c = CONF[level] || CONF.medium;
  const spread = low && high && high > low;
  return html`
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px">
      <span class="conf" style=${{ background: c.bg, color: c.fg }}>${t(c.key)}</span>
      ${spread && html`<span class="note" style="font-size:12px">
        ${t("conf_likely", { low: Math.round(low * servings), high: Math.round(high * servings) })}
      </span>`}
    </div>`;
}

/* ============================ carbs, in more detail ============================ */

/* Fibre and sugar are both carbohydrate, so they belong under the carb
   figure rather than beside it as if they were separate macros. Fibre is a
   target to reach, sugar a ceiling to stay under — the bars read in
   opposite directions on purpose. */
function CarbDetail({ sum, T }) {
  const fibre = Math.round(sum.fibre || 0), sugar = Math.round(sum.sugar || 0);
  const fibrePct = Math.min(1, fibre / Math.max(1, T.fibre));
  const sugarPct = Math.min(1, sugar / Math.max(1, T.sugar));
  const sugarOver = sugar > T.sugar;

  const row = (label, sub, val, target, pct, color) => html`
    <div class="owr">
      <div class="owl">
        <div class="owt">${label}</div>
        <div class="ows">${sub}</div>
        <div class="owbar"><i style=${{ width: pct * 100 + "%", background: color }}></i></div>
      </div>
      <div class="owv" style=${{ color }}>${val}<span style="color:var(--faint);font-size:12px">/${target}g</span></div>
    </div>`;

  return html`
    <div class="card">
      <div style="display:flex;align-items:baseline;justify-content:space-between">
        <div class="h">${t("carbs_h")}</div>
        <span class="note" style="font-size:11.5px">${t("carbs_total", { n: Math.round(sum.carbs || 0) })}</span>
      </div>
      ${row(t("ofwhich_fibre"), t("fibre_sub"), fibre, T.fibre, fibrePct, "var(--fibre)")}
      ${row(t("ofwhich_sugar"), t(sugarOver ? "sugar_over" : "sugar_sub"), sugar, T.sugar, sugarPct,
        sugarOver ? "var(--over)" : "var(--sugar)")}
      <div class="note" style="font-size:11.5px;margin-top:12px">${t("carbs_note")}</div>
    </div>`;
}

/* ============================ the numbers ============================ */

/* Typing a macro moves the calories with it, at 4 cal a gram for protein
   and carbs and 9 for fat. Correcting a weight on the label should never
   leave a meal claiming its old calorie count. The calorie box itself is
   still directly editable for anything that doesn't reconcile — alcohol,
   sugar alcohols, a figure read straight off a packet. */
function NumberGrid({ base, servings, onBase }) {
  const s = servings || 1;
  const FIELDS = ["kcal", "protein", "carbs", "fat", "sugar", "fibre"];

  const setField = (k, raw) => {
    const per = Math.max(0, Math.round((parseInt(raw || "0", 10) || 0) / s));
    const b = { ...zeroBase(), ...base, [k]: per };
    if (k === "carbs") { b.sugar = Math.min(b.sugar, per); b.fibre = Math.min(b.fibre, per); }
    if (k === "sugar" || k === "fibre") b[k] = Math.min(per, b.carbs || 0);
    if (k === "protein" || k === "carbs" || k === "fat") b.kcal = kcalFromMacros(b);
    onBase(b);
  };

  return html`
    <div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:10px">
        ${FIELDS.map((k) => html`
          <div key=${k}>
            <label class="lab">${t("m_" + (k === "kcal" ? "cal" : k))}${k === "kcal" ? "" : " (" + t("u_g") + ")"}</label>
            <input class="in" style="padding:12px 6px;border-radius:13px;text-align:center" type="number" inputmode="numeric"
              value=${Math.round((base[k] || 0) * s)} onInput=${(e) => setField(k, e.target.value)} />
          </div>`)}
      </div>
      <div class="note" style="font-size:11.5px;margin-top:7px">${t("num_note")}</div>
    </div>`;
}

/* ============================ editable ingredients ============================ */

/* "120 g" -> { amt: "120", unit: "g" }. Anything without a leading number
   (say "a good handful") keeps its text and simply loses the ability to
   scale, which is the honest outcome. */
const splitQty = (q) => {
  const m = /^\s*([\d]+(?:[.,]\d+)?)\s*(.*)$/.exec(q || "");
  return m ? { amt: m[1].replace(",", "."), unit: m[2].trim() } : { amt: "", unit: (q || "").trim() };
};
const joinQty = (amt, unit) =>
  [String(amt || "").trim(), String(unit || "").trim()].filter(Boolean).join(" ");

const ING_SYSTEM = () =>
  `You are a nutrition lookup inside a calorie tracker. You reply with JSON only — no prose, no markdown fences. ` +
  `Give figures for the exact amount asked for, not per 100 g and not per portion. ` +
  `Assume the food is prepared the ordinary way, including the oil or butter a kitchen would normally use. ` +
  `"carbs" is total carbohydrate; "sugar" and "fibre" are parts of it and must each be no greater than it. ` +
  `If the amount is vague, assume a normal household serving.`;

function IngredientList({ ings, base, servings, onChange, mealName, onNeedPass }) {
  const [edit, setEdit] = useState(-1);   // index being edited, -1 for none
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const list = ings || [];

  /* Scaling always works from the figures the editor opened with, so
     nudging the amount up and back down returns to where it started
     instead of drifting through rounding. */
  const mkDraft = (g) => {
    const q = splitQty(g.qty);
    const kcal = Math.max(0, Math.round(parseFloat(g.kcal) || 0));
    return { name: g.name || "", amt: q.amt, unit: q.unit, kcal: String(kcal),
      m: g.m || null, basisAmt: parseFloat(q.amt) || 0, basisKcal: kcal, basisM: g.m || null };
  };

  const open = (i) => { setErr(""); setAdding(false); setDraft(mkDraft(list[i])); setEdit(i); };
  const openNew = () => {
    setErr(""); setEdit(-1); setAdding(true);
    setDraft({ name: "", amt: "", unit: "", kcal: "", m: null, basisAmt: 0, basisKcal: 0, basisM: null });
  };
  const close = () => { setEdit(-1); setAdding(false); setDraft(null); setErr(""); setBusy(false); };

  /* The amount drives the calories. Change 100 g to 150 g and the calories,
     and every macro we know about, move with it. */
  const setAmt = (v) => {
    const n = parseFloat(v);
    if (!draft.basisAmt || !draft.basisKcal || !isFinite(n) || n <= 0) { setDraft({ ...draft, amt: v }); return; }
    const r = n / draft.basisAmt;
    const m = draft.basisM
      ? MACROS.reduce((a, k) => ({ ...a, [k]: Math.max(0, Math.round((draft.basisM[k] || 0) * r)) }), {})
      : null;
    setDraft({ ...draft, amt: v, kcal: String(Math.max(0, Math.round(draft.basisKcal * r))), m });
  };
  /* Typing a calorie figure by hand wins, and becomes the new basis. */
  const setKcal = (v) => {
    const k = Math.max(0, Math.round(parseFloat(v) || 0));
    setDraft({ ...draft, kcal: v, m: null, basisM: null, basisKcal: k, basisAmt: parseFloat(draft.amt) || 0 });
  };

  const rowOf = (d) => ({
    name: (d.name || "").trim() || "Item",
    qty: joinQty(d.amt, d.unit),
    kcal: Math.max(0, Math.round(parseFloat(d.kcal) || 0)),
    ...(d.m ? { m: d.m } : {}),
  });

  /* Where the ingredient's own macros are known the meal moves by exactly
     those; otherwise all we can honestly do is hold the macro ratio and
     shift the calories. */
  const applyRow = (nextList, removed, added) => {
    let b = base;
    if (removed) b = removed.m ? shiftBy(b, { kcal: removed.kcal, ...removed.m }, -1)
                               : rescaleTo(b, (b.kcal || 0) - (removed.kcal || 0));
    if (added) b = added.m ? shiftBy(b, { kcal: added.kcal, ...added.m }, 1)
                           : rescaleTo(b, (b.kcal || 0) + (added.kcal || 0));
    onChange({ ingredients: nextList, base: b });
    close();
  };

  const saveRow = () => {
    const row = rowOf(draft);
    if (adding) applyRow([...list, row], null, row);
    else applyRow(list.map((g, i) => (i === edit ? row : g)), list[edit], row);
  };
  const removeRow = () => applyRow(list.filter((_, i) => i !== edit), list[edit], null);

  /* Add "2 tbsp olive oil" with no number next to it and tally works the
     number out rather than logging it as nothing. */
  const lookup = async () => {
    if (!draft.name.trim()) return;
    setBusy(true); setErr("");
    try {
      const amount = joinQty(draft.amt, draft.unit) || "one normal serving";
      const p = await askClaude([{ type: "text", text:
        `How much energy and macronutrients are in ${amount} of "${draft.name.trim()}"` +
        (mealName ? `, as part of a dish described as "${mealName}"` : "") + `?\n\n` +
        `Reply with ONLY this JSON object:\n` +
        `{"kcal":integer,"protein":integer grams,"carbs":integer grams,"fat":integer grams,` +
        `"sugar":integer grams,"fibre":integer grams}` }], ING_SYSTEM());
      const kc = Math.max(0, Math.round(p.kcal || 0));
      const m = MACROS.reduce((a, k) => ({ ...a, [k]: Math.max(0, Math.round(p[k] || 0)) }), {});
      m.sugar = Math.min(m.sugar, m.carbs);
      m.fibre = Math.min(m.fibre, m.carbs);
      setDraft({ ...draft, kcal: String(kc), m, basisKcal: kc, basisM: m, basisAmt: parseFloat(draft.amt) || 0 });
    } catch (e) {
      if (e && e.auth) { onNeedPass && onNeedPass(); setErr(t("ing_err_pass")); }
      else setErr(t("ing_err"));
    }
    setBusy(false);
  };

  const editor = html`
    <div class="ined">
      <input class="in2" placeholder=${t("ing_name_ph")} value=${draft && draft.name} autofocus=${adding}
        onInput=${(ev) => setDraft({ ...draft, name: ev.target.value })} />
      <div style="display:flex;gap:8px;margin-top:8px">
        <input class="in2" style="flex:1;text-align:center" type="number" step="any" inputmode="decimal"
          placeholder=${t("ing_amt_ph")} value=${draft && draft.amt} onInput=${(ev) => setAmt(ev.target.value)} />
        <input class="in2" style="flex:1.1" placeholder=${t("ing_unit_ph")} value=${draft && draft.unit}
          onInput=${(ev) => setDraft({ ...draft, unit: ev.target.value })} />
        <input class="in2" style="flex:1;text-align:center" type="number" inputmode="numeric"
          placeholder=${t("ing_cal_ph")} value=${draft && draft.kcal} onInput=${(ev) => setKcal(ev.target.value)} />
      </div>

      <div class="note" style="font-size:11.5px;margin-top:8px">
        ${t(draft && draft.basisAmt > 0 && draft.basisKcal > 0 ? "ing_scales" : "ing_blank")}
      </div>

      ${draft && draft.m && html`
        <div class="note" style="font-size:11.5px;margin-top:5px">
          ${t("ing_breakdown", { p: draft.m.protein, c: draft.m.carbs, f: draft.m.fat, s: draft.m.sugar, fb: draft.m.fibre })}
        </div>`}

      ${err && html`<div class="err" style="margin-top:8px">${err}</div>`}

      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="mini" style="flex:1" disabled=${busy || !(draft && draft.name.trim())} onClick=${lookup}>
          ${busy ? html`<span class="spin"></span>${t("ing_looking")}` : t("ing_lookup")}
        </button>
        <button class="mini" style=${{ flex: 1, background: "var(--ink)", color: "var(--onInk)", borderColor: "var(--ink)" }}
          disabled=${busy} onClick=${saveRow}>${t(adding ? "ing_addit" : "ing_done")}</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        ${!adding && html`<button class="mini" style="flex:1;color:var(--over)" onClick=${removeRow}>${t("ing_remove")}</button>`}
        <button class="mini" style="flex:1" onClick=${close}>${t("ing_cancel")}</button>
      </div>
    </div>`;

  return html`
    <div style="margin-top:16px">
      <div style="display:flex;align-items:baseline;justify-content:space-between">
        <div class="lab" style="margin:0">${t("ing_h")}</div>
        <span class="note" style="font-size:11.5px">${t("ing_tap")}</span>
      </div>

      ${list.map((g, i) => edit === i && draft
        ? html`<div key=${"e" + i}>${editor}</div>`
        : html`
          <button class="ingb" key=${"r" + i} onClick=${() => open(i)}>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:14px">${g.name || t("ing_untitled")}</div>
              ${g.qty && html`<div class="note" style="font-size:12px">${g.qty}</div>`}
            </div>
            <div class="d" style="font-weight:700;font-size:14px">${Math.round((parseFloat(g.kcal) || 0) * servings)} ${t("u_cal")}</div>
            <span style="color:var(--faint2);font-size:15px">✎</span>
          </button>`)}

      ${adding && draft
        ? editor
        : html`<button class="addb" onClick=${openNew}>${t("ing_add")}</button>`}
    </div>`;
}

/* ============================ app ============================ */

export function App() {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState(DEFAULTS);
  const [days, setDays] = useState({});
  const [weights, setWeights] = useState([]);
  const [sel, setSel] = useState(todayKey());
  const [weekOff, setWeekOff] = useState(0);
  const [tab, setTab] = useState("home");
  const [sheet, setSheet] = useState(false);
  const [detail, setDetail] = useState(null);
  const [needPass, setNeedPass] = useState(false);

  useEffect(() => {
    (async () => {
      const d = await loadState();
      if (d) {
        /* Anyone with saved state was using tally before onboarding existed,
           so don't drag them back through it. */
        setProfile({ ...DEFAULTS, ...(d.profile || {}),
          lang: (d.profile && d.profile.lang) || detectLang(),
          onboarded: (d.profile && d.profile.onboarded) !== false });
        setDays(d.days || {});
        setWeights(d.weights || []);
      } else {
        setProfile((p) => ({ ...p, lang: detectLang() }));
      }
      setReady(true);
    })();
  }, []);

  /* Set during render rather than in an effect: an effect runs after the
     paint, which would show one frame in the old language every time. */
  setLang(profile.lang || "en");

  /* Keep the painted theme in step with the stored preference, and follow
     the phone if it flips to dark at sunset while the app is open. */
  useEffect(() => { applyTheme(profile.theme); }, [profile.theme]);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme(profile.theme);
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on));
  }, [profile.theme]);

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
    const tl = tot(e);
    const o = { kcal: a.kcal + tl.kcal };
    MACROS.forEach((k) => { o[k] = a[k] + tl[k]; });
    return o;
  }, { kcal: 0, ...MACROS.reduce((a, k) => ({ ...a, [k]: 0 }), {}) });
  const left = T.kcal - sum.kcal, over = left < 0;
  const dayTotal = (k) => (days[k] || []).reduce((a, e) => a + tot(e).kcal, 0);

  /* The strip is a seven-day window that slides a week at a time. Offset 0
     ends today; nothing beyond today is reachable. */
  const today = todayKey();
  const strip = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i - weekOff * 7);
    const k = todayKey(d);
    strip.push({ k, n: d.getDate(), future: k > today,
      l: d.toLocaleDateString(LOCALE(), { weekday: "short" }).slice(0, 3), tot: dayTotal(k) });
  }
  const fmtShort = (k) => new Date(k + "T00:00").toLocaleDateString(LOCALE(), { day: "numeric", month: "short" });
  const weekLabel = weekOff === 0 ? t("week_this")
    : fmtShort(strip[0].k) + " – " + fmtShort(strip[6].k);

  /* Meals from the last fortnight, newest first, for the repeat picker.
     Grouped by day so "yesterday's dinner" is one tap away. */
  const recentDays = [];
  for (let i = 1; i <= 14; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = todayKey(d);
    const list = (days[k] || []).map(norm);
    if (!list.length) continue;
    recentDays.push({
      k,
      label: i === 1 ? t("rep_yesterday")
        : d.toLocaleDateString(LOCALE(), { weekday: "long", day: "numeric", month: "short" }),
      meals: list,
    });
    if (recentDays.length >= 7) break;
  }

  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    if ((days[todayKey(d)] || []).length > 0) streak++;
    else if (i > 0) break;
  }

  /* A meal logged while looking at an earlier day belongs to that day. The
     clock time is kept so the ordering still reads naturally. */
  const stamp = (k) => {
    const now = new Date();
    if (k === todayKey()) return now.toISOString();
    const d = new Date(k + "T12:00:00");
    d.setHours(now.getHours(), now.getMinutes(), 0, 0);
    return d.toISOString();
  };
  const addMany = (list) => {
    if (!list.length) return;
    const stamped = list.map((e, i) => ({ ...e, id: Date.now() + i, at: stamp(sel) }));
    save({ days: { ...days, [sel]: [...(days[sel] || []), ...stamped] } });
    setSheet(false);
  };
  const addEntry = (e) => addMany([e]);
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

  if (!ready) return html`<div class="wrap" style="padding-top:60px"><span class="note">${t("loading")}</span></div>`;

  if (!profile.onboarded) {
    return html`<${Onboarding} lang=${profile.lang || "en"}
      onLang=${(l) => { setLang(l); setProfile((p) => ({ ...p, lang: l })); }}
      onDone=${(p, firstWeight) => {
        const w = [{ d: todayKey(), kg: firstWeight }];
        const full = { ...p, lang: profile.lang || "en", theme: profile.theme || "system" };
        setProfile(full); setWeights(w); setDays({});
        saveState({ profile: full, days: {}, weights: w });
      }} />`;
  }

  const liveDetail = detail ? entries.find((e) => e.id === detail) : null;

  const hr = new Date().getHours();
  const timeGreet = t(hr < 12 ? "greet_morning" : hr < 18 ? "greet_afternoon" : "greet_evening");
  const greeting = isBirthday(profile)
    ? (profile.name ? t("bday_named", { name: profile.name }) : t("bday"))
    : profile.name ? t("greet_named", { greet: timeGreet, name: profile.name }) : timeGreet;
  const isToday = sel === todayKey();
  const subline = !isToday
    ? t("sub_pastday", {
        date: new Date(sel + "T00:00").toLocaleDateString(LOCALE(), { weekday: "long", day: "numeric", month: "long" }),
        eaten: sum.kcal, target: T.kcal })
    : entries.length === 0
      ? t("sub_empty", { n: T.kcal })
      : over ? t("sub_over", { n: Math.abs(left) }) : t("sub_left", { n: left });

  return html`
    <div>
      <div class="wrap">
        <div class="top">
          <div class="brand">tally<span style="color:var(--lime)">.</span></div>
          <div class="streak">🔥 ${streak}</div>
        </div>

        ${tab === "home" && html`
          <div class="hello">${greeting}</div>
          <div class="hello-s">${subline}</div>

          <div class="wknav">
            <button class="wkarrow" onClick=${() => setWeekOff(weekOff + 1)} aria-label=${t("week_prev")}>‹</button>
            <button class="wklab" data-back=${weekOff === 0 ? "0" : "1"}
              onClick=${() => { setWeekOff(0); setSel(todayKey()); }}>
              ${weekLabel}${weekOff === 0 ? "" : " · " + t("week_return")}
            </button>
            <button class="wkarrow" onClick=${() => setWeekOff(Math.max(0, weekOff - 1))}
              disabled=${weekOff === 0} aria-label=${t("week_next")}>›</button>
          </div>

          <div class="strip">
            ${strip.map((d) => html`
              <button key=${d.k} class="day" data-on=${sel === d.k ? "1" : "0"} disabled=${d.future}
                onClick=${() => !d.future && setSel(d.k)}>
                <div class="day-l">${d.l}</div>
                <div style="display:flex;justify-content:center;margin-top:4px">
                  <${Ring} size=${34} stroke=${3} pct=${d.tot / T.kcal}
                    color=${d.tot === 0 ? "transparent" : d.tot > T.kcal ? "var(--over)" : "var(--lime)"}
                    track=${sel === d.k ? "rgba(127,127,127,.35)" : "var(--track2)"}>
                    <span class="d" style=${{ fontWeight: 700, fontSize: "13px", color: sel === d.k ? "var(--onInk)" : "var(--ink)" }}>${d.n}</span>
                  <//>
                </div>
              </button>`)}
          </div>

          <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:14px">
            <div>
              <div class="d" style=${{ fontWeight: 800, fontSize: "42px", lineHeight: 1, color: over ? "var(--over)" : null }}>
                ${sum.kcal}<span style="font-size:21px;color:var(--faint)">/${T.kcal}</span>
              </div>
              <div class="note" style="margin-top:7px;font-weight:500">${t("cal_eaten")}</div>
              <div class="note" style="font-size:12px;margin-top:2px">
                ${over ? t("cal_over", { n: Math.abs(left) }) : t("cal_left", { n: left })}
              </div>
            </div>
            <${Ring} size=${92} stroke=${9} pct=${sum.kcal / T.kcal} color=${over ? "var(--over)" : "var(--ink)"}>
              <span style="font-size:22px">🔥</span>
            <//>
          </div>

          <div class="macros">
            ${[["m_protein", sum.protein, T.protein, "var(--pro)", "🍗"],
               ["m_carbs", sum.carbs, T.carbs, "var(--carbc)", "🌾"],
               ["m_fat", sum.fat, T.fat, "var(--fatc)", "🥑"]].map(([n, v, tg, c, ic]) => html`
              <div class="macro" key=${n}>
                <div class="macro-n">${Math.round(v)}<span style="color:var(--faint);font-weight:600">/${tg}${t("u_g")}</span></div>
                <div class="macro-l">${t("macro_eaten", { name: t(n) })}</div>
                <div style="display:flex;justify-content:center;margin-top:9px">
                  <${Ring} size=${54} stroke=${6} pct=${v / tg} color=${c}><span style="font-size:16px">${ic}</span><//>
                </div>
              </div>`)}
          </div>

          <${CarbDetail} sum=${sum} T=${T} />

          <div style="margin-top:24px;display:flex;align-items:baseline;justify-content:space-between">
            <div class="h">${t("recent_h")}</div>
            <span class="note">${entries.length}</span>
          </div>

          ${entries.length === 0
            ? html`<div class="card empty">
                <div style="font-size:30px">🥑</div>
                <div style="margin-top:10px;font-weight:600;color:var(--ink)">${t("empty_h")}</div>
                <div class="note" style="margin-top:5px">${t("empty_s")}</div>
              </div>`
            : entries.map((e) => {
                const tl = tot(e);
                return html`
                  <button class="meal" key=${e.id} onClick=${() => setDetail(e.id)}>
                    ${e.thumb
                      ? html`<img src=${e.thumb} alt="" class="thumb" />`
                      : html`<div class="thumb thumb-ph">${SLOT_ICON[e.slot] || "🍽️"}</div>`}
                    <div style="flex:1;min-width:0">
                      <div class="meal-n">${e.name}${(e.servings || 1) !== 1 ? " ×" + e.servings : ""}</div>
                      <div class="tags">
                        <span class="tag">🔥 ${tl.kcal}</span>
                        <span class="tag"><i class="tagdot" style="background:var(--pro)"></i>${tl.protein}${t("u_g")}</span>
                        <span class="tag"><i class="tagdot" style="background:var(--carbc)"></i>${tl.carbs}${t("u_g")}</span>
                        <span class="tag"><i class="tagdot" style="background:var(--fatc)"></i>${tl.fat}${t("u_g")}</span>
                      </div>
                      <div class="note" style="font-size:11.5px;margin-top:5px">
                        ${t("slot_" + e.slot)} · ${new Date(e.at).toLocaleTimeString(LOCALE(), { hour: "numeric", minute: "2-digit" })}
                      </div>
                    </div>
                    <span style="color:var(--faint2);font-size:20px">›</span>
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
          onWipe=${() => {
            /* Erasing the food log shouldn't hand someone back a white screen
               on a dark phone, so the theme survives. */
            const fresh = { ...DEFAULTS, onboarded: false, theme: profile.theme, lang: profile.lang };
            saveState({ profile: fresh, days: {}, weights: [] });
            setDays({}); setWeights([]); setProfile(fresh);
          }} />`}
      </div>

      <div class="nav">
        <div class="navin">
          <div class="navpill">
            <button class="navbtn" data-on=${tab === "home" ? "1" : "0"} onClick=${() => setTab("home")}><span style="font-size:17px">⌂</span>${t("nav_home")}</button>
            <button class="navbtn" data-on=${tab === "progress" ? "1" : "0"} onClick=${() => setTab("progress")}><span style="font-size:17px">◪</span>${t("nav_progress")}</button>
            <button class="navbtn" data-on=${tab === "profile" ? "1" : "0"} onClick=${() => setTab("profile")}><span style="font-size:17px">☺</span>${t("nav_profile")}</button>
          </div>
          <button class="fab" onClick=${() => { setTab("home"); setSheet(true); }} aria-label=${t("aria_add")}>+</button>
        </div>
      </div>

      ${sheet && html`<${LogSheet} onClose=${() => setSheet(false)} onAdd=${addEntry} onAddMany=${addMany}
        eaten=${sum.kcal} budget=${T.kcal} proteinLeft=${Math.max(0, T.protein - sum.protein)}
        recentDays=${recentDays} forDay=${isToday ? "" : new Date(sel + "T00:00").toLocaleDateString(LOCALE(), { weekday: "long", day: "numeric", month: "long" })}
        onNeedPass=${() => setNeedPass(true)} />`}

      ${liveDetail && html`<${MealDetail} e=${liveDetail} onClose=${() => setDetail(null)}
        onPatch=${(p) => patchEntry(liveDetail.id, p)} onDelete=${() => delEntry(liveDetail.id)}
        onNeedPass=${() => setNeedPass(true)} />`}

      ${needPass && html`<${PassSheet} onClose=${() => setNeedPass(false)} />`}
    </div>`;
}

/* ======================= where the number comes from ======================= */

/* Shown identically in onboarding and in the profile. A calorie target is
   a number somebody is going to be told to live inside for months, and one
   that arrives with no working shown is either taken on blind faith or, more
   often, quietly ignored. This is the arithmetic, line by line. */
function PlanBreakdown({ T, p, weight }) {
  const w = weight || p.startWeight;
  const q = migrateActivity(p);
  const act = ACTIVITY.find((a) => a.id === q.activity) || ACTIVITY[1];
  const eff = EFFORT.find((e) => e.id === q.exEffort) || EFFORT[1];
  const exDays = Math.max(0, Math.min(7, q.exDays || 0));

  /* Time to goal, from the deficit actually being applied rather than the
     one that was asked for. Weight loss is never this linear, hence "about". */
  const toLose = w - (q.goalWeight || w);
  const weeks = T.deficit > 0 && toLose > 0
    ? Math.round((toLose * KCAL_PER_KG) / (T.deficit * 7))
    : null;
  const when = weeks
    ? new Date(Date.now() + weeks * 7 * 86400000)
        .toLocaleDateString(LOCALE(), { month: "long", year: "numeric" })
    : null;

  const Row = (label, sub, value, attrs = {}) => html`
    <div class="calcr" ...${attrs}>
      <div>
        <div class="calcl">${label}</div>
        ${sub && html`<div class="calcsub">${sub}</div>`}
      </div>
      <div class="calcv">${value}</div>
    </div>`;

  return html`
    <div class="card">
      <div class="h">${t("plan_how_h")}</div>
      <div class="calc" style="margin-top:10px">
        ${Row(t("calc_rest"), t(T.method === "katch" ? "calc_rest_katch" : "calc_rest_mifflin"),
          num(T.bmr))}
        ${Row(t("calc_living"), t(act.key), "+" + num(T.living))}
        ${Row(t("calc_ex"),
          exDays > 0
            ? t("calc_ex_s", { days: exDays + " " + tp("calc_sessions", exDays), mins: q.exMins, effort: t(eff.key).toLowerCase() })
            : t("calc_ex_none"),
          "+" + num(T.exercise))}
        ${Row(t("calc_maintain", { kg: kgs(w) }), t("calc_maintain_s"),
          num(T.maintain), { "data-rule": "1", "data-sum": "1" })}
        ${Row(t("calc_deficit", { pace: kgs(q.weeklyLoss) }),
          t("calc_deficit_s", {
            pace: kgs(q.weeklyLoss),
            n: num(T.deficit) + " " + t("u_cal"),
          }),
          "−" + num(T.deficit))}
        ${Row(t("calc_target"), null, num(T.kcal),
          { "data-rule": "1", "data-sum": "1", "data-final": "1" })}
      </div>

      ${weeks && when && html`
        <div class="note" style="margin-top:12px">
          ${t("calc_reach", { goal: kgs(q.goalWeight), n: weeks + " " + tp("weeksw", weeks), date: when })}
        </div>`}

      ${T.atFloor && html`
        <div class="warn">
          ${t("calc_floor", {
            want: num(T.wantDeficit), floor: num(T.floor), got: num(T.deficit),
            kg: kgs(T.weeklyKg),
          })}
        </div>`}

      <div class="note" style="margin-top:12px;font-size:12px">${t("calc_note")}</div>
    </div>`;
}

/* ============================ onboarding ============================ */

function Onboarding({ onDone, lang, onLang }) {
  const [i, setI] = useState(0);
  const [f, setF] = useState({
    name: "", dob: "", sex: "male", heightCm: "", weight: "", goalWeight: "",
    activity: "light", exDays: 0, exMins: 45, exEffort: "moderate", bodyFat: "",
    weeklyLoss: 0.5, pass: "",
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  /* A date of birth rather than an age, so the number stays right without
     anyone having to remember to update it. */
  const age = ageFromDob(f.dob);
  const cm = parseFloat(f.heightCm);
  const kg = parseFloat(f.weight);
  const goal = parseFloat(f.goalWeight);

  const tooYoung = age !== null && age < 18;
  const floorKg = isFinite(cm) && cm > 0 ? minHealthyKg(cm) : null;
  const goalTooLow = isFinite(goal) && floorKg !== null && goal < floorKg;
  const goalNotLower = isFinite(goal) && isFinite(kg) && goal >= kg;
  const alreadyLean = isFinite(kg) && isFinite(cm) && bmiOf(kg, cm) < 18.5;

  /* Blank is a valid answer here; a number outside the plausible range is
     not, and is treated as blank rather than quietly skewing the equation. */
  const bfRaw = parseFloat(f.bodyFat);
  const bodyFat = isFinite(bfRaw) && bfRaw >= 5 && bfRaw <= 60 ? bfRaw : null;
  const bfBad = f.bodyFat !== "" && bodyFat === null;

  const okStep = [
    () => f.name.trim().length > 0,
    () => age !== null && age >= 18 && age <= 100 && isFinite(cm) && cm >= 120 && cm <= 230,
    () => isFinite(kg) && kg >= 35 && kg <= 250 && isFinite(goal) && goal >= 35 && goal <= 250 && !goalNotLower && !bfBad,
    () => true,
    () => true,
    () => true,
  ][i]();

  const draft = {
    ...DEFAULTS, onboarded: true, name: f.name.trim(), dob: f.dob, age: age || 30,
    sex: f.sex, heightCm: Math.round(cm),
    startWeight: kg, goalWeight: goal, stretchWeight: Math.max(floorKg || 0, Math.round((goal - 2.5) * 10) / 10),
    activity: f.activity, weeklyLoss: f.weeklyLoss,
    exDays: f.exDays, exMins: f.exMins, exEffort: f.exEffort, bodyFat,
  };
  const T = i === 5 ? deriveTargets(draft, kg) : null;

  const finish = () => {
    if (f.pass.trim()) setPass(f.pass.trim());
    onDone(draft, kg);
  };

  const Head = (t, s) => html`<div><div class="obh">${t}</div><div class="obs">${s}</div></div>`;

  return html`
    <div class="ob">
      <div class="dots">
        ${[0, 1, 2, 3, 4, 5].map((n) => html`<div class="dot" key=${n} data-on=${n <= i ? "1" : "0"}></div>`)}
      </div>

      <div style="flex:1">
        ${i === 0 && html`
          <div>
            <div class="seg" style="margin-bottom:20px">
              ${LANGS.map((l) => html`
                <button class="segb" key=${l.id} data-on=${lang === l.id ? "1" : "0"}
                  onClick=${() => onLang && onLang(l.id)}>${l.label}</button>`)}
            </div>
            ${Head(t("ob_welcome_h"), t("ob_welcome_s"))}
            <div style="margin-top:22px">
              <label class="lab">${t("ob_name_l")}</label>
              <input class="in" autofocus placeholder=${t("ob_name_ph")} value=${f.name} onInput=${set("name")} />
            </div>
            <div class="obs" style="font-size:12.5px;margin-top:18px">${t("ob_private")}</div>
          </div>`}

        ${i === 1 && html`
          <div>
            ${Head(t("ob_about_h"), t("ob_about_s"))}
            <div style="margin-top:20px">
              <label class="lab">${t("ob_dob_l")}</label>
              <input class="in" type="date" value=${f.dob} onInput=${set("dob")}
                max=${todayKey()} min="1920-01-01" />
              <div class="note" style="font-size:12px;margin-top:6px">
                ${age === null ? t("ob_dob_note") : t("ob_dob_age", { age })}
              </div>
            </div>
            <div style="margin-top:16px">
              <label class="lab">${t("ob_height_l")}</label>
              <input class="in" type="number" inputmode="numeric" placeholder="166" value=${f.heightCm} onInput=${set("heightCm")} />
            </div>
            <div style="margin-top:16px">
              <label class="lab">${t("ob_sex_l")}</label>
              ${[["male", "ob_male"], ["female", "ob_female"]].map(([v, l]) => html`
                <button class="opt" key=${v} data-on=${f.sex === v ? "1" : "0"} onClick=${() => setF({ ...f, sex: v })}>${t(l)}</button>`)}
            </div>
            ${tooYoung && html`
              <div class="stop">
                <strong>${t("ob_young_h")}</strong><br />${t("ob_young_s")}
              </div>`}
          </div>`}

        ${i === 2 && html`
          <div>
            ${Head(t("ob_weight_h"), t("ob_weight_s"))}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:20px">
              <div>
                <label class="lab">${t("ob_now_l")}</label>
                <input class="in" type="number" step="0.1" inputmode="decimal" placeholder="72.5" value=${f.weight} onInput=${set("weight")} />
              </div>
              <div>
                <label class="lab">${t("ob_goal_l")}</label>
                <input class="in" type="number" step="0.5" inputmode="decimal" placeholder="69" value=${f.goalWeight} onInput=${set("goalWeight")} />
              </div>
            </div>
            ${goalNotLower && html`<div class="warn">${t("ob_goal_high")}</div>`}
            ${alreadyLean && !goalNotLower && html`
              <div class="warn">${t("ob_lean")}</div>`}
            ${goalTooLow && !goalNotLower && !alreadyLean && html`
              <div class="warn">
                ${t("ob_goal_low", { goal, cm: Math.round(cm), floor: floorKg })}
              </div>`}
            <div style="margin-top:20px">
              <label class="lab">${t("ob_bf_l")}</label>
              <input class="in" type="number" step="0.5" inputmode="decimal"
                placeholder=${t("ob_bf_ph")} value=${f.bodyFat} onInput=${set("bodyFat")} />
              <div class="obs" style="font-size:12.5px;margin-top:8px">${t("ob_bf_note")}</div>
              ${bfBad && html`<div class="err">${t("ob_bf_range")}</div>`}
            </div>
          </div>`}

        ${i === 3 && html`
          <div>
            ${Head(t("ob_move_h"), t("ob_move_s"))}
            <div style="margin-top:18px">
              ${ACTIVITY.map((a) => html`
                <button class="opt" key=${a.id} data-on=${f.activity === a.id ? "1" : "0"}
                  onClick=${() => setF({ ...f, activity: a.id })}>${t(a.key)}</button>`)}
            </div>
          </div>`}

        ${i === 4 && html`
          <div>
            ${Head(t("ob_ex_h"), t("ob_ex_s"))}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:20px">
              <div>
                <label class="lab">${t("ob_ex_days_l")}</label>
                <select class="in" value=${String(f.exDays)}
                  onChange=${(e) => setF({ ...f, exDays: parseInt(e.target.value, 10) })}>
                  ${[0, 1, 2, 3, 4, 5, 6, 7].map((n) => html`<option key=${n} value=${n}>${n}</option>`)}
                </select>
              </div>
              <div>
                <label class="lab">${t("ob_ex_mins_l")}</label>
                <select class="in" value=${String(f.exMins)} disabled=${f.exDays === 0}
                  onChange=${(e) => setF({ ...f, exMins: parseInt(e.target.value, 10) })}>
                  ${[15, 30, 45, 60, 75, 90, 120].map((n) => html`<option key=${n} value=${n}>${n}</option>`)}
                </select>
              </div>
            </div>
            ${f.exDays === 0
              ? html`<div class="note" style="margin-top:14px">${t("ob_ex_none")}</div>`
              : html`
                <div style="margin-top:20px">
                  <label class="lab">${t("ob_ex_effort_l")}</label>
                  ${EFFORT.map((e) => html`
                    <button class="opt" key=${e.id} data-on=${f.exEffort === e.id ? "1" : "0"}
                      onClick=${() => setF({ ...f, exEffort: e.id })}>${t(e.key)}</button>`)}
                </div>`}
            <div style="margin-top:22px">
              <label class="lab">${t("ob_pace_l")}</label>
              ${[[0.25, "ob_pace_25"], [0.5, "ob_pace_50"], [0.75, "ob_pace_75"]].map(([v, l]) => html`
                <button class="opt" key=${v} data-on=${f.weeklyLoss === v ? "1" : "0"}
                  onClick=${() => setF({ ...f, weeklyLoss: v })}>${t(l)}</button>`)}
            </div>
          </div>`}

        ${i === 5 && T && html`
          <div>
            ${Head(t("ob_plan_h"), t("ob_plan_s"))}
            <div style="margin-top:4px">
              <${PlanBreakdown} T=${T} p=${draft} weight=${kg} />
            </div>
            <div class="card">
              <div class="h">${t("pf_numbers_h")}</div>
              <div style="margin-top:10px">
                ${[[t("m_protein"), T.protein + " " + t("u_g")], [t("m_fat"), T.fat + " " + t("u_g")],
                   [t("m_carbs"), T.carbs + " " + t("u_g")], [t("plan_fibre"), T.fibre + " " + t("u_g")],
                   [t("plan_sugar"), T.sugar + " " + t("u_g")]].map(([k, v], n) => html`
                  <div key=${k} style=${{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
                    padding: "11px 0", borderBottom: n === 4 ? "none" : "1px solid var(--hair)" }}>
                    <span class="note" style="font-weight:500">${k}</span>
                    <span class="d" style=${{ fontWeight: 700, fontSize: "16px", opacity: n > 2 ? .75 : 1 }}>${v}</span>
                  </div>`)}
              </div>
              <div class="note" style="margin-top:12px">${t("pf_numbers_note", { floor: num(T.floor) })}</div>
            </div>
            <div style="margin-top:18px">
              <label class="lab">${t("ob_code_l")}</label>
              <input class="in" type="password" placeholder=${t("ob_code_ph")} value=${f.pass} onInput=${set("pass")} />
              <div class="obs" style="font-size:12.5px;margin-top:8px">${t("ob_code_note")}</div>
            </div>
            <div class="obs" style="font-size:12.5px;margin-top:16px">${t("ob_medical")}</div>
          </div>`}
      </div>

      <div style="display:flex;gap:9px;margin-top:26px">
        ${i > 0 && html`<button class="b b2" style="width:auto;padding:15px 22px" onClick=${() => setI(i - 1)}>${t("ob_back")}</button>`}
        ${i < 5
          ? html`<button class="b" onClick=${() => setI(i + 1)} disabled=${!okStep || tooYoung}>${t("ob_continue")}</button>`
          : html`<button class="b b3" onClick=${finish}>${t("ob_start")}</button>`}
      </div>
    </div>`;
}

/* ============================ passcode ============================ */

function PassSheet({ onClose }) {
  const ref = useRef(null);
  return html`
    <div class="scrim" onClick=${onClose}>
      <div class="sheet" onClick=${(e) => e.stopPropagation()}>
        <div class="grab"></div>
        <div class="h">${t("pass_h")}</div>
        <div class="note" style="margin-top:8px">${t("pass_note")}</div>
        <input class="in" style="margin-top:14px" type="password" ref=${ref} autofocus
          onKeyDown=${(e) => { if (e.key === "Enter") { setPass(e.target.value.trim()); onClose(); } }} />
        <button class="b" style="margin-top:10px"
          onClick=${() => { if (ref.current) setPass(ref.current.value.trim()); onClose(); }}>${t("pass_save")}</button>
      </div>
    </div>`;
}

/* ============================ log sheet ============================ */

function LogSheet({ onClose, onAdd, onAddMany, eaten, budget, proteinLeft, recentDays, forDay, onNeedPass }) {
  const guess = () => { const h = new Date().getHours(); return h < 11 ? "Breakfast" : h < 16 ? "Lunch" : h < 22 ? "Dinner" : "Snack"; };
  const [typing, setTyping] = useState(false);
  const [isLabel, setIsLabel] = useState(false);
  const [repeating, setRepeating] = useState(false);
  const [slot, setSlot] = useState(guess);
  const [text, setText] = useState("");
  const [img, setImg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [base, setBase] = useState(null);
  const [servings, setServings] = useState(1);
  const camRef = useRef(null);
  const galRef = useRef(null);

  const m = base && MACROS.reduce(
    (a, k) => ({ ...a, [k]: Math.round((base[k] || 0) * servings) }),
    { kcal: Math.round(base.kcal * servings) });

  const pick = async (file) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) { setErr(t("log_notimage")); return; }
    setErr("");
    try {
      const full = await shrink(file, 1100, 0.82);
      const thumb = await shrink(file, 320, 0.6);
      const p = dataUrlParts(full);
      setImg({ b64: p.b64, media: p.media, url: full, thumb });
    } catch { setErr(t("log_badphoto")); }
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
      const carbs = Math.max(0, Math.round(p.carbs || 0));
      setBase({
        name: p.name || t("meal_default"),
        kcal: kc, protein: Math.max(0, Math.round(p.protein || 0)),
        carbs, fat: Math.max(0, Math.round(p.fat || 0)),
        /* Sugar and fibre are parts of the carb figure, so neither can
           exceed it however the model phrased its answer. */
        sugar: Math.min(carbs, Math.max(0, Math.round(p.sugar || 0))),
        fibre: Math.min(carbs, Math.max(0, Math.round(p.fibre || 0))),
        kcalLow: Math.max(0, Math.round(p.kcalLow || kc)), kcalHigh: Math.max(0, Math.round(p.kcalHigh || kc)),
        confidence: CONF[p.confidence] ? p.confidence : "medium",
        basis: p.basis || "",
        ingredients: Array.isArray(p.ingredients) ? p.ingredients.slice(0, 8) : [],
        note: p.note || "", advice: p.advice || "",
      });
    } catch (e) {
      if (e && e.auth) { onNeedPass(); setErr(t("log_err_pass")); }
      else setErr(t("log_err"));
      setBase({ name: text.trim() || t("meal_default"), kcal: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fibre: 0,
        kcalLow: 0, kcalHigh: 0, confidence: "low", basis: "", ingredients: [], note: "", advice: "" });
    }
    setBusy(false);
  };

  const projected = eaten + (m ? m.kcal : 0), after = budget - projected;
  const key = after >= 150 ? "fits" : after >= 0 ? "tight" : "over";
  const V = {
    fits: { bg: "var(--okBg)", fg: "var(--okFg)", ac: "var(--okAc)", head: t("v_fits") },
    tight: { bg: "var(--warnBg)", fg: "var(--warnFg)", ac: "var(--warnAc)", head: t("v_tight") },
    over: { bg: "var(--stopBg)", fg: "var(--stopFg)", ac: "var(--stopAc)", head: t("v_over") },
  }[key];
  const max = Math.max(budget, projected);

  const reset = () => {
    setBase(null); setImg(null); setText(""); setTyping(false);
    setIsLabel(false); setRepeating(false); setErr("");
  };

  /* Bring an earlier meal back exactly as it was logged, photo included,
     and drop it into the review screen so the portion can still be
     adjusted before it goes in. */
  const repeat = (e) => {
    const n = norm(e), p = dataUrlParts(n.thumb);
    if (n.thumb) setImg({ thumb: n.thumb, url: n.thumb, b64: p ? p.b64 : null, media: p ? p.media : null });
    setSlot(n.slot || guess());
    setServings(n.servings || 1);
    setBase({
      name: n.name, ...n.base,
      kcalLow: n.base.kcal, kcalHigh: n.base.kcal, confidence: "repeat",
      basis: "", ingredients: n.ingredients || [], note: n.note || "",
      advice: "", repeated: true,
    });
    setRepeating(false);
  };

  const repeatAll = (meals) => onAddMany(meals.map((e) => {
    const n = norm(e);
    return { name: n.name, slot: n.slot, servings: n.servings, base: n.base,
      ingredients: n.ingredients || [], note: n.note || "", thumb: n.thumb || null };
  }));

  const hasRecent = (recentDays || []).length > 0;

  return html`
    <div class="scrim" onClick=${onClose}>
      <div class="sheet" onClick=${(e) => e.stopPropagation()}>
        <div class="grab"></div>

        <input ref=${camRef} type="file" accept="image/*" capture="environment" style="display:none"
          onChange=${(e) => { pick(e.target.files && e.target.files[0]); e.target.value = ""; }} />
        <input ref=${galRef} type="file" accept="image/*" style="display:none"
          onChange=${(e) => { pick(e.target.files && e.target.files[0]); e.target.value = ""; }} />

        ${!m && repeating && html`
          <div>
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">
              <div class="h">${t("rep_h")}</div>
              <button class="x" style="width:auto;padding:0 10px;border-radius:999px" onClick=${() => setRepeating(false)}>${t("rep_back")}</button>
            </div>
            <div class="note" style="margin-top:6px">
              ${t("rep_note")}
            </div>

            ${(recentDays || []).map((d) => html`
              <div key=${d.k}>
                <div class="repd">
                  <span>${d.label}</span>
                  <button class="repall" onClick=${() => repeatAll(d.meals)}>${t("rep_all", { n: d.meals.length })}</button>
                </div>
                ${d.meals.map((e) => {
                  const tt = tot(e);
                  return html`
                    <button class="repb" key=${e.id} onClick=${() => repeat(e)}>
                      ${e.thumb
                        ? html`<img src=${e.thumb} alt="" class="rept" />`
                        : html`<div class="rept rept-ph">${SLOT_ICON[e.slot] || "🍽️"}</div>`}
                      <div style="flex:1;min-width:0">
                        <div style="font-weight:600;font-size:14px;line-height:1.25">${e.name}</div>
                        <div class="note" style="font-size:11.5px;margin-top:3px">${t("slot_" + e.slot)} · ${tt.kcal} ${t("u_cal")}</div>
                      </div>
                      <span style="color:var(--faint2);font-size:18px">＋</span>
                    </button>`;
                })}
              </div>`)}
          </div>`}

        ${!m && !repeating && html`
          <div>
            <div class="h">${t("log_h")}</div>
            ${forDay && html`<div class="note" style="margin-top:6px">${t("log_forday", { day: forDay })}</div>`}

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
                    <div><div class="bigb-t">${t("log_snap_t")}</div><div class="bigb-s">${t("log_snap_s")}</div></div>
                  </button>
                  <button class="bigb" onClick=${() => galRef.current && galRef.current.click()}>
                    <div class="bigb-i">🖼️</div>
                    <div><div class="bigb-t">${t("log_pick_t")}</div><div class="bigb-s">${t("log_pick_s")}</div></div>
                  </button>
                  ${!typing && html`
                    <button class="bigb" onClick=${() => setTyping(true)}>
                      <div class="bigb-i">✏️</div>
                      <div><div class="bigb-t">${t("log_type_t")}</div><div class="bigb-s">${t("log_type_s")}</div></div>
                    </button>`}
                  ${hasRecent && html`
                    <button class="bigb" onClick=${() => setRepeating(true)}>
                      <div class="bigb-i">↺</div>
                      <div>
                        <div class="bigb-t">${t("log_again_t")}</div>
                        <div class="bigb-s">${t("log_again_s")}</div>
                      </div>
                    </button>`}
                </div>`}

            ${(img || typing) && html`
              <input class="in" style="margin-top:11px" autofocus=${typing && !img}
                placeholder=${t(isLabel ? "log_ph_label" : img ? "log_ph_photo" : "log_ph_text")}
                value=${text} onInput=${(e) => setText(e.target.value)}
                onKeyDown=${(e) => { if (e.key === "Enter" && !busy) run(); }} />`}

            ${img && html`
              <div style="display:flex;gap:6px;margin-top:10px">
                <button class="pill" data-on=${!isLabel ? "1" : "0"} onClick=${() => setIsLabel(false)}>${t("log_isfood")}</button>
                <button class="pill" data-on=${isLabel ? "1" : "0"} onClick=${() => setIsLabel(true)}>${t("log_islabel")}</button>
              </div>`}

            ${(img || typing) && html`
              <button class="b" style="margin-top:11px" onClick=${run} disabled=${busy || (!img && !text.trim())}>
                ${busy ? html`<span class="spin"></span>${t("log_running")}` : t("log_run")}
              </button>`}

            ${err && html`<div class="err">${err}</div>`}
          </div>`}

        ${m && html`
          <div>
            <div class="verdict" style=${{ background: V.bg, color: V.fg, marginTop: 0 }}>
              <div class="vhead">${V.head}${key === "over" ? t("v_over_by", { n: Math.abs(after) }) : ""}</div>
              <div class="vsub">
                ${t("v_line", { name: base.name })} <strong>${m.kcal} ${t("u_cal")}</strong>.
                ${t("v_line2", { done: projected, budget })}${after >= 0 ? t("v_left", { n: after }) : t("v_stop")}
              </div>
              <div class="track">
                <div style=${{ width: (eaten / max) * 100 + "%", background: V.ac, opacity: .4 }}></div>
                <div style=${{ width: (m.kcal / max) * 100 + "%", background: V.ac }}></div>
                <div class="mark" style=${{ left: (budget / max) * 100 + "%" }}></div>
              </div>
              ${base.advice && html`<div class="vsub">${base.advice}</div>`}
              ${proteinLeft > 0 && m.protein >= proteinLeft * 0.4 && html`<div class="vsub">${t("v_protein", { n: m.protein, need: proteinLeft })}</div>`}
            </div>

            <${Confidence} level=${base.confidence} low=${base.kcalLow} high=${base.kcalHigh} servings=${servings} />
            ${base.basis && html`<div class="note" style="font-size:12px;margin-top:6px">${t("v_basis", { basis: base.basis })}</div>`}

            <div style="margin-top:15px;display:flex;gap:10px;align-items:center">
              ${img && html`<img src=${img.thumb} alt="" style="width:52px;height:52px;border-radius:15px;object-fit:cover;flex:none" />`}
              <input class="in" style="flex:1;min-width:0" value=${base.name} onInput=${(e) => setBase({ ...base, name: e.target.value })} />
              <div class="step">
                <button class="stepb" onClick=${() => setServings((s) => Math.max(0.25, Math.round((s - 0.25) * 100) / 100))} disabled=${servings <= 0.25}>−</button>
                <span class="stepv">${servings}</span>
                <button class="stepb" onClick=${() => setServings((s) => Math.min(10, s + 0.25))}>+</button>
              </div>
            </div>

            <${NumberGrid} base=${base} servings=${servings}
              onBase=${(nb) => setBase({ ...base, ...nb })} />

            <${IngredientList} ings=${base.ingredients} servings=${servings} mealName=${base.name}
              onNeedPass=${onNeedPass}
              base=${MACROS.reduce((a, k) => ({ ...a, [k]: base[k] || 0 }), { kcal: base.kcal })}
              onChange=${({ ingredients, base: nb }) => setBase({ ...base, ...nb, ingredients })} />

            ${base.note && html`<div class="note" style="margin-top:11px">${base.note}</div>`}

            <div style="margin-top:16px">
              <div class="lab">${t("log_when")}</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                ${SLOTS.map((s) => html`<button class="pill" key=${s} data-on=${slot === s ? "1" : "0"} onClick=${() => setSlot(s)}>${t("slot_" + s)}</button>`)}
              </div>
            </div>

            <button class="b b3" style="margin-top:16px" onClick=${() => onAdd({
              name: base.name, slot, servings,
              base: MACROS.reduce((a, k) => ({ ...a, [k]: base[k] || 0 }), { kcal: base.kcal }),
              ingredients: base.ingredients || [], note: base.note || "", thumb: img ? img.thumb : null,
            })}>
              ${t("log_it", { n: m.kcal })}
            </button>
            <button class="b b2" style="margin-top:8px" onClick=${onClose}>${t("log_justchecking")}</button>
            <button class="b b2" style="margin-top:8px" onClick=${reset}>${t("log_restart")}</button>
          </div>`}
      </div>
    </div>`;
}

/* ============================ meal detail ============================ */

function MealDetail({ e, onClose, onPatch, onDelete, onNeedPass }) {
  const [fixing, setFixing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [fixText, setFixText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const tl = tot(e), s = e.servings || 1;

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
          `${e.base.protein}g protein, ${e.base.carbs}g carbs (of which ${e.base.sugar || 0}g sugar and ` +
          `${e.base.fibre || 0}g fibre), ${e.base.fat}g fat.` +
          (e.ingredients && e.ingredients.length ? ` Ingredients: ${e.ingredients.map((g) => g.name + " (" + g.qty + ")").join(", ")}.` : "") +
          `\n\nThe person says the estimate is wrong: "${fixText.trim()}"\n\n` +
          `Trust what they say over what the photograph appears to show — they were there. ` +
          `Revise the estimate for ONE serving accordingly. Reply with ONLY this JSON object:\n` +
          `{"name":"short dish name","kcal":integer,"protein":integer,"carbs":integer,"fat":integer,` +
          `"sugar":integer grams of total sugars,"fibre":integer grams of fibre,` +
          `"kcalLow":integer,"kcalHigh":integer,"confidence":"high"|"medium"|"low",` +
          `"ingredients":[{"name":"component","qty":"portion","kcal":integer}],"note":"one sentence on what changed"}`,
      });
      const p = await askClaude(parts);
      const carbs = Math.max(0, Math.round(p.carbs || 0));
      onPatch({
        name: p.name || e.name,
        base: {
          kcal: Math.max(0, Math.round(p.kcal || 0)), protein: Math.max(0, Math.round(p.protein || 0)),
          carbs, fat: Math.max(0, Math.round(p.fat || 0)),
          sugar: Math.min(carbs, Math.max(0, Math.round(p.sugar || 0))),
          fibre: Math.min(carbs, Math.max(0, Math.round(p.fibre || 0))),
        },
        ingredients: Array.isArray(p.ingredients) ? p.ingredients.slice(0, 8) : e.ingredients,
        note: p.note || "",
      });
      setFixing(false); setFixText("");
    } catch (ex) {
      if (ex && ex.auth) { onNeedPass(); setErr(t("md_err_pass")); }
      else setErr(t("md_err"));
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
              ${t("slot_" + e.slot)} · ${new Date(e.at).toLocaleTimeString(LOCALE(), { hour: "numeric", minute: "2-digit" })}
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
            <div class="note" style="font-weight:500">${t("md_calories")}</div>
            <div class="d" style="font-weight:800;font-size:32px;line-height:1.1">${tl.kcal}</div>
          </div>
        </div>

        <div class="macros">
          ${[["m_protein", tl.protein, "var(--pro)", "🍗"], ["m_carbs", tl.carbs, "var(--carbc)", "🌾"], ["m_fat", tl.fat, "var(--fatc)", "🥑"]].map(([n, v, c, ic]) => html`
            <div class="macro" key=${n} style="padding:14px 6px">
              <div style="font-size:15px">${ic}</div>
              <div class="macro-l" style="margin-top:4px">${t(n)}</div>
              <div class="macro-n" style=${{ color: c, marginTop: "3px" }}>${v}${t("u_g")}</div>
            </div>`)}
        </div>

        <div style="display:flex;gap:9px;margin-top:9px">
          ${[["ofwhich_fibre", tl.fibre, "var(--fibre)"], ["ofwhich_sugar", tl.sugar, "var(--sugar)"]].map(([n, v, c]) => html`
            <div key=${n} style="flex:1;background:var(--bg);border-radius:16px;padding:11px 13px">
              <div class="macro-l" style="text-align:left">${t(n)}</div>
              <div class="macro-n" style=${{ color: c, marginTop: "2px" }}>${v}${t("u_g")}</div>
            </div>`)}
        </div>

        ${editing
          ? html`
            <div style="margin-top:16px">
              <div class="lab">${t("md_numbers", { n: s })}</div>
              <${NumberGrid} base=${e.base} servings=${s} onBase=${(nb) => onPatch({ base: nb })} />
              <button class="b b2" style="margin-top:10px" onClick=${() => setEditing(false)}>${t("md_doneedit")}</button>
            </div>`
          : html`<button class="addb" style="margin-top:12px" onClick=${() => setEditing(true)}>${t("md_edit")}</button>`}

        <${IngredientList} ings=${e.ingredients} servings=${s} base=${e.base} mealName=${e.name}
          onNeedPass=${onNeedPass}
          onChange=${({ ingredients, base }) => onPatch({ ingredients, base })} />

        ${e.note && html`<div class="note" style="margin-top:14px">${e.note}</div>`}

        ${fixing
          ? html`<div style="margin-top:18px">
              <label class="lab">${t("md_fix_l")}</label>
              <input class="in" autofocus placeholder=${t("md_fix_ph")}
                value=${fixText} onInput=${(ev) => setFixText(ev.target.value)}
                onKeyDown=${(ev) => { if (ev.key === "Enter" && !busy) applyFix(); }} />
              <div class="note" style="font-size:12px;margin-top:8px">${t("md_fix_note")}</div>
              ${err && html`<div class="err">${err}</div>`}
              <button class="b" style="margin-top:10px" onClick=${applyFix} disabled=${busy || !fixText.trim()}>
                ${busy ? html`<span class="spin"></span>${t("md_fixing")}` : t("md_fix_go")}
              </button>
              <button class="b b2" style="margin-top:8px" onClick=${() => { setFixing(false); setErr(""); }}>${t("md_cancel")}</button>
            </div>`
          : html`<div style="display:flex;gap:9px;margin-top:20px">
              <button class="b b2" onClick=${() => setFixing(true)}>${t("md_redo")}</button>
              <button class="b" onClick=${onClose}>${t("md_done")}</button>
            </div>`}

        <button class="b b2" style="margin-top:9px;color:var(--over)" onClick=${onDelete}>${t("md_delete")}</button>
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
          <div class="note" style="font-size:12px;font-weight:500">${t("pr_weight")}</div>
          <div class="d" style="font-weight:800;font-size:26px;margin-top:3px">${dec(weight)} <span style="font-size:14px;color:var(--faint)">${t("u_kg")}</span></div>
          <div style="height:6px;background:var(--track);border-radius:99px;margin-top:11px;overflow:hidden">
            <div style=${{ width: prog * 100 + "%", height: "100%", background: "var(--lime)", borderRadius: "99px" }}></div>
          </div>
          <div class="note" style="font-size:11.5px;margin-top:7px">${t("pr_goal", { kg: goal, pct: Math.round(prog * 100) })}</div>
        </div>

        <div class="card" style="margin:0;padding:17px;text-align:center">
          <div style="font-size:26px">🔥</div>
          <div class="d" style="font-weight:800;font-size:22px;margin-top:2px">${t("pr_streak", { n: streak, unit: tp("days", streak) })}</div>
          <div class="note" style="font-size:11.5px">${t("pr_streak_s")}</div>
          <div class="wk">
            ${week.map((w) => html`
              <div class="wkd" key=${w.k}>
                <div style="font-size:9.5px;color:var(--faint);font-weight:700">${w.l}</div>
                <div class="wkc" style=${{ background: w.logged ? "var(--lime)" : "var(--track)", color: w.logged ? "var(--limeInk)" : "var(--faint2)" }}>
                  ${w.logged ? "✓" : ""}
                </div>
              </div>`)}
          </div>
        </div>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div class="h">${t("pr_chart_h")}</div>
          <span class="pill" style="padding:5px 11px;font-size:11.5px">${t("pr_ofgoal", { pct: Math.round(prog * 100) })}</span>
        </div>

        ${pts.length > 1
          ? html`<svg viewBox="0 0 100 46" preserveAspectRatio="none" style="width:100%;height:92px;margin-top:16px;overflow:visible">
              <line x1="0" y1=${yF(goal)} x2="100" y2=${yF(goal)} style="stroke:var(--lime)" stroke-width="2" stroke-dasharray="4 4" vector-effect="non-scaling-stroke" />
              <path d=${path} fill="none" style="stroke:var(--ink)" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" />
            </svg>`
          : html`<div class="note" style="margin-top:14px">${t("pr_needmore")}</div>`}

        <div class="seg" style="margin-top:14px">
          ${[[30, "30D"], [90, "90D"], [365, "1Y"], [9999, "ALL"]].map(([v, l]) => html`
            <button class="segb" key=${l} data-on=${range === v ? "1" : "0"} onClick=${() => setRange(v)} style="font-size:12px">${l}</button>`)}
        </div>

        <div style="display:flex;gap:8px;margin-top:14px">
          <input class="in" type="number" step="0.1" inputmode="decimal" placeholder=${t("pr_weigh_ph")} value=${val}
            onInput=${(e) => setVal(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") submit(); }} />
          <button class="b" style="width:auto;padding:14px 24px" onClick=${submit} disabled=${!val}>${t("pr_log")}</button>
        </div>
      </div>

      <div class="card">
        <div class="h">${t("pr_avg_h")}</div>
        <div style="display:flex;align-items:baseline;gap:9px;margin-top:8px">
          <span class="d" style="font-weight:800;font-size:34px">${avg || "—"}</span>
          ${delta !== 0 && html`<span style=${{ fontWeight: 700, fontSize: "13px", color: delta < 0 ? "var(--good)" : "var(--over)" }}>
            ${delta < 0 ? "↓" : "↑"}${Math.abs(delta)}%
          </span>`}
          <span class="note" style="font-size:12px">${t("pr_vs")}</span>
        </div>

        <div style="position:relative;margin-top:18px">
          <div style=${{ position: "absolute", left: 0, right: 0, borderTop: "2px dashed var(--dash)", bottom: (T.kcal / max) * 92 + "px" }}></div>
          <div class="bars">
            ${week.map((w) => html`
              <div key=${w.k} style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%">
                <div class="bar" style=${{ height: Math.max(5, (w.tot / max) * 92) + "px", background: w.tot === 0 ? "var(--track)" : w.tot > T.kcal ? "var(--over)" : "var(--lime)" }}></div>
              </div>`)}
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          ${week.map((w) => html`<div key=${w.k} style="flex:1;text-align:center;font-size:11px;color:var(--faint);font-weight:600">${w.l}</div>`)}
        </div>
        <div class="note" style="margin-top:13px">
          ${t("pr_dashed", { n: T.kcal })}
        </div>
      </div>
    </div>`;
}

/* ============================ profile ============================ */

function Profile({ profile, weight, days, weights, onSave, onImport, onWipe }) {
  /* Anyone onboarded before exercise was asked about separately gets it
     unpicked from their old activity choice on the way in, so the controls
     below show real values rather than blanks. */
  const [p, setP] = useState(() => migrateActivity(profile));
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(null);
  const [impErr, setImpErr] = useState("");
  const [done, setDone] = useState("");
  const fileRef = useRef(null);
  const tg = deriveTargets(p, weight);
  const dirty = JSON.stringify(p) !== JSON.stringify(migrateActivity(profile));

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
        setImpErr(t("pf_notbackup")); return;
      }
      const dayKeys = Object.keys(data.days || {});
      const meals = dayKeys.reduce((a, k) => a + (Array.isArray(data.days[k]) ? data.days[k].length : 0), 0);
      setPending({ data, meals, dayKeys: dayKeys.length, weighIns: (data.weights || []).length });
    } catch {
      setImpErr(t("pf_badfile"));
    }
  };

  return html`
    <div style="padding-top:6px">
      <div class="card">
        <div class="h">${t("pf_plan_h")}</div>
        <div style="margin-top:15px">
          <label class="lab">${t("pf_name_l")}</label>
          <input class="in" placeholder=${t("pf_name_ph")} value=${p.name || ""}
            onInput=${(e) => setP({ ...p, name: e.target.value })} />
        </div>
        <div style="margin-top:13px">
          <label class="lab">${t("pf_move_l")}</label>
          <select class="in" value=${p.activity} onChange=${(e) => setP({ ...p, activity: e.target.value })}>
            ${ACTIVITY.map((a) => html`<option key=${a.id} value=${a.id}>${t(a.key)}</option>`)}
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:13px">
          <div>
            <label class="lab">${t("pf_ex_days_l")}</label>
            <select class="in" value=${String(p.exDays || 0)}
              onChange=${(e) => setP({ ...p, exDays: parseInt(e.target.value, 10) })}>
              ${[0, 1, 2, 3, 4, 5, 6, 7].map((n) => html`<option key=${n} value=${n}>${n}</option>`)}
            </select>
          </div>
          <div>
            <label class="lab">${t("pf_ex_mins_l")}</label>
            <select class="in" value=${String(p.exMins || 45)} disabled=${!p.exDays}
              onChange=${(e) => setP({ ...p, exMins: parseInt(e.target.value, 10) })}>
              ${[15, 30, 45, 60, 75, 90, 120].map((n) => html`<option key=${n} value=${n}>${n}</option>`)}
            </select>
          </div>
        </div>
        ${!!p.exDays && html`
          <div style="margin-top:13px">
            <label class="lab">${t("pf_ex_effort_l")}</label>
            <select class="in" value=${p.exEffort || "moderate"}
              onChange=${(e) => setP({ ...p, exEffort: e.target.value })}>
              ${EFFORT.map((e) => html`<option key=${e.id} value=${e.id}>${t(e.key)}</option>`)}
            </select>
          </div>`}
        <div style="margin-top:13px">
          <label class="lab">${t("pf_bf_l")}</label>
          <input class="in" type="number" step="0.5" inputmode="decimal" placeholder=${t("pf_bf_ph")}
            value=${p.bodyFat === null || p.bodyFat === undefined ? "" : p.bodyFat}
            onInput=${(e) => {
              const v = parseFloat(e.target.value);
              setP({ ...p, bodyFat: isFinite(v) && v >= 5 && v <= 60 ? v : null });
            }} />
          <div class="note" style="font-size:12px;margin-top:6px">${t("pf_bf_note")}</div>
        </div>
        <div style="margin-top:13px">
          <label class="lab">${t("pf_pace_l")}</label>
          <select class="in" value=${String(p.weeklyLoss)} onChange=${(e) => setP({ ...p, weeklyLoss: parseFloat(e.target.value) })}>
            <option value="0.25">${t("pf_pace_25")}</option>
            <option value="0.5">${t("pf_pace_50")}</option>
            <option value="0.75">${t("pf_pace_75")}</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:13px">
          <div><label class="lab">${t("pf_goal_l")}</label>
            <input class="in" type="number" step="0.5" value=${p.goalWeight} onInput=${(e) => setP({ ...p, goalWeight: parseFloat(e.target.value) || p.goalWeight })} /></div>
          <div><label class="lab">${t("pf_stretch_l")}</label>
            <input class="in" type="number" step="0.5" value=${p.stretchWeight} onInput=${(e) => setP({ ...p, stretchWeight: parseFloat(e.target.value) || p.stretchWeight })} /></div>
        </div>
        <div style="margin-top:13px">
          <label class="lab">${t("pf_height_l")}</label>
          <input class="in" type="number" value=${p.heightCm} onInput=${(e) => setP({ ...p, heightCm: parseInt(e.target.value || "0", 10) || p.heightCm })} />
        </div>
        <div style="margin-top:13px">
          <label class="lab">${t("pf_dob_l")}</label>
          <input class="in" type="date" value=${p.dob || ""} max=${todayKey()} min="1920-01-01"
            onInput=${(e) => setP({ ...p, dob: e.target.value })} />
          <div class="note" style="font-size:12px;margin-top:6px">
            ${p.dob ? t("pf_dob_set", { age: ageOf(p) }) : t("pf_dob_unset", { age: p.age || 30 })}
          </div>
        </div>
        <div style="margin-top:13px">
          <label class="lab">${t("ob_sex_l")}</label>
          <select class="in" value=${p.sex} onChange=${(e) => setP({ ...p, sex: e.target.value })}>
            <option value="male">${t("ob_male")}</option>
            <option value="female">${t("ob_female")}</option>
          </select>
        </div>
        ${p.goalWeight < minHealthyKg(p.heightCm) && html`
          <div class="warn">
            ${t("pf_low", { goal: p.goalWeight, cm: p.heightCm, floor: minHealthyKg(p.heightCm) })}
          </div>`}
        <button class="b b3" style="margin-top:17px" disabled=${!dirty} onClick=${() => onSave(p)}>${t(dirty ? "pf_save" : "pf_saved")}</button>
      </div>

      <div class="card">
        <div class="h">${t("lang_h")}</div>
        <div class="note" style="margin-top:8px">${t("lang_note")}</div>
        <div class="seg" style="margin-top:13px">
          ${LANGS.map((l) => html`
            <button class="segb" key=${l.id} data-on=${(p.lang || "en") === l.id ? "1" : "0"}
              onClick=${() => {
                /* Applied immediately like the theme — a language you have to
                   save before seeing is no way to check you picked right. */
                setP({ ...p, lang: l.id });
                setLang(l.id);
                onSave({ ...profile, lang: l.id });
              }}>${l.label}</button>`)}
        </div>
      </div>

      <div class="card">
        <div class="h">${t("appearance_h")}</div>
        <div class="note" style="margin-top:8px">${t("appearance_note")}</div>
        <div class="seg" style="margin-top:13px">
          ${[["system", "theme_system"], ["light", "theme_light"], ["dark", "theme_dark"]].map(([v, l]) => html`
            <button class="segb" key=${v} data-on=${(p.theme || "system") === v ? "1" : "0"}
              onClick=${() => {
                /* Applied straight away rather than on Save — a theme you
                   have to commit to before seeing is no way to choose one. */
                setP({ ...p, theme: v });
                applyTheme(v);
                onSave({ ...profile, theme: v });
              }}>${t(l)}</button>`)}
        </div>
      </div>

      <${PlanBreakdown} T=${tg} p=${p} weight=${weight} />

      <div class="card">
        <div class="h">${t("pf_numbers_h")}</div>
        <div style="margin-top:10px">
          ${[[t("m_protein"), tg.protein + " " + t("u_g")], [t("m_fat"), tg.fat + " " + t("u_g")],
             [t("m_carbs"), tg.carbs + " " + t("u_g")], [t("plan_fibre"), tg.fibre + " " + t("u_g")],
             [t("plan_sugar"), tg.sugar + " " + t("u_g")]].map(([k, v], i) => html`
            <div key=${k} style=${{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "11px 0", borderBottom: i === 4 ? "none" : "1px solid var(--hair)" }}>
              <span class="note" style="font-weight:500">${k}</span>
              <span class="d" style=${{ fontWeight: 700, fontSize: "16px", opacity: i > 2 ? .75 : 1 }}>${v}</span>
            </div>`)}
        </div>
        <div class="note" style="margin-top:12px">${t("pf_numbers_note", { floor: num(tg.floor) })}</div>
      </div>

      <div class="card">
        <div class="h">${t("pf_data_h")}</div>
        <div class="note" style="margin-top:8px">${t("pf_data_note")}</div>
        <button class="b b2" style="margin-top:13px" onClick=${exportJson}>${t("pf_export")}</button>

        <input ref=${fileRef} type="file" accept="application/json,.json" style="display:none"
          onChange=${(e) => { readBackup(e.target.files && e.target.files[0]); e.target.value = ""; }} />

        ${pending
          ? html`
            <div style="background:var(--bg);border-radius:18px;padding:15px;margin-top:8px">
              <div style="font-weight:700;font-size:14.5px">${t("pf_restore_h")}</div>
              <div class="note" style="margin-top:6px">
                ${t("pf_restore_s", {
                  meals: pending.meals + " " + tp("meals", pending.meals),
                  days: pending.dayKeys + " " + tp("dayw", pending.dayKeys),
                  weighins: pending.weighIns + " " + tp("weighins", pending.weighIns) })}
              </div>
              <button class="b b3" style="margin-top:12px" onClick=${() => {
                onImport(pending.data);
                setDone(t("pf_restored", { n: pending.meals + " " + tp("meals", pending.meals) }));
                setPending(null);
              }}>${t("pf_merge")}</button>
              <button class="b b2" style="margin-top:8px" onClick=${() => setPending(null)}>${t("pf_cancel")}</button>
            </div>`
          : html`<button class="b b2" style="margin-top:8px" onClick=${() => fileRef.current && fileRef.current.click()}>${t("pf_restore")}</button>`}

        ${impErr && html`<div class="err">${impErr}</div>`}
        ${done && html`<div class="note" style="margin-top:10px;color:var(--good);font-weight:600">${done}</div>`}

        ${/* The passcode sheet still appears on its own if the server ever
             rejects the stored code, so there is nothing to change here by
             hand. */ ""}
        ${confirm
          ? html`<div style="margin-top:8px">
              <button class="b" style="background:var(--over)" onClick=${() => { onWipe(); setConfirm(false); }}>${t("pf_erase_yes")}</button>
              <button class="b b2" style="margin-top:8px" onClick=${() => setConfirm(false)}>${t("pf_cancel")}</button>
            </div>`
          : html`<button class="b b2" style="margin-top:8px;color:var(--over)" onClick=${() => setConfirm(true)}>${t("pf_erase")}</button>`}
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
