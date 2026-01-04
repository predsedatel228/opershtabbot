// src/types.ts
export interface BotSession {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}

export interface BotContext {
  session: BotSession;
}
