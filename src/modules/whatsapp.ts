import { config } from "../config.js";
import { log } from "../logger.js";
import type { OutboundSendResult } from "../types.js";

type JsonObject = Record<string, unknown>;

type MetaMessageResponse = {
  messages?: Array<{ id?: string }>;
};

type TemplateFallbackOptions = {
  name: string;
  languageCode: string;
};

type SendTextOptions = {
  templateFallback?: TemplateFallbackOptions | null;
};

type MetaErrorPayload = {
  error?: {
    message?: string;
    error_user_title?: string;
    error_user_msg?: string;
    error_data?: {
      details?: string;
    };
    code?: number;
  };
};

type ImageUploadPayload = {
  buffer: Buffer;
  mimeType: "image/png" | "image/jpeg";
  fileName: string;
};

class WhatsAppApiError extends Error {
  constructor(message: string, readonly statusCode: number, readonly payload: unknown) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

async function postJson<T>(url: string, body: JsonObject, headers: Record<string, string> = {}): Promise<T | null> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });

  const text = await response.text().catch(() => "");
  const payload = text ? JSON.parse(text) as T : null;

  if (!response.ok) {
    throw new WhatsAppApiError(buildErrorMessage(response.status, payload, text), response.status, payload ?? text);
  }

  return payload;
}

function buildErrorMessage(statusCode: number, payload: unknown, fallbackText: string): string {
  const errorPayload = payload as MetaErrorPayload | null;
  const message = errorPayload?.error?.message;
  const details = errorPayload?.error?.error_data?.details;
  const userTitle = errorPayload?.error?.error_user_title;
  const userMessage = errorPayload?.error?.error_user_msg;
  const parts = [message, details, userTitle, userMessage].filter((value): value is string => Boolean(value?.trim()));
  return `WhatsApp API retornou ${statusCode}: ${(parts.join(" | ") || fallbackText || "erro desconhecido").slice(0, 500)}`;
}

function requireConfig(value: string, name: string): string {
  if (!value) {
    throw new Error(`Configuracao obrigatoria ausente: ${name}`);
  }

  return value;
}

function metaResponse(result: MetaMessageResponse | null, numero: string, kind: OutboundSendResult["kind"], raw: unknown, templateName: string | null = null, fallbackUsed = false): OutboundSendResult {
  return {
    channel: "whatsapp",
    provider: "meta",
    recipientId: numero,
    kind,
    providerMessageId: result?.messages?.[0]?.id ?? null,
    status: "accepted",
    templateName,
    fallbackUsed,
    raw
  };
}

function isWindowClosedError(error: unknown): boolean {
  if (!(error instanceof WhatsAppApiError)) {
    return false;
  }

  const text = error.message.toLowerCase();
  return [
    "24 hour",
    "24-hour",
    "24h",
    "re-engagement",
    "outside the allowed window",
    "free-form",
    "template message"
  ].some((fragment) => text.includes(fragment));
}

function truncateTemplateText(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 900 ? `${collapsed.slice(0, 897)}...` : collapsed;
}

