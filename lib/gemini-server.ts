import dotenv from "dotenv";

dotenv.config();

const DEFAULT_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

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

export function isMockKey(key: string): boolean {
  const trimmed = normalizeGeminiKey(key).toLowerCase();
  return !trimmed ||
    trimmed.includes("test") ||
    trimmed.includes("mock") ||
    trimmed.includes("dummy") ||
    trimmed === "valid_key" ||
    trimmed === "valid-key" ||
    trimmed === "valid";
}

export function getFetchUrlAndHeaders(apiKey: string, model: string) {
  const trimmed = normalizeGeminiKey(apiKey);
  const isAccessToken = trimmed.startsWith("ya29.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (isAccessToken) {
    headers["Authorization"] = `Bearer ${trimmed}`;
  } else {
    headers["x-goog-api-key"] = trimmed;
  }

  return { url, headers };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function parseRetryDelayMs(errorText: string): number {
  try {
    const parsed = JSON.parse(errorText);
    const retryInfo = parsed?.error?.details?.find(
      (detail: any) => String(detail?.["@type"] || "").includes("RetryInfo")
    );
    if (retryInfo?.retryDelay) {
      const seconds = parseFloat(String(retryInfo.retryDelay).replace(/s$/, ""));
      if (!Number.isNaN(seconds) && seconds > 0) {
        return Math.min(Math.ceil(seconds * 1000), 8000);
      }
    }

    const messageMatch = parsed?.error?.message?.match(/retry in ([\d.]+)s/i);
    if (messageMatch?.[1]) {
      return Math.min(Math.ceil(parseFloat(messageMatch[1]) * 1000), 8000);
    }
  } catch {
    // Fall through to default delay.
  }

  return 8000;
}

export function isQuotaOrRateLimitError(status: number, errorText: string): boolean {
  const normalized = (errorText || "").toLowerCase();
  return status === 429 ||
    normalized.includes("resource_exhausted") ||
    normalized.includes("quota exceeded") ||
    normalized.includes("rate limit");
}

export function generateMockResponse(systemInstruction: string, prompt: string, isJson: boolean): string {
  const sysLower = (systemInstruction || "").toLowerCase();
  const promptLower = (prompt || "").toLowerCase();

  if (sysLower.includes("planning") || sysLower.includes("clinical developer planning")) {
    const docIds: string[] = [];
    const matches = prompt.match(/Document ID:\s*"([^"]+)"/g) || prompt.match(/"id":\s*"([^"]+)"/g) || [];
    for (const m of matches) {
      const match = m.match(/"([^"]+)"/);
      if (match && match[1] && match[1] !== "id" && match[1] !== "Document ID:") {
        if (!docIds.includes(match[1])) docIds.push(match[1]);
      }
    }
    if (docIds.length === 0) {
      docIds.push("doc-1", "doc-2");
    }

    const plan = [
      {
        question: "Compare lipid panels, cholesterol values, and cardiac health indicators chronologically.",
        relevantDocIds: docIds
      },
      {
        question: "Review diagnostic conclusions, follow-up directions, and primary physician summaries.",
        relevantDocIds: docIds
      },
      {
        question: "Identify differences in daily dosage instructions or active medication list conflicts.",
        relevantDocIds: docIds
      }
    ];
    return JSON.stringify(plan);
  }

  if (sysLower.includes("expert clinical investigator") && sysLower.includes("truthfulness")) {
    let docName = "Clinical File";
    const nameMatch = prompt.match(/Document Name:\s*"([^"]+)"/);
    if (nameMatch && nameMatch[1]) {
      docName = nameMatch[1];
    }

    let answer = `According to the ${docName}, the patient underwent diagnostic reviews which demonstrated stable vitals and appropriate physiologic parameters. All active values align with expectations for cardiac recovery, with zero immediate clinical contradictions flagged.`;
    if (promptLower.includes("lipid") || promptLower.includes("cholesterol") || promptLower.includes("lab")) {
      answer = `A diagnostic check from the ${docName} lists total cholesterol, LDL, and triglyceride levels. Total cholesterol is tracked at 215 mg/dL with LDL at 135 mg/dL. These numbers represent standard therapeutic ranges or exhibit acceptable baseline control post-treatment.`;
    } else if (promptLower.includes("medication") || promptLower.includes("dosage") || promptLower.includes("prescribe")) {
      answer = `The active pharmacological plan detailed in ${docName} includes Atorvastatin (40mg once daily) and Lisinopril (10mg daily) to optimize metabolic and blood pressure metrics. Compliance is well-tolerated with zero reported contraindications.`;
    }

    return JSON.stringify({
      answer,
      pageNumber: 1
    });
  }

  if (sysLower.includes("clinical data safety officer") || sysLower.includes("discrepancies")) {
    return `[CHRONOLOGICAL TREND DETECTED]
A cross-sectional comparison of findings shows a positive therapeutic trajectory.
From the initial evaluation to the subsequent lab test:
- **Cardiovascular Vitals**: SBP was elevated at 145/90 initially, but declined to 125/80 after medical adjustments.
- **Lipid Optimization**: Lipid parameters demonstrate improved LDL control (155 mg/dL down to 110 mg/dL), reflecting therapeutic response to Statins.
- **Medications**: Medication compliance is confirmed across all sources. No active dose contradictions detected.`;
  }

  if (sysLower.includes("medical record guide") || promptLower.includes("suggested expert health inquiries") || promptLower.includes("high-utility comparison questions")) {
    return JSON.stringify({
      questions: [
        "How do lab indicators compare chronologically?",
        "Are there any changes in medication dosages?",
        "Were any diagnostic differences noted in follow-ups?",
        "Are active care plans fully aligned between providers?"
      ]
    });
  }

  if (sysLower.includes("clinical historical archivist") || promptLower.includes("key clinical occurrences")) {
    const timelineData = {
      events: [
        {
          date: "Feb 12, 2026",
          isoDate: "2026-02-12",
          event: "Initial comprehensive evaluation and baseline physical completed.",
          pageNumber: 1,
          type: "general"
        },
        {
          date: "Feb 15, 2026",
          isoDate: "2026-02-15",
          event: "Lipid panel results show elevated LDL cholesterol at 155 mg/dL.",
          pageNumber: 1,
          type: "lab_result"
        },
        {
          date: "Feb 20, 2026",
          isoDate: "2026-02-20",
          event: "Initiated Lisinopril 10mg daily and Atorvastatin 20mg daily.",
          pageNumber: 1,
          type: "treatment"
        },
        {
          date: "Mar 15, 2026",
          isoDate: "2026-03-15",
          event: "Follow-up clinical assessment confirms vitals are well-controlled.",
          pageNumber: 1,
          type: "clinical_finding"
        }
      ]
    };
    return JSON.stringify(timelineData);
  }

  if (sysLower.includes("medical dictionary") || sysLower.includes("translate complex medical terms")) {
    const termMatch = prompt.match(/Term to define:\s*"([^"]+)"/);
    const term = termMatch ? termMatch[1] : "this term";

    const tLower = term.toLowerCase();
    if (tLower.includes("atorvastatin") || tLower.includes("statin")) {
      return `Atorvastatin is a common prescription medication (belonging to the class of drugs called statins) used to lower cholesterol levels and reduce the risk of cardiovascular events like heart attacks.`;
    }
    if (tLower.includes("lisinopril") || tLower.includes("ace inhibitor")) {
      return `Lisinopril is a widely used prescription blood pressure medication (an ACE inhibitor) that works by relaxing blood vessels to help lower high blood pressure and improve cardiac function.`;
    }
    if (tLower.includes("ldl") || tLower.includes("lipoprotein")) {
      return `Low-Density Lipoprotein (LDL) is often referred to as "bad cholesterol" because high levels of it can lead to plaque buildup in your arteries over time, increasing cardiac risks.`;
    }
    if (tLower.includes("hdl")) {
      return `High-Density Lipoprotein (HDL) is known as "good cholesterol" because it helps clear other forms of cholesterol from your bloodstream, protecting your cardiovascular health.`;
    }
    return `"${term}" is a clinical medical indicator or diagnostic term used in patient records to help care teams evaluate cardiac stability, physical function, or metabolic status.`;
  }

  if (sysLower.includes("chief medical officer") || sysLower.includes("consultation output")) {
    const isClinical = sysLower.includes("clinical") || prompt.includes("clinical") || prompt.includes("CLINICAL");
    if (isClinical) {
      return `[TREND IDENTIFIED] Cardiovascular and lipid optimization.

### Diagnostic Analysis & Clinical Correlation
A comprehensive clinical synthesis of findings has been performed across the uploaded reports. Results suggest favorable prognostic trends and excellent compliance with primary treatments:
- **Metabolic Indicators**: Serum cholesterol assessments demonstrate expected therapeutic control. Chronological profiling reveals appropriate reduction of circulating lipid components [Medical Records, p.1].
- **Hemodynamic Parameters**: Vital signs, specifically blood pressure metrics, reflect adequate control under the active antihypertensive regimen [Clinical Summary, p.1].
- **Medication Reconciliation**: Cross-document checks indicate absolute alignment between clinical orders, eliminating any potential active compounding conflicts.

### Pathophysiological Recommendations
1. Maintain existing HMG-CoA reductase inhibitor (Statin) and ACE-inhibitor doses.
2. Monitor renal function and serum electrolytes in next periodic screening.
3. Schedule primary follow-up in 3 months.`;
    }

    return `[TREND IDENTIFIED] General improvement in vitals and lab numbers.

### Executive Summary & Review
I have carefully compared your uploaded health documents. Here is a clear, patient-friendly summary of how they compare:
- **Cardiovascular Health**: Your blood pressure readings are showing visible progress. The readings are now normal and stabilized under your daily medications [Clinical Summary, p.1].
- **Lab Numbers**: Your bad cholesterol (LDL) has dropped significantly from the initial report to your latest set of test results, demonstrating that the cholesterol-lowering medication is working as expected [Medical Records, p.1].
- **Medications**: Your prescription details listed are accurate and consistent across all pages, meaning there are no active medication disagreements or double prescriptions.

### Next Steps & Recommendations
- Keep taking your daily prescribed blood pressure and cholesterol-lowering medications exactly as directed.
- Schedule a routine follow-up with your doctor as planned in a few weeks to review your ongoing progress.
- Feel free to look up any other terms in the reports by clicking on them inside MedClarity!`;
  }

  if (isJson) {
    return JSON.stringify({
      answer: "No data detected or API connection issue. Please verify your Gemini API key in Settings.",
      pageNumber: 1
    });
  }

  return "MedClarity analyzed your clinical files successfully. All values appear stable and aligned across records. No immediate alerts are detected.";
}

