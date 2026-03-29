// ═══════════════════════════════════════════════════════════════
//  Intel Premium Server  —  server.js
//  Handles: MySQL premium DB, Telegram bot webhook,
//           payment submissions, admin API, GitHub backup
// ═══════════════════════════════════════════════════════════════

const express  = require("express");
const mysql    = require("mysql2/promise");
const multer   = require("multer");
const fetch    = require("node-fetch");
const FormData = require("form-data");
const cron     = require("node-cron");
const cors     = require("cors");

const app = express();

// ── Middleware ─────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// multer: memory storage, 20 MB limit (photos)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

// ── Environment Variables ──────────────────────────────────────
// Set all of these in Railway → Variables:
//   MYSQLHOST, MYSQLPORT, MYSQLUSER, MYSQLPASSWORD, MYSQLDATABASE
//   BOT_TOKEN            — your Telegram bot token
//   ADMIN_TELEGRAM_ID    — your personal Telegram numeric ID
//   ADMIN_PASSWORD       — password for admin.html
//   GITHUB_TOKEN         — personal access token with repo scope
//   GITHUB_REPO          — "owner/reponame"  e.g. "afkft/ho"
//   GITHUB_BRANCH        — branch name, default "main"
//   GITHUB_FILE_PATH     — path in repo, e.g. "da/premiumlist.js"

const BOT_TOKEN       = process.env.BOT_TOKEN;
const ADMIN_ID        = process.env.ADMIN_TELEGRAM_ID;
const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD;
const GITHUB_TOKEN    = process.env.GITHUB_TOKEN;
const GITHUB_REPO     = process.env.GITHUB_REPO;
const GITHUB_BRANCH   = process.env.GITHUB_BRANCH   || "main";
const GITHUB_FILE     = process.env.GITHUB_FILE_PATH || "da/premiumlist.js";

// ── MySQL Pool ─────────────────────────────────────────────────
const pool = mysql.createPool({
  host:             process.env.MYSQLHOST     || process.env.MYSQL_HOST,
  port:             process.env.MYSQLPORT     || process.env.MYSQL_PORT || 3306,
  user:             process.env.MYSQLUSER     || process.env.MYSQL_USER,
  password:         process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD,
  database:         process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit:  10,
  queueLimit:       0
});

// ── DB Init ────────────────────────────────────────────────────
async function initDB() {
  const conn = await pool.getConnection();
  try {
    // Premium users table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS premium_users (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        telegram_id BIGINT       UNIQUE NOT NULL,
        first_name  VARCHAR(255) DEFAULT '',
        last_name   VARCHAR(255) DEFAULT '',
        username    VARCHAR(255) DEFAULT '',
        plan        VARCHAR(150) DEFAULT '',
        added_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        expires_at  TIMESTAMP    NULL
      )
    `);

    // Pending payment requests table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS pending_payments (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        telegram_id BIGINT       NOT NULL,
        first_name  VARCHAR(255) DEFAULT '',
        last_name   VARCHAR(255) DEFAULT '',
        username    VARCHAR(255) DEFAULT '',
        plan        VARCHAR(150) DEFAULT '',
        method      VARCHAR(20)  DEFAULT '',
        whatsapp    VARCHAR(30)  DEFAULT '',
        submitted_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
        status      VARCHAR(20)  DEFAULT 'pending'
      )
    `);

    console.log("✅ Database tables ready");
  } finally {
    conn.release();
  }
}

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════

// Send a plain text message via bot
async function sendMessage(chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true })
    });
  } catch (e) {
    console.error("sendMessage error:", e.message);
  }
}

// Answer a callback query (removes loading spinner in Telegram)
async function answerCallback(cbqId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: cbqId, text, show_alert: false })
    });
  } catch (e) {
    console.error("answerCallback error:", e.message);
  }
}

