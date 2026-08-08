# tally

A calorie tracker that installs to your home screen. No accounts, no login screen, no Claude app in the way.

Your food log lives in IndexedDB on your phone. Nothing is stored on the server. The only thing the
server does is hold your Anthropic API key so the browser never has to.

---

## Deploy

You need a Vercel account (free tier is fine) and an Anthropic API key from
console.anthropic.com. About fifteen minutes.

### 1. Put the folder on GitHub

```bash
cd tally
git init
git add .
git commit -m "tally"
gh repo create tally --private --source=. --push
```

No `gh`? Make an empty private repo on github.com and follow the push instructions it gives you.

### 2. Import it into Vercel

1. vercel.com → **Add New** → **Project** → pick the repo
2. Framework preset: **Other**. Leave build command and output directory empty — there is no build step.
3. Before you click Deploy, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your key, starts with `sk-ant-` |
| `APP_PASSCODE` | any phrase you invent, e.g. `machboos-tuesday` |

4. Deploy.

`APP_PASSCODE` matters. The URL is public, and without it anyone who finds it could run
estimates on your credit. You will be asked for it once in the app, and it is remembered after that.

### 3. Install it on your phone

1. Open your `.vercel.app` URL in Safari
2. Share → **Add to Home Screen**
3. Open it from the icon. No Claude app, no login, no address bar.

First time you scan a meal it will ask for your passcode. Type it once.

### 4. Optional: your own domain

Vercel → Project → Settings → Domains. Point a CNAME at it. Then reinstall the home screen icon
from the new address so the old one doesn't linger.

---

## Cost

Each meal estimate is one image plus a short reply — roughly a US cent or two. Three meals a day
lands somewhere around a dollar a month. Set a spend limit in the Anthropic console if you want a
hard ceiling.

---

## Files

```
index.html            shell, all the styling, import map
app.js                the whole app (Preact + htm, no build step)
api/estimate.js       serverless proxy, holds the API key
sw.js                 service worker, makes it open instantly and work offline
manifest.webmanifest  makes it installable
icons/                app icons
```

## Changing it

Edit `app.js` and push. Vercel redeploys on every commit.

One catch: the service worker caches the app shell, so after a change bump `CACHE` in `sw.js`
(`tally-v1` → `tally-v2`). Otherwise your phone keeps serving the old version.

## Backups

Profile tab → **Export a backup**. Do this before clearing Safari data or moving to a new phone,
because the log lives only on the device.

## Offline

The app opens and your log works with no signal. Calorie estimation needs the network, since that
part calls the model. Log the meal by hand and use **Fix results** later if you want.