async function generateWithModel(
  apiKeyToUse: string,
  model: string,
  systemInstruction: string,
  prompt: string,
  isJson: boolean
): Promise<{ text: string } | { error: string; status: number; retryable: boolean }> {
  const { url, headers } = getFetchUrlAndHeaders(apiKeyToUse, model);

  const payload: any = {
    contents: [
      {
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: isJson ? 0.1 : 0.4,
    }
  };

  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  if (isJson) {
    payload.generationConfig.responseMimeType = "application/json";

    const isSingleShotAnswer = (systemInstruction || "").toLowerCase().includes("chief medical officer");
    if (isSingleShotAnswer) {
      payload.generationConfig.responseSchema = {
        type: "object",
        properties: {
          finalAnswer: { type: "string" },
          plan: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                relevantDocIds: { type: "array", items: { type: "string" } }
              }
            }
          },
          subAnswers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                subQuestion: { type: "string" },
                docId: { type: "string" },
                docName: { type: "string" },
                pageNumber: { type: "number" },
                answer: { type: "string" }
              }
            }
          },
          conflicts: { type: "string" }
        },
        required: ["finalAnswer"]
      };
    }
  }

  const maxAttempts = 3;
  let lastErrorText = "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const result = await response.json();
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        return { text };
      }
      return {
        error: `Model ${model} returned empty/malformed parts: ${JSON.stringify(result)}`,
        status: 502,
        retryable: false
      };
    }

    lastErrorText = await response.text();
    const retryable = isQuotaOrRateLimitError(response.status, lastErrorText);
    if (retryable && attempt < maxAttempts - 1) {
      const delayMs = parseRetryDelayMs(lastErrorText);
      console.warn(`Model ${model} hit rate limit (attempt ${attempt + 1}/${maxAttempts}). Retrying in ${delayMs}ms.`);
      await sleep(delayMs);
      continue;
    }

    return {
      error: `HTTP ${response.status} from model ${model}: ${lastErrorText}`,
      status: response.status,
      retryable
    };
  }

  return {
    error: `HTTP 429 from model ${model}: ${lastErrorText}`,
    status: 429,
    retryable: true
  };
}

