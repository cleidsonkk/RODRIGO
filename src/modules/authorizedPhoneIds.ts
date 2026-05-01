import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { config } from "../config.js";

let sqlClient: NeonQueryFunction<false, false> | null = null;

export type AuthorizedPhoneId = {
  phone: string;
  displayName: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AuthorizedPhoneDecision =
  | { allowed: true; matchedPhone: string | null }
  | { allowed: false; reason: "not_registered" | "blocked"; matchedPhone: string | null };

function getSql(): NeonQueryFunction<false, false> {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL nao configurada");
  }

  if (!sqlClient) {
    sqlClient = neon(config.databaseUrl);
  }

  return sqlClient;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function addBrazilianVariants(value: string, variants: Set<string>): void {
  if (!value) {
    return;
  }

  variants.add(value);

  if (value.startsWith("55") && (value.length === 12 || value.length === 13)) {
    const local = value.slice(2);
    variants.add(local);
    addBrazilianVariants(local, variants);
    return;
  }

  if (value.length === 11 && value[2] === "9") {
    variants.add(`${value.slice(0, 2)}${value.slice(3)}`);
  }

  if (value.length === 10) {
    variants.add(`${value.slice(0, 2)}9${value.slice(2)}`);
  }

  if (value.length === 10 || value.length === 11) {
    variants.add(`55${value}`);
  }
}

export function expandAuthorizedPhoneVariants(phone: string): string[] {
  const digits = digitsOnly(phone);
  const variants = new Set<string>();
  addBrazilianVariants(digits, variants);
  return Array.from(variants).filter(Boolean);
}

export function canonicalAuthorizedPhone(phone: string): string {
  const variants = expandAuthorizedPhoneVariants(phone);
  const preferred = variants.find((item) => item.startsWith("55") && item.length === 13);

  if (preferred) {
    return preferred;
  }

  const withCountry = variants.find((item) => item.startsWith("55"));

  if (withCountry) {
    return withCountry;
  }

  return variants[0] ?? digitsOnly(phone);
}

export async function listAuthorizedPhoneIds(): Promise<AuthorizedPhoneId[]> {
  if (!config.databaseUrl) {
    return [];
  }

  const rows = await getSql().query(`
    SELECT phone, display_name, enabled, created_at, updated_at
    FROM authorized_phone_ids
    ORDER BY enabled DESC, updated_at DESC, phone ASC
  `);

  return (rows as Array<Record<string, any>>).map((row) => ({
    phone: String(row.phone ?? ""),
    displayName: typeof row.display_name === "string" && row.display_name.trim() ? row.display_name.trim() : null,
    enabled: Boolean(row.enabled),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  }));
}

export async function upsertAuthorizedPhoneId(phone: string, displayName: string | null): Promise<AuthorizedPhoneId> {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL nao configurada");
  }

  const canonicalPhone = canonicalAuthorizedPhone(phone);
  const normalizedDisplayName = typeof displayName === "string" && displayName.trim() ? displayName.trim() : null;
  const rows = await getSql().query(`
    INSERT INTO authorized_phone_ids (phone, display_name, enabled, created_at, updated_at)
    VALUES ($1, $2, true, now(), now())
    ON CONFLICT (phone) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      enabled = true,
      updated_at = now()
    RETURNING phone, display_name, enabled, created_at, updated_at
  `, [canonicalPhone, normalizedDisplayName]);

  const row = rows[0] as Record<string, any>;
  return {
    phone: String(row.phone ?? canonicalPhone),
    displayName: typeof row.display_name === "string" && row.display_name.trim() ? row.display_name.trim() : null,
    enabled: Boolean(row.enabled),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export async function setAuthorizedPhoneIdEnabled(phone: string, enabled: boolean): Promise<boolean> {
  if (!config.databaseUrl) {
    return false;
  }

  const rows = await getSql().query(`
    UPDATE authorized_phone_ids
    SET enabled = $2, updated_at = now()
    WHERE phone = $1
    RETURNING phone
  `, [canonicalAuthorizedPhone(phone), enabled]);

  return rows.length > 0;
}

export async function deleteAuthorizedPhoneId(phone: string): Promise<boolean> {
  if (!config.databaseUrl) {
    return false;
  }

  const rows = await getSql().query(`
    DELETE FROM authorized_phone_ids
    WHERE phone = $1
    RETURNING phone
  `, [canonicalAuthorizedPhone(phone)]);

  return rows.length > 0;
}

export async function checkAuthorizedPhoneId(phone: string): Promise<AuthorizedPhoneDecision> {
  if (!config.databaseUrl) {
    return { allowed: true, matchedPhone: null };
  }

  const variants = expandAuthorizedPhoneVariants(phone);

  if (variants.length === 0) {
    return { allowed: false, reason: "not_registered", matchedPhone: null };
  }

  const rows = await getSql().query(`
    SELECT phone, enabled
    FROM authorized_phone_ids
    WHERE phone = ANY($1::text[])
    ORDER BY enabled DESC, updated_at DESC
    LIMIT 1
  `, [variants]);

  const row = rows[0] as Record<string, any> | undefined;

  if (!row) {
    return { allowed: false, reason: "not_registered", matchedPhone: null };
  }

  if (!row.enabled) {
    return { allowed: false, reason: "blocked", matchedPhone: String(row.phone ?? "") };
  }

  return { allowed: true, matchedPhone: String(row.phone ?? "") };
}
