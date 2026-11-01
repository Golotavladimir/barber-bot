process.env.TZ = 'Europe/Moscow'; // Render по умолчанию работает в UTC — без этого "10:00" стало бы 13:00 по Москве

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

const REMINDER_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const REMINDER_DAY_BEFORE_MIN = 24 * 60;
const REMINDER_HOUR_BEFORE_MIN = 60;

// userId -> { selected: number[], date? } — состояние текущей записи клиента
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

function timeToMin(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minToTime(min) {
  const hh = String(Math.floor(min / 60)).padStart(2, '0');
  const mm = String(min % 60).padStart(2, '0');
  return `${hh}:${mm}`;
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

function getPending(userId) {
  if (!pendingBookings.has(userId)) {
    pendingBookings.set(userId, { selected: [] });
  }
  return pendingBookings.get(userId);
}

function getTotals(selected) {
  const services = selected.map((i) => SERVICES[i]);
  const totalDuration = services.reduce((sum, s) => sum + s.duration, 0);
  const totalPrice = services.reduce((sum, s) => sum + s.price, 0);
  return { services, totalDuration, totalPrice };
}

// Свободен ли слот [start, start+duration) на этот день с учётом уже занятых интервалов
function getFreeSlots(dateIso, duration) {
  const busy = loadBookings()
    .filter((b) => b.date === dateIso)
    .map((b) => ({ start: timeToMin(b.time), end: timeToMin(b.time) + b.totalDuration }));

  const isToday = dateIso === toIsoDate(new Date());
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const slots = [];
  for (let start = WORK_START_MIN; start + duration <= WORK_END_MIN; start += SLOT_STEP_MIN) {
    if (isToday && start <= nowMin) continue;

    const end = start + duration;
    const overlaps = busy.some((b) => start < b.end && b.start < end);
    if (!overlaps) slots.push(minToTime(start));
  }

  return slots;
}

function chunk(array, size) {
  const rows = [];
  for (let i = 0; i < array.length; i += size) rows.push(array.slice(i, i + size));
  return rows;
}

function renderServiceButtons(selected) {
  return SERVICES.map((s, i) => {
    const mark = selected.includes(i) ? '✅ ' : '';
    return [Markup.button.callback(`${mark}${s.emoji} ${s.name} — ${s.price}₽ (${s.duration} мин)`, `toggle:${i}`)];
  });
}

function renderServiceMessage(selected) {
  if (selected.length === 0) {
    return 'Выбери одну или несколько услуг:';
  }
  const { services, totalDuration, totalPrice } = getTotals(selected);
  const names = services.map((s) => s.name).join(', ');
  return `Выбери одну или несколько услуг:\n\n✅ Выбрано: ${names}\nИтого: ${totalDuration} мин, ${totalPrice}₽`;
}

bot.command('start', (ctx) => {
  pendingBookings.set(ctx.from.id, { selected: [] });
  ctx.reply(
    `👋 Привет! ${renderServiceMessage([])}`,
    Markup.inlineKeyboard(renderServiceButtons([]))
  );
});

bot.command('myid', (ctx) => {
  ctx.reply(`Твой chat id: ${ctx.chat.id}`);
});

bot.action(/toggle:(\d+)/, (ctx) => {
  const index = Number(ctx.match[1]);
  const pending = getPending(ctx.from.id);

  if (pending.selected.includes(index)) {
    pending.selected = pending.selected.filter((i) => i !== index);
  } else {
    pending.selected.push(index);
  }

  const rows = renderServiceButtons(pending.selected);
  if (pending.selected.length > 0) {
    rows.push([Markup.button.callback('➡️ Готово, выбрать время', 'done')]);
  }

  ctx.editMessageText(renderServiceMessage(pending.selected), Markup.inlineKeyboard(rows));
});

bot.action('done', (ctx) => {
  const pending = getPending(ctx.from.id);
  if (pending.selected.length === 0) {
    return ctx.answerCbQuery('Выбери хотя бы одну услугу');
  }

  const dateButtons = getWorkDates(DAYS_TO_SHOW).map((date) =>
    Markup.button.callback(formatDateLabel(date), `date:${toIsoDate(date)}`)
  );

  const { totalDuration, totalPrice } = getTotals(pending.selected);
  ctx.editMessageText(
    `${renderServiceMessage(pending.selected)}\n\nВыбери день:`,
    Markup.inlineKeyboard(chunk(dateButtons, 2))
  );
});

bot.action(/date:(\d{4}-\d{2}-\d{2})/, (ctx) => {
  const dateIso = ctx.match[1];
  const pending = pendingBookings.get(ctx.from.id);
  if (!pending || pending.selected.length === 0) {
    return ctx.answerCbQuery('Начни сначала: /start');
  }

  pending.date = dateIso;
  const { totalDuration } = getTotals(pending.selected);
  const freeSlots = getFreeSlots(dateIso, totalDuration);

  if (freeSlots.length === 0) {
    return ctx.editMessageText('😔 На этот день нет окна нужной длительности. Выбери другой день через /start.');
  }

  const timeButtons = freeSlots.map((time) => Markup.button.callback(time, `time:${time}`));

  ctx.editMessageText(
    `${renderServiceMessage(pending.selected)}\n\nДень: ${dateIso}\nВыбери время:`,
    Markup.inlineKeyboard(chunk(timeButtons, 3))
  );
});

bot.action(/time:(\d{2}:\d{2})/, (ctx) => {
  const time = ctx.match[1];
  const pending = pendingBookings.get(ctx.from.id);
  if (!pending || !pending.date) {
    return ctx.answerCbQuery('Начни сначала: /start');
  }

  const { services, totalDuration, totalPrice } = getTotals(pending.selected);
  const serviceNames = services.map((s) => s.name).join(', ');
  const clientName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;

  ctx.editMessageText(
    `✅ Заявка отправлена!\nУслуги: ${serviceNames}\nИтого: ${totalDuration} мин, ${totalPrice}₽\n📅 ${pending.date} в ${time}\n💈 Барбер скоро свяжется с тобой.`
  );

  saveBooking({
    clientName,
    clientChatId: ctx.chat.id,
    services: serviceNames,
    totalDuration,
    totalPrice,
    date: pending.date,
    time,
    createdAt: new Date().toISOString(),
    remindedDay: false,
    remindedHour: false,
  });

  if (OWNER_CHAT_ID) {
    bot.telegram.sendMessage(
      OWNER_CHAT_ID,
      `🔔 Новая заявка!\n👤 Клиент: ${clientName}\nУслуги: ${serviceNames}\nИтого: ${totalDuration} мин, ${totalPrice}₽\n📅 ${pending.date} в ${time}`
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
    .map((b, i) => `${i + 1}. 👤 ${b.clientName} — ${b.services} (${b.totalPrice}₽, ${b.totalDuration} мин), 📅 ${b.date} ${b.time}`)
    .join('\n');
  ctx.reply(list);
});

function checkReminders() {
  const bookings = loadBookings();
  const now = new Date();
  let changed = false;

  for (const b of bookings) {
    if (!b.clientChatId) continue; // старые заявки без сохранённого chat id

    const apptTime = new Date(`${b.date}T${b.time}:00`);
    const minutesUntil = (apptTime - now) / 60000;

    if (!b.remindedDay && minutesUntil <= REMINDER_DAY_BEFORE_MIN && minutesUntil > REMINDER_HOUR_BEFORE_MIN) {
      bot.telegram
        .sendMessage(b.clientChatId, `⏰ Напоминание: завтра в ${b.time} у тебя запись (${b.services}). Ждём!`)
        .catch((err) => console.error('Не удалось отправить напоминание (за день):', err.message));
      b.remindedDay = true;
      changed = true;
    }

    if (!b.remindedHour && minutesUntil <= REMINDER_HOUR_BEFORE_MIN && minutesUntil > 0) {
      bot.telegram
        .sendMessage(b.clientChatId, `⏰ Уже через час, в ${b.time}, ждём тебя: ${b.services}.`)
        .catch((err) => console.error('Не удалось отправить напоминание (за час):', err.message));
      b.remindedHour = true;
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2));
  }
}

bot.launch();
console.log('Бот запущен');

setInterval(checkReminders, REMINDER_CHECK_INTERVAL_MS);

// Render.com требует, чтобы веб-сервис слушал порт — без этого он решит, что процесс умер.
// Этот же адрес потом будет пинговать внешний "будильник", чтобы бот не засыпал.
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Бот жив')).listen(PORT, () => {
  console.log(`Health check слушает порт ${PORT}`);
});