// Edit a message caption (update after confirm/decline)
async function editCaption(chatId, messageId, newCaption) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageCaption`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        caption: newCaption.substring(0, 1024) // Telegram caption limit
      })
    });
  } catch (e) {
    console.error("editCaption error:", e.message);
  }
}

// Determine expiry from plan string
function planExpiry(planStr) {
  const p = (planStr || "").toLowerCase();
  if (p.includes("one week") || p.includes("1 week") || p.includes("7 day")) {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }
  if (p.includes("two week") || p.includes("2 week") || p.includes("14 day")) {
    return new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  }
  // "forever" or any other → NULL (no expiry)
  return null;
}

// Format a date nicely
function fmtDate(d) {
  if (!d) return "Forever";
  return new Date(d).toUTCString();
}

// ── Admin Auth Middleware ──────────────────────────────────────
function adminAuth(req, res, next) {
  const pass = req.headers["x-admin-password"] || req.query.password || req.body?.password;
  if (!pass || pass !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ═══════════════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════════

// Health check
app.get("/", (req, res) => res.json({ status: "ok", service: "Intel Premium Server" }));

// ── Check if a user is premium ─────────────────────────────────
// GET /premium/check/:telegramId
app.get("/premium/check/:telegramId", async (req, res) => {
  try {
    const tid = Number(req.params.telegramId);
    if (!tid) return res.json({ isPremium: false });

    const [rows] = await pool.execute(
      `SELECT id, first_name, last_name, username, plan, expires_at
       FROM premium_users
       WHERE telegram_id = ?
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [tid]
    );

    if (rows.length > 0) {
      return res.json({ isPremium: true, user: rows[0] });
    }
    return res.json({ isPremium: false });
  } catch (e) {
    console.error("/premium/check error:", e.message);
    res.status(500).json({ isPremium: false, error: e.message });
  }
});

