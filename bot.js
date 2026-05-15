// burn60 Telegram Bot + Reminder System
// Stack: Node.js + telegraf + node-cron
// Deploy: Railway / Render (free tier)

import { Telegraf, Markup } from "telegraf";
import cron from "node-cron";

const BOT_TOKEN = process.env.BOT_TOKEN || "8297747371:AAHzD3Cgb1vKV6YBJBwNjt0TskGzRtGL7aA";
const MINI_APP_URL = process.env.MINI_APP_URL || "https://your-app.vercel.app";
const TRAINER_CHAT_ID = process.env.TRAINER_CHAT_ID || ""; // заполни после первого /start

const bot = new Telegraf(BOT_TOKEN);

// ─── IN-MEMORY STORAGE (замени на DB позже) ────────────────────────────────
// В продакшене используй PostgreSQL / Supabase / MongoDB
let clients = [
  {
    id: 1,
    name: "Азиз",
    telegramId: null, // заполняется когда клиент нажимает /start
    telegramUsername: null,
    goal: "Набрать 5 кг мышц",
    type: "personal",
    plan: "16 трен.",
    price: 1400000,
    total: 16,
    used: 10,
    remaining: 6,
    start: "2025-04-10",
    end: "2025-05-10",
    paid: true,
    time: "08:00",
  },
  {
    id: 2,
    name: "Камила",
    telegramId: null,
    telegramUsername: null,
    goal: "Похудеть к лету",
    type: "personal",
    plan: "16 трен.",
    price: 1400000,
    total: 16,
    used: 14,
    remaining: 2,
    start: "2025-04-12",
    end: "2025-05-12",
    paid: true,
    time: "09:00",
  },
  {
    id: 3,
    name: "Нилуфар",
    telegramId: null,
    telegramUsername: null,
    goal: "Выносливость",
    type: "group",
    plan: "10 трен.",
    price: 300000,
    total: 10,
    used: 8,
    remaining: 2,
    start: "2025-04-20",
    end: "2025-05-20",
    paid: false,
    time: "19:00",
  },
];

// ─── HELPERS ───────────────────────────────────────────────────────────────
function daysUntil(dateString) {
  if (!dateString) return 999;
  const today = new Date();
  const end = new Date(dateString);
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.ceil((end - today) / (1000 * 60 * 60 * 24));
}

function fmtS(n) {
  return n.toLocaleString("ru-RU") + " сум";
}

function getStatus(c) {
  if (!c.paid) return "unpaid";
  const d = daysUntil(c.end);
  if (c.remaining <= 0 || d < 0) return "expired";
  if (c.remaining <= 3 || d <= 5) return "ending_soon";
  return "active";
}

function isTrainer(ctx) {
  return TRAINER_CHAT_ID && String(ctx.from.id) === String(TRAINER_CHAT_ID);
}

function findClientByTelegramId(telegramId) {
  return clients.find(c => String(c.telegramId) === String(telegramId));
}

// ─── BOT COMMANDS ─────────────────────────────────────────────────────────

// /start — регистрация
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username;
  const firstName = ctx.from.first_name;

  // Проверяем тренер это или нет
  if (isTrainer(ctx)) {
    await ctx.reply(
      `👋 Привет, тренер!\n\nОткрой панель управления:`,
      Markup.inlineKeyboard([
        [Markup.button.webApp("🏋️ Открыть панель тренера", MINI_APP_URL + "?role=trainer")],
        [Markup.button.callback("👥 Все клиенты", "list_clients")],
        [Markup.button.callback("⚠️ Нужно внимание", "attention_clients")],
      ])
    );
    return;
  }

  // Ищем клиента по username
  let client = clients.find(c =>
    username && c.name.toLowerCase() === firstName.toLowerCase() ||
    c.telegramUsername === username
  );

  if (client) {
    // Привязываем telegramId
    client.telegramId = userId;
    client.telegramUsername = username;

    const status = getStatus(client);
    const statusEmoji = status === "active" ? "✅" : status === "ending_soon" ? "⚠️" : "❌";
    const daysLeft = daysUntil(client.end);

    await ctx.reply(
      `${statusEmoji} Привет, ${client.name}!\n\n` +
      `📋 *Твой абонемент:* ${client.plan}\n` +
      `🏃 Осталось тренировок: *${client.remaining}* из ${client.total}\n` +
      `📅 До окончания: *${daysLeft} дней*\n` +
      `💰 Оплата: ${client.paid ? "✅ Оплачено" : "❌ Не оплачено"}`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.webApp("📱 Открыть абонемент", MINI_APP_URL + `?role=client&id=${client.id}`)],
        ])
      }
    );
  } else {
    // Клиент не найден — просим тренера добавить
    await ctx.reply(
      `👋 Привет, ${firstName}!\n\n` +
      `Ты ещё не добавлен в систему.\n` +
      `Напиши тренеру чтобы он тебя зарегистрировал.\n\n` +
      `@burn60trainer_bot`
    );
  }
});

