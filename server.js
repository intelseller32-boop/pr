// ═══════════════════════════════════════════════════════════════
//  Intel Premium Server — server.js
// ═══════════════════════════════════════════════════════════════

const express  = require("express");
const mysql    = require("mysql2/promise");
const multer   = require("multer");
const fetch    = require("node-fetch");
const FormData = require("form-data");
const cron     = require("node-cron");
const cors     = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const BOT_TOKEN      = process.env.BOT_TOKEN;
const ADMIN_ID       = process.env.ADMIN_TELEGRAM_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
const GITHUB_REPO    = process.env.GITHUB_REPO;
const GITHUB_BRANCH  = process.env.GITHUB_BRANCH   || "main";
const GITHUB_FILE    = process.env.GITHUB_FILE_PATH || "da/premiumlist.js";

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

async function initDB() {
  const conn = await pool.getConnection();
  try {
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
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS pending_payments (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        telegram_id  BIGINT       NOT NULL,
        first_name   VARCHAR(255) DEFAULT '',
        last_name    VARCHAR(255) DEFAULT '',
        username     VARCHAR(255) DEFAULT '',
        plan         VARCHAR(150) DEFAULT '',
        method       VARCHAR(20)  DEFAULT '',
        whatsapp     VARCHAR(30)  DEFAULT '',
        submitted_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        status       VARCHAR(20)  DEFAULT 'pending'
      )
    `);
    // Prevents seed from re-running on every restart
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS seed_log (
        id       INT AUTO_INCREMENT PRIMARY KEY,
        seed_key VARCHAR(100) UNIQUE NOT NULL,
        ran_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Database tables ready");
  } finally {
    conn.release();
  }
}

// ═══════════════════════════════════════════════════════════════
//  SEED — Import all users from old premiumlist.js on first deploy
//  Runs exactly ONCE, tracked by seed_log table.
//  Forever users get NULL expires_at.
//  Timed users get their known expiry date (skipped if already expired).
// ═══════════════════════════════════════════════════════════════
async function seedInitialUsers() {
  const conn = await pool.getConnection();
  try {
    const [existing] = await conn.execute(
      "SELECT id FROM seed_log WHERE seed_key = 'premiumlist_v1'"
    );
    if (existing.length > 0) {
      console.log("Seed already ran — skipping");
      return;
    }

    // Forever users from premiumlist.js
    const foreverUsers = [
      7979664801,
      6976365864,
      1687251080,
      6853136424,
      8432864246,
      6551769849,
      7593407632,
      7504892727,
      6693705429,
      1945280994,
      6391087192,
      7457769202,
      8290211822,
      8117626715,
      1453573199,
      5085293272,
      8553267554,
    ];

    // Timed users — add more here if needed
    const timedUsers = [
      { id: 7762146760, expires: new Date("2026-04-05T23:59:59Z"), plan: "One week plan" },
    ];

    let inserted = 0;

    for (const tid of foreverUsers) {
      await conn.execute(
        "INSERT IGNORE INTO premium_users (telegram_id, first_name, last_name, username, plan, expires_at) VALUES (?, '', '', '', 'Forever One time payment', NULL)",
        [tid]
      );
      inserted++;
    }

    for (const u of timedUsers) {
      if (u.expires > new Date()) {
        await conn.execute(
          "INSERT IGNORE INTO premium_users (telegram_id, first_name, last_name, username, plan, expires_at) VALUES (?, '', '', '', ?, ?)",
          [u.id, u.plan, u.expires]
        );
        inserted++;
      } else {
        console.log("Skipping " + u.id + " — plan expired");
      }
    }

    await conn.execute("INSERT IGNORE INTO seed_log (seed_key) VALUES ('premiumlist_v1')");
    console.log("Seed complete — " + inserted + " users imported from premiumlist.js");
  } catch (e) {
    console.error("Seed error (non-fatal):", e.message);
  } finally {
    conn.release();
  }
}

// Helpers
async function sendMessage(chatId, text) {
  try {
    await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true })
    });
  } catch (e) { console.error("sendMessage error:", e.message); }
}

async function answerCallback(cbqId, text) {
  try {
    await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/answerCallbackQuery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: cbqId, text, show_alert: false })
    });
  } catch (e) { console.error("answerCallback error:", e.message); }
}

async function editCaption(chatId, messageId, newCaption) {
  try {
    await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/editMessageCaption", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, caption: newCaption.substring(0, 1024) })
    });
  } catch (e) { console.error("editCaption error:", e.message); }
}

function planExpiry(planStr) {
  const p = (planStr || "").toLowerCase();
  if (p.includes("one week") || p.includes("1 week") || p.includes("7 day"))
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  if (p.includes("two week") || p.includes("2 week") || p.includes("14 day"))
    return new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  return null;
}

function fmtDate(d) { return d ? new Date(d).toUTCString() : "Forever"; }

function adminAuth(req, res, next) {
  const pass = req.headers["x-admin-password"] || req.query.password || req.body && req.body.password;
  if (!pass || pass !== ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// Routes
app.get("/", (req, res) => res.json({ status: "ok", service: "Intel Premium Server" }));

app.get("/premium/check/:telegramId", async (req, res) => {
  try {
    const tid = Number(req.params.telegramId);
    if (!tid) return res.json({ isPremium: false });
    const [rows] = await pool.execute(
      "SELECT id, first_name, last_name, username, plan, expires_at FROM premium_users WHERE telegram_id = ? AND (expires_at IS NULL OR expires_at > NOW())",
      [tid]
    );
    return res.json(rows.length > 0 ? { isPremium: true, user: rows[0] } : { isPremium: false });
  } catch (e) { res.status(500).json({ isPremium: false, error: e.message }); }
});

app.post("/payment/submit", upload.single("photo"), async (req, res) => {
  try {
    const { telegram_id, first_name, last_name, username, plan, method, whatsapp } = req.body;
    const photo = req.file;
    if (!telegram_id) return res.status(400).json({ error: "telegram_id required" });
    if (!photo) return res.status(400).json({ error: "photo required" });

    await pool.execute(
      "INSERT INTO pending_payments (telegram_id, first_name, last_name, username, plan, method, whatsapp) VALUES (?,?,?,?,?,?,?)",
      [telegram_id, first_name||"", last_name||"", username||"", plan||"", method||"", whatsapp||""]
    );
    const [[{ id: paymentId }]] = await pool.execute("SELECT LAST_INSERT_ID() AS id");

    const caption = "NEW PAYMENT REQUEST\n" +
      "Name: " + (first_name||"") + " " + (last_name||"") + "\n" +
      "Username: @" + (username||"N/A") + "\n" +
      "Telegram ID: " + telegram_id + "\n" +
      "Plan: " + (plan||"N/A") + "\n" +
      "Method: " + (method||"N/A") + "\n" +
      "WhatsApp: " + (whatsapp||"N/A") + "\n" +
      "Payment ID: #" + paymentId;

    const keyboard = { inline_keyboard: [[
      { text: "CONFIRM", callback_data: "confirm:" + telegram_id + ":" + paymentId },
      { text: "DECLINE", callback_data: "decline:" + telegram_id + ":" + paymentId }
    ]]};

    const fd = new FormData();
    fd.append("chat_id", ADMIN_ID);
    fd.append("photo", photo.buffer, { filename: photo.originalname||"proof.jpg", contentType: photo.mimetype||"image/jpeg" });
    fd.append("caption", caption);
    fd.append("reply_markup", JSON.stringify(keyboard));

    const tgRes = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendPhoto", { method: "POST", body: fd });
    const tgData = await tgRes.json();
    if (!tgData.ok) console.error("sendPhoto failed:", tgData);

    await sendMessage(telegram_id,
      "<b>Payment Submitted!</b>\n\nPayment ID: <b>#" + paymentId + "</b>\nPlan: <b>" + plan + "</b>\n\nAdmin will review shortly. Thank you!"
    );
    res.json({ success: true, paymentId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/bot/webhook", async (req, res) => {
  res.json({ ok: true });
  try {
    const update = req.body;
    if (!update.callback_query) return;
    const cbq   = update.callback_query;
    const parts = (cbq.data || "").split(":");
    if (parts.length < 3) return;
    const [action,, paymentId] = parts;

    if (String(cbq.from.id) !== String(ADMIN_ID)) { await answerCallback(cbq.id, "Not authorized"); return; }

    const [rows] = await pool.execute("SELECT * FROM pending_payments WHERE id=?", [paymentId]);
    if (!rows.length) { await answerCallback(cbq.id, "Payment not found"); return; }
    const p = rows[0];
    if (p.status !== "pending") { await answerCallback(cbq.id, "Already " + p.status); return; }

    if (action === "confirm") {
      const expiry = planExpiry(p.plan);
      await pool.execute(
        "INSERT INTO premium_users (telegram_id, first_name, last_name, username, plan, expires_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE plan=VALUES(plan), expires_at=VALUES(expires_at), first_name=VALUES(first_name), last_name=VALUES(last_name), username=VALUES(username)",
        [p.telegram_id, p.first_name, p.last_name, p.username, p.plan, expiry]
      );
      await pool.execute("UPDATE pending_payments SET status='confirmed' WHERE id=?", [paymentId]);
      await sendMessage(p.telegram_id,
        "<b>Payment Confirmed!</b>\n\nPlan: <b>" + p.plan + "</b>\nExpires: <b>" + fmtDate(expiry) + "</b>\n\nYou now have full premium access!"
      );
      await editCaption(cbq.message.chat.id, cbq.message.message_id, cbq.message.caption + "\n\nCONFIRMED\nExpires: " + fmtDate(expiry));
      await answerCallback(cbq.id, "User confirmed!");
    } else if (action === "decline") {
      await pool.execute("UPDATE pending_payments SET status='declined' WHERE id=?", [paymentId]);
      await sendMessage(p.telegram_id,
        "<b>Payment Declined</b>\n\nYour payment for <b>" + p.plan + "</b> was declined.\n\nContact admin: <a href='https://wa.me/2349114301708'>WhatsApp</a>"
      );
      await editCaption(cbq.message.chat.id, cbq.message.message_id, cbq.message.caption + "\n\nDECLINED by admin");
      await answerCallback(cbq.id, "User declined.");
    }
  } catch (e) { console.error("Webhook error:", e.message); }
});

app.get("/admin/premium", adminAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT id, telegram_id, first_name, last_name, username, plan, added_at, expires_at FROM premium_users ORDER BY added_at DESC");
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/admin/stats", adminAuth, async (req, res) => {
  try {
    const [[{ total }]]   = await pool.execute("SELECT COUNT(*) AS total FROM premium_users WHERE expires_at IS NULL OR expires_at > NOW()");
    const [[{ forever }]] = await pool.execute("SELECT COUNT(*) AS forever FROM premium_users WHERE expires_at IS NULL");
    const [[{ timed }]]   = await pool.execute("SELECT COUNT(*) AS timed FROM premium_users WHERE expires_at > NOW()");
    const [[{ pending }]] = await pool.execute("SELECT COUNT(*) AS pending FROM pending_payments WHERE status='pending'");
    res.json({ total, forever, timed, pending });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/admin/premium/add", adminAuth, async (req, res) => {
  try {
    const { telegram_id, first_name, last_name, username, plan, days } = req.body;
    if (!telegram_id) return res.status(400).json({ error: "telegram_id required" });
    const expiresAt = Number(days) > 0 ? new Date(Date.now() + Number(days) * 86400000) : null;
    await pool.execute(
      "INSERT INTO premium_users (telegram_id, first_name, last_name, username, plan, expires_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE plan=VALUES(plan), expires_at=VALUES(expires_at), first_name=VALUES(first_name), last_name=VALUES(last_name), username=VALUES(username)",
      [telegram_id, first_name||"", last_name||"", username||"", plan||"Manual", expiresAt]
    );
    await sendMessage(telegram_id,
      "<b>Added to Premium!</b>\n\nPlan: <b>" + (plan||"Manual") + "</b>\nExpires: <b>" + fmtDate(expiresAt) + "</b>"
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/admin/premium/:telegramId", adminAuth, async (req, res) => {
  try {
    await pool.execute("DELETE FROM premium_users WHERE telegram_id=?", [req.params.telegramId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/admin/payments", adminAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT * FROM pending_payments ORDER BY submitted_at DESC LIMIT 200");
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function backupToGitHub() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return { success: false, reason: "env vars missing" };
  try {
    const [rows] = await pool.execute("SELECT telegram_id FROM premium_users WHERE expires_at IS NULL OR expires_at > NOW()");
    const ids = rows.map(function(r) { return r.telegram_id; });
    const content = "// Auto-backup from Railway MySQL — " + new Date().toUTCString() + "\n// Source of truth is the Railway database.\nconst premiumUsers = [\n" + ids.map(function(id) { return "  " + id + ","; }).join("\n") + "\n];\n";
    const b64 = Buffer.from(content).toString("base64");
    const apiUrl = "https://api.github.com/repos/" + GITHUB_REPO + "/contents/" + GITHUB_FILE;
    const headers = { Authorization: "token " + GITHUB_TOKEN, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" };
    let sha;
    const get = await fetch(apiUrl + "?ref=" + GITHUB_BRANCH, { headers });
    if (get.ok) sha = (await get.json()).sha;
    const body = { message: "Backup " + new Date().toISOString() + " (" + ids.length + " users)", content: b64, branch: GITHUB_BRANCH };
    if (sha) body.sha = sha;
    const put = await fetch(apiUrl, { method: "PUT", headers, body: JSON.stringify(body) });
    const putData = await put.json();
    return putData.content ? { success: true, users: ids.length } : { success: false, error: JSON.stringify(putData) };
  } catch (e) { return { success: false, error: e.message }; }
}

cron.schedule("0 */2 * * *", function() { backupToGitHub(); });

app.post("/admin/backup", adminAuth, async (req, res) => {
  try { res.json(await backupToGitHub()); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get("/setup/webhook", adminAuth, async (req, res) => {
  try {
    if (!req.query.url) return res.status(400).json({ error: "?url= required" });
    const r = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/setWebhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: req.query.url, allowed_updates: ["callback_query", "message"] })
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/setup/webhook-info", adminAuth, async (req, res) => {
  try {
    const r = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/getWebhookInfo");
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
initDB()
  .then(function() { return seedInitialUsers(); })
  .then(function() {
    app.listen(PORT, function() {
      console.log("Intel Premium Server running on port " + PORT);
    });
  })
  .catch(function(e) { console.error("DB init failed:", e.message); process.exit(1); });
