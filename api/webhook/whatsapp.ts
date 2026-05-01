import { waitUntil } from "@vercel/functions";
import { prepareInboundForProcessing } from "../../src/modules/inboundHandler.js";
import { processValidationJob } from "../../src/modules/processor.js";
import { authorizeRequest } from "../../src/modules/security.js";
import { config } from "../../src/config.js";
import { sendText } from "../../src/modules/notifier.js";
import { applyWhatsAppStatusUpdate } from "../../src/modules/persistence.js";
import { parseInboundWhatsAppMessage, parseWhatsAppStatusUpdates } from "../../src/modules/webhookParser.js";

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method === "GET") {
    const mode = String(req.query?.["hub.mode"] ?? "");
    const token = String(req.query?.["hub.verify_token"] ?? "");
    const challenge = String(req.query?.["hub.challenge"] ?? "");

    if (mode === "subscribe" && token && token === process.env.WEBHOOK_SECRET) {
      res.status(200).send(challenge);
      return;
    }

    res.status(403).send("Forbidden");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const authorized = await authorizeRequest({
    ip: String(req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "").split(",")[0].trim(),
    userAgent: String(req.headers["user-agent"] ?? ""),
    getHeader: (name) => req.headers[name.toLowerCase()] as string | undefined
  }, {
    requireSharedSecret: config.whatsapp.provider !== "meta"
  });

  if (!authorized) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  const statusUpdates = parseWhatsAppStatusUpdates(req.body);

  if (statusUpdates.length > 0) {
    await Promise.all(statusUpdates.map(async (update) => {
      await applyWhatsAppStatusUpdate(update).catch(() => false);
    }));
  }

  const inbound = parseInboundWhatsAppMessage(req.body);

  if (!inbound) {
    res.status(202).json({ ok: true, ignored: true, reason: "mensagem_sem_texto_ou_numero" });
    return;
  }

  if (config.serviceSuspended) {
    await sendText(inbound.channel, inbound.recipientId, config.suspensionMessage).catch(() => undefined);
    res.status(202).json({ ok: true, suspended: true });
    return;
  }

  const result = await prepareInboundForProcessing(inbound);

  if (result.kind !== "queued") {
    res.status(202).json({ ok: true, queued: false, reason: result.kind });
    return;
  }

  if (!result.duplicate) {
    waitUntil(processValidationJob(result.job));
  }

  res.status(202).json({
    ok: true,
    queued: true,
    duplicate: result.duplicate,
    jobId: result.job.id,
    codigo: result.job.codigo
  });
}
