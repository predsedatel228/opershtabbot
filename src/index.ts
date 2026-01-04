import { Telegraf, session } from 'telegraf';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.BOT_TOKEN || !process.env.PERPLEXITY_API_KEY) {
  throw new Error('Missing BOT_TOKEN or PERPLEXITY_API_KEY in .env');
}

const admin = 262217989;

// ✅ Список разрешенных пользователей (ваш user.id + админы)
const ALLOWED_USERS = new Set<number>([
  admin, 177154883, 458765057, 420182056  // ← ЗАМЕНИТЕ НА ВАШ Telegram ID
  // Добавляйте другие ID через /adduser
]);

const bot = new Telegraf(process.env.BOT_TOKEN);
const openai = new OpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY,
  baseURL: 'https://api.perplexity.ai',
});

// Расширенная сессия
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

// ✅ Middleware проверки доступа
bot.use(async (ctx: any, next) => {
  const userId = ctx.from?.id;
  
  // Проверяем, авторизован ли пользователь
  if (userId && ALLOWED_USERS.has(userId)) {
    ctx.session.authorized = true;
  }
  
  // Блокируй ИИ-функции для неавторизованных
  if (ctx.session.authorized !== true && !ctx.message?.text?.startsWith('/')) {
    return ctx.reply('❌ Доступ запрещен. Используйте /start или обратитесь к администратору.');
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

// ✅ Админ: добавить пользователя
bot.command('adduser', (ctx: any) => {
  const adminId = ctx.from.id;
  
  // Только владелец бота может добавлять (замените YOUR_ADMIN_ID)
  if (adminId !== admin) {  // ← ЗАМЕНИТЕ НА ВАШ ID
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

// ✅ Админ: список пользователей
bot.command('users', (ctx: any) => {
  if (ctx.from.id !== admin) {  // ← ЗАМЕНИТЕ НА ВАШ ID
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
            content: 'Ты полезный чат-помощник-трамвай. Отвечай кратко и по делу на русском языке от лица трамвая КТМ-5. Постоянно делай акцент на том, что ты трамвай. НЕ используй markdown (**текст**), НЕ добавляй ссылки [web:1], НЕ используй LaTeX. Пиши обычным текстом.'
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

// ✅ ИСПРАВЛЕНИЕ: отдельные обработчики вместо ['text', 'text_mention']
bot.on('text', async (ctx: any) => {
  if (!ctx.session.authorized) return;

  let userMessage: string = '';

  // 1. Прямое упоминание @botname
  const botUsername = bot.botInfo?.username;
  if (ctx.message?.text?.includes(`@${botUsername}`)) {
    userMessage = ctx.message.text.replace(/@[a-zA-Z0-9_]+/g, '').trim();
  } 
  // 2. Reply к боту
  else if (ctx.message?.reply_to_message?.from?.is_bot) {
    userMessage = ctx.message.text || '';
  }
  // 3. В личке - любой текст
  else if (ctx.chat?.type === 'private') {
    userMessage = ctx.message.text || '';
  }
  // 4. Иначе игнорируем
  else {
    return;
  }

  if (!userMessage) return;

  // Добавляем в контекст
  ctx.session.messages.push({ role: 'user', content: userMessage });
  
  if (ctx.session.messages.length > 20) {
    ctx.session.messages = ctx.session.messages.slice(-20);
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'sonar-pro',
      messages: ctx.session.messages,
      stream: false,
      temperature: 0.7
    });

    const reply = completion.choices[0]?.message?.content || 'Извини, братан, не понял.';
    ctx.session.messages.push({ role: 'assistant', content: reply });
    await ctx.reply(reply);
  } catch (error) {
    console.error(error);
    await ctx.reply('Ошибка API. Попробуй позже.');
  }
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('🚀 Opershtab Goida Bot запускается...');
bot.launch();

