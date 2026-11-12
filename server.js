const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const crypto = require("crypto");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.use(express.json({ limit: "100kb" }));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_TELEGRAM_ID;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is not configured");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ...(process.env.PGSSLMODE === "require"
    ? { ssl: { rejectUnauthorized: false } }
    : {})
});

// Создание таблиц и первоначальных демонстрационных товаров
async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price >= 0),
      description TEXT NOT NULL DEFAULT ''
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      user_id TEXT NOT NULL,
      items JSONB NOT NULL,
      total INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Тестовый'
    )
  `);

  const result = await pool.query(
    "SELECT COUNT(*)::int AS count FROM products"
  );

  if (result.rows[0].count === 0) {
    await pool.query(
      `INSERT INTO products (id, name, price, description)
       VALUES
       ($1, $2, $3, $4),
       ($5, $6, $7, $8)`,
      [
        "stars",
        "Telegram Stars",
        100,
        "Тестовые баллы",
        "premium",
        "Telegram Premium",
        300,
        "Демо-товар"
      ]
    );
  }

  console.log("PostgreSQL database is ready");
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, status: "running", database: "connected" });
  } catch (error) {
    console.error("Health check error:", error.message);
    res.status(503).json({
      ok: false,
      status: "running",
      database: "disconnected"
    });
  }
});

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

    if (
      !authDate ||
      Math.abs(Date.now() / 1000 - authDate) > 86400
    ) {
      return null;
    }

    return JSON.parse(params.get("user") || "{}");
  } catch {
    return null;
  }
}

function getInitData(req) {
  return req.headers["x-telegram-init-data"] ||
    req.body?.initData ||
    "";
}

function requireTelegram(req, res, next) {
  const user = verifyTelegramData(getInitData(req));

  if (!user) {
    return res.status(401).json({
      ok: false,
      error: "Telegram authorization required"
    });
  }

  req.telegramUser = user;
  next();
}

function requireOwner(req, res, next) {
  const user = verifyTelegramData(getInitData(req));

  if (
    !user ||
    !OWNER_ID ||
    String(user.id) !== String(OWNER_ID)
  ) {
    return res.status(403).json({
      ok: false,
      error: "Access denied"
    });
  }

  req.telegramUser = user;
  next();
}

// Публичный каталог
app.get("/api/products", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, price, description FROM products ORDER BY name"
    );

    res.json({ ok: true, products: result.rows });
  } catch (error) {
    console.error("Products error:", error.message);
    res.status(500).json({ ok: false, error: "Database error" });
  }
});

// Проверка владельца
app.post("/api/admin-check", requireOwner, (req, res) => {
  res.json({ ok: true, owner: true });
});

// Создание демонстрационного заказа
app.post("/api/orders", requireTelegram, async (req, res) => {
  try {
    const items = req.body?.items;

    if (
      !Array.isArray(items) ||
      items.length === 0 ||
      items.length > 20
    ) {
      return res.status(400).json({
        ok: false,
        error: "Invalid items"
      });
    }

    const productResult = await pool.query(
      "SELECT id, name, price FROM products"
    );

    const products = productResult.rows;
    const checkedItems = [];

    for (const item of items) {
      const product = products.find(p => p.id === item.id);
      const quantity = Number(item.quantity);

      if (
        !product ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 50
      ) {
        return res.status(400).json({
          ok: false,
          error: "Invalid product or quantity"
        });
      }

      checkedItems.push({
        id: product.id,
        name: product.name,
        quantity,
        price: product.price
      });
    }

    const total = checkedItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    const order = {
      id: "DEMO-" + crypto.randomUUID().slice(0, 8),
      date: new Date().toISOString(),
      userId: String(req.telegramUser.id),
      items: checkedItems,
      total,
      status: "Тестовый"
    };

    await pool.query(
      `INSERT INTO orders (id, created_at, user_id, items, total, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        order.id,
        order.date,
        order.userId,
        JSON.stringify(order.items),
        order.total,
        order.status
      ]
    );

    res.json({ ok: true, order });
  } catch (error) {
    console.error("Create order error:", error.message);
    res.status(500).json({ ok: false, error: "Database error" });
  }
});

