/**
 * Server-side Gemini proxy shared by the Express server (server.ts) and the
 * Vercel functions in api/. The browser never talks to Google directly: it
 * sends the user's own key plus the prompt here, and this module calls the
 * Gemini REST API with model fallback and bounded rate-limit retries.
 *
 * No server-side key exists. Every request must carry the user's key.
 */

/**
 * Models tried in order. The first model that answers wins.
 * Override with GEMINI_MODELS="model-a,model-b" if Google changes availability.
 */
export const DEFAULT_GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
];

export function getConfiguredModels(env: Record<string, string | undefined> = process.env): string[] {
  const fromEnv = (env.GEMINI_MODELS || "")
    .split(",")
    .map(m => m.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_GEMINI_MODELS;
}

/** Largest prompt + system instruction the proxy forwards (characters). */
export const MAX_PROMPT_CHARS = 1_000_000;

/** Upper bound for a single RetryInfo wait, so one request cannot hang the function. */
export const MAX_RETRY_DELAY_MS = 8000;

/** Attempts per model when Google answers with a quota / rate-limit error. */
export const MAX_ATTEMPTS_PER_MODEL = 2;

/**
 * Accepts what people actually paste: a bare key, a quoted key, or a whole
 * `GEMINI_API_KEY="..."` line, and returns only the key.
 */
export function normalizeGeminiKey(key: string): string {
  let normalized = (key || "").trim();
  const assignmentMatch = normalized.match(/^(?:export\s+)?(?:GEMINI_API_KEY|GOOGLE_API_KEY|VITE_GEMINI_API_KEY)\s*=\s*(.+)$/i);
  if (assignmentMatch?.[1]) {
    normalized = assignmentMatch[1].trim();
  }

  normalized = normalized.replace(/[;,]\s*$/, "").trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }

  const apiKeyMatch = normalized.match(/AIzaSy[0-9A-Za-z_-]+/);
  if (apiKeyMatch) {
    return apiKeyMatch[0];
  }

  const authKeyMatch = normalized.match(/AQ\.[0-9A-Za-z._-]+/);
  if (authKeyMatch) {
    return authKeyMatch[0];
  }

  const accessTokenMatch = normalized.match(/ya29\.[0-9A-Za-z._-]+/);
  if (accessTokenMatch) {
    return accessTokenMatch[0];
  }

  return normalized;
}

/** Rejects obvious placeholders ("test", "YOUR_GEMINI_API_KEY", ...) before a network call. */
export function isPlaceholderKey(key: string): boolean {
  const k = normalizeGeminiKey(key).toLowerCase();
  if (!k) return true;
  if (/^(test|mock|dummy|fake|valid|placeholder|changeme)([_-]?(api[_-]?)?key)?$/.test(k)) return true;
  return /^(your|my)[_-]?(gemini[_-]?)?api[_-]?key$/.test(k);
}

export function getFetchUrlAndHeaders(apiKey: string, model: string) {
  const trimmed = normalizeGeminiKey(apiKey);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  return { url, headers: authHeaders(trimmed) };
}

function authHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key.startsWith("ya29.")) {
    headers["Authorization"] = `Bearer ${key}`;
  } else {
    headers["x-goog-api-key"] = key;
  }
  return headers;
}

/** Reads Google's RetryInfo (or "retry in Ns" text) and caps the wait. */
export function parseRetryDelayMs(errorText: string): number {
  try {
    const parsed = JSON.parse(errorText);
    const retryInfo = parsed?.error?.details?.find(
      (detail: any) => String(detail?.["@type"] || "").includes("RetryInfo")
    );
    if (retryInfo?.retryDelay) {
      const seconds = parseFloat(String(retryInfo.retryDelay).replace(/s$/, ""));
      if (!Number.isNaN(seconds) && seconds > 0) {
        return Math.min(Math.ceil(seconds * 1000), MAX_RETRY_DELAY_MS);
      }
    }

    const messageMatch = parsed?.error?.message?.match(/retry in ([\d.]+)s/i);
    if (messageMatch?.[1]) {
      return Math.min(Math.ceil(parseFloat(messageMatch[1]) * 1000), MAX_RETRY_DELAY_MS);
    }
  } catch {
    // Not JSON: fall through to the default delay.
  }

  return MAX_RETRY_DELAY_MS;
}

