import type { TicketConfirmationResult, TicketStatus } from "../types.js";
import { formatMoney, type CustomerCreditSummary } from "./credit.js";

type MessageInput = Pick<
  TicketConfirmationResult,
  "confirmado" | "codigo_bilhete" | "codigo_confirmacao" | "mensagem_erro" | "dados_bilhete"
> & {
  status: TicketStatus;
  credit?: TicketConfirmationResult["credit"];
};

function getStatusDescription(result: MessageInput): string | null {
  const ticket = result.dados_bilhete?.aposta;

  if (!ticket || typeof ticket !== "object") {
    return null;
  }

  const statusDescription = (ticket as Record<string, unknown>).status_desc;
  return typeof statusDescription === "string" && statusDescription.trim() ? statusDescription.trim() : null;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

function ticketItems(data: Record<string, unknown> | null): Array<Record<string, any>> {
  if (!data || typeof data !== "object") {
    return [];
  }

  const payload = data as Record<string, any>;

  if (Array.isArray(payload.itens)) {
    return payload.itens;
  }

  if (Array.isArray(payload.itensBolao)) {
    return payload.itensBolao;
  }

  return [];
}

function gameLabel(item: Record<string, any>): string {
  const home = pickString(item.casa_nome, item.time_casa, item.home, item.casa);
  const away = pickString(item.visit_nome, item.time_visitante, item.away, item.visitante);

  if (home && away) {
    return `${home} x ${away}`;
  }

  return pickString(item.jogo, item.evento, item.descricao, item.nome) || "jogo do bilhete";
}

function gameDetailLines(item: Record<string, any>): string[] {
  const lines = [`Jogo: ${gameLabel(item)}`];
  const date = pickString(item.dt_jogo, item.data, item.date);
  const market = pickString(item.odd_desc, item.mercado, item.market);
  const selection = pickString(item.descricao, item.palpite, item.selection);

  if (date) {
    lines.push(`Data: ${date}`);
  }

  if (market || selection) {
    lines.push(`Palpite: ${[market, selection].filter(Boolean).join(" - ")}`);
  }

  return lines;
}

function findTimeLimitGame(data: Record<string, unknown> | null, errorText: string): Record<string, any> | null {
  const items = ticketItems(data);

  if (items.length === 0) {
    return null;
  }

  const normalizedError = normalizeText(errorText);
  const matching = items.find((item) => {
    const searchable = normalizeText([
      item.casa_nome,
      item.time_casa,
      item.home,
      item.casa,
      item.visit_nome,
      item.time_visitante,
      item.away,
      item.visitante,
      item.descricao,
      item.palpite,
      item.odd_desc,
      item.mercado
    ].map((value) => pickString(value)).filter(Boolean).join(" "));

    return searchable && normalizedError.includes(searchable);
  });

  return matching ?? (items.length === 1 ? items[0] : null);
}

function isTimeLimitError(message: string | null | undefined): boolean {
  const normalized = normalizeText(message ?? "");
  return normalized.includes("horario")
    || normalized.includes("hora limite")
    || normalized.includes("limite de jogo")
    || normalized.includes("jogo atingido")
    || normalized.includes("evento encerrado")
    || normalized.includes("prazo")
    || normalized.includes("tempo limite");
}

function buildTimeLimitMessage(result: MessageInput): string {
  const errorText = result.mensagem_erro?.trim() ?? "";
  const game = findTimeLimitGame(result.dados_bilhete ?? null, errorText);
  const lines = [
    "⚠️ Não foi possível confirmar este bilhete.",
    `Código: ${result.codigo_bilhete}`,
    "Motivo: o horário limite de um jogo foi atingido."
  ];

  if (game) {
    lines.push("", ...gameDetailLines(game));
  }

  if (errorText) {
    lines.push("", `Retorno do site: ${errorText.slice(0, 300)}`);
  }

  lines.push("", "Refaça o bilhete sem esse jogo ou envie outro código para validação.");
  return lines.join("\n");
}

export function buildCustomerMessage(result: MessageInput): string {
  if (result.status === "limite_excedido") {
    const credit = result.credit;
    const lines = [
      "⚠️ Este bilhete ultrapassa seu limite atual.",
      `Código: ${result.codigo_bilhete}`
    ];

    if (credit?.limit !== undefined) {
      lines.push(`Seu limite: ${formatMoney(credit.limit)}`);
      lines.push(`Em aberto: ${formatMoney(credit.outstanding)} · Bilhete: ${formatMoney(credit.ticketAmount ?? 0)}`);
      lines.push(`Disponível agora: ${formatMoney(credit.available)}`);

      if ((credit.requiredPayment ?? 0) > 0) {
        lines.push(`Para confirmar, faça pagamento mínimo de ${formatMoney(credit.requiredPayment ?? 0)}.`);
      }
    }

    lines.push("Ou aguarde o administrador liberar mais limite.");
    return lines.join("\n");
  }

  if (result.confirmado) {
    const lines = [
      "✅ Bilhete confirmado com sucesso!",
      `Código: ${result.codigo_bilhete}`
    ];

    if (result.codigo_confirmacao) {
      lines.push(`Confirmação: ${result.codigo_confirmacao}`);
    }

    if (result.credit?.available !== undefined) {
      lines.push(`Limite disponível: ${formatMoney(result.credit.available)}`);
    }

    lines.push("Guarde este comprovante. Boa sorte! 🍀");
    return lines.join("\n");
  }

  if (result.status === "encontrado" && result.mensagem_erro?.includes("pendente de confirmacao")) {
    const statusDescription = getStatusDescription(result);

    return [
      "✅ Bilhete localizado.",
      `Código: ${result.codigo_bilhete}`,
      statusDescription ? `Status: ${statusDescription}` : "Status: já confirmado",
      "Este bilhete não está pendente de confirmação."
    ].join("\n");
  }

  if (result.status === "nao_encontrado") {
    return [
      "⚠️ Não conseguimos localizar o código informado.",
      "Verifique se digitou corretamente e envie novamente."
    ].join("\n");
  }

  if (isTimeLimitError(result.mensagem_erro)) {
    return buildTimeLimitMessage(result);
  }

  return [
    "🔄 Tivemos uma instabilidade ao consultar seu bilhete.",
    "Tente novamente em alguns minutos."
  ].join("\n");
}

export function buildExtractionFailureMessage(): string {
  return [
    "⚠️ Não consegui identificar o código do bilhete.",
    "Envie o código com 12 caracteres, com ou sem espaços.",
    "Exemplo: ABCD 1234 WXYZ"
  ].join("\n");
}

export function buildMultipleCodesMessage(summary: CustomerCreditSummary | null): string {
  const lines = [
    "⚠️ Envie apenas 1 código de bilhete por vez.",
    "Assim consigo validar o limite e confirmar com segurança."
  ];

  if (summary) {
    lines.push(`Seu limite: ${formatMoney(summary.limit)}`);
    lines.push(`Disponível agora: ${formatMoney(summary.available)}`);
  }

  return lines.join("\n");
}

export function buildTelegramWelcomeMessage(): string {
  return [
    "Olá! Envie o código do bilhete para validação.",
    "Pode mandar com espaços ou tudo junto.",
    "Para aparecer com celular no painel, toque em Compartilhar meu telefone.",
    "Exemplo: ABCD 1234 WXYZ"
  ].join("\n");
}

export function buildTelegramContactRegisteredMessage(phoneNumber: string): string {
  return [
    "✅ Telefone cadastrado com sucesso.",
    `Celular: ${phoneNumber}`,
    "Agora envie 1 código de bilhete por vez."
  ].join("\n");
}

export function buildTelegramContactRejectedMessage(): string {
  return [
    "⚠️ Para sua segurança, envie o seu próprio contato pelo botão Compartilhar meu telefone.",
    "Depois envie 1 código de bilhete por vez."
  ].join("\n");
}
