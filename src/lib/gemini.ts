import type { MedicalDocument, SourceFinding, TimelineEntry } from '../types';
import { parseAnswerJson, type ParsedAnswer } from './answer';

export type ReadingLevel = 'simple' | 'clinical';

export function formatGeminiErrorMessage(rawMessage: string): string {
  const message = rawMessage || 'Unknown Gemini API error.';
  if (message.includes('429') || message.toLowerCase().includes('quota') || message.toLowerCase().includes('resource_exhausted')) {
    return 'The Gemini quota for this key is exhausted. The key itself is fine: wait about a minute and retry, check usage at https://ai.dev/rate-limit, or enable billing on the linked Google Cloud project.';
  }
  return message;
}

interface CallOptions {
  isJson?: boolean;
  responseSchema?: 'answer';
}

/** Sends one request through the server proxy (/api/gemini) with the user's own key. */
export async function callGeminiWithModel(
  apiKey: string,
  systemInstruction: string,
  prompt: string,
  options: CallOptions = {}
): Promise<{ text: string; model: string }> {
  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction,
      prompt,
      isJson: !!options.isJson,
      responseSchema: options.responseSchema,
      customApiKey: apiKey.trim(),
    }),
  });

  if (!response.ok) {
    let errMsg = '';
    try {
      const errJson = await response.json();
      errMsg = errJson.error || JSON.stringify(errJson);
    } catch {
      errMsg = `HTTP ${response.status}`;
    }
    throw new Error(formatGeminiErrorMessage(errMsg));
  }

  const result = await response.json();
  if (!result.text) {
    throw new Error('The server returned an empty reply.');
  }
  return { text: result.text, model: result.model || 'unknown model' };
}

export async function callGemini(
  apiKey: string,
  systemInstruction: string,
  prompt: string,
  isJson: boolean = false
): Promise<string> {
  return (await callGeminiWithModel(apiKey, systemInstruction, prompt, { isJson })).text;
}

/** Asks the server to check the key with Google. */
export async function testApiKey(apiKey: string): Promise<boolean> {
  const trimmed = apiKey.trim();
  if (!trimmed) return false;
  try {
    const response = await fetch('/api/gemini/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: trimmed }),
    });
    if (!response.ok) return false;
    const result = await response.json();
    return !!result.isValid;
  } catch (err) {
    console.error('API key check failed', err);
    return false;
  }
}

const CITATION_RULES = `CITATIONS:
- Support every factual statement with an inline citation in exactly this form: [Document Name, p.N]
- "Document Name" must be copied exactly from the DOCUMENT header, and N must be a page number that exists in that document.
- Never invent documents or pages. If the documents do not answer the question, say so.`;

const READING_LEVEL_RULES = `READING LEVEL:
- simple: plain language for a patient, explain medical terms briefly.
- clinical: precise clinical terminology for a clinician.`;

/** Builds the page-labelled document text sent with a question. */
export function buildDocumentsContext(documents: MedicalDocument[]): string {
  return documents
    .map(d => `DOCUMENT: "${d.name}" | Date: ${d.uploadDate} | Pages: ${d.pageCount}\n` +
      d.pages.map(p => `--- Page ${p.pageNumber} ---\n${p.text}`).join('\n\n'))
    .join('\n\n==========\n\n');
}

/**
 * Answers a question with ONE Gemini request that receives the full extracted text
 * of every loaded document and returns structured JSON (answer, page-level findings,
 * and a short conflict summary).
 */
export async function answerQuestion(
  apiKey: string,
  question: string,
  documents: MedicalDocument[],
  readingLevel: ReadingLevel
): Promise<ParsedAnswer & { model: string }> {
  const systemInstruction = `You help a patient understand their own medical records. Answer using ONLY the provided documents.

${CITATION_RULES}

${READING_LEVEL_RULES}

OUTPUT: strict JSON with these keys:
- "finalAnswer": the answer in Markdown (short headings and bullet lists are fine). If documents disagree, or a value changes over time, start that paragraph with [CONTRADICTION DETECTED] or [TREND IDENTIFIED].
- "findings": array of { "docName", "pageNumber", "finding" }, one entry per page-level fact you used, with "finding" quoting or closely paraphrasing the page.
- "conflicts": one or two sentences on disagreements between documents, or "No discrepancies reported."`;

  const prompt = `Question: "${question}"
Reading level: ${readingLevel}

${buildDocumentsContext(documents)}`;

  const { text, model } = await callGeminiWithModel(apiKey, systemInstruction, prompt, {
    isJson: true,
    responseSchema: 'answer',
  });
  return { ...parseAnswerJson(text), model };
}

