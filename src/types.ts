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

export interface AgentStep {
  id: string;
  name: string; // e.g., "Planning Approach", "Querying Patient Chart"
  status: 'pending' | 'running' | 'completed' | 'failed';
  message: string; // dynamic explanation
  details?: string; // finer logs
}

export interface SubAnswer {
  subQuestion: string;
  docId: string;
  docName: string;
  pageNumber: number;
  answer: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  timestamp: string;
  text: string;
  avatar?: string;
  readingLevel?: 'simple' | 'clinical';
  agentSteps?: AgentStep[];
  isGenerating?: boolean;
  error?: string;
  // Raw inputs stored so that toggling simplicity re-runs synthesis without re-running reading
  rawContext?: {
    originalQuestion: string;
    plan: { question: string; relevantDocIds: string[] }[];
    subAnswers: SubAnswer[];
    conflicts: string;
  };
}
