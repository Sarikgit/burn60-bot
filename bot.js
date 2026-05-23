// burn60 Telegram Bot + Reminder System
import { Telegraf, Markup } from "telegraf";
import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";

const BOT_TOKEN = process.env.BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL || "https://burn60-app-c1e7.vercel.app";
const TRAINER_CHAT_ID = process.env.TRAINER_CHAT_ID || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://xruwdgxxjhttwoywgaoq.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhydXdkZ3h4amh0dHdveXdnYW9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4NTM5MDMsImV4cCI6MjA5NDQyOTkwM30.uOWcOLoL03HuL_yrN-Cdz1j-Rn72lwmBGtKwL1pNdxQ";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);

// ─── ЛИЧНЫЕ НАСТРОЙКИ ТРЕНЕРА (хранятся в памяти, обновляются через бот) ──
// Времена намазов по умолчанию (Ташкент)
let prayerTimes = {
  Фаджр:  "05:10",
  Зухр:   "13:15",
  Аср:    "16:30",
  Магриб: "20:45",
  Иша:    "22:30",
};

// Блоки дня тренера (загружаются из Supabase или памяти)
let dayBlocks = [];

// ─── HELPERS ──────────────────────────────────────────────────────────────
function daysUntil(dateString) {
  if (!dateString) return 999;
  const today = new Date();
  const end = new Date(dateString);
  today.setHours(0,0,0,0);
  end.setHours(0,0,0,0);
  return Math.ceil((end - today) / 86400000);
}

function fmtS(n) { return n.toLocaleString("ru-RU") + " сум"; }

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

