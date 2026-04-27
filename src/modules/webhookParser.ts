import type { InboundMessage } from "../types.js";

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function normalizePhone(raw: string): string {
  const remoteJid = raw.split("@")[0] ?? raw;
  return remoteJid.replace(/\D/g, "");
}

export function parseInboundWhatsAppMessage(body: unknown): InboundMessage | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const payload = body as Record<string, any>;
  const data = payload.data ?? {};
  const message = data.message ?? payload.message ?? {};
  const key = data.key ?? payload.key ?? {};

  const rawNumber = pickString(
    payload.numero,
    payload.number,
    payload.phone,
    payload.from,
    payload.remoteJid,
    data.numero,
    data.number,
    data.phone,
    data.from,
    data.remoteJid,
    key.remoteJid
  );

  const text = pickString(
    payload.mensagem,
    payload.text,
    payload.body,
    payload.message,
    data.mensagem,
    data.text,
    data.body,
    message.conversation,
    message.text,
    message?.extendedTextMessage?.text,
    message?.ephemeralMessage?.message?.extendedTextMessage?.text,
    message?.ephemeralMessage?.message?.conversation
  );

  const numero = normalizePhone(rawNumber);
  const externalMessageId = pickString(
    payload.messageId,
    payload.id,
    data.messageId,
    data.id,
    key.id,
    message.id
  );

  if (!numero || !text) {
    return null;
  }

  return {
    channel: "whatsapp",
    recipientId: numero,
    mensagem: text,
    externalMessageId: externalMessageId || null,
    raw: body
  };
}
