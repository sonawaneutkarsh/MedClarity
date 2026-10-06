import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GEMINI_MODELS,
  MAX_PROMPT_CHARS,
  extractResponseText,
  getConfiguredModels,
  getFetchUrlAndHeaders,
  getGeminiResponse,
  getVerifyKeyResponse,
  isPlaceholderKey,
  isQuotaOrRateLimitError,
  normalizeGeminiKey,
  parseRetryDelayMs,
  validateGeminiRequest,
} from '../lib/gemini-server';

const KEY = 'AIzaSyA1234567890abcdefghijklmnopqrstuv';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function okText(text: string) {
  return jsonResponse(200, { candidates: [{ content: { parts: [{ text }] } }] });
}

const RATE_LIMITED = {
  error: {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    message: 'Quota exceeded. Please retry in 3.2s.',
    details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3s' }],
  },
};

describe('normalizeGeminiKey', () => {
  it('returns a bare key unchanged', () => {
    expect(normalizeGeminiKey(KEY)).toBe(KEY);
  });

  it('strips an env-style assignment, quotes, and a trailing semicolon', () => {
    expect(normalizeGeminiKey(`export GEMINI_API_KEY="${KEY}";`)).toBe(KEY);
    expect(normalizeGeminiKey(`  VITE_GEMINI_API_KEY = '${KEY}'  `)).toBe(KEY);
  });

  it('extracts AIzaSy, AQ. and ya29. keys from surrounding text', () => {
    expect(normalizeGeminiKey(`key: ${KEY} (copied)`)).toBe(KEY);
    expect(normalizeGeminiKey('token AQ.Ab8RN6abc_DEF-123.x')).toBe('AQ.Ab8RN6abc_DEF-123.x');
    expect(normalizeGeminiKey('Bearer ya29.a0AfH6SMB-xyz')).toBe('ya29.a0AfH6SMB-xyz');
  });

  it('handles empty input', () => {
    expect(normalizeGeminiKey('')).toBe('');
    expect(normalizeGeminiKey(undefined as unknown as string)).toBe('');
  });
});

describe('isPlaceholderKey', () => {
  it('rejects obvious placeholders', () => {
    for (const k of ['', 'test', 'mock', 'dummy_key', 'YOUR_GEMINI_API_KEY', 'my-api-key', 'valid-key']) {
      expect(isPlaceholderKey(k)).toBe(true);
    }
  });

  it('accepts real-looking keys, even if they happen to contain "test"', () => {
    expect(isPlaceholderKey(KEY)).toBe(false);
    expect(isPlaceholderKey('AIzaSyTESTxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).toBe(false);
  });
});

describe('getFetchUrlAndHeaders', () => {
  it('sends API keys in x-goog-api-key', () => {
    const { url, headers } = getFetchUrlAndHeaders(KEY, 'gemini-x');
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent');
    expect(headers['x-goog-api-key']).toBe(KEY);
    expect(headers.Authorization).toBeUndefined();
  });

  it('sends OAuth access tokens as a Bearer header', () => {
    const { headers } = getFetchUrlAndHeaders('ya29.token', 'gemini-x');
    expect(headers.Authorization).toBe('Bearer ya29.token');
    expect(headers['x-goog-api-key']).toBeUndefined();
  });
});

describe('parseRetryDelayMs', () => {
  it('uses RetryInfo.retryDelay', () => {
    expect(parseRetryDelayMs(JSON.stringify(RATE_LIMITED))).toBe(3000);
  });

  it('falls back to "retry in Ns" in the message', () => {
    const body = { error: { message: 'Please retry in 1.5s.' } };
    expect(parseRetryDelayMs(JSON.stringify(body))).toBe(1500);
  });

  it('caps long delays at 8 seconds', () => {
    const body = { error: { details: [{ '@type': 'google.rpc.RetryInfo', retryDelay: '57s' }] } };
    expect(parseRetryDelayMs(JSON.stringify(body))).toBe(8000);
  });

  it('returns the default for non-JSON or missing info', () => {
    expect(parseRetryDelayMs('<html>busy</html>')).toBe(8000);
    expect(parseRetryDelayMs('{}')).toBe(8000);
  });
});

describe('isQuotaOrRateLimitError', () => {
  it('detects 429 and quota wording', () => {
    expect(isQuotaOrRateLimitError(429, '')).toBe(true);
    expect(isQuotaOrRateLimitError(400, '{"status":"RESOURCE_EXHAUSTED"}')).toBe(true);
    expect(isQuotaOrRateLimitError(403, 'Quota exceeded for metric')).toBe(true);
  });

  it('does not flag ordinary errors', () => {
    expect(isQuotaOrRateLimitError(400, 'API key not valid')).toBe(false);
    expect(isQuotaOrRateLimitError(500, '')).toBe(false);
  });
});

describe('extractResponseText', () => {
  it('joins text parts and skips thought parts', () => {
    const result = { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: 'Hello ' }, { text: 'world' }] } }] };
    expect(extractResponseText(result)).toBe('Hello world');
  });

  it('returns an empty string for malformed responses', () => {
    expect(extractResponseText({})).toBe('');
    expect(extractResponseText(null)).toBe('');
  });
});

