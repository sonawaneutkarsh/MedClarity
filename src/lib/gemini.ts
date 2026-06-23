import { MedicalDocument, SubAnswer, TimelineEntry } from '../types';

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

export function isAuthGeminiKey(key: string): boolean {
  return normalizeGeminiKey(key).startsWith("AQ.");
}

export function formatGeminiErrorMessage(rawMessage: string): string {
  const message = rawMessage || "Unknown Gemini API error.";
  if (message.includes("429") || message.toLowerCase().includes("quota")) {
    return "Gemini free-tier quota is exhausted. Your AQ. auth key is valid — wait about a minute and retry, check usage at https://ai.dev/rate-limit, restrict the key to Gemini-only in AI Studio, or enable billing on the linked Google Cloud project.";
  }
  return message;
}

/**
 * Server-side Gemini proxy caller. Requires the judge's own API key.
 */
export async function callGemini(
  apiKey: string,
  systemInstruction: string,
  prompt: string,
  isJson: boolean = false
): Promise<string> {
  const response = await fetch("/api/gemini", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction,
      prompt,
      isJson,
      customApiKey: normalizeGeminiKey(apiKey)
    })
  });

  if (!response.ok) {
    let errMsg = "";
    try {
      const errJson = await response.json();
      errMsg = errJson.error || JSON.stringify(errJson);
    } catch {
      errMsg = await response.text();
    }
    throw new Error(formatGeminiErrorMessage(errMsg || `HTTP Error ${response.status}`));
  }

  const result = await response.json();
  if (!result.text) {
    throw new Error("Received an empty or malformed reply from the backend.");
  }

  return result.text;
}

/**
 * Fast ping key verification
 */
export async function testApiKey(apiKey: string): Promise<boolean> {
  const trimmed = normalizeGeminiKey(apiKey);
  if (!trimmed) return false;

  try {
    const response = await fetch("/api/gemini/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ apiKey: trimmed })
    });
    if (!response.ok) return false;
    const result = await response.json();
    return !!result.isValid;
  } catch (err) {
    console.error("API Key check error", err);
    return false;
  }
}

/**
 * Step 1: PLAN
 * Returns a list of targeted clinical sub-questions and the relevant document IDs.
 */
export async function planResearch(
  apiKey: string,
  question: string,
  documents: MedicalDocument[]
): Promise<{ question: string; relevantDocIds: string[] }[]> {
  const systemInstruction = `You are the lead clinical developer planning a Multi-document Health Research inquiry. 
Your goal is to parse a complex user health query and split it into 2 to 4 highly-focused clinical sub-questions. 
Map each sub-question matching which of the uploaded documents would contain the answer.`;

  const docsSummary = documents
    .map(d => `Document ID: "${d.id}", Name: "${d.name}", Date: "${d.uploadDate}", Page Count: ${d.pageCount}`)
    .join("\n");

  const prompt = `
Original Query: "${question}"

Available Documents:
${docsSummary}

Determine:
1. Divide the original query into 2 to 4 distinct simpler sub-questions.
2. For each sub-question, map the IDs of the documents that contain relevant information. Be precise and conservative.

Return your plan in a strict JSON array where each object has these exact keys: "question" (string) and "relevantDocIds" (array of strings corresponding to document ids).
Example:
[
  { "question": "What was the patient's glucose level?", "relevantDocIds": ["doc-1"] }
]
`;

  const text = await callGemini(apiKey, systemInstruction, prompt, true);
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed.subQuestions && Array.isArray(parsed.subQuestions)) {
      return parsed.subQuestions;
    }
    throw new Error("Plan returned unexpected structure");
  } catch (e) {
    console.error("Failed to parse Gemini plan, using fallback plan", e);
    // Fallback: assign question to all files
    return [
      {
        question: `Answer across files: "${question.substring(0, 60)}..."`,
        relevantDocIds: documents.map(d => d.id)
      }
    ];
  }
}

