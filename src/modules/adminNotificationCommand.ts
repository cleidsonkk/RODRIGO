import { config } from "../config.js";
import { log } from "../logger.js";
import { verifyAdminCredentials } from "./adminAuth.js";
import { upsertAdminNotificationTarget } from "./adminNotificationTargets.js";
import { customerIdentityFromInbound } from "./customerProfile.js";
import { sendText } from "./notifier.js";
import type { InboundMessage } from "../types.js";

export function parseAdminNotificationCommand(message: string): string | null {
  const match = message.trim().match(/^\/(?:admin|notificacoes|admin_notify|ativar_admin)(?:@\w+)?(?:\s+(.+))?$/i);
  return match ? (match[1] ?? "").trim() : null;
}

export async function handleAdminNotificationCommand(inbound: InboundMessage): Promise<boolean> {
  const password = parseAdminNotificationCommand(inbound.mensagem);

  if (password === null) {
    return false;
  }

  if (!config.admin.username || !config.admin.password || !verifyAdminCredentials(config.admin.username, password)) {
    log("warn", "Tentativa invalida de ativar notificacoes administrativas", {
      channel: inbound.channel,
      recipientId: inbound.recipientId
    });

    await sendText(
      inbound.channel,
      inbound.recipientId,
      [
        "Nao foi possivel ativar as notificacoes administrativas.",
        "Confira a senha do painel e tente novamente."
      ].join("\n")
    );
    return true;
  }

  const identity = customerIdentityFromInbound(inbound);

  await upsertAdminNotificationTarget({
    channel: inbound.channel,
    targetId: inbound.recipientId,
    displayName: identity.displayName,
    username: identity.username
  });

  await sendText(
    inbound.channel,
    inbound.recipientId,
    [
      `Notificacoes administrativas ativadas neste ${inbound.channel === "telegram" ? "Telegram" : "WhatsApp"}.`,
      "Voce recebera confirmacoes, erros, limites, pagamentos pendentes e codigos invalidos em tempo real."
    ].join("\n")
  );

  log("info", "Notificacoes administrativas ativadas", {
    channel: inbound.channel,
    recipientId: inbound.recipientId
  });

  return true;
}
