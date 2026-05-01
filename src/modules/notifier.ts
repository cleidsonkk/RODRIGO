import type { OutboundSendResult, ValidationJob } from "../types.js";
import { TelegramClient } from "./telegram.js";
import { WhatsAppClient } from "./whatsapp.js";

const whatsapp = new WhatsAppClient();
const telegram = new TelegramClient();

export async function sendText(channel: ValidationJob["channel"], recipientId: string, text: string): Promise<OutboundSendResult> {
  if (channel === "telegram") {
    return await telegram.sendText(recipientId, text);
  }

  return await whatsapp.sendText(recipientId, text);
}

export async function sendImage(channel: ValidationJob["channel"], recipientId: string, imageBase64: string, caption: string): Promise<OutboundSendResult> {
  if (channel === "telegram") {
    return await telegram.sendImage(recipientId, imageBase64, caption);
  }

  return await whatsapp.sendImage(recipientId, imageBase64, caption);
}

export async function requestTelegramContact(recipientId: string, text: string): Promise<OutboundSendResult> {
  return await telegram.requestContact(recipientId, text);
}