describe('getConfiguredModels', () => {
  it('uses the defaults when GEMINI_MODELS is unset', () => {
    expect(getConfiguredModels({})).toEqual(DEFAULT_GEMINI_MODELS);
  });

  it('parses a comma-separated override', () => {
    expect(getConfiguredModels({ GEMINI_MODELS: ' a , b,,' })).toEqual(['a', 'b']);
  });
});

describe('validateGeminiRequest', () => {
  it('accepts a normal request', () => {
    expect(validateGeminiRequest({ prompt: 'hi', systemInstruction: 'sys' })).toBeNull();
  });

  it('rejects a missing prompt or a non-object body', () => {
    expect(validateGeminiRequest(null)?.status).toBe(400);
    expect(validateGeminiRequest({ prompt: '   ' })?.status).toBe(400);
  });

  it('rejects oversized prompts with 413', () => {
    expect(validateGeminiRequest({ prompt: 'x'.repeat(MAX_PROMPT_CHARS + 1) })?.status).toBe(413);
  });

  it('rejects unknown response schemas', () => {
    expect(validateGeminiRequest({ prompt: 'hi', responseSchema: 'nope' })?.status).toBe(400);
  });
});

describe('getGeminiResponse', () => {
  const sleep = vi.fn(async () => {});

  it('returns 400 without a key and never calls Google', async () => {
    const fetchImpl = vi.fn();
    const result = await getGeminiResponse({ prompt: 'hi' }, { fetchImpl: fetchImpl as any, sleep, models: ['m1'] });
    expect(result.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns the text and the model that answered', async () => {
    const fetchImpl = vi.fn(async () => okText('answer'));
    const result = await getGeminiResponse({ prompt: 'hi', customApiKey: KEY }, { fetchImpl: fetchImpl as any, sleep, models: ['m1', 'm2'] });
    expect(result).toEqual({ status: 200, body: { text: 'answer', model: 'm1' } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a rate-limited model once, honoring RetryInfo, then succeeds', async () => {
    const sleepSpy = vi.fn(async () => {});
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, RATE_LIMITED))
      .mockResolvedValueOnce(okText('after retry'));
    const result = await getGeminiResponse({ prompt: 'hi', customApiKey: KEY }, { fetchImpl, sleep: sleepSpy, models: ['m1', 'm2'] });
    expect(result.body).toEqual({ text: 'after retry', model: 'm1' });
    expect(sleepSpy).toHaveBeenCalledWith(3000);
  });

  it('falls back to the next model when the first one keeps failing', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('/m1:') ? jsonResponse(429, RATE_LIMITED) : okText('from m2'));
    const result = await getGeminiResponse({ prompt: 'hi', customApiKey: KEY }, { fetchImpl: fetchImpl as any, sleep, models: ['m1', 'm2'] });
    expect(result.body).toEqual({ text: 'from m2', model: 'm2' });
    // m1: two attempts (one retry), m2: one attempt
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('falls back on a non-retryable error such as an unavailable model', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(404, { error: { message: 'model not found' } }))
      .mockResolvedValueOnce(okText('ok'));
    const result = await getGeminiResponse({ prompt: 'hi', customApiKey: KEY }, { fetchImpl, sleep, models: ['gone', 'm2'] });
    expect(result.body).toEqual({ text: 'ok', model: 'm2' });
  });

  it('returns 429 when every model is rate limited, and 502 for other failures', async () => {
    const limited = vi.fn(async () => jsonResponse(429, RATE_LIMITED));
    const r1 = await getGeminiResponse({ prompt: 'hi', customApiKey: KEY }, { fetchImpl: limited as any, sleep, models: ['m1', 'm2'] });
    expect(r1.status).toBe(429);

    const broken = vi.fn(async () => jsonResponse(500, { error: { message: 'boom' } }));
    const r2 = await getGeminiResponse({ prompt: 'hi', customApiKey: KEY }, { fetchImpl: broken as any, sleep, models: ['m1'] });
    expect(r2.status).toBe(502);
    expect(String(r2.body.error)).toContain('HTTP 500 from model m1');
  });

  it('sends the answer schema and JSON mime type when requested', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => okText('{}'));
    await getGeminiResponse(
      { prompt: 'hi', customApiKey: KEY, isJson: true, responseSchema: 'answer' },
      { fetchImpl: fetchImpl as any, sleep, models: ['m1'] }
    );
    const payload = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(payload.generationConfig.responseMimeType).toBe('application/json');
    expect(payload.generationConfig.responseSchema.required).toEqual(['finalAnswer']);
  });
});

describe('getVerifyKeyResponse', () => {
  it('rejects placeholders without a network call', async () => {
    const fetchImpl = vi.fn();
    const result = await getVerifyKeyResponse({ apiKey: 'test' }, fetchImpl as any);
    expect(result.body.isValid).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts a key that models.list accepts', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, { models: [] }));
    const result = await getVerifyKeyResponse({ apiKey: KEY }, fetchImpl as any);
    expect(result.body).toEqual({ isValid: true });
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/v1beta/models?pageSize=1');
  });

  it('rejects a key Google refuses', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid' } }));
    const result = await getVerifyKeyResponse({ apiKey: KEY }, fetchImpl as any);
    expect(result.body.isValid).toBe(false);
  });

  it('does not report unknown server errors as a valid key', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { error: { message: 'unavailable' } }));
    const result = await getVerifyKeyResponse({ apiKey: KEY }, fetchImpl as any);
    expect(result.body.isValid).toBe(false);
    expect(String(result.body.reason)).toContain('503');
  });
});
