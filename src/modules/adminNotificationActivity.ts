import { neon } from "@neondatabase/serverless";
import { config } from "../config.js";

export type AdminNotificationAttempt = {
  id: string;
  channel: string;
  recipientId: string;
  kind: string;
  provider: string;
  providerMessageId: string | null;
  templateName: string | null;
  fallbackUsed: boolean;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
};

export async function loadRecentAdminNotificationAttempts(limit = 12, maxAgeMinutes = 1): Promise<AdminNotificationAttempt[]> {
  if (!config.databaseUrl) {
    return [];
  }

  const rows = await neon(config.databaseUrl)`
    SELECT
      id,
      channel,
      recipient_id,
      kind,
      provider,
      provider_message_id,
      template_name,
      fallback_used,
      status,
      error_message,
      created_at,
      updated_at,
      delivered_at,
      read_at,
      failed_at
    FROM outbound_notifications
    WHERE scope = 'admin'
      AND created_at >= now() - (${maxAgeMinutes}::text || ' minutes')::interval
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return (rows as Array<Record<string, any>>).map((row) => ({
    id: String(row.id),
    channel: String(row.channel ?? ""),
    recipientId: String(row.recipient_id ?? ""),
    kind: String(row.kind ?? ""),
    provider: String(row.provider ?? ""),
    providerMessageId: typeof row.provider_message_id === "string" ? row.provider_message_id : null,
    templateName: typeof row.template_name === "string" ? row.template_name : null,
    fallbackUsed: Boolean(row.fallback_used),
    status: String(row.status ?? "unknown"),
    errorMessage: typeof row.error_message === "string" ? row.error_message : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    deliveredAt: row.delivered_at ? new Date(row.delivered_at).toISOString() : null,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    failedAt: row.failed_at ? new Date(row.failed_at).toISOString() : null
  }));
}
