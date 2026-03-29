# Intel Premium System — Full Setup Guide

## What was built
| File | Purpose |
|------|---------|
| `server.js` | Railway Express backend — MySQL, Telegram webhook, admin API, GitHub backup |
| `package.json` | Node.js dependencies |
| `admin.html` | Admin panel (hosted anywhere, no images) |
| `buyp.html` | Updated payment WebApp — checks premium from Railway, submits to Railway |
| `index_patch.md` | 2 surgical changes needed in your index.html |

---

## Step 1 — Add MySQL to Railway

1. Go to your Railway project → **+ New** → **Database** → **MySQL**
2. Railway auto-injects these env vars into your service:
   `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`
   — server.js reads all of them automatically, no extra config needed.

---

## Step 2 — Set Railway Environment Variables

In Railway → your service → **Variables**, add:

```
BOT_TOKEN            = 123456:ABCdef...        (your Telegram bot token)
ADMIN_TELEGRAM_ID    = 6976365864              (your personal Telegram ID)
ADMIN_PASSWORD       = choose_a_strong_password
GITHUB_TOKEN         = ghp_xxxxx               (GitHub personal access token, repo scope)
GITHUB_REPO          = afkft/ho                (owner/reponame)
GITHUB_BRANCH        = main                    (or master)
GITHUB_FILE_PATH     = da/premiumlist.js       (path to premiumlist.js in your repo)
```

---

## Step 3 — Deploy server.js to Railway

1. Push `server.js` and `package.json` to your Railway-connected GitHub repo
2. Railway will auto-deploy on push
3. Note your Railway public URL: `https://YOUR-APP.up.railway.app`

---

## Step 4 — Register Telegram Webhook

Visit this URL once in your browser (replace values):

```
https://YOUR-APP.up.railway.app/setup/webhook?url=https://YOUR-APP.up.railway.app/bot/webhook&password=YOUR_ADMIN_PASSWORD
```

You should get: `{"ok":true,"result":true,"description":"Webhook was set"}`

From now on, when admin presses ✅ Confirm or ❌ Decline in Telegram,
the server handles it and saves to MySQL automatically.

---

## Step 5 — Update HTML files

### buyp.html
Replace line near top of the `<script>` block:
```javascript
const RAILWAY_URL = "https://YOUR-APP.up.railway.app";
```

### index.html
Follow the 2 changes in `index_patch.md`.

### admin.html
No code changes needed — you enter the Railway URL at login time.

---

## Step 6 — Migrate existing premiumUsers from premiumlist.js

In admin.html, log in and add each user manually using the **Add User** form.
Or use the `/admin/premium/add` API in bulk.

Alternatively, you can import them all at once via MySQL directly (Railway DB tab → Query):

```sql
INSERT IGNORE INTO premium_users (telegram_id, plan) VALUES
  (7979664801, 'Forever One time payment'),
  (6976365864, 'Forever One time payment'),
  -- ... add all IDs from your old premiumlist.js
  (7762146760, 'One week plan');
```

---

## How the flow works end-to-end

```
User opens buyp.html
  → GET /premium/check/:id  (Railway)
  → if already premium → show "Already Premium" page
  → else → show plan selection

User selects plan, uploads screenshot, submits
  → POST /payment/submit  (Railway, multipart with photo)
  → Railway saves pending_payment to MySQL
  → Railway sends photo + ✅ Confirm / ❌ Decline buttons to admin Telegram
  → User sees success page + receives bot message

Admin clicks ✅ Confirm in Telegram
  → POST /bot/webhook (Telegram → Railway)
  → Railway adds user to premium_users table with correct expiry
  → Railway sends confirmation message to user's Telegram
  → Caption of admin's photo message is updated to "✅ CONFIRMED"

Admin clicks ❌ Decline
  → Railway sends decline message to user
  → Caption updated to "❌ DECLINED"

index.html loads
  → GET /premium/check/:id
  → if premium → unlocks premium links, shows Edit Crypto button
  → if not → shows locked state

GitHub backup (auto every 2 hours, or manual from admin.html)
  → Reads all active premium_users from MySQL
  → Pushes updated premiumlist.js to GitHub
  → This keeps the old file in sync as a backup
```

---

## Admin Panel Features

- **Login**: enter Railway URL + admin password (saved in localStorage for next session)
- **Stats**: total premium, forever plans, timed plans, pending payments
- **Add User**: fill Telegram ID, name, username, plan, days (0 = forever) → sends bot notification
- **Remove User**: one-click removal
- **Search**: filter by name, username, or Telegram ID
- **Payments tab**: view all submitted payment requests with status
- **Backup**: manual GitHub backup button + auto every 2 hours from server
- **Webhook setup**: one-click webhook registration from admin panel

---

## Expiry Logic

| Plan keyword | Expiry |
|-------------|--------|
| "one week" / "1 week" / "7 day" | 7 days from confirmation |
| "two week" / "2 week" / "14 day" | 14 days from confirmation |
| "forever" / anything else | NULL (never expires) |

Premium check always verifies `expires_at > NOW()` so expired users are automatically blocked.
