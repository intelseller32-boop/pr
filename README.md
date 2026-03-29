# 🏆 Intel Premium System

A full-stack premium membership system for the **Intelligent Verification Link Bot** Telegram WebApp. Handles plan selection, NGN/USD payments, admin review via Telegram, and MySQL-backed premium tracking on Railway.

---

## 📁 File Overview

| File | Purpose |
|------|---------|
| `server.js` | Railway Express backend — MySQL, Telegram webhook, payment API, GitHub backup |
| `package.json` | Node.js dependencies |
| `buyp.html` | Payment WebApp — plan selection, NGN/USD checkout, premium check |
| `admin.html` | Admin panel — manage users, review payments, run backups |
| `SETUP.md` | Full step-by-step deployment guide |
| `index_patch.md` | 2 surgical changes for your existing `index.html` |

---

## ⚡ Quick Start

### 1. Deploy the backend

```bash
# Push server.js and package.json to your Railway-connected GitHub repo
git add server.js package.json
git commit -m "Add premium backend"
git push
```

Railway auto-deploys on push. Note your public URL: `https://YOUR-APP.up.railway.app`

### 2. Set Railway environment variables

In Railway → your service → **Variables**:

```
BOT_TOKEN            = 123456:ABCdef...
ADMIN_TELEGRAM_ID    = 6976365864
ADMIN_PASSWORD       = your_strong_password
GITHUB_TOKEN         = ghp_xxxxx
GITHUB_REPO          = yourusername/yourrepo
GITHUB_BRANCH        = main
GITHUB_FILE_PATH     = da/premiumlist.js
```

MySQL variables are injected automatically by Railway when you add a MySQL database.

### 3. Update `buyp.html`

Find this line near the top of the `<script>` block and update it:

```javascript
const RAILWAY_URL = "https://YOUR-APP.up.railway.app";
```

### 4. Register the Telegram webhook

Open this URL in your browser once (replace placeholders):

```
https://YOUR-APP.up.railway.app/setup/webhook?url=https://YOUR-APP.up.railway.app/bot/webhook&password=YOUR_ADMIN_PASSWORD
```

Expected response: `{"ok":true,"result":true}`

### 5. Host `buyp.html` and `admin.html`

Upload both files to any static host (GitHub Pages, your existing server, etc.) or serve them via your Railway app directly.

---

## 💳 Payment Flow

```
User opens buyp.html
  → Checks premium status via GET /premium/check/:id
  → Already premium → shows "Active Premium" screen
  → Not premium → shows plan selection

User selects plan and payment method
  → NGN: bank transfer details shown → user uploads screenshot
  → USD: BNB wallet shown → user uploads tx screenshot
  → Submits via POST /payment/submit (multipart)

Server receives submission
  → Saves to pending_payments (MySQL)
  → Sends photo + ✅ Confirm / ❌ Decline buttons to admin Telegram

Admin taps ✅ Confirm
  → User added to premium_users with correct expiry
  → User receives confirmation via bot
  → Admin photo caption updates to "✅ CONFIRMED"

Admin taps ❌ Decline
  → User receives decline message
  → Caption updates to "❌ DECLINED"
```

---

## 🎨 buyp.html Features (v2)

- **Light / Dark theme toggle** — persists via localStorage
- **Loading states** — spinner while checking premium, button loading during submit
- **Toast notifications** — success, error, warning, info pop-ups for every action
- **Inline status banners** — contextual messages on each page
- **Form validation** — highlights missing fields, validates file type & size (max 10 MB)
- **Timeout handling** — 8s premium check timeout, 20s submit timeout with clear error messages
- **Offline detection** — shows appropriate message when no internet
- **Live USD rates** — fetched from open.er-api.com, gracefully falls back if unavailable
- **Copy buttons** — account number and wallet address with clipboard feedback
- **File preview** — shows uploaded screenshot before submitting
- **No promo code section** — removed per design update

---

## ⏱ Expiry Logic

| Plan contains | Expires after |
|---------------|--------------|
| `one week` / `1 week` / `7 day` | 7 days from confirmation |
| `two week` / `2 week` / `14 day` | 14 days from confirmation |
| `forever` / anything else | Never (`NULL`) |

The premium check always validates `expires_at > NOW()` so expired users are automatically locked out.

---

## 🛡 Admin Panel

Open `admin.html` in any browser. On first login, enter your Railway URL and admin password (saved locally for future sessions).

Features:
- **Stats** — total premium users, forever plans, timed plans, pending payments
- **Add / Remove users** manually with bot notification
- **Search** by name, username, or Telegram ID
- **Payments tab** — view all submissions and their status
- **Manual GitHub backup** + auto-backup every 2 hours
- **One-click webhook registration**

---

## 🛠 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/premium/check/:telegram_id` | Check if user is premium |
| `POST` | `/payment/submit` | Submit payment (multipart: photo + user info) |
| `POST` | `/bot/webhook` | Telegram webhook for admin button callbacks |
| `GET` | `/admin/stats` | Premium stats (requires `?password=`) |
| `POST` | `/admin/premium/add` | Add premium user manually |
| `DELETE` | `/admin/premium/remove/:id` | Remove premium user |
| `GET` | `/admin/payments` | List all payment submissions |
| `POST` | `/admin/backup` | Trigger GitHub backup manually |
| `GET` | `/setup/webhook` | Register Telegram webhook |

---

## 📦 Dependencies

```json
{
  "express":    "^4.18.2",
  "mysql2":     "^3.6.5",
  "multer":     "^1.4.5-lts.1",
  "node-fetch": "^2.7.0",
  "form-data":  "^4.0.0",
  "node-cron":  "^3.0.3",
  "cors":       "^2.8.5"
}
```

Node.js **≥ 18.0.0** required.

---

## 📞 Support

WhatsApp Admin: [+234 911 430 1708](https://wa.me/2349114301708)  
Bot: [@intelligentverificationlinkbot](https://t.me/intelligentverificationlinkbot)