/**
 * Step 2: RETRIEVE & ANSWER PER DOCUMENT/PAGE
 * Send document text and the specific sub-question to Gemini.
 */
export async function retrieveAndAnswer(
  apiKey: string,
  subQuestion: string,
  doc: MedicalDocument
): Promise<SubAnswer[]> {
  // We can group document contents by pages and prompt the model to review.
  // Since we want page-level citations, we formulate the pages nicely with page tags.
  const pagesText = doc.pages
    .map(p => `[BEGIN_PAGE_${p.pageNumber}]\n${p.text}\n[END_PAGE_${p.pageNumber}]`)
    .join("\n\n");

  const systemInstruction = `You are an expert clinical investigator extracting structured facts from patient files. 
You answer with ultimate truthfulness, relying ONLY on the text provided. 
If the text does not supply the answers, explicitly report "NOT_FOUND". Ensure citations are grounded.`;

  const prompt = `
Sub-Question to Solve: "${subQuestion}"
Document Name: "${doc.name}"
Document Date: "${doc.uploadDate}"

TEXT CONTENT FOR THIS DOCUMENT:
${pagesText}

Based ONLY on the text content above, formulate a short, fact-based response answering the sub-question.
Additionally, detect the EXACT page number where the evidence resides.
If the document does not contain the answer or is completely irrelevant, return "NOT_FOUND: This document does not address this sub-question." inside the "answer" field.

Return your response in strict JSON format with these exact keys:
{
  "answer": "Grounded medical answer summary, or NOT_FOUND statement",
  "pageNumber": 1
}
(If there are multiple pages, return the primary page number).
`;

  const text = await callGemini(apiKey, systemInstruction, prompt, true);
  try {
    const parsed = JSON.parse(text);
    const ans = parsed.answer || "";
    if (ans.toUpperCase().includes("NOT_FOUND")) {
      return [];
    }
    return [
      {
        subQuestion,
        docId: doc.id,
        docName: doc.name,
        pageNumber: typeof parsed.pageNumber === 'number' ? parsed.pageNumber : 1,
        answer: ans
      }
    ];
  } catch (e) {
    console.error(`Failed to parse page analysis for document ${doc.name}`, e);
    // Return simple fallback citation
    return [
      {
        subQuestion,
        docId: doc.id,
        docName: doc.name,
        pageNumber: 1,
        answer: text.substring(0, 300)
      }
    ];
  }
}

/**
 * Step 3: DETECT CONFLICTS
 * Checks if multiple document findings are in agreement, contradict, or show trend over time.
 */
export async function detectConflicts(
  apiKey: string,
  subAnswers: SubAnswer[],
  documents: MedicalDocument[]
): Promise<string> {
  if (subAnswers.length < 2) {
    return "No comparisons necessary. Single source fact analyzed.";
  }

  const systemInstruction = `You are a clinical data safety officer and timeline auditor. 
Compare multiple independent extractions for the same subjects.
Detect discrepancies, contradictions, and changes over time based on report dates.`;

  const answersReport = subAnswers
    .map(
      (sa, i) =>
        `No. ${i + 1}:
Sub-Question investigated: "${sa.subQuestion}"
Document Source: "${sa.docName}" (Page ${sa.pageNumber})
Finding: "${sa.answer}"`
    )
    .join("\n\n");

  const docsTimeline = documents
    .map(d => `- "${d.name}" (Report Date: ${d.uploadDate})`)
    .join("\n");

  const prompt = `
Analyze the medical findings below drawn from different documents.
Document Reports Timeline:
${docsTimeline}

Extracted Findings:
${answersReport}

Examine:
1. AGREEMENT vs. CONTRADICTION: Are there different diagnosis, vital values, or medication dosages?
2. TIMELINE SHIFT: Does the report dates explain the change? (e.g., Blood pressure was high on Day 1, but normal on Day 10 after starting medicine).
3. UNITS / METRICS: Are there conflicts in units (e.g. mg vs mcg)?

Answer with a short clinical report:
Start with high-contrast alert tags if contradictions exist, e.g. [CONTRADICTION DETECTED] or [CHRONOLOGICAL TREND DETECTED].
Keep your comparison concise and clinically grounded.
`;

  return await callGemini(apiKey, systemInstruction, prompt, false);
}

