// Client- and server-safe secret redaction utility for MacroEdge incident logs,
// stack traces, HTTP metadata, and runtime telemetry.
// IMPORTANT: Never import Node built-ins (`node:*`) here so browser error boundaries can use it safely.

const REDACTED = "[REDACTED]";
const REDACTED_JWT = "[REDACTED_JWT]";
const REDACTED_KEY = "[REDACTED_KEY]";
const MAX_OBJECT_DEPTH = 12;

const EXPLICIT_SECRET_ENV_KEYS = [
  "FRED_API_KEY",
  "BLS_API_KEY",
  "BEA_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GEMINI_API_KEY",
  "CRON_SECRET",
  "SYNC_ADMIN_TOKEN",
  "INCIDENT_ADMIN_TOKEN",
  "TWELVE_DATA_API_KEY",
  "FINNHUB_API_KEY",
  "POLYGON_API_KEY",
  "ALPHA_VANTAGE_API_KEY",
  "EODHD_API_KEY",
  "DATABASE_URL",
  "POSTGRES_URL",
] as const;

const DYNAMIC_SECRET_ENV_KEY_RE =
  /(API_KEY|SECRET|SERVICE_ROLE|PASSWORD|PRIVATE_KEY|ADMIN_TOKEN|ACCESS_TOKEN|AUTH_TOKEN|REGISTRATIONKEY)/i;

const SECRET_OBJECT_KEY_EXACT_RE =
  /^(authorization|cookie|set[-_]?cookie|x[-_]?goog[-_]?api[-_]?key|x[-_]?sync[-_]?admin[-_]?token|x[-_]?api[-_]?key|api[-_]?key|apikey|registrationkey|service[-_]?role[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|cron[-_]?secret|admin[-_]?token|incident[-_]?admin[-_]?token|password|passwd|secret|private[-_]?key|bearer[-_]?token|auth[-_]?token|token)$/i;

const SECRET_OBJECT_KEY_SUFFIX_RE =
  /(ApiKey|Secret|Password|ServiceRoleKey|AdminToken|PrivateKey|AccessToken|RefreshToken)$/;

const URL_CREDENTIALS_RE =
  /\b(postgres(?:ql)?|mysql|redis|amqps?|mongodb(?:\+srv)?):\/\/([^:/\s@]+):([^@\s]+)@/gi;

const JWT_RE =
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]*)?\b/g;

const AUTH_HEADER_SCHEME_RE =
  /(["']?authorization["']?\s*[:=]\s*["']?(?:Bearer|Basic|Token)\s+)([A-Za-z0-9._~+/=-]+)/gi;

const BEARER_TOKEN_RE = /(\bBearer\s+)([A-Za-z0-9._~+/=-]{6,})/gi;

const BASIC_CREDS_RE = /(\bBasic\s+)([A-Za-z0-9+/]{12,}={0,2})/g;

const URL_QUERY_SECRET_RE =
  /([?&](?:api_key|apikey|token|secret|password|passwd|registrationkey|x-goog-api-key|x-sync-admin-token|x-api-key|access_token|refresh_token|client_secret|key|UserID)=)([^&#\s"']+)/gi;

const JSON_QUOTED_SECRET_RE =
  /(["'](?:x-goog-api-key|x-sync-admin-token|x-api-key|authorization|api_key|apikey|registrationkey|service_role_key|access_token|refresh_token|id_token|client_secret|cron_secret|admin_token|incident_admin_token|password|passwd|secret|private_key|token|UserID)["']\s*:\s*)(["'])(?:\\.|[^"'\\])*\2/gi;

const KV_SECRET_RE =
  /\b([A-Za-z0-9_]*(?:API_KEY|APIKEY|REGISTRATIONKEY|SERVICE_ROLE_KEY|ACCESS_TOKEN|REFRESH_TOKEN|ID_TOKEN|CLIENT_SECRET|CRON_SECRET|ADMIN_TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|SECRET)|x-goog-api-key|x-sync-admin-token|x-api-key|authorization|token|UserID)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,&;}\]]+)/gi;