// Текущее время в Ташкенте HH:MM
function nowTashkent() {
  const now = new Date();
  const tashkent = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const h = String(tashkent.getUTCHours()).padStart(2, "0");
  const m = String(tashkent.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function timeToMins(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// ─── BOT COMMANDS ─────────────────────────────────────────────────────────

// /start
bot.start(async (ctx) => {
  const firstName = ctx.from.first_name;
  if (isTrainer(ctx)) {
    await ctx.reply(
      `👋 Привет, тренер!\n\nОткрой панель управления:`,
      Markup.inlineKeyboard([
        [Markup.button.webApp("🏋️ Открыть панель тренера", MINI_APP_URL)],
        [Markup.button.callback("👥 Все клиенты", "list_clients")],
        [Markup.button.callback("⚠️ Нужно внимание", "attention_clients")],
      ])
    );
    return;
  }
  await ctx.reply(`👋 Привет, ${firstName}!\nОбратись к тренеру для регистрации.`);
});

// /myid — узнать свой Telegram ID
bot.command("myid", async (ctx) => {
  await ctx.reply(
    `🆔 Твой Telegram ID:\n\n<code>${ctx.from.id}</code>\n\nСкопируй и добавь как TRAINER_CHAT_ID в Railway.`,
    { parse_mode: "HTML" }
  );
});

// /clients
bot.command("clients", async (ctx) => {
  if (!isTrainer(ctx)) return ctx.reply("⛔ Нет доступа.");
  const { data } = await supabase.from("clients").select("*");
  if (!data || data.length === 0) return ctx.reply("Клиентов нет.");
  const lines = data.map(c => {
    const remaining = (c.total || 0) - (c.used || 0);
    const emoji = !c.paid ? "💳" : remaining <= 3 ? "⚠️" : "✅";
    return `${emoji} ${c.name} — ${remaining} трен. до ${c.end_date || "?"}`;
  });
  await ctx.reply(`👥 *Клиенты:*\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
});

// /prayers — показать текущие времена намазов
bot.command("prayers", async (ctx) => {
  if (!isTrainer(ctx)) return ctx.reply("⛔ Нет доступа.");
  const lines = Object.entries(prayerTimes).map(([n, t]) => `🕌 ${n}: ${t}`);
  await ctx.reply(
    `*Времена намазов:*\n\n${lines.join("\n")}\n\nДля изменения:\n/setprayer Фаджр 05:30`,
    { parse_mode: "Markdown" }
  );
});

// /setprayer Фаджр 05:30
bot.command("setprayer", async (ctx) => {
  if (!isTrainer(ctx)) return ctx.reply("⛔ Нет доступа.");
  const parts = ctx.message.text.split(" ");
  if (parts.length < 3) return ctx.reply("Формат: /setprayer Фаджр 05:30");
  const name = parts[1];
  const time = parts[2];
  if (!prayerTimes[name]) return ctx.reply(`Намаз не найден. Доступные: ${Object.keys(prayerTimes).join(", ")}`);
  if (!/^\d{2}:\d{2}$/.test(time)) return ctx.reply("Формат времени: HH:MM");
  prayerTimes[name] = time;
  await ctx.reply(`✅ ${name} обновлён: ${time}`);
});

// /today — расписание дня
bot.command("today", async (ctx) => {
  if (!isTrainer(ctx)) return ctx.reply("⛔ Нет доступа.");
  if (dayBlocks.length === 0) return ctx.reply("Расписание дня пустое. Добавь блоки в приложении.");
  const lines = dayBlocks.map(b => `${b.start} — ${b.label} (${b.dur}м)`);
  await ctx.reply(`📅 *Расписание сегодня:*\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
});

// Callback: список клиентов
bot.action("list_clients", async (ctx) => {
  if (!isTrainer(ctx)) return ctx.answerCbQuery("⛔ Нет доступа.");
  await ctx.answerCbQuery();
  const { data } = await supabase.from("clients").select("*");
  if (!data || data.length === 0) return ctx.reply("Клиентов нет.");
  const lines = data.map(c => {
    const remaining = (c.total || 0) - (c.used || 0);
    const emoji = !c.paid ? "💳" : remaining <= 3 ? "⚠️" : "✅";
    return `${emoji} ${c.name} — ${remaining} трен., до ${c.end_date || "?"}`;
  });
  await ctx.reply(`👥 *Клиенты:*\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
});

// Callback: нужно внимание
bot.action("attention_clients", async (ctx) => {
  if (!isTrainer(ctx)) return ctx.answerCbQuery("⛔ Нет доступа.");
  await ctx.answerCbQuery();
  const { data } = await supabase.from("clients").select("*");
  if (!data) return ctx.reply("Ошибка загрузки.");
  const attention = data.filter(c => {
    const remaining = (c.total || 0) - (c.used || 0);
    return !c.paid || remaining <= 3;
  });
  if (attention.length === 0) return ctx.reply("✅ Всё в порядке!");
  const lines = attention.map(c => {
    const remaining = (c.total || 0) - (c.used || 0);
    const msg = !c.paid ? "не оплачено" : `осталось ${remaining} трен.`;
    return `⚠️ ${c.name} — ${msg}`;
  });
  await ctx.reply(`⚠️ *Нужно внимание:*\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
});

// ─── УВЕДОМЛЕНИЯ ──────────────────────────────────────────────────────────

// Каждую минуту проверяем намазы и расписание дня
cron.schedule("* * * * *", async () => {
  if (!TRAINER_CHAT_ID) return;

  const now = nowTashkent();
  const nowMins = timeToMins(now);

  // 1. Проверка намазов — уведомить за 15 минут
  for (const [name, time] of Object.entries(prayerTimes)) {
    const prayerMins = timeToMins(time);
    if (prayerMins - nowMins === 15) {
      const emojis = { Фаджр:"🌅", Зухр:"☀️", Аср:"🌤", Магриб:"🌇", Иша:"🌙" };
      await bot.telegram.sendMessage(
        TRAINER_CHAT_ID,
        `${emojis[name] || "🕌"} *${name}* через 15 минут\n⏰ Время: ${time}`,
        { parse_mode: "Markdown" }
      ).catch(console.error);
    }
  }

  // 2. Проверка блоков дня — уведомить за 30 минут
  for (const block of dayBlocks) {
    if (!block.start || block.done) continue;
    const blockMins = timeToMins(block.start);
    if (blockMins - nowMins === 30) {
      await bot.telegram.sendMessage(
        TRAINER_CHAT_ID,
        `⏰ *Через 30 минут:* ${block.label}\n📝 ${block.sub || ""}\n🕐 Начало: ${block.start}`,
        { parse_mode: "Markdown" }
      ).catch(console.error);
    }
  }
});

// Ежедневный отчёт в 9:00 по Ташкенту
cron.schedule("0 9 * * *", async () => {
  if (!TRAINER_CHAT_ID) return;
  const { data } = await supabase.from("clients").select("*");
  if (!data) return;
  const attention = data.filter(c => {
    const remaining = (c.total || 0) - (c.used || 0);
    return !c.paid || remaining <= 3;
  });
  if (attention.length === 0) return;
  const lines = attention.map(c => {
    const remaining = (c.total || 0) - (c.used || 0);
    const msg = !c.paid ? "не оплачено" : `осталось ${remaining} трен.`;
    return `• ${c.name}: ${msg}`;
  });
  await bot.telegram.sendMessage(
    TRAINER_CHAT_ID,
    `📊 *Ежедневный отчёт*\n\nТребуют внимания:\n${lines.join("\n")}`,
    { parse_mode: "Markdown" }
  ).catch(console.error);
}, { timezone: "Asia/Tashkent" });

// ─── HTTP SERVER для Mini App ──────────────────────────────────────────────
const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // POST /blocks — Mini App синхронизирует блоки дня
  if (req.method === "POST" && url.pathname === "/blocks") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        dayBlocks = JSON.parse(body);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, count: dayBlocks.length }));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // POST /prayers — обновить времена намазов из Mini App
  if (req.method === "POST" && url.pathname === "/prayers") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        prayerTimes = { ...prayerTimes, ...JSON.parse(body) };
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // GET /health
  if (url.pathname === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, time: new Date().toISOString() }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));

bot.launch().then(() => console.log("🤖 burn60 bot started!"));
process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
