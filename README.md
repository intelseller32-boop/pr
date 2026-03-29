# Intel Premium System

Full-stack premium membership system for Intelligent Verification Link Bot.

---

## Files

| File | What changed |
|------|-------------|
| `server.js` | **Updated** — auto-seeds all premiumlist.js users into MySQL on first deploy |
| `index.html` | **Updated** — checks Railway API instead of premiumlist.js; one-line URL to set |
| `buyp.html` | **Updated** — beautiful redesign, light/dark theme, toasts, loading states |
| `admin.html` | Original (unchanged) |
| `package.json` | Original (unchanged) |
| `SETUP.md` | Original setup guide |
| `index_patch.md` | Original patch notes (now superseded by updated index.html) |

---

## Quick Setup

### Step 1 — Set Railway environment variables

In Railway → your service → **Variables**, add:

```
BOT_TOKEN            = 123456:ABCdef...
ADMIN_TELEGRAM_ID    = 6976365864
ADMIN_PASSWORD       = choose_a_strong_password
GITHUB_TOKEN         = ghp_xxxxx
GITHUB_REPO          = yourusername/yourrepo
GITHUB_BRANCH        = main
GITHUB_FILE_PATH     = da/premiumlist.js
```

MySQL variables (`MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`) are injected automatically when you add a MySQL database plugin in Railway.

### Step 2 — Update the Railway URL in index.html

Open `index.html` and search for:

```
CHANGE THIS TO YOUR RAILWAY URL
```

You will find this block (around line 913):

```javascript
const RAILWAY_URL = "https://YOUR-APP.up.railway.app"; // ← CHANGE THIS TO YOUR RAILWAY URL
```

Replace `YOUR-APP` with your actual Railway subdomain. That is the **only line** you need to change in `index.html`.

### Step 3 — Update the Railway URL in buyp.html

Open `buyp.html` and search for:

```
RAILWAY URL  ← hardcoded
```

Change the same line:

```javascript
const RAILWAY_URL = "https://YOUR-APP.up.railway.app";
```

### Step 4 — Deploy server.js to Railway

Push `server.js` and `package.json` to your Railway-connected GitHub repo. Railway auto-deploys.

On **first deploy**, the server will automatically import all users from the old `premiumlist.js` into MySQL:

- 17 forever users → inserted with `expires_at = NULL`
- 1 timed user (7762146760) → inserted with `expires_at = 2026-04-05` if not already expired

This runs **exactly once** — it is tracked by a `seed_log` table and will never re-run.

### Step 5 — Register the Telegram webhook

Open this URL in your browser once (replace placeholders):

```
https://YOUR-APP.up.railway.app/setup/webhook?url=https://YOUR-APP.up.railway.app/bot/webhook&password=YOUR_ADMIN_PASSWORD
```

Expected: `{"ok":true,"result":true}`

### Step 6 — Deploy your HTML files

Upload `index.html` and `buyp.html` to your static host (GitHub Pages, etc.).

---

## How premium check works in index.html

Previously index.html loaded `premiumlist.js` which contained a JavaScript array of IDs. Now it calls the Railway API:

```javascript
// Runs on page load:
const res  = await fetch(RAILWAY_URL + "/premium/check/" + telegramId);
const data = await res.json();
// data.isPremium === true → show premium links + Edit Crypto button
// data.isPremium === false → show locked/upgrade UI
```

If the API is unreachable (network error, timeout), it fails gracefully and shows the locked state — it does not crash.

---

## Seeded users from premiumlist.js

| Plan | Count |
|------|-------|
| Forever (NULL expires_at) | 17 users |
| One week (exp. 2026-04-05) | 1 user |

The seed will skip the timed user if their expiry date has already passed by the time you deploy.

To add more users after deploy, use the Admin Panel (`admin.html`) or the API:

```
POST /admin/premium/add
Headers: x-admin-password: YOUR_PASSWORD
Body: { telegram_id, plan, days }   (days=0 = forever)
```

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/premium/check/:id` | none | Check if user is premium |
| POST | `/payment/submit` | none | Submit payment proof |
| POST | `/bot/webhook` | Telegram | Admin confirm/decline buttons |
| GET | `/admin/premium` | password | List all premium users |
| GET | `/admin/stats` | password | Quick stats |
| POST | `/admin/premium/add` | password | Add user manually |
| DELETE | `/admin/premium/:id` | password | Remove user |
| GET | `/admin/payments` | password | List payment submissions |
| POST | `/admin/backup` | password | Manual GitHub backup |
| GET | `/setup/webhook` | password | Register Telegram webhook |

---

## Support

WhatsApp: [+234 911 430 1708](https://wa.me/2349114301708)
