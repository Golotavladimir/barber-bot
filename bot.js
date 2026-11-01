require('dotenv').config();
const fs = require('fs');
const http = require('http');
const { Telegraf, Markup } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;
const BOOKINGS_FILE = 'bookings.json';

const SERVICES = [
  { emoji: '💇‍♂️', name: 'Мужская стрижка', price: 1500, duration: 40 },
  { emoji: '👦', name: 'Детская стрижка', price: 1000, duration: 30 },
  { emoji: '✂️🧔', name: 'Стрижка + борода', price: 2000, duration: 60 },
  { emoji: '👨‍👦', name: 'Отец + сын', price: 2200, duration: 80 },
  { emoji: '👁️', name: 'Оформление бровей', price: 400, duration: 15 },
  { emoji: '🧔', name: 'Оформление бороды и усов', price: 1000, duration: 40 },
  { emoji: '🕯️', name: 'Восковые процедуры (1 зона)', price: 100, duration: 5 },
  { emoji: '✂️', name: 'Окантовка головы', price: 500, duration: 10 },
  { emoji: '✂️', name: 'Окантовка головы и бороды триммером', price: 900, duration: 15 },
  { emoji: '👨‍🦲', name: 'Стрижка налысо', price: 500, duration: 20 },
  { emoji: '🎨', name: 'Камуфляж бороды', price: 800, duration: 30 },
  { emoji: '🎨', name: 'Камуфляж головы', price: 900, duration: 30 },
  { emoji: '✂️', name: 'Стрижка не более 3х насадок', price: 800, duration: 40 },
  { emoji: '🪒', name: 'Бритьё бороды под ноль', price: 400, duration: 20 },
  { emoji: '✂️', name: 'Окантовка бороды', price: 500, duration: 15 },
  { emoji: '🪒', name: 'Бритьё бороды опасной бритвой', price: 1000, duration: 30 },
  { emoji: '🪒', name: 'Бритьё головы опасной бритвой', price: 1200, duration: 30 },
];

const WORK_DAY_OFF = 1; // понедельник (getDay(): 0 = вс, 1 = пн, ...)
const WORK_START_MIN = 10 * 60;
const WORK_END_MIN = 20 * 60;
const SLOT_STEP_MIN = 30;
const DAYS_TO_SHOW = 7;

const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTH_NAMES = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

// userId -> { serviceIndex, date }, пока клиент не закончил выбор
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

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDateLabel(date) {
  return `${DAY_NAMES[date.getDay()]}, ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
}

function getWorkDates(count) {
  const dates = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  while (dates.length < count) {
    if (cursor.getDay() !== WORK_DAY_OFF) {
      dates.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function getFreeSlots(dateIso) {
  const bookings = loadBookings();
  const takenTimes = new Set(bookings.filter((b) => b.date === dateIso).map((b) => b.time));

  const isToday = dateIso === toIsoDate(new Date());
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const slots = [];
  for (let min = WORK_START_MIN; min < WORK_END_MIN; min += SLOT_STEP_MIN) {
    if (isToday && min <= nowMin) continue;

    const hh = String(Math.floor(min / 60)).padStart(2, '0');
    const mm = String(min % 60).padStart(2, '0');
    const time = `${hh}:${mm}`;
    if (!takenTimes.has(time)) slots.push(time);
  }

  return slots;
}

function chunk(array, size) {
  const rows = [];
  for (let i = 0; i < array.length; i += size) rows.push(array.slice(i, i + size));
  return rows;
}

bot.command('start', (ctx) => {
  ctx.reply(
    '👋 Привет! Выбери услугу:',
    Markup.inlineKeyboard(
      SERVICES.map((s, i) => [
        Markup.button.callback(`${s.emoji} ${s.name} — ${s.price}₽ (${s.duration} мин)`, `svc:${i}`),
      ])
    )
  );
});

bot.command('myid', (ctx) => {
  ctx.reply(`Твой chat id: ${ctx.chat.id}`);
});

bot.action(/svc:(\d+)/, (ctx) => {
  const serviceIndex = Number(ctx.match[1]);
  const service = SERVICES[serviceIndex];
  pendingBookings.set(ctx.from.id, { serviceIndex });

  const dateButtons = getWorkDates(DAYS_TO_SHOW).map((date) =>
    Markup.button.callback(formatDateLabel(date), `date:${toIsoDate(date)}`)
  );

  ctx.editMessageText(
    `${service.emoji} Услуга: ${service.name} — ${service.price}₽\nВыбери день:`,
    Markup.inlineKeyboard(chunk(dateButtons, 2))
  );
});

bot.action(/date:(\d{4}-\d{2}-\d{2})/, (ctx) => {
  const dateIso = ctx.match[1];
  const pending = pendingBookings.get(ctx.from.id);
  if (!pending) {
    return ctx.answerCbQuery('Начни сначала: /start');
  }

  pending.date = dateIso;
  const service = SERVICES[pending.serviceIndex];
  const freeSlots = getFreeSlots(dateIso);

  if (freeSlots.length === 0) {
    return ctx.editMessageText('😔 На этот день свободных окон не осталось. Выбери другой день через /start.');
  }

  const timeButtons = freeSlots.map((time) => Markup.button.callback(time, `time:${time}`));

  ctx.editMessageText(
    `${service.emoji} Услуга: ${service.name}\nДень: ${dateIso}\nВыбери время:`,
    Markup.inlineKeyboard(chunk(timeButtons, 3))
  );
});

bot.action(/time:(\d{2}:\d{2})/, (ctx) => {
  const time = ctx.match[1];
  const pending = pendingBookings.get(ctx.from.id);
  if (!pending || !pending.date) {
    return ctx.answerCbQuery('Начни сначала: /start');
  }

  const service = SERVICES[pending.serviceIndex];
  const clientName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;

  ctx.editMessageText(
    `✅ Заявка отправлена!\n${service.emoji} Услуга: ${service.name} — ${service.price}₽\n📅 ${pending.date} в ${time}\n💈 Барбер скоро свяжется с тобой.`
  );

  saveBooking({
    clientName,
    service: service.name,
    price: service.price,
    date: pending.date,
    time,
    createdAt: new Date().toISOString(),
  });

  if (OWNER_CHAT_ID) {
    bot.telegram.sendMessage(
      OWNER_CHAT_ID,
      `🔔 Новая заявка!\n👤 Клиент: ${clientName}\n${service.emoji} Услуга: ${service.name} — ${service.price}₽\n📅 ${pending.date} в ${time}`
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
    return ctx.reply('📭 Заявок пока нет.');
  }

  const list = bookings
    .map((b, i) => `${i + 1}. 👤 ${b.clientName} — ${b.service} (${b.price}₽), 📅 ${b.date} ${b.time}`)
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
