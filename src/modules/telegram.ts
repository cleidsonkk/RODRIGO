import { config } from "../config.js";
import { log } from "../logger.js";
import type { OutboundSendResult } from "../types.js";

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type TelegramReplyMarkup = Record<string, unknown>;

type TelegramMessageResult = {
  message_id?: number;
};

function telegramImagePayload(imageBase64: string): { buffer: Buffer; mimeType: "image/png" | "image/jpeg"; fileName: string } {
  const buffer = Buffer.from(imageBase64, "base64");

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return {
      buffer,
      mimeType: "image/jpeg",
      fileName: "comprovante-bilhete.jpg"
    };
  }

  return {
    buffer,
    mimeType: "image/png",
    fileName: "comprovante-bilhete.png"
  };
}

function requireBotToken(): string {
  if (!config.telegram.botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN nao configurado");
  }

  return config.telegram.botToken;
}

async function callTelegram<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = requireBotToken();
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const payload = (await response.json().catch(() => null)) as TelegramResponse<T> | null;

  if (!response.ok || !payload?.ok) {
    throw new Error(`Telegram ${method} retornou ${response.status}: ${payload?.description ?? "erro desconhecido"}`);
  }

  return payload.result as T;
}

function buildResult(chatId: string, kind: OutboundSendResult["kind"], raw: unknown, messageId: number | undefined): OutboundSendResult {
  return {
    channel: "telegram",
    provider: "telegram",
    recipientId: chatId,
    kind,
    providerMessageId: messageId ? String(messageId) : null,
    status: "accepted",
    raw
  };
}

export class TelegramClient {
  async sendText(chatId: string, text: string, options: { replyMarkup?: TelegramReplyMarkup } = {}): Promise<OutboundSendResult> {
    if (!config.telegram.botToken) {
      log("info", "Telegram sem token: texto nao enviado", { chatId, text });
      return {
        channel: "telegram",
        provider: "telegram",
        recipientId: chatId,
        kind: "text",
        providerMessageId: null,
        status: "unknown",
        raw: { skipped: true, reason: "missing_bot_token" }
      };
    }

    const result = await callTelegram<TelegramMessageResult>("sendMessage", {
      chat_id: chatId,
      text,
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {})
    });

    return buildResult(chatId, "text", result, result?.message_id);
  }

  async requestContact(chatId: string, text: string): Promise<OutboundSendResult> {
    return await this.sendText(chatId, text, {
      replyMarkup: {
        keyboard: [[{ text: "Compartilhar meu telefone", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
        input_field_placeholder: "Envie o codigo do bilhete"
      }
    });
  }

  async sendImage(chatId: string, imageBase64: string, caption: string): Promise<OutboundSendResult> {
    if (!config.telegram.botToken) {
      log("info", "Telegram sem token: imagem nao enviada", {
        chatId,
        caption,
        bytesBase64: imageBase64.length
      });
      return {
        channel: "telegram",
        provider: "telegram",
        recipientId: chatId,
        kind: "image",
        providerMessageId: null,
        status: "unknown",
        raw: { skipped: true, reason: "missing_bot_token" }
      };
    }

    const token = requireBotToken();
    const image = telegramImagePayload(imageBase64);
    const formData = new FormData();

    formData.append("chat_id", chatId);
    formData.append("caption", caption);
    formData.append("photo", new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }), image.fileName);

    const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      body: formData
    });

    const payload = (await response.json().catch(() => null)) as TelegramResponse<TelegramMessageResult> | null;

    if (!response.ok || !payload?.ok) {
      throw new Error(`Telegram sendPhoto retornou ${response.status}: ${payload?.description ?? "erro desconhecido"}`);
    }

    return buildResult(chatId, "image", payload.result, payload.result?.message_id);
  }
}