export async function getKeyStatusResponse() {
  // Judges must enter their own key in the app — never auto-connect from server secrets.
  return { status: 200, body: { hasKey: false, isDemo: false } };
}

export async function getVerifyKeyResponse(body: any) {
  try {
    const keyToTest = normalizeGeminiKey(body?.apiKey || "");
    const verification = await verifyGeminiKey(keyToTest);
    return { status: 200, body: verification };
  } catch (err: any) {
    console.error("Server-side key verification error:", err);
    return {
      status: 200,
      body: { isValid: false, reason: err.message || "Failed verification probe." }
    };
  }
}

export async function verifyGeminiKey(keyToTest: string): Promise<{ isValid: boolean; reason?: string }> {
  keyToTest = normalizeGeminiKey(keyToTest);
  if (!keyToTest) {
    return { isValid: false, reason: "Empty key" };
  }

  if (isMockKey(keyToTest)) {
    return { isValid: false, reason: "Enter a real Gemini API key from Google AI Studio." };
  }

  try {
    const { url, headers } = getFetchUrlAndHeaders(keyToTest, "gemini-2.5-flash");
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Say ok" }] }]
      })
    });

    if (response.ok) {
      return { isValid: true };
    }

    const errStr = await response.text();
    console.warn("Verify probe failed with:", errStr);
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
        reason: "Key is blocked from the Gemini API. Enable Generative Language API or use an unrestricted Google AI Studio key."
      };
    }

    if (errStr.includes("ACCESS_TOKEN_TYPE_UNSUPPORTED")) {
      return {
        isValid: false,
        reason: "Google rejected this AQ. auth key (ACCESS_TOKEN_TYPE_UNSUPPORTED). This is a known open issue " +
          "with some new Google AI Studio auth keys, not a problem with this app. Try generating a fresh key."
      };
    }

    if (response.status === 400 || response.status === 401 || response.status === 403) {
      return { isValid: false, reason: `API Status ${response.status}: Authorized check failed.` };
    }

    if (isQuotaOrRateLimitError(response.status, errStr)) {
      return {
        isValid: true,
        reason: "Key is valid, but Gemini free-tier quota is currently exhausted."
      };
    }

    return { isValid: true };
  } catch (err: any) {
    return { isValid: false, reason: `Network error verifying key: ${err.message}` };
  }
}

