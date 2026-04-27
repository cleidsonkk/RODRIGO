import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { config } from "../config.js";
import { log } from "../logger.js";

let sqlClient: NeonQueryFunction<false, false> | null = null;

export type AdminNotificationChannel = "telegram" | "whatsapp";

export type AdminNotificationTarget = {
  channel: AdminNotificationChannel;
  targetId: string;
  displayName: string | null;
  username: string | null;
  source: "env" | "database";
};

function getSql(): NeonQueryFunction<false, false> {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL nao configurada");
  }

  if (!sqlClient) {
    sqlClient = neon(config.databaseUrl);
  }

  return sqlClient;
}

function normalizeTargetId(channel: AdminNotificationChannel, targetId: string): string {
  if (channel === "whatsapp") {
    return targetId.replace(/\D/g, "");
  }

  return targetId.trim();
}

function envTargets(): AdminNotificationTarget[] {
  const telegramTargets = config.adminNotifications.telegramChatIds.map((targetId) => ({
    channel: "telegram",
    targetId: normalizeTargetId("telegram", targetId),
    displayName: "Configurado no ambiente",
    username: null,
    source: "env"
  }) satisfies AdminNotificationTarget);

  const whatsappTargets = config.adminNotifications.whatsappNumbers.map((targetId) => ({
    channel: "whatsapp",
    targetId: normalizeTargetId("whatsapp", targetId),
    displayName: "Configurado no ambiente",
    username: null,
    source: "env"
  }) satisfies AdminNotificationTarget);

  return [...telegramTargets, ...whatsappTargets];
}

function uniqueTargets(targets: AdminNotificationTarget[]): AdminNotificationTarget[] {
  const seen = new Set<string>();
  const unique: AdminNotificationTarget[] = [];

  for (const target of targets) {
    const key = `${target.channel}:${target.targetId}`;

    if (!target.targetId || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(target);
  }

  return unique;
}

export async function syncConfiguredAdminNotificationTargets(): Promise<number> {
  const targets = envTargets();

  if (!config.databaseUrl || targets.length === 0) {
    return 0;
  }

  try {
    await getSql().transaction((tx) => targets.map((target) => tx`
      INSERT INTO admin_notification_targets (
        channel,
        target_id,
        display_name,
        username,
        enabled
      )
      VALUES (
        ${target.channel},
        ${target.targetId},
        ${target.displayName},
        ${target.username},
        true
      )
      ON CONFLICT (channel, target_id) DO UPDATE SET
        display_name = COALESCE(admin_notification_targets.display_name, EXCLUDED.display_name),
        username = COALESCE(admin_notification_targets.username, EXCLUDED.username),
        enabled = true,
        updated_at = now()
    `));
  } catch (error) {
    log("warn", "Falha ao sincronizar destinos administrativos configurados no ambiente", {
      error: error instanceof Error ? error.message : String(error)
    });
    return 0;
  }

  return uniqueTargets(targets).length;
}

export async function loadAdminTelegramTargets(): Promise<AdminNotificationTarget[]> {
  return loadAdminNotificationTargets("telegram");
}

export async function loadAdminNotificationTargets(channel?: AdminNotificationChannel): Promise<AdminNotificationTarget[]> {
  const targets = envTargets();
  const selectedTargets = channel ? targets.filter((target) => target.channel === channel) : targets;

  if (!config.databaseUrl) {
    return uniqueTargets(selectedTargets);
  }

  try {
    const rows = channel ? await getSql()`
      SELECT channel, target_id, display_name, username
      FROM admin_notification_targets
      WHERE channel = ${channel}
        AND enabled = true
      ORDER BY updated_at DESC
    ` : await getSql()`
      SELECT channel, target_id, display_name, username
      FROM admin_notification_targets
      WHERE enabled = true
      ORDER BY updated_at DESC
    `;

    for (const row of rows as Array<Record<string, any>>) {
      const rowChannel = row.channel === "whatsapp" ? "whatsapp" : "telegram";
      selectedTargets.push({
        channel: rowChannel,
        targetId: String(row.target_id ?? ""),
        displayName: typeof row.display_name === "string" ? row.display_name : null,
        username: typeof row.username === "string" ? row.username : null,
        source: "database"
      });
    }
  } catch (error) {
    log("warn", "Falha ao carregar destinos administrativos", {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return uniqueTargets(selectedTargets);
}

export async function countAdminTelegramTargets(): Promise<number> {
  return (await loadAdminTelegramTargets()).length;
}

export async function countAdminNotificationTargets(): Promise<number> {
  return (await loadAdminNotificationTargets()).length;
}

export async function upsertAdminNotificationTarget(input: {
  channel: AdminNotificationChannel;
  targetId: string;
  displayName: string | null;
  username: string | null;
}): Promise<void> {
  await getSql()`
    INSERT INTO admin_notification_targets (
      channel,
      target_id,
      display_name,
      username,
      enabled
    )
    VALUES (
      ${input.channel},
      ${normalizeTargetId(input.channel, input.targetId)},
      ${input.displayName},
      ${input.username},
      true
    )
    ON CONFLICT (channel, target_id) DO UPDATE SET
      display_name = COALESCE(EXCLUDED.display_name, admin_notification_targets.display_name),
      username = COALESCE(EXCLUDED.username, admin_notification_targets.username),
      enabled = true,
      updated_at = now()
  `;
}

export async function upsertAdminTelegramTarget(input: {
  targetId: string;
  displayName: string | null;
  username: string | null;
}): Promise<void> {
  await upsertAdminNotificationTarget({
    channel: "telegram",
    ...input
  });
}

export async function markAdminNotificationTargetNotified(channel: AdminNotificationChannel, targetId: string): Promise<void> {
  if (!config.databaseUrl) {
    return;
  }

  try {
    await getSql()`
      UPDATE admin_notification_targets
      SET last_notified_at = now(), updated_at = now()
      WHERE channel = ${channel}
        AND target_id = ${normalizeTargetId(channel, targetId)}
    `;
  } catch (error) {
    log("warn", "Falha ao atualizar ultimo envio administrativo", {
      channel,
      targetId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function markAdminTelegramTargetNotified(targetId: string): Promise<void> {
  await markAdminNotificationTargetNotified("telegram", targetId);
}
