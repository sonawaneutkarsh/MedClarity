import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerQuestion, buildDocumentsContext, testApiKey } from '../src/lib/gemini';
import { SAMPLE_DOCUMENTS } from '../src/sampleData';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('buildDocumentsContext', () => {
  it('labels every document and page so the model can cite them', () => {
    const ctx = buildDocumentsContext(SAMPLE_DOCUMENTS);
    expect(ctx).toContain('DOCUMENT: "Apex_Cardiology_Summary_Doe_John.pdf" | Date: 2026-03-12 | Pages: 3');
    expect(ctx.match(/--- Page \d+ ---/g)?.length).toBe(5);
  });
});

describe('answerQuestion', () => {
  it('makes exactly one proxy request with the answer schema and parses the result', async () => {
    const fetchMock = stubFetch(200, {
      model: 'gemini-test',
      text: JSON.stringify({
        finalAnswer: 'BP improved [Apex_Cardiology_90_Day_Lipid_Panel_Doe.pdf, p.1].',
        findings: [{ docName: 'Apex_Cardiology_90_Day_Lipid_Panel_Doe.pdf', pageNumber: 1, finding: '128/80 mmHg' }],
        conflicts: 'None.',
      }),
    });

    const result = await answerQuestion('AIzaSyKEY', 'How is my BP?', SAMPLE_DOCUMENTS, 'simple');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/gemini');
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sent).toMatchObject({ isJson: true, responseSchema: 'answer', customApiKey: 'AIzaSyKEY' });
    expect(sent.prompt).toContain('--- Page 2 ---');
    expect(result.model).toBe('gemini-test');
    expect(result.findings).toHaveLength(1);
  });

  it('shows the raw model text when the reply is not JSON', async () => {
    stubFetch(200, { model: 'm', text: 'Not JSON at all' });
    const result = await answerQuestion('k', 'q', SAMPLE_DOCUMENTS, 'clinical');
    expect(result.finalAnswer).toBe('Not JSON at all');
    expect(result.findings).toEqual([]);
  });

  it('turns proxy errors into readable messages', async () => {
    stubFetch(429, { error: 'HTTP 429 from model m: RESOURCE_EXHAUSTED' });
    await expect(answerQuestion('k', 'q', SAMPLE_DOCUMENTS, 'simple')).rejects.toThrow(/quota/i);
  });
});

describe('testApiKey', () => {
  it('returns the server verdict and skips the request for an empty key', async () => {
    const fetchMock = stubFetch(200, { isValid: true });
    expect(await testApiKey('   ')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await testApiKey('AIzaSyKEY')).toBe(true);
  });
});
