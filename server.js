const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", project: "ZoriqStars" });
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
            [
              {
                text: "Открыть приложение",
                web_app: {
                  url: "https://zoriqstars-app-2026.onrender.com"
                }
              }
            ],
            [
              {
                text: "Telegram Stars",
                url: "https://telegram.org/blog/telegram-stars"
              }
            ],
            [
              {
                text: "Telegram Premium",
                url: "https://telegram.org/faq_premium"
              }
            ],
            [
              {
                text: "Поддержка",
                callback_data: "support"
              }
            ]
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

  console.log("Telegram bot started");
} else {
  console.log("BOT_TOKEN is not configured");
}

app.listen(PORT, () => {
  console.log("ZoriqStars server started on port " + PORT);
});
