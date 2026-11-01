require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;

const SERVICES = ['Стрижка', 'Борода', 'Стрижка + борода'];
const SLOTS = ['Завтра, 12:00', 'Завтра, 15:00', 'Послезавтра, 11:00', 'Послезавтра, 17:00'];

// userId -> выбранная услуга, пока клиент не выбрал время
const pendingBookings = new Map();

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

  if (OWNER_CHAT_ID) {
    bot.telegram.sendMessage(
      OWNER_CHAT_ID,
      `Новая заявка!\nКлиент: ${clientName}\nУслуга: ${service}\nВремя: ${slot}`
    );
  }

  pendingBookings.delete(ctx.from.id);
});

bot.launch();
console.log('Бот запущен');