/**
 * Step 4: SYNTHESIZE ANSWER
 * Combine all sub-answers, plan, and conflicts into a final integrated report.
 */
export async function synthesizeAnswer(
  apiKey: string,
  originalQuestion: string,
  plan: { question: string; relevantDocIds: string[] }[],
  subAnswers: SubAnswer[],
  conflicts: string,
  readingLevel: 'simple' | 'clinical'
): Promise<string> {
  const isClinical = readingLevel === 'clinical';

  const systemInstruction = `You are the lead Chief Medical Officer of MedClarity producing a synchronized consultation output.
Synthesize the structured findings derived from various clinical pages into a unified cohesive report answering: "${originalQuestion}"

CITATION COMPLIANCE RULES:
- You MUST back up statements with inline clickable citations using exactly the format: "[DocName, p.X]".
- "DocName" must match the original document name EXACTLY, and X must be the page number. 
- Example: "The patient showed normal kidney clearance [Lab Report 1, p.2]."
- Never invent citations. Only use the authentic docNames and pageNumbers provided.
- Do not use markdown hyperlinks like [DocName](p1); use literal square brackets \`[Document Name, p.X]\`.

READING LEVEL FORMATS:
- For 'simple' style: Speak directly, with warmth, explaining complex words, using layperson terms, very understandable.
- For 'clinical' style: Use advanced, precise clinical terminology, professional medical structure, detailed pathophysiological breakdowns.`;

  const findingsTrail = subAnswers
    .map(
      sa =>
        `- For "${sa.subQuestion}" in Document "${sa.docName}" Page ${sa.pageNumber}:
  Finding: "${sa.answer}"`
    )
    .join("\n");

  const prompt = `
User Query: "${originalQuestion}"

We gathered these grounded facts from independent pages:
${findingsTrail}

Timeline, Agreement & Conflict Audit Report:
${conflicts}

Format the Synthesis Report under the ${readingLevel.toUpperCase()} level.
1. If there's a trend over time or a conflict between documents, state it explicitly and clearly in a high-visibility callout box or blockquote near the very top (e.g., "[TREND IDENTIFIED]" or "[ALERT: CONTRADICTION DETECTED]").
2. Write a highly structured review, ending with a clear, concise final recommendation.
3. Every single fact MUST carry its inline citation bracket \`[Document Name, p.PageNumber]\` exactly matching the source.
`;

  return await callGemini(apiKey, systemInstruction, prompt, false);
}

/**
 * UTILITY: Extract timeline data from parsed PDF page contents
 */
