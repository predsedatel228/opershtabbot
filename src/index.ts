import { Telegraf, session } from 'telegraf';
import { message } from 'telegraf/filters';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import express from 'express';
dotenv.config();

if (!process.env.BOT_TOKEN || !process.env.PERPLEXITY_API_KEY) {
  throw new Error('Missing BOT_TOKEN or PERPLEXITY_API_KEY in .env');
}

const admin = 262217989;
const ALLOWED_USERS = new Set<number>([
  admin, 177154883, 458765057, 420182056
]);

const bot = new Telegraf(process.env.BOT_TOKEN);
const openai = new OpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY,
  baseURL: 'https://api.perplexity.ai',
});

let botUsername = '';

interface BotSession {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  authorized?: boolean;
}

bot.use(session({
  defaultSession: (): BotSession => ({
    messages: [],
    authorized: false
  })

} as any));

bot.use(async (ctx: any, next) => {
  const userId = ctx.from?.id;
  const text = ctx.message?.text || '';

  if (userId && ALLOWED_USERS.has(userId)) {
    ctx.session.authorized = true;
  }

  if (!ctx.session.authorized && !text.startsWith('/')) {
    return ctx.reply('❌ Доступ запрещен');
  }

  await next();
});


// Показать свой ID
bot.command('id', (ctx: any) => {
  const userId = ctx.from.id;
  ctx.reply(`Ваш Telegram ID: \`${userId}\`\n\nОтправьте этот ID администратору для получения доступа.`, {
    parse_mode: 'Markdown'
  });
});

// Админ: добавить пользователя
bot.command('adduser', (ctx: any) => {
  const adminId = ctx.from.id;

  if (adminId !== admin) {
    return ctx.reply('❌ Только администратор может добавлять пользователей.');
  }

  const args = ctx.message.text.split(' ');
  const targetId = parseInt(args[1]);

  if (!targetId) {
    return ctx.reply('Использование: /adduser 123456789');
  }

  ALLOWED_USERS.add(targetId);
  ctx.reply(`✅ Пользователь ${targetId} добавлен в список доступа.`);
});


// Админ: список пользователей
bot.command('users', (ctx: any) => {
  if (ctx.from.id !== admin) {
    return ctx.reply('❌ Доступ запрещен.');
  }

  const usersList = Array.from(ALLOWED_USERS).join(', ');
  ctx.reply(`👥 Разрешенные пользователи (${ALLOWED_USERS.size}):\n\`${usersList}\``, {
    parse_mode: 'Markdown'
  });
});

// /start для всех (показывает статус доступа)
bot.command('start', async (ctx: any) => {
  const userId = ctx.from.id;
  const isAllowed = ALLOWED_USERS.has(userId);

  if (isAllowed) {
    ctx.session.messages = [{
      role: 'system',
      content: 'Ты полезный чат-помощник-трамвай. Отвечай кратко и по делу на русском языке от лица трамвая. Модель трамвая выбери самостоятельно и предствься. Постоянно делай акцент на том, что ты трамвай. НЕ используй markdown (**текст**), НЕ добавляй ссылки [web:1], НЕ используй LaTeX. Пиши обычным текстом.'
    }];
    ctx.session.authorized = true;
    await ctx.reply('✅ Доступ разрешен, братан! Пиши вопросы — сохраню контекст беседы.');
  } else {
    await ctx.reply(
      '🔒 Доступ ограничен.\n\n' +
      'Ваш ID: `' + userId + '`\n\n' +
      '1. Отправьте /id для получения ID\n' +
      '2. Перешлите ID администратору\n' +
      '3. После одобрения бот заработает',
      { parse_mode: 'Markdown' }
    );
  }
});


