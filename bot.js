require('dotenv').config();
const fs = require('fs');
const http = require('http');
const { Telegraf, Markup } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;
const BOOKINGS_FILE = 'bookings.json';

const SERVICES = ['Стрижка', 'Борода', 'Стрижка + борода'];
const SLOTS = ['Завтра, 12:00', 'Завтра, 15:00', 'Послезавтра, 11:00', 'Послезавтра, 17:00'];

// userId -> выбранная услуга, пока клиент не выбрал время
const pendingBookings = new Map();

function loadBookings() {
  try {
    return JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveBooking(booking) {
  const bookings = loadBookings();
  bookings.push(booking);
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2));
}

bot.command('start', (ctx) => {
  ctx.reply(
    'Привет! Выбери услугу:',
    Markup.inlineKeyboard(SERVICES.map((s) => [Markup.button.callback(s, `service:${s}`)]))
  );
});

bot.command('myid', (ctx) => {
  ctx.reply(`Твой chat id: ${ctx.chat.id}`);
});

bot.action(/service:(.+)/, (ctx) => {
  const service = ctx.match[1];
  pendingBookings.set(ctx.from.id, service);
  ctx.editMessageText(
    `Услуга: ${service}\nВыбери время:`,
    Markup.inlineKeyboard(SLOTS.map((slot) => [Markup.button.callback(slot, `slot:${slot}`)]))
  );
});

bot.action(/slot:(.+)/, (ctx) => {
  const slot = ctx.match[1];
  const service = pendingBookings.get(ctx.from.id);
  if (!service) {
    return ctx.answerCbQuery('Начни сначала: /start');
  }

  const clientName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
  ctx.editMessageText(`Заявка отправлена!\nУслуга: ${service}\nВремя: ${slot}\nБарбер скоро свяжется с тобой.`);

  saveBooking({ clientName, service, slot, createdAt: new Date().toISOString() });

  if (OWNER_CHAT_ID) {
    bot.telegram.sendMessage(
      OWNER_CHAT_ID,
      `Новая заявка!\nКлиент: ${clientName}\nУслуга: ${service}\nВремя: ${slot}`
    );
  }

  pendingBookings.delete(ctx.from.id);
});

bot.command('bookings', (ctx) => {
  if (String(ctx.chat.id) !== OWNER_CHAT_ID) {
    return;
  }

  const bookings = loadBookings();
  if (bookings.length === 0) {
    return ctx.reply('Заявок пока нет.');
  }

  const list = bookings
    .map((b, i) => `${i + 1}. ${b.clientName} — ${b.service}, ${b.slot}`)
    .join('\n');
  ctx.reply(list);
});

bot.launch();
console.log('Бот запущен');

// Render.com требует, чтобы веб-сервис слушал порт — без этого он решит, что процесс умер.
// Этот же адрес потом будет пинговать внешний "будильник", чтобы бот не засыпал.
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Бот жив')).listen(PORT, () => {
  console.log(`Health check слушает порт ${PORT}`);
});
