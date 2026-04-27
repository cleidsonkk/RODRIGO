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

function parseMetaCloudMessage(payload: Record<string, any>): InboundMessage | null {
  const value = payload.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];

  if (!message || typeof message !== "object") {
    return null;
  }

  const rawNumber = pickString(message.from);
  const text = pickString(
    message.text?.body,
    message.button?.text,
    message.interactive?.button_reply?.title,
    message.interactive?.list_reply?.title
  );
  const numero = normalizePhone(rawNumber);

  if (!numero || !text) {
    return null;
  }

  const contact = Array.isArray(value?.contacts)
    ? value.contacts.find((item: Record<string, any>) => normalizePhone(pickString(item.wa_id)) === numero)
    : null;
  const profileName = pickString(contact?.profile?.name);

  return {
    channel: "whatsapp",
    recipientId: numero,
    mensagem: text,
    externalMessageId: pickString(message.id) || null,
    raw: payload,
    contactFirstName: profileName || null
  };
}

export function parseInboundWhatsAppMessage(body: unknown): InboundMessage | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const payload = body as Record<string, any>;
  const metaMessage = parseMetaCloudMessage(payload);

  if (metaMessage) {
    return metaMessage;
  }

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