bot.on(message('text'), async (ctx: any) => {
  console.log(botUsername, ctx.message?.text)
  if (!ctx.session.authorized) return;
  let userMessage = '';

  // 1️⃣ ПРЯМОЕ УПОМИНАНИЕ @botname в тексте
  if (botUsername && ctx.message?.text?.includes(`@${botUsername}`)) {
    userMessage = ctx.message.text.replace(/@[a-zA-Z0-9_]+/g, '').trim();
    console.log('3')
    console.log(ctx.message)
    if (ctx.message?.reply_to_message) {
    // Берем текст reply + текст оригинального сообщения
    // const replyText = ctx.message.text || '';
    const originalText = ctx.message.reply_to_message.caption || '';
    userMessage = `${userMessage}\n\n[Прокомментируй сообщение развернуто в соответствии с комментарием перед этим предложением: "${originalText}"]`;
  }
  }
  // 2️⃣ Reply к любому боту
  else if (ctx.message?.reply_to_message?.from?.is_bot) {
    userMessage = ctx.message.text || '';
    console.log('4')
  }
  // 3️⃣ Reply к сообщению где упоминали бота
  else if (botUsername && ctx.message?.reply_to_message?.text?.includes(`@${botUsername}`)) {
    userMessage = ctx.message.text || '';
  }
  // 4️⃣ ПЕРЕСЛАННЫЕ СООБЩЕНИЯ с @botname
  else if (ctx.message?.forwardFrom && botUsername && ctx.message?.text?.includes(`@${botUsername}`)) {
    userMessage = ctx.message.text.replace(/@[a-zA-Z0-9_]+/g, '').trim();
  }
  // 5️⃣ ЛИЧКА — любой текст
  else if (ctx.chat?.type === 'private') {
    userMessage = ctx.message.text || '';
  }
  // 6️⃣ Иначе игнорируем
  else {
    return;
  }

  if (!userMessage?.trim()) return;

  // 1. ОТПРАВЛЯЕМ ЗАГЛУШКУ (анимация)
  const loadingMsg = await ctx.reply('⏳ Братан, думаю над ответом...');

  // 2. Добавляем в контекст
  ctx.session.messages.push({ role: 'user', content: userMessage });
  if (ctx.session.messages.length > 20) {
    ctx.session.messages = ctx.session.messages.slice(-20);
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'sonar',
      messages: ctx.session.messages,
      stream: false,
      temperature: 0.7,
    });

    let reply = completion.choices[0]?.message?.content || 'Извини, не понял.';

    // 3. ОЧИСТКА Markdown
    reply = reply
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/_(.*?)_/g, '$1')
      .replace(/\[\w+:\d+\]/g, '')
      .replace(/`(.*?)`/g, '$1')
      .replace(/\\[(.*?)\\]/g, '$1')
      .replace(/\\\((.*?)\\\)/g, '$1')
      .trim();

    ctx.session.messages.push({ role: 'assistant', content: reply });

    // 4. РЕДАКТИРУЕМ заглушку на финальный ответ
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      reply
    );
  } catch (error) {
    console.error(error);
    // Редактируем ошибку вместо заглушки
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      '❌ Ошибка API. Попробуй позже.'
    );
  }
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('🚀 Opershtab Goida Bot запускается...');

// ✅ ФУНКЦИЯ ИНИЦИАЛИЗАЦИИ БОТА
async function initializeBot() {
  try {
    // Получаем информацию о боте перед запуском
    const me = await bot.telegram.getMe();
    botUsername = me.username;
    console.log(`✅ Бот: @${botUsername}`);

    // Запускаем бота
    await bot.launch();
    console.log('🚀 Opershtab Goida Bot запущен!');

    // Запуск Express сервера для health checks
    const app = express();
    const PORT = process.env.PORT || 3000;

    // Health check endpoint
    app.get('/', (_: any, res: { json: (arg0: { status: string; timestamp: string; }) => void; }) => {
      res.json({ status: 'Telegram bot running', timestamp: new Date().toISOString() });
    });

    app.get('/health', (_: any, res: { json: (arg0: { status: string; bot: string; username: string; }) => void; }) => {
      res.json({
        status: 'OK',
        bot: 'active',
        username: botUsername
      });
    });

    // Запуск сервера ПОСЛЕ бота
    app.listen(PORT, () => {
      console.log(`🚀 Health server on port ${PORT}`);
    });

  } catch (error) {
    console.error('❌ Ошибка при запуске бота:', error);
    process.exit(1);
  }
}

// ✅ ЗАПУСКАЕМ ИНИЦИАЛИЗАЦИЮ
initializeBot();