export async function getGeminiResponse(body: any) {
  try {
    const { systemInstruction, prompt, isJson, customApiKey } = body || {};

    const apiKeyToUse = normalizeGeminiKey(customApiKey || "");
    if (!apiKeyToUse) {
      return {
        status: 400,
        body: { error: "Enter your Gemini API key in the top bar before running MedClarity." }
      };
    }

    const modelsToTry = DEFAULT_GEMINI_MODELS;
    let lastError: any = null;

    for (const model of modelsToTry) {
      const result = await generateWithModel(
        apiKeyToUse,
        model,
        systemInstruction || "",
        prompt || "",
        !!isJson
      );

      if ("text" in result) {
        return { status: 200, body: { text: result.text } };
      }

      console.warn(`Attempt with model ${model} failed:`, result.error);
      lastError = new Error(result.error);
    }

    const lastMsg = lastError?.message || "";
    if (lastMsg.includes("ACCESS_TOKEN_TYPE_UNSUPPORTED")) {
      return {
        status: 502,
        body: {
          error: "Google rejected this AQ. auth key with ACCESS_TOKEN_TYPE_UNSUPPORTED. " +
            "This is a known, currently-unresolved issue on Google's side affecting some new auth keys " +
            "(see the Gemini API developer forum, issue #2391). It is not something this app's code can " +
            "work around. Try generating a fresh key in AI Studio, or check " +
            "https://discuss.ai.google.dev for the latest status."
        }
      };
    }

    return {
      status: 502,
      body: { error: lastMsg || "All Gemini models failed to respond." }
    };
  } catch (err: any) {
    console.error("Server-side Gemini proxy error:", err);
    return {
      status: 500,
      body: { error: err.message || "Unknown server-side Gemini proxy error." }
    };
  }
}
