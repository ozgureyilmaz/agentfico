import { redactText, redactValue } from "@agentfico/serv/redact";

const IDENTITY_FIELDS = new Set([
  "agentname",
  "modelname",
  "model",
  "modelid",
  "model_id",
  "reviewerid",
  "reviewername",
  "contributorid",
  "contributorname",
]);

const PRIVATE_COLLECTIONS = new Set([
  "peerassessments",
  "peerassessmentcontributors",
  "humancontributions",
]);

const PRIVATE_FIELDS = new Set([
  "trace",
  "credittoken",
  "paymentsignature",
  "paymentrequired",
]);

function stripPeerAndHumanIdentities(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripPeerAndHumanIdentities(item));
  }
  if (typeof value !== "object" || value === null) return value;

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (
      PRIVATE_COLLECTIONS.has(normalized) ||
      IDENTITY_FIELDS.has(normalized) ||
      PRIVATE_FIELDS.has(normalized) ||
      normalized.startsWith("model") ||
      normalized.startsWith("evaluator") ||
      normalized.startsWith("judge") ||
      normalized.startsWith("reviewer") ||
      normalized.startsWith("wallet") ||
      normalized.startsWith("credit_token") ||
      normalized.startsWith("payment_signature") ||
      normalized.startsWith("x402") ||
      normalized === "credittoken" ||
      normalized === "payer" ||
      normalized === "pods"
    ) {
      continue;
    }
    output[key] = stripPeerAndHumanIdentities(item);
  }
  return output;
}

export function sanitizeReppoValue(
  value: unknown,
  secrets: readonly string[] = [],
): unknown {
  return stripPeerAndHumanIdentities(redactValue(value, secrets));
}

function stripX402PersonalData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripX402PersonalData);
  if (typeof value !== "object" || value === null) return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (
      normalized.startsWith("x402") ||
      normalized.startsWith("wallet") ||
      normalized.startsWith("credit_token") ||
      normalized === "credittoken" ||
      normalized.startsWith("payment_signature") ||
      normalized === "payer"
    ) {
      continue;
    }
    output[key] = stripX402PersonalData(item);
  }
  return output;
}

export function redactReppoRaw(
  value: unknown,
  secrets: readonly string[] = [],
): unknown {
  return stripX402PersonalData(redactValue(value, secrets));
}

export function sanitizeReppoText(
  value: string,
  secrets: readonly string[] = [],
): string {
  return redactText(value, secrets);
}

export function safeReppoJson(
  value: unknown,
  secrets: readonly string[] = [],
): string {
  return JSON.stringify(sanitizeReppoValue(value, secrets));
}