const PROVIDER_PREFIX_KEY_RE =
  /\b(?:AIza[0-9A-Za-z_-]{20,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,})\b/g;

function getServerEnvSecretValues(): string[] {
  // Never inspect process.env inside a browser bundle / DOM context.
  if (typeof window !== "undefined") {
    return [];
  }
  if (typeof process === "undefined" || !process.env) {
    return [];
  }

  const secretValues = new Set<string>();

  for (const key of EXPLICIT_SECRET_ENV_KEYS) {
    const val = process.env[key];
    if (typeof val === "string" && val.trim().length >= 6) {
      secretValues.add(val.trim());
    }
  }

  for (const [key, val] of Object.entries(process.env)) {
    if (key.startsWith("NEXT_PUBLIC_")) continue;
    if (!DYNAMIC_SECRET_ENV_KEY_RE.test(key)) continue;
    if (typeof val === "string" && val.trim().length >= 6) {
      secretValues.add(val.trim());
    }
  }

  // Replace longest secrets first so shorter substrings never partially mask longer keys.
  return Array.from(secretValues).sort((a, b) => b.length - a.length);
}

function isSecretObjectKey(key: string): boolean {
  const normalized = key.trim();
  return (
    SECRET_OBJECT_KEY_EXACT_RE.test(normalized) ||
    SECRET_OBJECT_KEY_SUFFIX_RE.test(normalized)
  );
}

export function redactSensitiveText(input: string): string {
  if (!input) return input;

  let output = input;

  for (const secretValue of getServerEnvSecretValues()) {
    if (output.includes(secretValue)) {
      output = output.split(secretValue).join(REDACTED);
    }
  }

  output = output.replace(URL_CREDENTIALS_RE, `$1://$2:${REDACTED}@`);
  output = output.replace(JWT_RE, REDACTED_JWT);
  output = output.replace(AUTH_HEADER_SCHEME_RE, `$1${REDACTED}`);
  output = output.replace(BEARER_TOKEN_RE, `$1${REDACTED}`);
  output = output.replace(BASIC_CREDS_RE, `$1${REDACTED}`);
  output = output.replace(URL_QUERY_SECRET_RE, `$1${REDACTED}`);
  output = output.replace(
    JSON_QUOTED_SECRET_RE,
    (_match, prefix: string, quote: string) =>
      `${prefix}${quote}${REDACTED}${quote}`
  );
  output = output.replace(KV_SECRET_RE, `$1$2${REDACTED}`);
  output = output.replace(PROVIDER_PREFIX_KEY_RE, REDACTED_KEY);

  return output;
}

function redactValueInternal(
  value: unknown,
  seen: WeakSet<object>,
  depth: number
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  if (depth >= MAX_OBJECT_DEPTH) {
    return "[Truncated]";
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      name: redactSensitiveText(value.name),
      message: redactSensitiveText(value.message),
    };
    if (value.stack) {
      out.stack = redactSensitiveText(value.stack);
    }
    for (const [k, v] of Object.entries(
      value as unknown as Record<string, unknown>
    )) {
      out[k] = isSecretObjectKey(k)
        ? REDACTED
        : redactValueInternal(v, seen, depth + 1);
    }
    return out;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValueInternal(item, seen, depth + 1));
  }

  if (value instanceof Map) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) {
      const keyStr = String(k);
      result[keyStr] = isSecretObjectKey(keyStr)
        ? REDACTED
        : redactValueInternal(v, seen, depth + 1);
    }
    return result;
  }

  if (value instanceof Set) {
    return Array.from(value.values()).map((item) =>
      redactValueInternal(item, seen, depth + 1)
    );
  }

  const output: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (
      isSecretObjectKey(key) &&
      entryValue !== null &&
      entryValue !== undefined
    ) {
      output[key] = REDACTED;
      continue;
    }
    output[key] = redactValueInternal(entryValue, seen, depth + 1);
  }
  return output;
}

export function redactObjectSecrets<T>(value: T): T {
  const seen = new WeakSet<object>();
  return redactValueInternal(value, seen, 0) as T;
}