// /me — мой абонемент
bot.command("me", async (ctx) => {
  const client = findClientByTelegramId(ctx.from.id);
  if (!client) {
    return ctx.reply("Ты не найден в системе. Обратись к тренеру.");
  }

  const daysLeft = daysUntil(client.end);
  const status = getStatus(client);

  const statusText = {
    active: "✅ Активен",
    ending_soon: "⚠️ Скоро заканчивается",
    expired: "❌ Истёк",
    unpaid: "💳 Не оплачено",
  }[status];

  await ctx.reply(
    `📋 *Твой абонемент*\n\n` +
    `👤 ${client.name}\n` +
    `🎯 Цель: ${client.goal}\n\n` +
    `📦 План: ${client.plan}\n` +
    `🏃 Использовано: ${client.used} из ${client.total}\n` +
    `⏳ Осталось: *${client.remaining} тренировок*\n` +
    `📅 До окончания: *${daysLeft} дней*\n` +
    `💰 Оплата: ${client.paid ? "✅ Оплачено" : "❌ Не оплачено"}\n\n` +
    `Статус: ${statusText}`,
    { parse_mode: "Markdown" }
  );
});

// /clients — список клиентов (только тренер)
bot.command("clients", async (ctx) => {
  if (!isTrainer(ctx)) return ctx.reply("⛔ Нет доступа.");

  const lines = clients.map(c => {
    const st = getStatus(c);
    const emoji = st === "active" ? "✅" : st === "ending_soon" ? "⚠️" : st === "expired" ? "❌" : "💳";
    return `${emoji} ${c.name} — ${c.remaining} трен. (до ${c.end})`;
  });

  await ctx.reply(
    `👥 *Все клиенты:*\n\n${lines.join("\n")}`,
    { parse_mode: "Markdown" }
  );
});