export function isQuotaOrRateLimitError(status: number, errorText: string): boolean {
  const normalized = (errorText || "").toLowerCase();
  return status === 429 ||
    normalized.includes("resource_exhausted") ||
    normalized.includes("quota exceeded") ||
    normalized.includes("rate limit");
}

/** Concatenates the answer text parts of a generateContent response (skips thought parts). */
export function extractResponseText(result: any): string {
  const parts: any[] = result?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter(p => typeof p?.text === "string" && !p.thought)
    .map(p => p.text)
    .join("");
}

/** JSON schema for the question-answering call (see src/lib/gemini.ts answerQuestion). */
export const ANSWER_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    finalAnswer: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          docName: { type: "string" },
          pageNumber: { type: "number" },
          finding: { type: "string" }
        },
        required: ["docName", "pageNumber", "finding"]
      }
    },
    conflicts: { type: "string" }
  },
  required: ["finalAnswer"]
};

const RESPONSE_SCHEMAS: Record<string, object> = {
  answer: ANSWER_RESPONSE_SCHEMA,
};

export interface GeminiRequestBody {
  systemInstruction?: string;
  prompt?: string;
  isJson?: boolean;
  responseSchema?: string;
  customApiKey?: string;
}

export interface ProxyResult {
  status: number;
  body: Record<string, unknown>;
}

export interface ProxyDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  models?: string[];
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Returns an error result for a malformed or oversized request, or null when it is acceptable. */
export function validateGeminiRequest(body: unknown): ProxyResult | null {
  if (!body || typeof body !== "object") {
    return { status: 400, body: { error: "Request body must be a JSON object." } };
  }
  const b = body as GeminiRequestBody;
  if (typeof b.prompt !== "string" || !b.prompt.trim()) {
    return { status: 400, body: { error: "Missing prompt." } };
  }
  if (b.systemInstruction !== undefined && typeof b.systemInstruction !== "string") {
    return { status: 400, body: { error: "systemInstruction must be a string." } };
  }
  const size = b.prompt.length + (b.systemInstruction || "").length;
  if (size > MAX_PROMPT_CHARS) {
    return {
      status: 413,
      body: { error: `The documents are too large for one request (${size.toLocaleString("en-US")} characters, limit ${MAX_PROMPT_CHARS.toLocaleString("en-US")}). Remove some documents and try again.` }
    };
  }
  if (b.responseSchema !== undefined && !(b.responseSchema in RESPONSE_SCHEMAS)) {
    return { status: 400, body: { error: `Unknown responseSchema "${b.responseSchema}".` } };
  }
  return null;
}

type ModelResult = { text: string } | { error: string; status: number };

async function generateWithModel(
  apiKey: string,
  model: string,
  body: GeminiRequestBody,
  deps: Required<Omit<ProxyDeps, "models">>
): Promise<ModelResult> {
  const { url, headers } = getFetchUrlAndHeaders(apiKey, model);
  const isJson = !!body.isJson;

  const payload: any = {
    contents: [{ parts: [{ text: body.prompt || "" }] }],
    generationConfig: { temperature: isJson ? 0.1 : 0.4 },
  };
  if (body.systemInstruction) {
    payload.systemInstruction = { parts: [{ text: body.systemInstruction }] };
  }
  if (isJson) {
    payload.generationConfig.responseMimeType = "application/json";
    if (body.responseSchema) {
      payload.generationConfig.responseSchema = RESPONSE_SCHEMAS[body.responseSchema];
    }
  }

  let lastErrorText = "";
  let lastStatus = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt++) {
    const response = await deps.fetchImpl(url, { method: "POST", headers, body: JSON.stringify(payload) });

    if (response.ok) {
      const result = await response.json();
      const text = extractResponseText(result);
      if (text) return { text };
      return { error: `Model ${model} returned no text (finishReason: ${result?.candidates?.[0]?.finishReason ?? "unknown"}).`, status: 502 };
    }

    lastStatus = response.status;
    lastErrorText = await response.text();
    if (isQuotaOrRateLimitError(response.status, lastErrorText) && attempt < MAX_ATTEMPTS_PER_MODEL - 1) {
      await deps.sleep(parseRetryDelayMs(lastErrorText));
      continue;
    }
    break;
  }

  return { error: `HTTP ${lastStatus} from model ${model}: ${lastErrorText}`, status: lastStatus };
}

