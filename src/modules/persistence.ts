import { createHash, randomUUID } from "node:crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { config } from "../config.js";
import { log } from "../logger.js";
import type {
  DeliveryStatus,
  OutboundMessageKind,
  OutboundSendResult,
  TicketConfirmationResult,
  ValidationJob,
  WhatsAppStatusUpdate
} from "../types.js";
import { extractTicketFinancials } from "./credit.js";

let sqlClient: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL não configurada");
  }

  if (!sqlClient) {
    sqlClient = neon(config.databaseUrl);
  }

  return sqlClient;
}

export function hasDatabase(): boolean {
  return Boolean(config.databaseUrl);
}

export async function createValidationJob(input: {
  channel: ValidationJob["channel"];
  recipientId: string;
  mensagem: string;
  codigo: string;
  externalMessageId: string | null;
  raw: unknown;
}): Promise<{ job: ValidationJob; duplicate: boolean }> {
  const sql = getSql();

  if (input.externalMessageId) {
    const existing = await sql`
      SELECT id, external_message_id, channel, phone, original_message, ticket_code, raw_payload, created_at
      FROM validation_jobs
      WHERE channel = ${input.channel}
        AND external_message_id = ${input.externalMessageId}
      LIMIT 1
    `;

    if (existing.length > 0) {
      const row = existing[0] as Record<string, any>;
      return {
        duplicate: true,
        job: {
          id: row.id,
          externalMessageId: row.external_message_id,
          channel: row.channel,
          recipientId: row.phone,
          numero: row.phone,
          mensagem: row.original_message,
          codigo: row.ticket_code,
          raw: row.raw_payload,
          createdAt: new Date(row.created_at).toISOString()
        }
      };
    }
  }

  const id = randomUUID();
  await sql`
    INSERT INTO validation_jobs (
      id,
      external_message_id,
      channel,
      phone,
      original_message,
      ticket_code,
      status,
      raw_payload
    )
    VALUES (
      ${id},
      ${input.externalMessageId},
      ${input.channel},
      ${input.recipientId},
      ${input.mensagem},
      ${input.codigo},
      'queued',
      ${JSON.stringify(input.raw)}::jsonb
    )
  `;

  return {
    duplicate: false,
    job: {
      id,
      externalMessageId: input.externalMessageId,
      channel: input.channel,
      recipientId: input.recipientId,
      numero: input.recipientId,
      mensagem: input.mensagem,
      codigo: input.codigo,
      raw: input.raw,
      createdAt: new Date().toISOString()
    }
  };
}

export async function recordExtractionFailure(input: {
  channel: ValidationJob["channel"];
  recipientId: string;
  mensagem: string;
  externalMessageId: string | null;
  raw: unknown;
  customerMessage: string;
}): Promise<string | null> {
  if (!hasDatabase()) {
    return null;
  }

  const sql = getSql();
  const id = randomUUID();
  const rows = await sql`
    INSERT INTO validation_jobs (
      id,
      external_message_id,
      channel,
      phone,
      original_message,
      ticket_code,
      status,
      customer_message,
      raw_payload,
      processed_at
    )
    VALUES (
      ${id},
      ${input.externalMessageId},
      ${input.channel},
      ${input.recipientId},
      ${input.mensagem},
      ${null},
      'codigo_nao_encontrado',
      ${input.customerMessage},
      ${JSON.stringify(input.raw)}::jsonb,
      now()
    )
    ON CONFLICT (channel, external_message_id) WHERE external_message_id IS NOT NULL
    DO NOTHING
    RETURNING id
  `;

  return rows.length > 0 ? String(rows[0].id) : null;
}

export async function markJobProcessing(jobId: string): Promise<void> {
  if (!hasDatabase()) {
    return;
  }

  const sql = getSql();
  await sql`
    UPDATE validation_jobs
    SET status = 'processing', updated_at = now()
    WHERE id = ${jobId}
  `;
}