/**
 * Rewrites an existing answer at another reading level from the findings the first
 * request already returned (one more request; the documents are not re-sent).
 */
export async function rewriteAnswer(
  apiKey: string,
  question: string,
  findings: SourceFinding[],
  conflicts: string,
  readingLevel: ReadingLevel
): Promise<{ text: string; model: string }> {
  const systemInstruction = `You rewrite an answer about a patient's medical records at a requested reading level, using ONLY the findings provided.

${CITATION_RULES}

${READING_LEVEL_RULES}

Answer in Markdown. If findings disagree or change over time, start that paragraph with [CONTRADICTION DETECTED] or [TREND IDENTIFIED].`;

  const findingsText = findings.length
    ? findings.map(f => `- [${f.docName}, p.${f.pageNumber}] ${f.finding}`).join('\n')
    : '- (no page-level findings were returned)';

  const prompt = `Question: "${question}"
Reading level: ${readingLevel}

Findings:
${findingsText}

Conflict summary: ${conflicts}`;

  return callGeminiWithModel(apiKey, systemInstruction, prompt);
}

/** Extracts up to 6 dated events from one document for the combined timeline. */
export async function extractTimelineEntries(
  apiKey: string,
  docId: string,
  docName: string,
  docDate: string,
  pages: { pageNumber: number; text: string }[]
): Promise<TimelineEntry[]> {
  const fullTextSample = pages.map(p => `(Page ${p.pageNumber}): ${p.text}`).join('\n').substring(0, 16000);

  const systemInstruction = 'Extract dated clinical events (findings, treatments, lab results) from a medical document. Use only dates written in or clearly implied by the text.';

  const prompt = `Extract up to 6 key clinical events from this document.
Document Name: "${docName}"
Document Date: "${docDate}"

DOCUMENT CONTENT:
${fullTextSample}

Return JSON: { "events": [ { "date": "date as written", "isoDate": "YYYY-MM-DD (approximate the day if only month/year is known)", "event": "one short sentence", "pageNumber": 1, "type": "clinical_finding" | "treatment" | "lab_result" | "general" } ] }`;

  try {
    const text = await callGemini(apiKey, systemInstruction, prompt, true);
    const parsed = JSON.parse(text);
    const rawEvents: any[] = Array.isArray(parsed?.events) ? parsed.events : [];
    return rawEvents.map(ev => {
      const parsedEpoch = ev.isoDate ? Date.parse(ev.isoDate) : NaN;
      return {
        date: ev.date || docDate,
        isoDate: typeof ev.isoDate === 'string' ? ev.isoDate : undefined,
        event: ev.event || '',
        sourceDocId: docId,
        sourceDocName: docName,
        pageNumber: typeof ev.pageNumber === 'number' ? ev.pageNumber : 1,
        type: ['clinical_finding', 'treatment', 'lab_result', 'general'].includes(ev.type) ? ev.type : 'general',
        epochTime: Number.isNaN(parsedEpoch) ? Date.parse(docDate) : parsedEpoch,
      } as TimelineEntry;
    });
  } catch (e) {
    console.error('Timeline extraction failed for', docName, e);
    return [];
  }
}

/** Suggests 3-4 short questions about the loaded documents. */
export async function generateSuggestedInquiries(apiKey: string, documents: MedicalDocument[]): Promise<string[]> {
  const systemInstruction = 'Suggest 3 or 4 short, plain-language questions (under 10 words each) a patient could ask about their records.';
  const prompt = `Records:
${documents.map(d => `- "${d.name}" (${d.uploadDate}, ${d.pageCount} pages)`).join('\n')}

Return JSON: { "questions": ["...", "..."] }`;

  const fallback = [
    'Are there any discrepancies between reports?',
    'How did lab values change over time?',
    'Are there medication differences?',
  ];
  try {
    const parsed = JSON.parse(await callGemini(apiKey, systemInstruction, prompt, true));
    if (Array.isArray(parsed?.questions) && parsed.questions.length > 0) {
      return parsed.questions.map((q: string) => {
        const words = String(q).split(/\s+/);
        return words.length > 10 ? words.slice(0, 9).join(' ') + '?' : String(q);
      });
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/** One-sentence plain-language definition of a selected term. */
export async function lookupMedicalDefinition(apiKey: string, term: string, paragraphContext: string): Promise<string> {
  const systemInstruction = 'Explain a medical term in one plain-language sentence.';
  const prompt = `Term: "${term}"
Context: "...${paragraphContext.substring(0, 300)}..."

Define "${term}" in one short sentence a non-specialist understands. Define the word itself; do not refer to the context.`;
  try {
    return await callGemini(apiKey, systemInstruction, prompt, false);
  } catch {
    return 'Definition lookup is unavailable right now.';
  }
}