// Статистика
app.get("/api/admin/stats", requireOwner, async (req, res) => {
  try {
    const [ordersResult, productsResult] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS count,
          COALESCE(SUM(total), 0)::int AS total
        FROM orders
      `),
      pool.query("SELECT COUNT(*)::int AS count FROM products")
    ]);

    res.json({
      ok: true,
      ordersCount: ordersResult.rows[0].count,
      totalPoints: ordersResult.rows[0].total,
      productsCount: productsResult.rows[0].count
    });
  } catch (error) {
    console.error("Stats error:", error.message);
    res.status(500).json({ ok: false, error: "Database error" });
  }
});

// Список заказов
app.get("/api/admin/orders", requireOwner, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        created_at AS date,
        user_id AS "userId",
        items,
        total,
        status
      FROM orders
      ORDER BY created_at DESC
    `);

    res.json({ ok: true, orders: result.rows });
  } catch (error) {
    console.error("Orders error:", error.message);
    res.status(500).json({ ok: false, error: "Database error" });
  }
});

// Список товаров для админ-панели
app.get("/api/admin/products", requireOwner, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, price, description FROM products ORDER BY name"
    );

    res.json({ ok: true, products: result.rows });
  } catch (error) {
    console.error("Admin products error:", error.message);
    res.status(500).json({ ok: false, error: "Database error" });
  }
});

// Добавление товара
app.post("/api/admin/products", requireOwner, async (req, res) => {
  try {
    const { name, price, description } = req.body || {};

    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 60 ||
      !Number.isInteger(Number(price)) ||
      Number(price) < 0 ||
      Number(price) > 1000000
    ) {
      return res.status(400).json({
        ok: false,
        error: "Invalid product data"
      });
    }

    const product = {
      id: crypto.randomUUID(),
      name: name.trim(),
      price: Number(price),
      description: typeof description === "string"
        ? description.slice(0, 300)
        : ""
    };

    await pool.query(
      `INSERT INTO products (id, name, price, description)
       VALUES ($1, $2, $3, $4)`,
      [
        product.id,
        product.name,
        product.price,
        product.description
      ]
    );

    res.json({ ok: true, product });
  } catch (error) {
    console.error("Add product error:", error.message);
    res.status(500).json({ ok: false, error: "Database error" });
  }
});

// Редактирование товара
app.put("/api/admin/products/:id", requireOwner, async (req, res) => {
  try {
    const { name, price, description } = req.body || {};

    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 60 ||
      !Number.isInteger(Number(price)) ||
      Number(price) < 0 ||
      Number(price) > 1000000
    ) {
      return res.status(400).json({
        ok: false,
        error: "Invalid product data"
      });
    }

    const result = await pool.query(
      `UPDATE products
       SET name = $1, price = $2, description = $3
       WHERE id = $4
       RETURNING id, name, price, description`,
      [
        name.trim(),
        Number(price),
        typeof description === "string"
          ? description.slice(0, 300)
          : "",
        req.params.id
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        error: "Product not found"
      });
    }

    res.json({ ok: true, product: result.rows[0] });
  } catch (error) {
    console.error("Edit product error:", error.message);
    res.status(500).json({ ok: false, error: "Database error" });
  }
});

// Удаление товара
app.delete("/api/admin/products/:id", requireOwner, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM products WHERE id = $1",
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        error: "Product not found"
      });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("Delete product error:", error.message);
    res.status(500).json({ ok: false, error: "Database error" });
  }
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
              web_app: {
                url: "https://zoriqstars-app-2026.onrender.com"
              }
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

// Запуск только после подключения к базе
async function startServer() {
  try {
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(`ZoriqStars server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup error:", error);
    process.exit(1);
  }
}

startServer();
