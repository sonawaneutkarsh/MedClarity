export interface DocumentPage {
  pageNumber: number;
  text: string;
}

export interface TimelineEntry {
  date: string; // e.g., "2026-06-15" or "June 2026"
  isoDate?: string; // standardised ISO date string for reference
  event: string;
  sourceDocId: string;
  sourceDocName: string;
  pageNumber: number;
  type: 'clinical_finding' | 'treatment' | 'lab_result' | 'general';
  epochTime?: number; // for sorting chronologically
}

export interface MedicalDocument {
  id: string;
  name: string;
  uploadDate: string;
  pageCount: number;
  pages: DocumentPage[];
  sizeString: string;
  suggestedQuestions?: string[];
  timelineEntries?: TimelineEntry[];
  rawFile?: File; // Used to re-render in the native canvas viewer
}

/** One page-level fact the model reported while answering. */
export interface SourceFinding {
  docName: string;
  pageNumber: number;
  finding: string;
}

/** What actually ran to produce an answer, shown under the answer. */
export interface AnswerProvenance {
  model: string;
  documentCount: number;
  pageCount: number;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  timestamp: string;
  text: string;
  readingLevel?: 'simple' | 'clinical';
  isGenerating?: boolean;
  error?: string;
  /** Non-fatal problem shown under an answer (for example, a failed reading-level rewrite). */
  notice?: string;
  provenance?: AnswerProvenance;
  /** Kept so the reading-level toggle can rewrite the answer without re-reading the documents. */
  rawContext?: {
    originalQuestion: string;
    findings: SourceFinding[];
    conflicts: string;
  };
}