export async function markJobFinished(jobId: string, result: TicketConfirmationResult, customerMessage: string): Promise<void> {
  if (!hasDatabase()) {
    return;
  }

  const sql = getSql();
  const screenshotBytes = result.screenshot_base64 ? Buffer.byteLength(result.screenshot_base64, "base64") : null;
  const screenshotSha256 = result.screenshot_base64
    ? createHash("sha256").update(Buffer.from(result.screenshot_base64, "base64")).digest("hex")
    : null;
  const persistedStatus = result.confirmado ? "confirmado" : result.status;
  const financials = extractTicketFinancials(result.dados_bilhete);
  const resultPayload = {
    ...result,
    screenshot_base64: result.screenshot_base64 ? "[omitted]" : null
  };

  await sql`
    UPDATE validation_jobs
    SET
      status = ${persistedStatus},
      confirmed = ${result.confirmado},
      confirmation_code = ${result.codigo_confirmacao},
      customer_message = ${customerMessage},
      error_message = ${result.mensagem_erro},
      screenshot_sha256 = ${screenshotSha256},
      screenshot_bytes = ${screenshotBytes},
      ticket_amount = ${financials.amount || null},
      ticket_prize = ${financials.prize || null},
      ticket_game_count = ${financials.gameCount || null},
      result_payload = ${JSON.stringify(resultPayload)}::jsonb,
      updated_at = now(),
      processed_at = now()
    WHERE id = ${jobId}
  `;
}

export async function markDeliveryStatus(input: {
  jobId: string;
  textSent: boolean;
  imageSent: boolean;
  deliveryError: string | null;
}): Promise<void> {
  if (!hasDatabase()) {
    return;
  }

  const sql = getSql();
  await sql`
    UPDATE validation_jobs
    SET
      text_sent = ${input.textSent},
      image_sent = ${input.imageSent},
      delivery_error = ${input.deliveryError},
      updated_at = now()
    WHERE id = ${input.jobId}
  `;
}