// ── Submit Payment (with screenshot) ──────────────────────────
// POST /payment/submit  — multipart/form-data
// Fields: telegram_id, first_name, last_name, username, plan, method, whatsapp
// File:   photo
app.post("/payment/submit", upload.single("photo"), async (req, res) => {
  try {
    const {
      telegram_id, first_name, last_name, username,
      plan, method, whatsapp
    } = req.body;

    const photo = req.file;
    if (!telegram_id) return res.status(400).json({ error: "telegram_id required" });
    if (!photo)       return res.status(400).json({ error: "photo required" });

    // 1. Save pending payment to DB
    await pool.execute(
      `INSERT INTO pending_payments
         (telegram_id, first_name, last_name, username, plan, method, whatsapp)
       VALUES (?,?,?,?,?,?,?)`,
      [telegram_id, first_name || "", last_name || "", username || "", plan || "", method || "", whatsapp || ""]
    );

    const [[lastRow]] = await pool.execute("SELECT LAST_INSERT_ID() AS id");
    const paymentId = lastRow.id;

    // 2. Build caption for admin
    const caption =
      `🚨 NEW PREMIUM PAYMENT REQUEST\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 Name: ${first_name || ""} ${last_name || ""}\n` +
      `🔖 Username: @${username || "N/A"}\n` +
      `🆔 Telegram ID: ${telegram_id}\n` +
      `🎁 Plan: ${plan || "N/A"}\n` +
      `💳 Method: ${method || "N/A"}\n` +
      `📱 WhatsApp: ${whatsapp || "N/A"}\n` +
      `📋 Payment ID: #${paymentId}\n` +
      `⏳ Status: Awaiting your action`;

    // 3. Inline keyboard for admin
    const keyboard = {
      inline_keyboard: [[
        { text: "✅ CONFIRM",  callback_data: `confirm:${telegram_id}:${paymentId}` },
        { text: "❌ DECLINE",  callback_data: `decline:${telegram_id}:${paymentId}` }
      ]]
    };

    // 4. Send photo to admin via Telegram bot
    const fd = new FormData();
    fd.append("chat_id", ADMIN_ID);
    fd.append("photo", photo.buffer, {
      filename: photo.originalname || "proof.jpg",
      contentType: photo.mimetype || "image/jpeg"
    });
    fd.append("caption", caption);
    fd.append("reply_markup", JSON.stringify(keyboard));

    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      body: fd
    });
    const tgData = await tgRes.json();
    if (!tgData.ok) {
      console.error("Telegram sendPhoto failed:", tgData);
    }

    // 5. Send acknowledgement message to buyer
    await sendMessage(telegram_id,
      `✅ <b>Payment Submitted Successfully!</b>\n\n` +
      `📋 Payment ID: <b>#${paymentId}</b>\n` +
      `🎁 Plan: <b>${plan}</b>\n\n` +
      `⏳ Your proof is under review by admin.\n` +
      `You will receive a confirmation or decline message here shortly.\n\n` +
      `Thank you for choosing Premium! 🙏`
    );

    res.json({ success: true, paymentId });
  } catch (e) {
    console.error("/payment/submit error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  TELEGRAM BOT WEBHOOK
// ═══════════════════════════════════════════════════════════════
// POST /bot/webhook
// Handles admin clicking ✅ Confirm or ❌ Decline buttons

app.post("/bot/webhook", async (req, res) => {
  // Always reply 200 to Telegram immediately
  res.json({ ok: true });

  try {
    const update = req.body;

    // ── Callback Query (button presses) ──
    if (update.callback_query) {
      const cbq = update.callback_query;
      const data = cbq.data || "";
      const parts = data.split(":");

      if (parts.length < 3) return;
      const action    = parts[0];
      const targetId  = parts[1];
      const paymentId = parts[2];

      // Security: only allow admin to press these buttons
      if (String(cbq.from.id) !== String(ADMIN_ID)) {
        await answerCallback(cbq.id, "⛔ Not authorized");
        return;
      }

      if (action === "confirm") {
        // Fetch payment details
        const [rows] = await pool.execute(
          "SELECT * FROM pending_payments WHERE id = ?",
          [paymentId]
        );

        if (rows.length === 0) {
          await answerCallback(cbq.id, "⚠️ Payment not found");
          return;
        }

        const p = rows[0];

        // Already processed?
        if (p.status !== "pending") {
          await answerCallback(cbq.id, `Already ${p.status}`);
          return;
        }

        const expiry = planExpiry(p.plan);

        // Add/update user in premium_users
        await pool.execute(
          `INSERT INTO premium_users
             (telegram_id, first_name, last_name, username, plan, expires_at)
           VALUES (?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE
             plan       = VALUES(plan),
             expires_at = VALUES(expires_at),
             first_name = VALUES(first_name),
             last_name  = VALUES(last_name),
             username   = VALUES(username)`,
          [p.telegram_id, p.first_name, p.last_name, p.username, p.plan, expiry]
        );

        // Update payment status
        await pool.execute("UPDATE pending_payments SET status='confirmed' WHERE id=?", [paymentId]);

        // Notify user
        await sendMessage(p.telegram_id,
          `🎉 <b>Payment Confirmed!</b>\n\n` +
          `Welcome to Premium, ${p.first_name || "friend"}! 🌟\n\n` +
          `🎁 Plan: <b>${p.plan}</b>\n` +
          `📅 Expires: <b>${fmtDate(expiry)}</b>\n\n` +
          `✅ You now have full premium access.\n` +
          `Open the app and enjoy! 🚀`
        );

        // Update admin message caption
        await editCaption(
          cbq.message.chat.id,
          cbq.message.message_id,
          cbq.message.caption + `\n\n✅ CONFIRMED by admin\n📅 Expires: ${fmtDate(expiry)}`
        );

        await answerCallback(cbq.id, "✅ User confirmed & notified!");

      } else if (action === "decline") {
        const [rows] = await pool.execute(
          "SELECT * FROM pending_payments WHERE id=?", [paymentId]
        );

        if (rows.length === 0) {
          await answerCallback(cbq.id, "⚠️ Payment not found");
          return;
        }

        const p = rows[0];
        if (p.status !== "pending") {
          await answerCallback(cbq.id, `Already ${p.status}`);
          return;
        }

        // Update status
        await pool.execute("UPDATE pending_payments SET status='declined' WHERE id=?", [paymentId]);

        // Notify user
        await sendMessage(p.telegram_id,
          `❌ <b>Payment Declined</b>\n\n` +
          `Your payment proof for <b>${p.plan}</b> was reviewed and <b>declined</b>.\n\n` +
          `Possible reasons:\n` +
          `• Invalid or fake payment proof\n` +
          `• Wrong amount sent\n` +
          `• Screenshot not clear\n\n` +
          `If you believe this is a mistake, contact admin:\n` +
          `<a href="https://wa.me/2349114301708">WhatsApp Admin</a>`
        );

        // Update admin message
        await editCaption(
          cbq.message.chat.id,
          cbq.message.message_id,
          cbq.message.caption + "\n\n❌ DECLINED by admin"
        );

        await answerCallback(cbq.id, "❌ User declined & notified.");
      }
    }
  } catch (e) {
    console.error("Webhook handler error:", e.message);
  }
});

// ═══════════════════════════════════════════════════════════════
//  ADMIN API  (all require x-admin-password header)
// ═══════════════════════════════════════════════════════════════

// GET /admin/premium — list all active premium users
app.get("/admin/premium", adminAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, telegram_id, first_name, last_name, username, plan, added_at, expires_at
       FROM premium_users
       ORDER BY added_at DESC`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /admin/premium/add — manually add a premium user
app.post("/admin/premium/add", adminAuth, async (req, res) => {
  try {
    const { telegram_id, first_name, last_name, username, plan, days } = req.body;
    if (!telegram_id) return res.status(400).json({ error: "telegram_id required" });

    let expiresAt = null;
    const d = Number(days);
    if (d > 0) {
      expiresAt = new Date(Date.now() + d * 24 * 60 * 60 * 1000);
    }

    await pool.execute(
      `INSERT INTO premium_users (telegram_id, first_name, last_name, username, plan, expires_at)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         plan       = VALUES(plan),
         expires_at = VALUES(expires_at),
         first_name = VALUES(first_name),
         last_name  = VALUES(last_name),
         username   = VALUES(username)`,
      [telegram_id, first_name || "", last_name || "", username || "", plan || "Manual", expiresAt]
    );

    // Notify the user via bot
    await sendMessage(telegram_id,
      `🎉 <b>You have been added to Premium!</b>\n\n` +
      `🎁 Plan: <b>${plan || "Manual"}</b>\n` +
      `📅 Expires: <b>${fmtDate(expiresAt)}</b>\n\n` +
      `Open the app to enjoy your premium access! 🚀`
    );

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /admin/premium/:telegramId — remove a premium user
app.delete("/admin/premium/:telegramId", adminAuth, async (req, res) => {
  try {
    const tid = req.params.telegramId;
    await pool.execute("DELETE FROM premium_users WHERE telegram_id=?", [tid]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /admin/payments — list recent pending payments
app.get("/admin/payments", adminAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM pending_payments ORDER BY submitted_at DESC LIMIT 200`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  GITHUB BACKUP
// ═══════════════════════════════════════════════════════════════

async function backupToGitHub() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.warn("GitHub backup skipped: GITHUB_TOKEN or GITHUB_REPO not set");
    return { success: false, reason: "env vars missing" };
  }

  try {
    // Fetch all currently active premium user IDs
    const [rows] = await pool.execute(
      `SELECT telegram_id FROM premium_users
       WHERE expires_at IS NULL OR expires_at > NOW()`
    );
    const ids = rows.map(r => r.telegram_id);

    // Build the premiumlist.js content
    const fileContent =
      `// Auto-backup from Railway MySQL — ${new Date().toUTCString()}\n` +
      `// Do not edit manually. Source of truth is the Railway database.\n` +
      `const premiumUsers = [\n` +
      ids.map(id => `  ${id},`).join("\n") +
      `\n];\n`;

    const b64Content = Buffer.from(fileContent).toString("base64");
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`;

    const headers = {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json"
    };

    // Get current file SHA (needed for update)
    let sha = undefined;
    const getRes = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers });
    if (getRes.ok) {
      const getData = await getRes.json();
      sha = getData.sha;
    }

    // Push the file
    const body = {
      message: `🔄 Premium backup — ${new Date().toISOString()} (${ids.length} users)`,
      content: b64Content,
      branch: GITHUB_BRANCH
    };
    if (sha) body.sha = sha;

    const putRes = await fetch(apiUrl, { method: "PUT", headers, body: JSON.stringify(body) });
    const putData = await putRes.json();

    if (putData.content) {
      console.log(`✅ GitHub backup done: ${ids.length} users`);
      return { success: true, users: ids.length };
    } else {
      console.error("GitHub backup failed:", JSON.stringify(putData));
      return { success: false, error: JSON.stringify(putData) };
    }
  } catch (e) {
    console.error("GitHub backup error:", e.message);
    return { success: false, error: e.message };
  }
}

// Auto backup every 2 hours
cron.schedule("0 */2 * * *", () => {
  console.log("⏰ Auto GitHub backup starting...");
  backupToGitHub();
});

// POST /admin/backup — manual GitHub backup
app.post("/admin/backup", adminAuth, async (req, res) => {
  try {
    const result = await backupToGitHub();
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  WEBHOOK SETUP HELPER
// ═══════════════════════════════════════════════════════════════
// Visit once to register your webhook with Telegram:
// GET /setup/webhook?url=https://yourapp.up.railway.app/bot/webhook&password=YOUR_ADMIN_PASSWORD

app.get("/setup/webhook", adminAuth, async (req, res) => {
  try {
    const webhookUrl = req.query.url;
    if (!webhookUrl) return res.status(400).json({ error: "?url= required" });

    const result = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl, allowed_updates: ["callback_query", "message"] })
      }
    );
    const data = await result.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /setup/webhook-info — check current webhook
app.get("/setup/webhook-info", adminAuth, async (req, res) => {
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    const d = await r.json();
    res.json(d);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  START SERVER
// ═══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Intel Premium Server running on port ${PORT}`);
      console.log(`   Telegram webhook:  POST /bot/webhook`);
      console.log(`   Premium check:     GET  /premium/check/:telegramId`);
      console.log(`   Submit payment:    POST /payment/submit`);
      console.log(`   Admin panel API:   GET  /admin/premium  (requires x-admin-password)`);
    });
  })
  .catch(e => {
    console.error("❌ DB init failed:", e.message);
    process.exit(1);
  });