function imagePayloadFromBase64(imageBase64: string): ImageUploadPayload {
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

export class WhatsAppClient {
  async sendText(numero: string, text: string, options: SendTextOptions = {}): Promise<OutboundSendResult> {
    const provider = config.whatsapp.provider;

    if (provider === "none") {
      log("info", "WhatsApp provider none: texto nao enviado", { numero, text });
      return {
        channel: "whatsapp",
        provider: "none",
        recipientId: numero,
        kind: "text",
        providerMessageId: null,
        status: "unknown",
        raw: { skipped: true, reason: "provider_none" }
      };
    }

    if (provider === "evolution") {
      return await this.sendEvolutionText(numero, text);
    }

    if (provider === "zapi") {
      return await this.sendZapiText(numero, text);
    }

    if (provider === "meta") {
      try {
        return await this.sendMetaText(numero, text);
      } catch (error) {
        if (options.templateFallback && isWindowClosedError(error)) {
          log("warn", "Texto administrativo fora da janela do WhatsApp; usando template aprovado", {
            numero,
            templateName: options.templateFallback.name
          });
          return await this.sendMetaTemplate(numero, truncateTemplateText(text), options.templateFallback);
        }

        throw error;
      }
    }

    throw new Error(`WHATSAPP_PROVIDER invalido: ${provider}`);
  }

  async sendImage(numero: string, imageBase64: string, caption: string): Promise<OutboundSendResult> {
    const provider = config.whatsapp.provider;

    if (provider === "none") {
      log("info", "WhatsApp provider none: imagem nao enviada", {
        numero,
        caption,
        bytesBase64: imageBase64.length
      });
      return {
        channel: "whatsapp",
        provider: "none",
        recipientId: numero,
        kind: "image",
        providerMessageId: null,
        status: "unknown",
        raw: { skipped: true, reason: "provider_none" }
      };
    }

    if (provider === "evolution") {
      return await this.sendEvolutionImage(numero, imageBase64, caption);
    }

    if (provider === "zapi") {
      return await this.sendZapiImage(numero, imageBase64, caption);
    }

    if (provider === "meta") {
      return await this.sendMetaImage(numero, imageBase64, caption);
    }

    throw new Error(`WHATSAPP_PROVIDER invalido: ${provider}`);
  }

  private async sendEvolutionText(numero: string, text: string): Promise<OutboundSendResult> {
    const baseUrl = requireConfig(config.whatsapp.apiBaseUrl, "WHATSAPP_API_BASE_URL").replace(/\/$/, "");
    const instance = requireConfig(config.whatsapp.instance, "WHATSAPP_INSTANCE");
    const token = requireConfig(config.whatsapp.apiToken, "WHATSAPP_API_TOKEN");
    const payload = await postJson<Record<string, unknown>>(
      `${baseUrl}/message/sendText/${instance}`,
      { number: numero, text },
      { apikey: token }
    );

    return {
      channel: "whatsapp",
      provider: "evolution",
      recipientId: numero,
      kind: "text",
      providerMessageId: String((payload as Record<string, unknown> | null)?.["key"] ?? (payload as Record<string, unknown> | null)?.["id"] ?? ""),
      status: "accepted",
      raw: payload
    };
  }

  private async sendEvolutionImage(numero: string, imageBase64: string, caption: string): Promise<OutboundSendResult> {
    const baseUrl = requireConfig(config.whatsapp.apiBaseUrl, "WHATSAPP_API_BASE_URL").replace(/\/$/, "");
    const instance = requireConfig(config.whatsapp.instance, "WHATSAPP_INSTANCE");
    const token = requireConfig(config.whatsapp.apiToken, "WHATSAPP_API_TOKEN");
    const image = imagePayloadFromBase64(imageBase64);
    const payload = await postJson<Record<string, unknown>>(
      `${baseUrl}/message/sendMedia/${instance}`,
      {
        number: numero,
        mediatype: "image",
        mimetype: image.mimeType,
        caption,
        media: imageBase64,
        fileName: image.fileName
      },
      { apikey: token }
    );

    return {
      channel: "whatsapp",
      provider: "evolution",
      recipientId: numero,
      kind: "image",
      providerMessageId: String((payload as Record<string, unknown> | null)?.["key"] ?? (payload as Record<string, unknown> | null)?.["id"] ?? ""),
      status: "accepted",
      raw: payload
    };
  }

  private async sendZapiText(numero: string, text: string): Promise<OutboundSendResult> {
    const baseUrl = requireConfig(config.whatsapp.apiBaseUrl, "WHATSAPP_API_BASE_URL").replace(/\/$/, "");
    const instance = requireConfig(config.whatsapp.instance, "WHATSAPP_INSTANCE");
    const token = requireConfig(config.whatsapp.apiToken, "WHATSAPP_API_TOKEN");
    const clientToken = config.whatsapp.clientToken;
    const payload = await postJson<Record<string, unknown>>(
      `${baseUrl}/instances/${instance}/token/${token}/send-text`,
      { phone: numero, message: text },
      clientToken ? { "Client-Token": clientToken } : {}
    );

    return {
      channel: "whatsapp",
      provider: "zapi",
      recipientId: numero,
      kind: "text",
      providerMessageId: String((payload as Record<string, unknown> | null)?.["zaapId"] ?? (payload as Record<string, unknown> | null)?.["messageId"] ?? ""),
      status: "accepted",
      raw: payload
    };
  }

  private async sendZapiImage(numero: string, imageBase64: string, caption: string): Promise<OutboundSendResult> {
    const baseUrl = requireConfig(config.whatsapp.apiBaseUrl, "WHATSAPP_API_BASE_URL").replace(/\/$/, "");
    const instance = requireConfig(config.whatsapp.instance, "WHATSAPP_INSTANCE");
    const token = requireConfig(config.whatsapp.apiToken, "WHATSAPP_API_TOKEN");
    const clientToken = config.whatsapp.clientToken;
    const payload = await postJson<Record<string, unknown>>(
      `${baseUrl}/instances/${instance}/token/${token}/send-image`,
      { phone: numero, image: imageBase64, caption },
      clientToken ? { "Client-Token": clientToken } : {}
    );

    return {
      channel: "whatsapp",
      provider: "zapi",
      recipientId: numero,
      kind: "image",
      providerMessageId: String((payload as Record<string, unknown> | null)?.["zaapId"] ?? (payload as Record<string, unknown> | null)?.["messageId"] ?? ""),
      status: "accepted",
      raw: payload
    };
  }

  private async sendMetaText(numero: string, text: string): Promise<OutboundSendResult> {
    const phoneNumberId = requireConfig(config.whatsapp.metaPhoneNumberId, "META_PHONE_NUMBER_ID");
    const token = requireConfig(config.whatsapp.apiToken, "WHATSAPP_API_TOKEN");
    const payload = await postJson<MetaMessageResponse>(
      `https://graph.facebook.com/${config.whatsapp.metaApiVersion}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to: numero,
        type: "text",
        text: { body: text }
      },
      { Authorization: `Bearer ${token}` }
    );

    return metaResponse(payload, numero, "text", payload);
  }

  private async sendMetaTemplate(numero: string, text: string, template: TemplateFallbackOptions): Promise<OutboundSendResult> {
    const phoneNumberId = requireConfig(config.whatsapp.metaPhoneNumberId, "META_PHONE_NUMBER_ID");
    const token = requireConfig(config.whatsapp.apiToken, "WHATSAPP_API_TOKEN");
    const payload = await postJson<MetaMessageResponse>(
      `https://graph.facebook.com/${config.whatsapp.metaApiVersion}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to: numero,
        type: "template",
        template: {
          name: template.name,
          language: { code: template.languageCode },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text }]
            }
          ]
        }
      },
      { Authorization: `Bearer ${token}` }
    );

    return metaResponse(payload, numero, "template", payload, template.name, true);
  }

  private async sendMetaImage(numero: string, imageBase64: string, caption: string): Promise<OutboundSendResult> {
    const phoneNumberId = requireConfig(config.whatsapp.metaPhoneNumberId, "META_PHONE_NUMBER_ID");
    const token = requireConfig(config.whatsapp.apiToken, "WHATSAPP_API_TOKEN");
    const image = imagePayloadFromBase64(imageBase64);
    const formData = new FormData();

    formData.append("messaging_product", "whatsapp");
    formData.append("file", new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }), image.fileName);

    const uploadResponse = await fetch(
      `https://graph.facebook.com/${config.whatsapp.metaApiVersion}/${phoneNumberId}/media`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      }
    );

    const uploadText = await uploadResponse.text().catch(() => "");
    const uploadPayload = uploadText ? JSON.parse(uploadText) as { id?: string } : null;

    if (!uploadResponse.ok) {
      throw new WhatsAppApiError(buildErrorMessage(uploadResponse.status, uploadPayload, uploadText), uploadResponse.status, uploadPayload ?? uploadText);
    }

    if (!uploadPayload?.id) {
      throw new Error("Upload Meta nao retornou id de midia");
    }

    const payload = await postJson<MetaMessageResponse>(
      `https://graph.facebook.com/${config.whatsapp.metaApiVersion}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to: numero,
        type: "image",
        image: {
          id: uploadPayload.id,
          caption
        }
      },
      { Authorization: `Bearer ${token}` }
    );

    return metaResponse(payload, numero, "image", payload);
  }
}
