const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_TELEGRAM_ID;

app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", project: "ZoriqStars" });
});

// Проверка владельца через Telegram Web App
app.post("/api/admin-check", (req, res) => {
  if (!BOT_TOKEN || !OWNER_ID) {
    return res.status(503).json({ ok: false });
  }

  const initData = req.body.initData;

  if (typeof initData !== "string" || !initData) {
    return res.status(401).json({ ok: false });
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    return res.status(401).json({ ok: false });
  }

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const validHash = crypto.timingSafeEqual(
    Buffer.from(receivedHash, "hex"),
    Buffer.from(calculatedHash, "hex")
  );

  if (!validHash) {
    return res.status(401).json({ ok: false });
  }

  const userData = params.get("user");
  const authDate = Number(params.get("auth_date"));

  if (!userData || !Number.isFinite(authDate)) {
    return res.status(401).json({ ok: false });
  }

  if (
    authDate > Math.floor(Date.now() / 1000) + 60 ||
    Math.floor(Date.now() / 1000) - authDate > 86400
  ) {
    return res.status(401).json({ ok: false });
  }

  let user;

  try {
    user = JSON.parse(userData);
  } catch {
    return res.status(401).json({ ok: false });
  }

  if (String(user.id) !== String(OWNER_ID)) {
    return res.status(403).json({ ok: false });
  }

  return res.json({ ok: true, message: "Доступ разрешён" });
});

if (BOT_TOKEN) {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      "Добро пожаловать в ZoriqStars! ⭐\nВыбери нужный раздел:",
      {
        reply_markup: {
          inline_keyboard: [
            [{
              text: "Открыть приложение",
              web_app: {
                url: "https://zoriqstars-app-2026.onrender.com"
              }
            }],
            [{
              text: "Telegram Stars",
              url: "https://telegram.org/blog/telegram-stars"
            }],
            [{
              text: "Telegram Premium",
              url: "https://telegram.org/faq_premium"
            }],
            [{
              text: "Поддержка",
              callback_data: "support"
            }]
          ]
        }
      }
    );
  });

  bot.on("callback_query", (query) => {
    if (query.data === "support") {
      bot.answerCallbackQuery(query.id, {
        text: "Раздел поддержки пока готовится."
      });
    }
  });

  bot.on("polling_error", (error) => {
    console.log("Telegram polling error:", error.message);
  });
}

app.listen(PORT, () => {
  console.log("ZoriqStars server started on port " + PORT);
});
