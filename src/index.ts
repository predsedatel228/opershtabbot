import { Telegraf } from 'telegraf';
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
  admin, 177154883, 458765057, 420182056, 382338329, 50265358, 1261664782, 299231204,
]);

const app = express();
const PORT = parseInt(process.env.PORT || '10000', 10);

app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    status: 'OK',
    service: 'opershtabbot',
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    bot: 'starting',
    uptime: process.uptime(),
    port: PORT
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server listening on 0.0.0.0:${PORT}`);
});

const bot = new Telegraf(process.env.BOT_TOKEN);
const openai = new OpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY,
  baseURL: 'https://api.perplexity.ai',
});

let botUsername = '';

type Role = 'system' | 'user' | 'assistant';

interface ChatSession {
  messages: Array<{ role: Role; content: string }>;
  authorized: boolean;
}

const chatSessions = new Map<number, ChatSession>();

function getChatSession(chatId: number): ChatSession {
  let session = chatSessions.get(chatId);

  if (!session) {
    session = {
      authorized: false,
      messages: [
        {
          role: 'system',
          content:
            ' Ты ветеран локальных войн и конфликтов, русский патриот. Ты участвовал во всех конфликтах России с 1991 года по 2025 год, пока тебе не прострелили колено. Теперь ты сидишь дома, отвечаешь на вопросы оперштаба. А еще ты очень любишь рыбалку и постоянно ее упоминаешь. Расскажи небольшой патриотический монолог. Твой позывной буба, представься. Также у тебя есть друзья: Ветераны СВО Бибер и Долик. Отвечай кратко и по делу на русском языке, придерживаясь этой легенды. НЕ используй markdown, НЕ добавляй ссылки, НЕ используй LaTeX. Пиши обычным текстом.'
        }
      ]
    };
    chatSessions.set(chatId, session);
  }

  return session;
}

function cleanupText(text: string) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/\[\w+:\d+\]/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\\[(.*?)\\]/g, '$1')
    .replace(/\\\((.*?)\\\)/g, '$1')
    .trim();
}

bot.command('id', (ctx: any) => {
  const userId = ctx.from.id;
  ctx.reply(
    `Ваш Telegram ID: \`${userId}\`\n\nОтправьте этот ID администратору для получения доступа.`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('adduser', (ctx: any) => {
  const adminId = ctx.from.id;

  if (adminId !== admin) {
    return ctx.reply('❌ Только администратор может добавлять пользователей.');
  }

  const args = ctx.message.text.split(' ');
  const targetId = parseInt(args[1], 10);

  if (!targetId) {
    return ctx.reply('Использование: /adduser 123456789');
  }

  ALLOWED_USERS.add(targetId);
  ctx.reply(`✅ Пользователь ${targetId} добавлен в список доступа.`);
});

bot.command('users', (ctx: any) => {
  if (ctx.from.id !== admin) {
    return ctx.reply('❌ Доступ запрещен.');
  }

  const usersList = Array.from(ALLOWED_USERS).join(', ');
  ctx.reply(`👥 Разрешенные пользователи (${ALLOWED_USERS.size}):\n\`${usersList}\``, {
    parse_mode: 'Markdown'
  });
});

bot.command('start', async (ctx: any) => {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const session = getChatSession(chatId);

  const isAllowed = ALLOWED_USERS.has(userId);

  if (isAllowed) {
    session.authorized = true;
    await ctx.reply('✅ Доступ разрешен. Пиши вопросы — контекст общий для этого чата.');
  } else {
    await ctx.reply(
      '🔒 Доступ ограничен.\n\n' +
        `Ваш ID: \`${userId}\`\n\n` +
        '1. Отправьте /id для получения ID\n' +
        '2. Перешлите ID администратору\n' +
        '3. После одобрения бот заработает',
      { parse_mode: 'Markdown' }
    );
  }
});

bot.on(message('text'), async (ctx: any) => {
  if (!ctx.chat || !ctx.from) return;

  const chatId = ctx.chat.id;
  const session = getChatSession(chatId);
  const text = ctx.message?.text || '';

  if (ALLOWED_USERS.has(ctx.from.id)) {
    session.authorized = true;
  }

  if (!session.authorized && !text.startsWith('/')) {
    return ctx.reply('❌ Доступ запрещен');
  }

  let userMessage = '';

  if (botUsername && text.includes(`@${botUsername}`)) {
    userMessage = text.replace(/@[a-zA-Z0-9_]+/g, '').trim();

    if (ctx.message?.reply_to_message) {
      const originalText =
        ctx.message.reply_to_message.caption ||
        ctx.message.reply_to_message.text ||
        '';
      userMessage = `${userMessage}\n\n[Прокомментируй сообщение развернуто в соответствии с комментарием перед этим предложением: "${originalText}"]`;
    }
  } else if (ctx.message?.reply_to_message?.from?.is_bot) {
    userMessage = text;
  } else if (ctx.message?.reply_to_message?.text?.includes(`@${botUsername}`)) {
    userMessage = text;
  } else if (ctx.message?.forward_from && text.includes(`@${botUsername}`)) {
    userMessage = text.replace(/@[a-zA-Z0-9_]+/g, '').trim();
  } else if (ctx.chat.type === 'private') {
    userMessage = text;
  } else {
    return;
  }

  if (!userMessage.trim()) return;

  const loadingMsg = await ctx.reply('⏳ Думаю над ответом...', {
    reply_parameters: { message_id: ctx.message.message_id }
  });

  session.messages.push({ role: 'user', content: userMessage });

  if (session.messages.length > 20) {
    session.messages = [session.messages[0], ...session.messages.slice(-19)];
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'sonar',
      messages: session.messages,
      stream: false,
      temperature: 0.7,
    });

    let reply = completion.choices[0]?.message?.content || 'Извини, не понял.';
    reply = cleanupText(reply);

    session.messages.push({ role: 'assistant', content: reply });

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      reply
    );
  } catch (error) {
    console.error(error);

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      '❌ Ошибка API. Попробуй позже.'
    );
  }
});

async function initializeBot() {
  try {
    const me = await bot.telegram.getMe();
    botUsername = me.username;
    console.log(`✅ Бот: @${botUsername}`);

    await bot.launch();
    console.log('🚀 Bot запущен!');
  } catch (error) {
    console.error('❌ Ошибка запуска бота:', error);
    process.exit(1);
  }
}

console.log('🚀 Бот запускается...');
setTimeout(initializeBot, 2000);

process.once('SIGINT', () => {
  console.log('SIGINT received, stopping bot...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('SIGTERM received, stopping bot...');
  bot.stop('SIGTERM');
});