export async function extractTimelineEntries(
  apiKey: string,
  docId: string,
  docName: string,
  docDate: string,
  pages: { pageNumber: number; text: string }[]
): Promise<TimelineEntry[]> {
  const fullTextSample = pages.map(p => `(Page ${p.pageNumber}): ${p.text}`).join("\n").substring(0, 16000);

  const systemInstruction = `You are a clinical historical archivist. Extract dates, findings, medications, or events with high timing-accuracy.`;

  const prompt = `
Extract up to 6 key clinical occurrences from this document.
Document Name: "${docName}"
Primary Document Date: "${docDate}"

DOCUMENT CONTENT:
${fullTextSample}

Extract and structure each event in a JSON array. Each object in the array MUST contain:
1. "date": The specific date as written or implied (e.g., "June 15, 2026").
2. "isoDate": Standardized "YYYY-MM-DD" style date. If only the year or month is known, approximate (e.g., "June 2026" -> "2026-06-15"). This is used for sorting.
3. "event": Clear, concise clinical sentence of what happened (e.g., "Prescribed Amoxicillin 500mg").
4. "pageNumber": Page number.
5. "type": Must be one of these categories: 'clinical_finding', 'treatment', 'lab_result', 'general'.

Return your answer strictly in JSON layout:
{
  "events": [
    {
      "date": "Date text",
      "isoDate": "YYYY-MM-DD",
      "event": "Finding details",
      "pageNumber": 1,
      "type": "clinical_finding"
    }
  ]
}
`;

  try {
    const text = await callGemini(apiKey, systemInstruction, prompt, true);
    const parsed = JSON.parse(text);
    const rawEvents = parsed.events || [];
    return rawEvents.map((ev: any) => {
      // Parse isoDate for epoch sorting
      let epoch = Date.now();
      if (ev.isoDate) {
        const parsedD = Date.parse(ev.isoDate);
        if (!isNaN(parsedD)) {
          epoch = parsedD;
        }
      }
      return {
        date: ev.date || docDate,
        event: ev.event || "",
        sourceDocId: docId,
        sourceDocName: docName,
        pageNumber: typeof ev.pageNumber === 'number' ? ev.pageNumber : 1,
        type: ev.type || 'general',
        epochTime: epoch
      };
    });
  } catch (e) {
    console.error("Failed to parse timeline for PDF", e);
    return [];
  }
}

/**
 * UTILITY: Generate 3-4 suggested expert health inquiries based on files
 */
export async function generateSuggestedInquiries(
  apiKey: string,
  documents: MedicalDocument[]
): Promise<string[]> {
  const systemInstruction = `You are a medical record guide. Generate 3 or 4 extremely short, punchy questions. Each question MUST be under 10 words, phrased as a simple, natural layperson query (e.g., "Has blood pressure improved?" or "Are medications different?"). Do NOT exceed 10 words per question.`;

  const docSummaries = documents
    .map(d => `- "${d.name}" (${d.uploadDate}, ${d.pageCount} pages)`)
    .join("\n");

  const prompt = `
We have academic or clinical medical records uploaded:
${docSummaries}

Generate 3 or 4 simple, high-utility comparison questions about these records.
Each question MUST be under 10 words. Do not use jargon. Style them like simple patient lookups.

Return strictly in this JSON format:
{
  "questions": [
    "Short question 1?",
    "Short question 2?",
    "Short question 3?"
  ]
}
`;

  try {
    const text = await callGemini(apiKey, systemInstruction, prompt, true);
    const parsed = JSON.parse(text);
    if (parsed.questions && Array.isArray(parsed.questions)) {
      return parsed.questions.map((q: string) => {
        const words = q.split(/\s+/);
        if (words.length > 10) {
          return words.slice(0, 9).join(' ') + '?';
        }
        return q;
      });
    }
    return [
      "Are there any report discrepancies?",
      "How did vitals change over time?",
      "Are there medication disagreements?"
    ];
  } catch (e) {
    return [
      "What are the major diagnoses?",
      "Compare lab outcomes chronologically.",
      "Are there conflicting prescriptions?"
    ];
  }
}

/**
 * UTILITY: Quick medical lookup definition
 */
export async function lookupMedicalDefinition(
  apiKey: string,
  term: string,
  paragraphContext: string
): Promise<string> {
  const systemInstruction = `You are a patient-friendly medical dictionary. Translate complex medical terms into a single, plain-language sentence.`;

  const prompt = `
Term to define: "${term}"
Context of use: "...${paragraphContext.substring(0, 300)}..."

Explain what "${term}" means in a warm, simple, accurate, and supportive way that a normal layperson can understand instantly. Keep it strictly to one sentence.
Do not use terms like "as mentioned in the context". Just define the word itself.
`;

  try {
    return await callGemini(apiKey, systemInstruction, prompt, false);
  } catch (err) {
    return "Definition lookup unavailable. Please consult your physician.";
  }
}
