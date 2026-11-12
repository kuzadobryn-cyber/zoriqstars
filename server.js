const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "100kb" }));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_TELEGRAM_ID;

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, status: "running" });
});

// Демонстрационные товары
let products = [
  { id: "stars", name: "Telegram Stars", price: 100, description: "Тестовые баллы" },
  { id: "premium", name: "Telegram Premium", price: 300, description: "Демо-товар" }
];

// Временное хранилище тестовых заказов
let orders = [];

// Проверка подлинности Telegram Mini App
function verifyTelegramData(initData) {
  if (!BOT_TOKEN || !initData) return null;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;

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

    const a = Buffer.from(calculatedHash, "hex");
    const b = Buffer.from(hash, "hex");

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }

    const authDate = Number(params.get("auth_date"));
    if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 86400) {
      return null;
    }

    const user = JSON.parse(params.get("user") || "{}");
    return user;
  } catch {
    return null;
  }
}

function getInitData(req) {
  return req.headers["x-telegram-init-data"] || req.body?.initData || "";
}

function requireTelegram(req, res, next) {
  const user = verifyTelegramData(getInitData(req));

  if (!user) {
    return res.status(401).json({ ok: false, error: "Telegram authorization required" });
  }

  req.telegramUser = user;
  next();
}

function requireOwner(req, res, next) {
  const user = verifyTelegramData(getInitData(req));

  if (!user || !OWNER_ID || String(user.id) !== String(OWNER_ID)) {
    return res.status(403).json({ ok: false, error: "Access denied" });
  }

  req.telegramUser = user;
  next();
}

// Проверка владельца
app.post("/api/admin-check", requireOwner, (req, res) => {
  res.json({ ok: true, owner: true });
});

// Создание демонстрационного заказа
app.post("/api/orders", requireTelegram, (req, res) => {
  const items = req.body?.items;

  if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
    return res.status(400).json({ ok: false, error: "Invalid items" });
  }

  const checkedItems = [];

  for (const item of items) {
    const product = products.find(p => p.id === item.id);
    const quantity = Number(item.quantity);

    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      return res.status(400).json({ ok: false, error: "Invalid product or quantity" });
    }

    checkedItems.push({
      id: product.id,
      name: product.name,
      quantity,
      price: product.price
    });
  }

  const total = checkedItems.reduce(
    (sum, item) => sum + item.price * item.quantity, 0
  );

  const order = {
    id: "DEMO-" + Date.now().toString().slice(-8),
    date: new Date().toISOString(),
    userId: String(req.telegramUser.id),
    items: checkedItems,
    total,
    status: "Тестовый"
  };

  orders.unshift(order);
  res.json({ ok: true, order });
});

// Все следующие маршруты доступны только владельцу
app.get("/api/admin/stats", requireOwner, (req, res) => {
  res.json({
    ok: true,
    ordersCount: orders.length,
    totalPoints: orders.reduce((sum, order) => sum + order.total, 0),
    productsCount: products.length
  });
});

app.get("/api/admin/orders", requireOwner, (req, res) => {
  res.json({ ok: true, orders });
});

app.get("/api/admin/products", requireOwner, (req, res) => {
  res.json({ ok: true, products });
});

app.post("/api/admin/products", requireOwner, (req, res) => {
  const { name, price, description } = req.body || {};

  if (
    typeof name !== "string" || !name.trim() ||
    name.length > 60 ||
    !Number.isInteger(Number(price)) ||
    Number(price) < 0 || Number(price) > 1000000
  ) {
    return res.status(400).json({ ok: false, error: "Invalid product data" });
  }

  const product = {
    id: crypto.randomUUID(),
    name: name.trim(),
    price: Number(price),
    description: typeof description === "string"
      ? description.slice(0, 300) : ""
  };

  products.push(product);
  res.json({ ok: true, product });
});

app.put("/api/admin/products/:id", requireOwner, (req, res) => {
  const product = products.find(p => p.id === req.params.id);
  if (!product) {
    return res.status(404).json({ ok: false, error: "Product not found" });
  }

  const { name, price, description } = req.body || {};

  if (
    typeof name !== "string" || !name.trim() ||
    name.length > 60 ||
    !Number.isInteger(Number(price)) ||
    Number(price) < 0 || Number(price) > 1000000
  ) {
    return res.status(400).json({ ok: false, error: "Invalid product data" });
  }

  product.name = name.trim();
  product.price = Number(price);
  product.description = typeof description === "string"
    ? description.slice(0, 300) : "";

  res.json({ ok: true, product });
});

app.delete("/api/admin/products/:id", requireOwner, (req, res) => {
  const index = products.findIndex(p => p.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ ok: false, error: "Product not found" });
  }

  products.splice(index, 1);
  res.json({ ok: true });
});

// Telegram-бот
if (BOT_TOKEN) {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      "Добро пожаловать в ZoriqStars! ⭐\n\nЭто демонстрационный каталог.",
      {
        reply_markup: {
          inline_keyboard: [
            [{
              text: "Открыть ZoriqStars",
              web_app: { url: "https://zoriqstars-app-2026.onrender.com" }
            }],
            [{
              text: "Информация о Telegram Stars",
              url: "https://telegram.org/blog/telegram-stars"
            }],
            [{
              text: "Telegram Premium FAQ",
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

  bot.on("callback_query", async (query) => {
    if (query.data === "support") {
      await bot.answerCallbackQuery(query.id, {
        text: "Раздел поддержки пока готовится."
      });
    }
  });

  bot.on("polling_error", (error) => {
    console.log("Telegram polling error:", error.message);
  });
}

app.listen(PORT, () => {
  console.log(`ZoriqStars server running on port ${PORT}`);
});