/** POST /api/gemini */
export async function getGeminiResponse(body: unknown, deps: ProxyDeps = {}): Promise<ProxyResult> {
  try {
    const invalid = validateGeminiRequest(body);
    if (invalid) return invalid;
    const b = body as GeminiRequestBody;

    const apiKey = normalizeGeminiKey(b.customApiKey || "");
    if (!apiKey) {
      return { status: 400, body: { error: "Enter your Gemini API key in the top bar before asking a question." } };
    }

    const resolved = {
      fetchImpl: deps.fetchImpl ?? fetch,
      sleep: deps.sleep ?? defaultSleep,
    };
    const models = deps.models ?? getConfiguredModels();

    let lastError = "";
    let sawQuota = false;
    for (const model of models) {
      const result = await generateWithModel(apiKey, model, b, resolved);
      if ("text" in result) {
        return { status: 200, body: { text: result.text, model } };
      }
      console.warn(`Gemini model ${model} failed:`, result.error.slice(0, 500));
      lastError = result.error;
      if (isQuotaOrRateLimitError(result.status, result.error)) sawQuota = true;
    }

    if (lastError.includes("ACCESS_TOKEN_TYPE_UNSUPPORTED")) {
      return {
        status: 502,
        body: {
          error: "Google rejected this AQ. auth key with ACCESS_TOKEN_TYPE_UNSUPPORTED. " +
            "This is an issue on Google's side for some new auth keys. Generate a fresh key in AI Studio, " +
            "or use a standard AIzaSy... API key."
        }
      };
    }

    return {
      status: sawQuota ? 429 : 502,
      body: { error: lastError || "All Gemini models failed to respond." }
    };
  } catch (err: any) {
    console.error("Gemini proxy error:", err);
    return { status: 500, body: { error: err?.message || "Unknown Gemini proxy error." } };
  }
}

/**
 * Checks a key with a models.list call. This does not depend on access to any
 * particular model and does not spend generation quota.
 */
export async function verifyGeminiKey(
  keyToTest: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ isValid: boolean; reason?: string }> {
  const key = normalizeGeminiKey(keyToTest);
  if (!key) {
    return { isValid: false, reason: "Empty key." };
  }
  if (isPlaceholderKey(key)) {
    return { isValid: false, reason: "Enter a real Gemini API key from Google AI Studio." };
  }

  try {
    const response = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
      method: "GET",
      headers: authHeaders(key),
    });
    if (response.ok) {
      return { isValid: true };
    }

    const errStr = await response.text();
    let googleReason = "";
    try {
      const parsed = JSON.parse(errStr);
      googleReason = parsed?.error?.details?.[0]?.metadata?.reason || parsed?.error?.details?.[0]?.reason || parsed?.error?.status || "";
    } catch {
      googleReason = "";
    }

    if (googleReason === "API_KEY_SERVICE_BLOCKED") {
      return {
        isValid: false,
        reason: "This key is blocked from the Gemini API. Enable the Generative Language API or use an unrestricted AI Studio key."
      };
    }
    if (errStr.includes("ACCESS_TOKEN_TYPE_UNSUPPORTED")) {
      return {
        isValid: false,
        reason: "Google rejected this AQ. auth key (ACCESS_TOKEN_TYPE_UNSUPPORTED). Generate a fresh key or use an AIzaSy... key."
      };
    }
    if (isQuotaOrRateLimitError(response.status, errStr)) {
      return { isValid: true, reason: "Key accepted, but the Gemini quota for this key is currently exhausted." };
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      return { isValid: false, reason: `Google rejected the key (HTTP ${response.status}).` };
    }
    return { isValid: false, reason: `Could not verify the key: Google returned HTTP ${response.status}. Try again shortly.` };
  } catch (err: any) {
    return { isValid: false, reason: `Network error while verifying the key: ${err?.message || err}` };
  }
}

/** POST /api/gemini/verify. Always 200 with { isValid, reason } unless the server itself fails. */
export async function getVerifyKeyResponse(body: any, fetchImpl: typeof fetch = fetch): Promise<ProxyResult> {
  try {
    const verification = await verifyGeminiKey(typeof body?.apiKey === "string" ? body.apiKey : "", fetchImpl);
    return { status: 200, body: verification };
  } catch (err: any) {
    console.error("Key verification error:", err);
    return { status: 500, body: { isValid: false, reason: err?.message || "Key verification failed." } };
  }
}