// Callback: список клиентов
bot.action("list_clients", async (ctx) => {
  if (!isTrainer(ctx)) return ctx.answerCbQuery("⛔ Нет доступа.");
  await ctx.answerCbQuery();

  const lines = clients.map(c => {
    const st = getStatus(c);
    const emoji = st === "active" ? "✅" : st === "ending_soon" ? "⚠️" : st === "expired" ? "❌" : "💳";
    return `${emoji} ${c.name} — ${c.remaining} трен., до ${c.end}`;
  });

  await ctx.reply(`👥 *Клиенты:*\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
});

// Callback: кому нужно внимание
bot.action("attention_clients", async (ctx) => {
  if (!isTrainer(ctx)) return ctx.answerCbQuery("⛔ Нет доступа.");
  await ctx.answerCbQuery();

  const attention = clients.filter(c => {
    const st = getStatus(c);
    return st === "ending_soon" || st === "expired" || st === "unpaid";
  });

  if (attention.length === 0) {
    return ctx.reply("✅ Всё в порядке, внимания не требует никто.");
  }

  const lines = attention.map(c => {
    const st = getStatus(c);
    const msg = st === "unpaid" ? "не оплачено" : st === "expired" ? "абонемент истёк" : `осталось ${c.remaining} трен.`;
    return `⚠️ ${c.name} — ${msg}`;
  });

  await ctx.reply(`⚠️ *Нужно внимание:*\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
});

// ─── REMINDER SYSTEM ──────────────────────────────────────────────────────
async function sendReminders() {
  console.log("🔔 Checking reminders...");

  for (const client of clients) {
    if (!client.telegramId) continue; // клиент не зарегистрирован в боте

    const status = getStatus(client);
    const daysLeft = daysUntil(client.end);

    // Не оплачено
    if (!client.paid) {
      await bot.telegram.sendMessage(
        client.telegramId,
        `💳 *${client.name}, напоминание об оплате*\n\n` +
        `Твой абонемент ещё не оплачен.\n` +
        `Сумма: *${fmtS(client.price)}*\n\n` +
        `Свяжись с тренером для оплаты.`,
        { parse_mode: "Markdown" }
      ).catch(console.error);
    }

    // Осталось 3 тренировки
    else if (client.remaining === 3) {
      await bot.telegram.sendMessage(
        client.telegramId,
        `⏳ *${client.name}, осталось 3 тренировки*\n\n` +
        `Твой абонемент заканчивается.\n` +
        `Поговори с тренером о продлении — не теряй темп! 💪`,
        { parse_mode: "Markdown" }
      ).catch(console.error);
    }

    // Осталось 1 тренировка
    else if (client.remaining === 1) {
      await bot.telegram.sendMessage(
        client.telegramId,
        `🚨 *${client.name}, последняя тренировка!*\n\n` +
        `После неё абонемент заканчивается.\n` +
        `Продли сейчас чтобы не прерывать прогресс.`,
        { parse_mode: "Markdown" }
      ).catch(console.error);
    }

    // До окончания 5 дней
    else if (daysLeft === 5) {
      await bot.telegram.sendMessage(
        client.telegramId,
        `📅 *${client.name}, до окончания абонемента 5 дней*\n\n` +
        `Осталось тренировок: ${client.remaining}\n` +
        `Дата окончания: ${client.end}\n\n` +
        `Успей использовать все тренировки! 🏋️`,
        { parse_mode: "Markdown" }
      ).catch(console.error);
    }

    // Абонемент истёк
    else if (status === "expired" && client.remaining > 0) {
      await bot.telegram.sendMessage(
        client.telegramId,
        `❌ *${client.name}, абонемент истёк*\n\n` +
        `Срок действия закончился ${client.end}.\n` +
        `Обратись к тренеру для продления.`,
        { parse_mode: "Markdown" }
      ).catch(console.error);
    }
  }

  // Уведомление тренеру
  if (TRAINER_CHAT_ID) {
    const needAttention = clients.filter(c => {
      const st = getStatus(c);
      return st === "ending_soon" || st === "expired" || st === "unpaid";
    });

    if (needAttention.length > 0) {
      const lines = needAttention.map(c => {
        const st = getStatus(c);
        const msg = st === "unpaid" ? "не оплачено" : st === "expired" ? "истёк" : `осталось ${c.remaining} трен.`;
        return `• ${c.name}: ${msg}`;
      });

      await bot.telegram.sendMessage(
        TRAINER_CHAT_ID,
        `📊 *Ежедневный отчёт*\n\n` +
        `Требуют внимания:\n${lines.join("\n")}`,
        { parse_mode: "Markdown" }
      ).catch(console.error);
    }
  }
}

// Запускать каждый день в 9:00
cron.schedule("0 9 * * *", sendReminders, {
  timezone: "Asia/Tashkent",
});

// ─── API для Mini App ─────────────────────────────────────────────────────
// Простой HTTP сервер для обмена данными с Mini App
import { createServer } from "http";

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // GET /clients — все клиенты (для тренера)
  if (req.method === "GET" && url.pathname === "/clients") {
    res.writeHead(200);
    res.end(JSON.stringify(clients));
    return;
  }

  // GET /client/:id — один клиент
  if (req.method === "GET" && url.pathname.startsWith("/client/")) {
    const id = parseInt(url.pathname.split("/")[2]);
    const client = clients.find(c => c.id === id);
    if (client) {
      res.writeHead(200);
      res.end(JSON.stringify(client));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found" }));
    }
    return;
  }

  // POST /client/:id/mark — отметить тренировку
  if (req.method === "POST" && url.pathname.includes("/mark")) {
    const id = parseInt(url.pathname.split("/")[2]);
    const client = clients.find(c => c.id === id);
    if (client && client.remaining > 0) {
      client.used += 1;
      client.remaining -= 1;
      res.writeHead(200);
      res.end(JSON.stringify(client));
    } else {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "No remaining sessions" }));
    }
    return;
  }

  // POST /remind — ручной запуск напоминалок (для теста)
  if (req.method === "POST" && url.pathname === "/remind") {
    sendReminders();
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, message: "Reminders sent" }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ─── START BOT ────────────────────────────────────────────────────────────
bot.launch().then(() => {
  console.log("🤖 burn60 bot started!");
  console.log(`📱 Mini App URL: ${MINI_APP_URL}`);
});

process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