export async function recordSecurityEvent(input: {
  id: string;
  eventType: string;
  ip: string;
  userAgent: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  if (!hasDatabase()) {
    return;
  }

  const sql = getSql();
  await sql`
    INSERT INTO security_events (id, event_type, ip, user_agent, metadata)
    VALUES (${input.id}, ${input.eventType}, ${input.ip}, ${input.userAgent}, ${JSON.stringify(input.metadata)}::jsonb)
  `;
}

export async function recordOutboundNotification(input: {
  scope: "customer" | "admin";
  recipientId: string;
  channel: ValidationJob["channel"];
  kind: OutboundMessageKind;
  result: OutboundSendResult;
  jobId?: string | null;
  adminTargetChannel?: string | null;
  adminTargetId?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  if (!hasDatabase()) {
    return;
  }

  const sql = getSql();
  const id = randomUUID();
  await sql`
    INSERT INTO outbound_notifications (
      id,
      scope,
      channel,
      recipient_id,
      job_id,
      admin_target_channel,
      admin_target_id,
      kind,
      provider,
      provider_message_id,
      template_name,
      fallback_used,
      status,
      error_message,
      last_status_at,
      payload,
      created_at,
      updated_at
    )
    VALUES (
      ${id},
      ${input.scope},
      ${input.channel},
      ${input.recipientId},
      ${input.jobId ?? null},
      ${input.adminTargetChannel ?? null},
      ${input.adminTargetId ?? null},
      ${input.kind},
      ${input.result.provider},
      ${input.result.providerMessageId},
      ${input.result.templateName ?? null},
      ${Boolean(input.result.fallbackUsed)},
      ${input.result.status},
      ${input.errorMessage ?? null},
      now(),
      ${JSON.stringify(input.result.raw)}::jsonb,
      now(),
      now()
    )
    ON CONFLICT (provider, provider_message_id) WHERE provider_message_id IS NOT NULL
    DO UPDATE SET
      scope = EXCLUDED.scope,
      channel = EXCLUDED.channel,
      recipient_id = EXCLUDED.recipient_id,
      job_id = COALESCE(EXCLUDED.job_id, outbound_notifications.job_id),
      admin_target_channel = COALESCE(EXCLUDED.admin_target_channel, outbound_notifications.admin_target_channel),
      admin_target_id = COALESCE(EXCLUDED.admin_target_id, outbound_notifications.admin_target_id),
      kind = EXCLUDED.kind,
      template_name = COALESCE(EXCLUDED.template_name, outbound_notifications.template_name),
      fallback_used = EXCLUDED.fallback_used,
      status = EXCLUDED.status,
      error_message = COALESCE(EXCLUDED.error_message, outbound_notifications.error_message),
      last_status_at = now(),
      payload = EXCLUDED.payload,
      updated_at = now()
  `;

  if (input.scope === "customer" && input.jobId) {
    const textStatus = input.kind === "image" ? null : input.result.status;
    const imageStatus = input.kind === "image" ? input.result.status : null;
    await sql`
      UPDATE validation_jobs
      SET
        customer_text_delivery_status = COALESCE(${textStatus}, customer_text_delivery_status),
        customer_image_delivery_status = COALESCE(${imageStatus}, customer_image_delivery_status),
        updated_at = now()
      WHERE id = ${input.jobId}
    `;
  }
}

export async function recordOutboundNotificationSafely(input: {
  scope: "customer" | "admin";
  recipientId: string;
  channel: ValidationJob["channel"];
  kind: OutboundMessageKind;
  result: OutboundSendResult;
  jobId?: string | null;
  adminTargetChannel?: string | null;
  adminTargetId?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  try {
    await recordOutboundNotification(input);
  } catch (error) {
    log("warn", "Falha ao registrar notificacao enviada", {
      scope: input.scope,
      channel: input.channel,
      recipientId: input.recipientId,
      jobId: input.jobId ?? null,
      kind: input.kind,
      provider: input.result.provider,
      providerMessageId: input.result.providerMessageId,
      error: error instanceof Error ? error.message : String(error)
    });

    if (input.scope !== "customer" || !input.jobId || !hasDatabase()) {
      return;
    }

    const sql = getSql();
    const textStatus = input.kind === "image" ? null : input.result.status;
    const imageStatus = input.kind === "image" ? input.result.status : null;

    await sql`
      UPDATE validation_jobs
      SET
        customer_text_delivery_status = COALESCE(${textStatus}, customer_text_delivery_status),
        customer_image_delivery_status = COALESCE(${imageStatus}, customer_image_delivery_status),
        updated_at = now()
      WHERE id = ${input.jobId}
    `;
  }
}

function normalizeDeliveryStatus(status: DeliveryStatus): DeliveryStatus {
  if (status === "sent" || status === "delivered" || status === "read" || status === "failed" || status === "accepted") {
    return status;
  }

  return "unknown";
}

export async function applyWhatsAppStatusUpdate(update: WhatsAppStatusUpdate): Promise<boolean> {
  if (!hasDatabase()) {
    return false;
  }

  const sql = getSql();
  const normalized = normalizeDeliveryStatus(update.status);
  const timestamp = update.timestamp ? new Date(update.timestamp) : null;
  const effectiveTimestamp = timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp.toISOString() : new Date().toISOString();
  const rows = await sql`
    UPDATE outbound_notifications
    SET
      status = ${normalized},
      error_message = ${update.errorMessage ?? null},
      last_status_at = ${effectiveTimestamp},
      delivered_at = CASE WHEN ${normalized} = 'delivered' THEN ${effectiveTimestamp}::timestamptz ELSE delivered_at END,
      read_at = CASE WHEN ${normalized} = 'read' THEN ${effectiveTimestamp}::timestamptz ELSE read_at END,
      failed_at = CASE WHEN ${normalized} = 'failed' THEN ${effectiveTimestamp}::timestamptz ELSE failed_at END,
      last_webhook_payload = ${JSON.stringify(update.raw)}::jsonb,
      updated_at = now()
    WHERE provider = 'meta'
      AND provider_message_id = ${update.providerMessageId}
    RETURNING job_id, kind
  `;

  if (rows.length === 0) {
    return false;
  }

  const relatedJobIds = new Set<string>();
  for (const row of rows as Array<Record<string, any>>) {
    if (row.job_id) {
      relatedJobIds.add(String(row.job_id));
    }
  }

  for (const jobId of relatedJobIds) {
    await sql`
      UPDATE validation_jobs
      SET
        customer_text_delivery_status = COALESCE((
          SELECT onf.status
          FROM outbound_notifications onf
          WHERE onf.job_id = ${jobId}
            AND onf.kind IN ('text', 'template')
          ORDER BY onf.updated_at DESC
          LIMIT 1
        ), customer_text_delivery_status),
        customer_image_delivery_status = COALESCE((
          SELECT onf.status
          FROM outbound_notifications onf
          WHERE onf.job_id = ${jobId}
            AND onf.kind = 'image'
          ORDER BY onf.updated_at DESC
          LIMIT 1
        ), customer_image_delivery_status),
        updated_at = now()
      WHERE id = ${jobId}
    `;
  }

  return true;
}
