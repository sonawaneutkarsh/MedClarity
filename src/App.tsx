import { useState, useEffect, useRef, useMemo, DragEvent, ChangeEvent, FormEvent, MouseEvent } from 'react';
import { parsePdfFile, extractClinicalReportDate } from './lib/pdfParser';
import { 
  testApiKey, 
  planResearch, 
  retrieveAndAnswer, 
  detectConflicts, 
  synthesizeAnswer, 
  generateSuggestedInquiries, 
  extractTimelineEntries 
} from './lib/gemini';
import { MedicalDocument, ChatMessage, TimelineEntry, AgentStep, SubAnswer } from './types';
import DocViewer from './components/DocViewer';
import TimelineView from './components/TimelineView';
import SuggestedQuestions from './components/SuggestedQuestions';
import MedicalDictionaryPopup from './components/MedicalDictionaryPopup';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Activity, 
  Plus, 
  Trash2, 
  Trash,
  HelpCircle, 
  Loader2, 
  Send, 
  Sparkles, 
  ShieldCheck, 
  AlertCircle, 
  Calendar, 
  BookOpen, 
  BrainCircuit, 
  Key, 
  Sun, 
  Moon, 
  FileText, 
  History, 
  Clock, 
  RefreshCw,
  Info
} from 'lucide-react';

export default function App() {
  // Theme state
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('medclarity_theme_mode');
    return saved !== null ? saved === 'dark' : true;
  });

  // Key and verification
  const [apiKey, setApiKey] = useState<string>('');
  const [keyState, setKeyState] = useState<'empty' | 'checking' | 'valid' | 'invalid'>('empty');

  // Documents state
  const [documents, setDocuments] = useState<MedicalDocument[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<number>(1);
  const [docUploadLoading, setDocUploadLoading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Chat/QA
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [readingLevel, setReadingLevel] = useState<'simple' | 'clinical'>('clinical');

  // Interactive definitions lookup
  const [lookupTerm, setLookupTerm] = useState<string>('');
  const [lookupContext, setLookupContext] = useState<string>('');
  const [lookupPos, setLookupPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isLookupOpen, setIsLookupOpen] = useState<boolean>(false);

  // Active highlighted word inside page viewer for citation tracing
  const [activeHighlightSnippet, setActiveHighlightSnippet] = useState<string>('');

  // suggested inquiries
  const [suggestedQuestionsList, setSuggestedQuestionsList] = useState<string[]>([]);
  const [isGeneratingSuggestions, setIsGeneratingSuggestions] = useState<boolean>(false);

  // Center panel view state ('viewer' | 'timeline')
  const [centerPanelMode, setCenterPanelMode] = useState<'viewer' | 'timeline'>('viewer');

  // Auto-scroll to bottom of chat when messages or generation state change
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  // Theme synchronization with reliable class toggle and persistence
  useEffect(() => {
    const root = window.document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
      localStorage.setItem('medclarity_theme_mode', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('medclarity_theme_mode', 'light');
    }
  }, [isDarkMode]);

  // Restore a key only if the judge entered one earlier in this browser session.
  useEffect(() => {
    const savedKey = sessionStorage.getItem('medclarity_session_key');
    if (savedKey) {
      setApiKey(savedKey);
      verifyEnteredKey(savedKey);
    }
  }, []);

  const verifyEnteredKey = async (key: string) => {
    if (!key || key.trim() === '') {
      setKeyState('empty');
      return;
    }
    setKeyState('checking');
    const isValid = await testApiKey(key);
    if (isValid) {
      setKeyState('valid');
      sessionStorage.setItem('medclarity_session_key', key);
    } else {
      setKeyState('invalid');
    }
  };

  // Debounced auto-verify as user types
  useEffect(() => {
    if (!apiKey) return;
    const timer = setTimeout(() => {
      const savedKey = sessionStorage.getItem('medclarity_session_key');
      if (apiKey !== savedKey || keyState === 'empty' || keyState === 'invalid') {
        verifyEnteredKey(apiKey);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [apiKey]);

  const handleApiKeyChange = (e: ChangeEvent<HTMLInputElement>) => {
    const key = e.target.value.trim();
    setApiKey(key);
    if (!key) {
      setKeyState('empty');
      sessionStorage.removeItem('medclarity_session_key');
    } else {
      setKeyState('checking');
    }
  };

  const handleVerifyButtonClick = () => {
    verifyEnteredKey(apiKey);
  };

  // Drag and Drop handlers
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setUploadError(null);
    const files = Array.from(e.dataTransfer.files) as File[];
    const pdfFiles = files.filter(f => f.type === 'application/pdf');
    if (pdfFiles.length > 0) {
      await processUploadedFiles(pdfFiles);
    } else {
      setUploadError("Only standard medical PDF records are supported.");
    }
  };

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    if (e.target.files) {
      const files = Array.from(e.target.files) as File[];
      await processUploadedFiles(files);
    }
  };

  const processUploadedFiles = async (files: File[]) => {
    setDocUploadLoading(true);
    setUploadError(null);

    const newlyParsedDocs: MedicalDocument[] = [];

    for (const file of files) {
      try {
        const parsedData = await parsePdfFile(file);
        const docId = `doc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        const fullDoc: MedicalDocument = {
          ...parsedData,
          id: docId,
          uploadDate: parsedData.uploadDate,
          timelineEntries: []
        };

        newlyParsedDocs.push(fullDoc);

        // Extract using Gemini in the background
        if (keyState === 'valid') {
          if (parsedData.pages.length > 0) {
            extractClinicalReportDate(apiKey, parsedData.name, parsedData.pages[0].text, parsedData.uploadDate)
              .then(clinicalDate => {
                setDocuments(prev => prev.map(d => d.id === docId ? { ...d, uploadDate: clinicalDate } : d));
                return extractTimelineEntries(apiKey, docId, parsedData.name, clinicalDate, parsedData.pages);
              })
              .then(timeline => {
                setDocuments(prev => prev.map(d => d.id === docId ? { ...d, timelineEntries: timeline } : d));
              })
              .catch(err => console.error("Background extraction failed:", err));
          } else {
            extractTimelineEntries(apiKey, docId, parsedData.name, parsedData.uploadDate, parsedData.pages)
              .then(timeline => {
                setDocuments(prev => prev.map(d => d.id === docId ? { ...d, timelineEntries: timeline } : d));
              })
              .catch(err => console.error("Background extraction failed:", err));
          }
        }
      } catch (err: any) {
        setUploadError(`Failed to read "${file.name}": ` + (err?.message || "File corrupt or password protected."));
      }
    }

    if (newlyParsedDocs.length > 0) {
      setDocuments(prev => {
        const next = [...prev, ...newlyParsedDocs];
        // Select first document automatically if none selected
        if (!selectedDocId) {
          setSelectedDocId(newlyParsedDocs[0].id);
          setActivePage(1);
        }
        
        // Trigger recommendations in background
        triggerRecommendationsUpdate(next);
        
        return next;
      });
    }

    setDocUploadLoading(false);
  };

  // Re-generate clinical prompts dynamically
  const triggerRecommendationsUpdate = async (currentDocs: MedicalDocument[]) => {
    if (keyState !== 'valid' || currentDocs.length === 0) return;
    setIsGeneratingSuggestions(true);
    try {
      const suggestions = await generateSuggestedInquiries(apiKey, currentDocs);
      setSuggestedQuestionsList(suggestions);
    } catch (e) {
      console.error(e);
    } finally {
      setIsGeneratingSuggestions(false);
    }
  };

  // Trigger background updates whenever API key turns green
  useEffect(() => {
    if (keyState === 'valid' && documents.length > 0) {
      triggerRecommendationsUpdate(documents);
      
      // Retroactively extract timelines if empty
      documents.forEach(async (doc) => {
        if (!doc.timelineEntries || doc.timelineEntries.length === 0) {
          try {
            const timeline = await extractTimelineEntries(apiKey, doc.id, doc.name, doc.uploadDate, doc.pages);
            setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, timelineEntries: timeline } : d));
          } catch (e) {
            console.error("Delayed timeline extraction failure", e);
          }
        }
      });
    }
  }, [keyState]);

  // Manual update doc date from the center panel
  const handleUpdateDocDate = async (docId: string, newDate: string) => {
    // Basic format validator
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(newDate)) {
      alert("Please ensure the date follows standard YYYY-MM-DD format.");
      return;
    }

    setDocuments(prev => prev.map(doc => {
      if (doc.id === docId) {
        // Re-calculate the timeline event epochs under the new sorted date
        const timeline = doc.timelineEntries?.map(entry => {
          const parsedEpoch = Date.parse(newDate);
          return {
            ...entry,
            date: newDate,
            epochTime: isNaN(parsedEpoch) ? Date.now() : parsedEpoch
          };
        }) || [];
        
        return {
          ...doc,
          uploadDate: newDate,
          timelineEntries: timeline
        };
      }
      return doc;
    }));
  };

  // Remove document from rail safely
  const handleRemoveDocument = (docId: string) => {
    setDocuments(prev => {
      const next = prev.filter(d => d.id !== docId);
      if (selectedDocId === docId) {
        if (next.length > 0) {
          setSelectedDocId(next[0].id);
          setActivePage(1);
        } else {
          setSelectedDocId(null);
          setActivePage(1);
        }
      }
      return next;
    });
  };

  // Pre-load a Mock Patient Record set to let clinicians preview immediately
  const handleLoadSampleRecords = () => {
    const sampleDocs: MedicalDocument[] = [
      {
        id: 'sample-doc-1',
        name: 'Apex_Cardiology_Summary_Doe_John.pdf',
        uploadDate: '2026-03-12',
        pageCount: 3,
        sizeString: '420 KB',
        pages: [
          {
            pageNumber: 1,
            text: `PATIENT DEMOGRAPHICS & CLINICAL METRICS
Name: John Doe | DOB: 1978-08-14 | Gender: Male
Encounter Date: March 12, 2026 | Provider: Dr. Sarah Vance, MD

REASON FOR ENCOUNTER:
Follow-up for primary cardiac profile evaluation, chronic hypertension, chest discomfort, and hyperlipidemia management.

VITAL SIGNS:
Height: 180 cm | Weight: 92 kg | BMI: 28.4 (Overweight)
Blood Pressure: 145/92 mmHg (Elevated) | Heart Rate: 72 bpm | SpO2: 98% on room air

ALLERGIC DISPOSITION & SOCIAL HISTORY:
- Drug Allergies: Severe allergy to Penicillin (Anaphylaxis in 2018).
- Smoking: Denies any lifetime tobacco or smoking history (never smoked).

ECG FINDINGS:
Sinus rhythm at 74 bpm. Prominent voltage criteria in lead V5 and V6 indicating early forms of Left Ventricular Hypertrophy (LVH). No ST-segment elevations or active T-wave inversions observed.`
          },
          {
            pageNumber: 2,
            text: `Apex Cardiology Clinic - Doe, John - Page 2

BASELINE lipid PROFILE LABS (Done March 10, 2026):
- Total Cholesterol: 240 mg/dL (Severely elevated)
- Triglycerides: 210 mg/dL (Elevated)
- LDL Cholesterol: 155 mg/dL (High risk target range)
- HDL Cholesterol: 42 mg/dL (Sub-optimal level)

RECOMMENDATIONS & PHARMACOLOGICAL MANAGEMENT:
The elevated arterial blood pressures, abnormal lipid panel, and hypertensive ventricular changes require dual agent therapy:
1. Initiate Atorvastatin 40 mg PO nightly (titrated up from 10 mg) to combat hyperlipidemia.
2. Initiate Amlodipine 5 mg PO daily for blood pressure control.
3. Patient directed to restrict dietary sodium intake (~1500 mg daily limit).`
          },
          {
            pageNumber: 3,
            text: `Apex Cardiology Clinic - Doe, John - Page 3

DIAGNOSTIC CRITERIA & CONCLUSION:
Primary assessments correspond to Essential Arterial Hypertension combined with Hyperlipidemia.
Follow up scheduled in 90 days (June 2026) to audit blood lipid profile panel and test kidney creatinine clearance.`
          }
        ],
        timelineEntries: [
          {
            date: '2026-03-12',
            isoDate: '2026-03-12',
            event: 'Diagnosed with early Left Ventricular Hypertrophy (LVH) via ECG findings',
            sourceDocId: 'sample-doc-1',
            sourceDocName: 'Apex_Cardiology_Summary_Doe_John.pdf',
            pageNumber: 1,
            type: 'clinical_finding',
            epochTime: Date.parse('2026-03-12')
          },
          {
            date: '2026-03-12',
            isoDate: '2026-03-12',
            event: 'Initiated Atorvastatin 40mg nightly and Amlodipine 5mg daily',
            sourceDocId: 'sample-doc-1',
            sourceDocName: 'Apex_Cardiology_Summary_Doe_John.pdf',
            pageNumber: 2,
            type: 'treatment',
            epochTime: Date.parse('2026-03-12')
          }
        ]
      },
      {
        id: 'sample-doc-2',
        name: 'Apex_Cardiology_90_Day_Lipid_Panel_Doe.pdf',
        uploadDate: '2026-06-10',
        pageCount: 2,
        sizeString: '250 KB',
        pages: [
          {
            pageNumber: 1,
            text: `APEX CARDIOLOGY CLINICAL REASSESSMENT
Patient: John Doe | Diagnostic Re-evaluation Date: June 10, 2026
Attendant Phys: Dr. Sarah Vance, MD

FOLLOW-UP REVIEW:
Patient returns for 90-day progress panel. Reports high medication adherence. Denies any drug allergies (states "No Known Drug Allergies - NKDA").
Dr. Vance prescribed amoxicillin/clavulanate (Penicillin family resistance) today for mild bronchitis.
Patient reports smoking half a pack of cigarettes daily for the last 15 years, seeking tobacco cessation counseling.

VITAL PROGRESSION:
Blood Pressure: 128/80 mmHg (Normal control - indicating strong responsiveness to Amlodipine 5 mg daily).
Weight recorded at 89.5 kg (Loss of 2.5 kg).`
          },
          {
            pageNumber: 2,
            text: `Apex Cardiology Clinic - 90-Day Lipid Panel - Page 2

BLOOD LIPID PROFILE COMPARISON:
- Total Cholesterol: 165 mg/dL (Successful decline from March 2026 baseline of 240 mg/dL)
- Triglycerides: 135 mg/dL (Normal control, decline from March 2026 baseline of 210 mg/dL)
- LDL Cholesterol: 88 mg/dL (Outstanding result, successfully meeting the cardiological target of <100 mg/dL, decline from March 2026 baseline of 155 mg/dL on Atorvastatin)
- HDL Cholesterol: 50 mg/dL (Cardio-protective state, improvement from 42 mg/dL)

CLINICAL DECISION TRAIL & DISCREPANCY:
Patient notes he is taking his "Atorvastatin 10 mg daily" (Note: March recommendations were Atorvastatin 40 mg nightly).
Continue Amlodipine 5 mg PO daily. Continue Atorvastatin 40 mg PO nightly. Next baseline metabolic panels scheduled for December 2026.`
          }
        ],
        timelineEntries: [
          {
            date: '2026-06-10',
            isoDate: '2026-06-10',
            event: 'Blood Pressure successfully controlled to 128/80 mmHg using daily Amlodipine',
            sourceDocId: 'sample-doc-2',
            sourceDocName: 'Apex_Cardiology_90_Day_Lipid_Panel_Doe.pdf',
            pageNumber: 1,
            type: 'clinical_finding',
            epochTime: Date.parse('2026-06-10')
          },
          {
            date: '2026-06-10',
            isoDate: '2026-06-10',
            event: 'Serum Blood Test confirms LDL Cholesterol reduced from high levels to 88 mg/dL',
            sourceDocId: 'sample-doc-2',
            sourceDocName: 'Apex_Cardiology_90_Day_Lipid_Panel_Doe.pdf',
            pageNumber: 2,
            type: 'lab_result',
            epochTime: Date.parse('2026-06-10')
          }
        ]
      }
    ];

    setDocuments(sampleDocs);
    setSelectedDocId(sampleDocs[0].id);
    setActivePage(1);
    
    // Auto populate custom suggested research questions as a guide
    setSuggestedQuestionsList([
      "Compare the patient's lipids and cholesterol over the 90-day treatment timeline.",
      "Has John Doe's Blood Pressure successfully responded to his clinical therapies over time?",
      "Detail John Doe's active prescriptions and general treatment directives.",
      "Are there any clinical contradictions or dosage irregularities identified across these assessments?"
    ]);
  };

  // Clear all uploaded documents safely
  const handleClearAllDocs = () => {
    setDocuments([]);
    setSelectedDocId(null);
    setActivePage(1);
    setSuggestedQuestionsList([]);
  };

  // Launch research question
  const handleSuggestedQuestionTrigger = (question: string) => {
    setChatInput(question);
    handleSubmitQuestion(null, question);
  };

  // Help normalize document titles for loose references comparison
  const normalizeDocName = (name: string) => {
    return name
      .toLowerCase()
      .replace(/\.pdf$/gi, '')
      .replace(/[^a-z0-9]/gi, '');
  };

  // Dynamic citation jump handler
  const handleCitationJump = (docName: string, pageNumber: number) => {
    const targetNormalized = normalizeDocName(docName);
    
    // Find doc ID with robust fuzzy normalization
    const foundDoc = documents.find(d => {
      const currentNormalized = normalizeDocName(d.name);
      return currentNormalized.includes(targetNormalized) || targetNormalized.includes(currentNormalized);
    });

    if (foundDoc) {
      setSelectedDocId(foundDoc.id);
      setActivePage(pageNumber);
      setCenterPanelMode('viewer');
      
      // Look up previous chat transcripts to extract the precise statement returned by the model
      let highlightSnippet = '';
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.sender === 'assistant' && msg.rawContext?.subAnswers) {
          const match = msg.rawContext.subAnswers.find(sa => {
            const entryNormalized = normalizeDocName(sa.docName);
            return (entryNormalized.includes(targetNormalized) || targetNormalized.includes(entryNormalized)) 
              && sa.pageNumber === pageNumber;
          });
          if (match && match.answer) {
            highlightSnippet = match.answer;
            break;
          }
        }
      }

      // Fallback to active query key terms if no direct sentence extraction matches
      setActiveHighlightSnippet(highlightSnippet);

      setTimeout(() => {
        const item = document.getElementById(`doc-viewer-${foundDoc.id}`);
        if (item) {
          item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  };

  // Text highlighting gloss lookup triggers
  const handleMouseSelectionUp = (e: MouseEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    if (!selection) return;

    const selectedText = selection.toString().trim();
    
    // Ensure we trigger on valid words, and avoid long paragraphs that degrade search performance
    if (selectedText.length >= 2 && selectedText.length < 50 && keyState === 'valid') {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      
      // Extract containing text block context
      const containerText = range.commonAncestorContainer.textContent || '';
      
      setLookupTerm(selectedText);
      setLookupContext(containerText);
      setLookupPos({
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY
      });
      setIsLookupOpen(true);
    }
  };

  // Submit Q&A
  const handleSubmitQuestion = async (e: FormEvent | null, forceQuestion?: string) => {
    if (e) e.preventDefault();
    const query = (forceQuestion || chatInput).trim();
    if (!query) return;

    // Friendly inline responses for missing API key
    if (keyState !== 'valid') {
      const userMessageIdTemplate = `msg-user-${Date.now()}`;
      const userMessage: ChatMessage = {
        id: userMessageIdTemplate,
        sender: 'user',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: query,
        avatar: 'Patient'
      };

      const assistantWarningTemplateId = `msg-assistant-warning-${Date.now()}`;
      const assistantWarning: ChatMessage = {
        id: assistantWarningTemplateId,
        sender: 'assistant',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: '',
        error: "Connect API key first. Please provide a valid Gemini API Key in the top-right credentials slot and click the status dot to authenticate. Your key is kept secure inside local memory.",
        isGenerating: false,
        readingLevel: readingLevel
      };
      setMessages(prev => [...prev, userMessage, assistantWarning]);
      setChatInput('');
      return;
    }

    // Friendly inline responses for missing documents
    if (documents.length === 0) {
      const userMessageIdTemplate = `msg-user-${Date.now()}`;
      const userMessage: ChatMessage = {
        id: userMessageIdTemplate,
        sender: 'user',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: query,
        avatar: 'Patient'
      };

      const assistantWarningTemplateId = `msg-assistant-warning-${Date.now()}`;
      const assistantWarning: ChatMessage = {
        id: assistantWarningTemplateId,
        sender: 'assistant',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: '',
        error: "Please upload at least one medical PDF report in the sidebar, or select the clinical 'Load Sample Card Case' option before starting agentic audits.",
        isGenerating: false,
        readingLevel: readingLevel
      };
      setMessages(prev => [...prev, userMessage, assistantWarning]);
      setChatInput('');
      return;
    }

    setChatInput('');
    setIsGenerating(true);

    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Append User Message
    const userMessageId = `msg-user-${Date.now()}`;
    const userMessage: ChatMessage = {
      id: userMessageId,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: query,
      avatar: 'Patient'
    };

    // Append Assistant placeholder containing the collapsible agent trails
    const assistantMessageId = `msg-assistant-${Date.now()}`;
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      sender: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: '',
      isGenerating: true,
      readingLevel: readingLevel,
      rawContext: {
        originalQuestion: query,
        plan: [],
        subAnswers: [],
        conflicts: ""
      },
      agentSteps: [
        { id: 'step-1', name: 'Strategic Inquiry Mapping', status: 'pending', message: 'Formulating focused sub-questions' },
        { id: 'step-2', name: 'Selective Source Extraction', status: 'pending', message: 'Querying medical records page-by-page' },
        { id: 'step-3', name: 'Longitudinal Discrepancy Audits', status: 'pending', message: 'Cross-analyzing records for timeline shifts' },
        { id: 'step-4', name: 'Chief Clinical Synthesis', status: 'pending', message: 'Drafting response under clinical levels' }
      ]
    };

    setMessages(prev => [...prev, userMessage, assistantMessage]);
    await delay(300); // Allow browser to render the initial pending UI

    // Setup pure React state updates for step transitions
    const updateLocalStep = (stepId: string, status: 'pending'|'running'|'completed'|'failed', messageText: string, details?: string) => {
      setMessages(prev => prev.map(m => {
        if (m.id === assistantMessageId) {
          const currentSteps = m.agentSteps || [];
          return {
            ...m,
            agentSteps: currentSteps.map(s => s.id === stepId ? { ...s, status, message: messageText, details } : s)
          };
        }
        return m;
      }));
    };

    let activeStepId = 'step-1';
    try {
      // STEP 1: PLAN
      activeStepId = 'step-1';
      updateLocalStep('step-1', 'running', 'Planning research approach using expert system routing...');
      await delay(600); // Visual breathing room for progress simulation
      
      const plan = await planResearch(apiKey, query, documents);
      const subQuestionsSummary = plan.map((q, idx) => `Sub-question ${idx+1}: "${q.question}" targeted to Document(s) [${q.relevantDocIds.join(', ')}]`).join('\n');
      
      updateLocalStep('step-1', 'completed', `Identified ${plan.length} core clinical questions to pursue.`, subQuestionsSummary);
      await delay(600);

      // STEP 2: RETRIEVE & ANSWER PER DOCUMENT
      activeStepId = 'step-2';
      updateLocalStep('step-2', 'running', 'Initiating client-side extraction across target page texts...');
      await delay(600);
      
      const accumulator: SubAnswer[] = [];
      
      for (const sq of plan) {
        for (const targetId of sq.relevantDocIds) {
          const targetDoc = documents.find(d => d.id === targetId);
          if (!targetDoc) continue;
          
          updateLocalStep('step-2', 'running', `Reading page data from: "${targetDoc.name}" for "${sq.question}"...`);
          const docAnswers = await retrieveAndAnswer(apiKey, sq.question, targetDoc);
          accumulator.push(...docAnswers);
          await delay(1500); // Space Gemini calls to avoid free-tier burst limits
        }
      }

      const answersCount = accumulator.length;
      updateLocalStep('step-2', 'completed', `Grounded extraction finished. Collected ${answersCount} page-level evidentiary references.`, 
        accumulator.map(a => `• [${a.docName} p.${a.pageNumber}]: "${a.answer.substring(0, 80)}..."`).join('\n')
      );
      await delay(600);

      // STEP 3: CONFLICTS DETECTION (LONGITUDINAL REASSESSMENT)
      activeStepId = 'step-3';
      updateLocalStep('step-3', 'running', 'Auditing longitudinal findings chronologically across reports...');
      await delay(600);
      
      const conflictsOutput = await detectConflicts(apiKey, accumulator, documents);
      updateLocalStep('step-3', 'completed', 'Timeline discrepancy audit complete.', conflictsOutput);
      await delay(600);

      // STEP 4: SYNTHESIS
      activeStepId = 'step-4';
      updateLocalStep('step-4', 'running', `CMO compiling final unified report styled at the ${readingLevel.toUpperCase()} explanation level...`);
      await delay(600);
      
      const finalReport = await synthesizeAnswer(apiKey, query, plan, accumulator, conflictsOutput, readingLevel);
      updateLocalStep('step-4', 'completed', 'Clinical synthesis finished.');
      await delay(400);

      // Update finalizing card data elements
      setMessages(prev => prev.map(m => {
        if (m.id === assistantMessageId) {
          return {
            ...m,
            text: finalReport,
            isGenerating: false,
            rawContext: {
              originalQuestion: query,
              plan,
              subAnswers: accumulator,
              conflicts: conflictsOutput
            }
          };
        }
        return m;
      }));

    } catch (error: any) {
      console.error("Agent Research Pipeline encountered failures:", error);
      const rawMsg = error?.message || "Internal error occurred.";
      const userFriendlyMsg = rawMsg.includes("429") || rawMsg.toLowerCase().includes("quota")
        ? "Gemini free-tier quota is exhausted. AQ. auth keys from AI Studio are valid — this is a usage limit, not a bad key. Wait ~1 minute and retry, check https://ai.dev/rate-limit, or enable billing. MedClarity makes many API calls during source extraction."
        : rawMsg;
      // Fail active running steps safely
      setMessages(prev => prev.map(m => {
        if (m.id === assistantMessageId) {
          const currentSteps = m.agentSteps || [];
          return {
            ...m,
            isGenerating: false,
            error: `API Failure at ${activeStepId === 'step-1' ? 'Inquiry Mapping' : activeStepId === 'step-2' ? 'Source Extraction' : activeStepId === 'step-3' ? 'Discrepancy Audit' : 'Clinical Synthesis'}: ${userFriendlyMsg}`,
            agentSteps: currentSteps.map(s => {
              if (s.id === activeStepId) {
                return { ...s, status: 'failed', message: 'Pipeline failed at this point.', details: error?.message };
              }
              if (s.status === 'running') {
                return { ...s, status: 'failed', message: 'Pipeline halted.' };
              }
              return s;
            })
          };
        }
        return m;
      }));
    } finally {
      setIsGenerating(false);
    }
  };

  // Re-run raw synthesis instantly when readingLevel is toggled
  const handleReadingLevelToggle = async (level: 'simple' | 'clinical', msg: ChatMessage) => {
    if (!msg.rawContext || isGenerating) return;
    
    // Lock interface
    setIsGenerating(true);
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isGenerating: true, readingLevel: level } : m));

    try {
      const { originalQuestion, plan, subAnswers, conflicts } = msg.rawContext;
      const reSynthesized = await synthesizeAnswer(apiKey, originalQuestion, plan, subAnswers, conflicts, level);
      
      setMessages(prev => prev.map(m => {
        if (m.id === msg.id) {
          return {
            ...m,
            text: reSynthesized,
            isGenerating: false,
            readingLevel: level
          };
        }
        return m;
      }));
    } catch (err: any) {
      alert("Failed to rebuild synthesis level. Try querying again.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Extracted total chronology events across all documents combined
  const aggregatedTimeline = useMemo(() => {
    const list: TimelineEntry[] = [];
    documents.forEach(doc => {
      if (doc.timelineEntries) {
        list.push(...doc.timelineEntries);
      }
    });
    return list;
  }, [documents]);

  const activeDocument = documents.find(d => d.id === selectedDocId) || null;

  return (
    <div className="flex flex-col h-screen text-slate-900 bg-slate-50/50 dark:text-slate-100 dark:bg-slate-950 font-sans transition-colors duration-250 pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      
      {/* 🧩 Header Bar Component */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-2xs gap-4 z-40">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-emerald-500/10 rounded-lg flex items-center justify-center">
            <Activity className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-800 dark:text-slate-100 font-display">
              MedClarity
            </h1>
            <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
              Compare medical reports & get clear answers
            </p>
          </div>
        </div>

        {/* API credentials & Theme widgets */}
        <div className="flex items-center gap-3 self-end sm:self-center">
          <div className="flex flex-col items-end gap-0.5">
            <div className={`flex items-center bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border ${keyState === 'invalid' ? 'border-rose-350 dark:border-rose-800' : 'border-slate-200 dark:border-slate-700/80'} max-w-sm`}>
              <Key className="w-3.5 h-3.5 text-slate-400 mr-2 flex-shrink-0" />
              <input
                type="password"
                placeholder="Paste your Gemini API key (AQ. or AIzaSy...)"
                value={apiKey}
                onChange={handleApiKeyChange}
                className="bg-transparent text-xs w-32 md:w-44 focus:outline-hidden text-slate-800 dark:text-slate-200"
              />
              
              {/* API Glowing Dot Status Indicator */}
              {keyState === 'checking' ? (
                <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin ml-2" />
              ) : (
                <button 
                  onClick={handleVerifyButtonClick} 
                  className="focus:outline-hidden cursor-pointer"
                  title={keyState === 'valid' ? 'API Key Connected successfully' : 'Provide API Key and click to test'}
                >
                  <div 
                    className={`w-2.5 h-2.5 rounded-full ml-2 transition-all duration-300 ${
                      keyState === 'valid' 
                        ? 'bg-emerald-500 shadow-sm animate-glow' 
                        : keyState === 'checking' 
                        ? 'bg-amber-400'
                        : keyState === 'invalid' 
                        ? 'bg-rose-500 shadow-xs' 
                        : 'bg-slate-300'
                    }`} 
                  />
                </button>
              )}
            </div>
            {keyState === 'invalid' && (
              <span className="text-[9px] text-rose-600 dark:text-rose-400 font-bold select-none animate-pulse">
                Invalid API key
              </span>
            )}
            {keyState === 'valid' && (
              <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold select-none">
                Key Connected
              </span>
            )}
          </div>

          <button
            onClick={() => setIsDarkMode(prev => !prev)}
            className="p-2 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg transition-colors border border-slate-200 dark:border-slate-800 cursor-pointer"
            title="Toggle contrast levels"
          >
            {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* 📦 Floating Dictionary Lookup */}
      {isLookupOpen && (
        <MedicalDictionaryPopup
          term={lookupTerm}
          context={lookupContext}
          x={lookupPos.x}
          y={lookupPos.y}
          apiKey={apiKey}
          onClose={() => setIsLookupOpen(false)}
        />
      )}

      {/* 🚀 Main Interface Container */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">

        {/* 📚 Left Sidebar: Document uploading & File lists */}
        <aside className="w-full md:w-80 flex flex-col bg-white border-b md:border-b-0 md:border-r border-slate-200 dark:bg-slate-900 dark:border-slate-800">
          
          {/* Drag and drop panel */}
          <div 
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`p-5 border-2 border-dashed m-4 rounded-lg flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-150 ${
              isDragging 
                ? 'border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/20' 
                : 'border-slate-200 dark:border-slate-800 hover:border-emerald-500 hover:bg-slate-50/30'
            }`}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileSelect} 
              accept=".pdf" 
              multiple 
              className="hidden" 
            />
            <Plus className="w-6 h-6 text-slate-400 dark:text-slate-500 mb-1" />
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Upload medical PDFs
            </p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
              Supports standard medical reports
            </p>
          </div>

          {/* Validation and sample pre-loaders */}
          <div className="px-5 pb-3">
            {uploadError && (
              <div className="p-2.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-950/50 rounded-lg text-[11px] text-rose-800 dark:text-rose-400 font-medium mb-3 flex items-start justify-between gap-2 shadow-2xs">
                <div className="flex gap-2">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-rose-500" />
                  <span className="leading-tight">{uploadError}</span>
                </div>
                <button
                  onClick={() => setUploadError(null)}
                  className="text-rose-600 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-200 font-bold px-1 select-none cursor-pointer"
                  title="Dismiss error"
                >
                  &times;
                </button>
              </div>
            )}

            {documents.length === 0 && (
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleLoadSampleRecords}
                  className="w-full flex items-center justify-center gap-1 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 shadow-2xs transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Load Sample Medical Files</span>
                </button>
                <div className="flex items-start gap-1.5 p-2 bg-emerald-500/5 dark:bg-emerald-950/5 border border-emerald-500/10 rounded-md">
                  <Info className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[10px] text-slate-600 dark:text-slate-400 leading-normal">
                    Loads sample reports to try comparing changes or viewing discrepancies.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Upload loading */}
          {docUploadLoading && (
            <div className="px-5 py-2 flex items-center gap-2 text-xs font-mono text-slate-500 dark:text-slate-500 animate-pulse">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
              <span>Parsing PDFs per page...</span>
            </div>
          )}

          {/* Document list header list */}
          {documents.length > 0 && (
            <div className="flex items-center justify-between px-5 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-900/10 select-none">
              <span className="text-[10px] uppercase font-mono font-bold text-slate-500 dark:text-slate-400 tracking-wider">
                Medical Records ({documents.length})
              </span>
              <button
                onClick={handleClearAllDocs}
                className="text-[10px] font-mono font-medium hover:text-rose-500 text-slate-500 dark:text-slate-400 flex items-center gap-0.5 cursor-pointer"
                title="Wipe files"
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear All</span>
              </button>
            </div>
          )}

          {/* Files container */}
          <div className="flex-1 overflow-y-auto px-3 space-y-1 py-2">
            {documents.map((doc) => {
              const isActive = doc.id === selectedDocId;
              return (
                <div
                  key={doc.id}
                  onClick={() => {
                    setSelectedDocId(doc.id);
                    setActivePage(1);
                  }}
                  className={`group flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all duration-150 relative ${
                    isActive 
                      ? 'bg-emerald-50/20 dark:bg-slate-800 border-l-2 border-emerald-500 pr-2 pl-3 shadow-2xs' 
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <FileText className={`w-4 h-4 mt-0.5 flex-shrink-0 ${isActive ? 'text-emerald-500' : 'text-slate-400'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold tracking-tight text-slate-800 dark:text-slate-200 truncate pr-1">
                        {doc.name}
                      </p>
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                        <span className="truncate">{doc.uploadDate}</span>
                        <span>&bull;</span>
                        <span>p.{doc.pageCount}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveDocument(doc.id);
                    }}
                    className="p-1 hover:bg-rose-50 dark:hover:bg-rose-950/25 text-slate-400 hover:text-rose-550 dark:text-slate-500 dark:hover:text-rose-400 transition-colors self-start mt-0.5 rounded-md ml-2 cursor-pointer"
                    title="Remove record"
                  >
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        {/* 📋 Center Container: Formatted PDF Canvas & Reader or Historical Timeline */}
        <section className="flex-1 flex flex-col bg-slate-50/30 p-4 md:p-6 overflow-hidden border-b md:border-b-0 md:border-r border-slate-205 dark:border-slate-850 dark:bg-slate-950/20">
          
          {/* Controls toggle center tab */}
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => setCenterPanelMode('viewer')}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                centerPanelMode === 'viewer'
                  ? 'bg-slate-900 border-slate-900 text-white dark:bg-slate-800 dark:border-slate-805 dark:text-slate-200'
                  : 'bg-white border-slate-250 hover:bg-slate-50 text-slate-650 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/60'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Medical Reports</span>
            </button>
            
            <button
              onClick={() => setCenterPanelMode('timeline')}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                centerPanelMode === 'timeline'
                  ? 'bg-slate-900 border-slate-900 text-white dark:bg-slate-800 dark:border-slate-805 dark:text-slate-200'
                  : 'bg-white border-slate-250 hover:bg-slate-50 text-slate-650 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/60'
              }`}
            >
              <History className="w-3.5 h-3.5 animate-glow" />
              <span>Combined Timeline</span>
              {aggregatedTimeline.length > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-emerald-500 text-white text-[9px] font-bold">
                  {aggregatedTimeline.length}
                </span>
              )}
            </button>
          </div>

          <div className="flex-1 min-h-0">
            {centerPanelMode === 'viewer' ? (
              <DocViewer
                doc={activeDocument}
                activePage={activePage}
                onPageChange={setActivePage}
                onUpdateDocDate={handleUpdateDocDate}
                highlightText={activeHighlightSnippet}
              />
            ) : (
              <TimelineView
                entries={aggregatedTimeline}
                onNodeClick={(docId, pageNum, term) => {
                  setSelectedDocId(docId);
                  setActivePage(pageNum);
                  setCenterPanelMode('viewer');
                  setActiveHighlightSnippet(term.substring(0, 45));
                }}
              />
            )}
          </div>
        </section>

        {/* 💬 Right Column: Clinician chat console */}
        <section className="w-full md:w-96 flex flex-col bg-white dark:bg-slate-900 border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 overflow-hidden">
          
          {/* Suggested Inquiries segment */}
          <div className="p-4 border-b border-slate-250 dark:border-slate-800 flex-shrink-0">
            <h3 className="text-[10px] font-bold font-mono text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
              Health Settings
            </h3>
            
            {/* Simple / Clinical synthesizers toggler */}
            <div className="flex items-center justify-between py-1 bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2 border border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-700 dark:text-slate-300 flex items-center gap-1 font-medium">
                <BrainCircuit className="w-3.5 h-3.5 text-emerald-500" />
                <span>Explanation size:</span>
              </span>
              <div className="flex items-center bg-slate-200 dark:bg-slate-800 p-0.5 rounded">
                <button
                  onClick={() => setReadingLevel('simple')}
                  className={`px-2 py-1 text-[10px] font-semibold rounded-xs transition-all cursor-pointer ${
                    readingLevel === 'simple'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-3xs'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  Simple
                </button>
                <button
                  onClick={() => setReadingLevel('clinical')}
                  className={`px-2 py-1 text-[10px] font-semibold rounded-xs transition-all cursor-pointer ${
                    readingLevel === 'clinical'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-3xs'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  Detailed
                </button>
              </div>
            </div>
          </div>

          {/* Interactive message space */}
          <div 
            onMouseUp={handleMouseSelectionUp}
            className="flex-1 overflow-y-auto p-4 space-y-4"
          >
            {/* Suggested inquiries */}
            {suggestedQuestionsList.length > 0 && (
              <SuggestedQuestions
                questions={suggestedQuestionsList}
                onQuestionClick={handleSuggestedQuestionTrigger}
                isLoading={isGeneratingSuggestions}
              />
            )}

            {messages.length === 0 ? (
              <div id="no-chat-state" className="flex flex-col items-center justify-center p-8 text-center h-48 text-slate-500 dark:text-slate-400">
                <BrainCircuit className="w-9 h-9 mb-2 opacity-40 text-emerald-500" />
                <p className="text-xs font-bold text-slate-800 dark:text-slate-200">Compare Your Records</p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1.5 max-w-[220px] leading-normal">
                  Ask a question to see lab changes, track medical timelines, or summarize differences across report dates.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((msg) => {
                  const isAssistant = msg.sender === 'assistant';
                  
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isAssistant ? 'items-start' : 'items-end'}`}
                    >
                      {/* Avatar */}
                      <span className="text-[9px] font-mono font-bold text-slate-500 dark:text-slate-400 mb-1 select-none">
                        {isAssistant ? "MedClarity Assistant" : "You"} &bull; {msg.timestamp}
                      </span>

                      {/* Content Card container */}
                      <div className={`p-4 rounded-lg break-words text-xs shadow-3xs border max-w-full leading-relaxed ${
                        isAssistant
                          ? 'bg-slate-100/50 dark:bg-slate-900/60 border-slate-250 dark:border-slate-800 text-slate-850 dark:text-slate-200'
                          : 'bg-slate-900 dark:bg-slate-800 text-white border-transparent shadow-xs'
                      }`}>

                        {/* Collapsible Agent execution tracker step display */}
                        {isAssistant && msg.agentSteps && (
                          <div className="mb-4 bg-white/50 dark:bg-slate-950/40 p-3 rounded-md border border-slate-200 dark:border-slate-800">
                            <details className="group" open={msg.isGenerating}>
                              <summary className="list-none flex items-center justify-between cursor-pointer focus:outline-hidden">
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-700 dark:text-slate-300">
                                  <BrainCircuit className="w-3.5 h-3.5 text-emerald-500" />
                                  <span>How we are researching</span>
                                </div>
                                <span className="text-[9px] font-mono text-slate-500 dark:text-slate-400 group-open:hidden uppercase font-semibold">Details</span>
                                <span className="text-[9px] font-mono text-slate-500 dark:text-slate-400 hidden group-open:inline uppercase font-semibold">Hide</span>
                              </summary>

                              <div className="space-y-2.5 mt-3 pt-2.5 border-t border-slate-200 dark:border-slate-800/80">
                                {msg.agentSteps.map((s, idx) => (
                                  <div key={idx} className="flex gap-2.5">
                                    {/* Line Bullet connection dots styled like professional logs */}
                                    <div className="flex flex-col items-center">
                                      <div className={`w-2.5 h-2.5 rounded-full mt-0.5 border border-white dark:border-slate-800 ${
                                        s.status === 'completed' 
                                          ? 'bg-emerald-500 dark:bg-emerald-400 shadow-xs' 
                                          : s.status === 'running' 
                                          ? 'bg-amber-400 animate-pulse'
                                          : s.status === 'failed' 
                                          ? 'bg-rose-500' 
                                          : 'bg-slate-250 dark:bg-slate-700'
                                      }`} />
                                      {idx < msg.agentSteps!.length - 1 && (
                                        <div className="w-[1.5px] bg-slate-200 dark:bg-slate-800/80 flex-1 min-h-[16px] my-0.5" />
                                      )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[10px] font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                                        <span>{s.name}</span>
                                        {s.status === 'running' && <Loader2 className="w-2.5 h-2.5 text-amber-500 animate-spin" />}
                                      </p>
                                      <p className="text-[9px] font-medium text-slate-500 dark:text-slate-400 leading-normal mt-0.5">
                                        {s.message}
                                      </p>
                                      {s.details && (
                                        <pre className="mt-1 p-1.5 bg-slate-100 dark:bg-slate-950 rounded text-[9px] font-mono text-slate-500 whitespace-pre-wrap leading-tight border border-slate-150 dark:border-slate-950/40 max-h-24 overflow-y-auto">
                                          {s.details}
                                        </pre>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </details>
                          </div>
                        )}

                        {/* Error output */}
                        {msg.error ? (
                          <div className="space-y-2 mt-1">
                            <div className="p-3 bg-rose-50/50 dark:bg-rose-950/25 border border-rose-200/50 text-rose-800 dark:text-rose-450 rounded-lg text-[11px] flex gap-2">
                              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-500" />
                              <div className="flex-1">
                                <p className="font-semibold text-rose-900 dark:text-rose-350">Pipeline Disruption</p>
                                <p className="mt-0.5 text-[10.5px] leading-relaxed select-text">{msg.error}</p>
                              </div>
                            </div>
                            {msg.rawContext?.originalQuestion && (
                              <button
                                onClick={() => handleSubmitQuestion(null, msg.rawContext?.originalQuestion)}
                                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-[10px] uppercase rounded-md flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                              >
                                <RefreshCw className="w-3 h-3 animate-spin duration-3000" />
                                <span>Retry This Investigation</span>
                              </button>
                            )}
                          </div>
                        ) : isAssistant && msg.isGenerating && !msg.text ? (
                          <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 font-mono text-[10px] py-4">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
                            <span>Synthesizing medical findings...</span>
                          </div>
                        ) : (
                          <div className="prose prose-sm dark:prose-invert text-xs dark:text-slate-300">
                            {/* Synthesis content */}
                            {isAssistant ? (
                              <div className="whitespace-pre-wrap">
                                {renderCompilationTextAndCitations(msg.text)}
                              </div>
                            ) : (
                              msg.text
                            )}
                          </div>
                        )}

                        {/* Layout Simple/Clinical level rebuild selector inside finalized responses */}
                        {isAssistant && msg.rawContext && !msg.isGenerating && (
                          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[9px] text-slate-500 dark:text-slate-400 select-none">
                            <span className="font-semibold">Explanation type:</span>
                            <div className="flex items-center gap-1.5 font-bold">
                              <button
                                onClick={() => handleReadingLevelToggle('simple', msg)}
                                disabled={msg.readingLevel === 'simple'}
                                className={`px-1 rounded-sm text-[9px] hover:text-emerald-500 cursor-pointer disabled:text-emerald-500 disabled:font-bold disabled:bg-emerald-50/10`}
                              >
                                Simple
                              </button>
                              <span>|</span>
                              <button
                                onClick={() => handleReadingLevelToggle('clinical', msg)}
                                disabled={msg.readingLevel === 'clinical'}
                                className={`px-1 rounded-sm text-[9px] hover:text-emerald-500 cursor-pointer disabled:text-emerald-500 disabled:font-bold disabled:bg-emerald-50/10`}
                              >
                                Detailed
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      {isAssistant && !msg.isGenerating && (
                        <span className="text-[9px] font-medium text-slate-500 dark:text-slate-400 mt-1 pl-1">
                          Tip: Highlight or double-click any hard medical word to see its meaning.
                        </span>
                      )}
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {/* Form console keyboard triggers */}
          <footer className="p-4 border-t border-slate-200 dark:border-slate-800 flex-shrink-0 bg-slate-50/50 dark:bg-slate-900/40">
            <form onSubmit={handleSubmitQuestion} className="flex gap-2">
              <input
                type="text"
                placeholder={
                  keyState !== 'valid' 
                    ? "Please enter an API key above..." 
                    : documents.length === 0
                    ? "Upload medical records or load a sample first..."
                    : "Ask about differences, timeline, or vitals..."
                }
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                disabled={isGenerating}
                className="flex-1 px-3 py-2 bg-white dark:bg-slate-800 text-xs rounded-lg border border-slate-200 dark:border-slate-700/80 focus:outline-hidden text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-550 disabled:opacity-40 disabled:cursor-not-allowed font-sans"
              />
              <button
                type="submit"
                disabled={isGenerating || !chatInput.trim()}
                className="p-2.5 bg-slate-900 text-white dark:bg-emerald-600 hover:bg-emerald-700 rounded-lg font-semibold flex items-center justify-center transition-colors shadow-2xs cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </form>
          </footer>
        </section>
      </div>
    </div>
  );

  // Helper helper to format inline citation links inside message outputs
  function renderCompilationTextAndCitations(messageText: string) {
    if (!messageText) return null;

    // Split text into paragraphs nicely
    const paragraphs = messageText.split(/\n\n+/);

    return (
      <div className="space-y-3">
        {paragraphs.map((para, index) => {
          const trimmed = para.trim();
          if (!trimmed) return null;

          // Check for discrepancy/contradiction keywords or tags
          const isContradiction = 
            trimmed.includes('[CONTRADICTION DETECTED]') || 
            trimmed.includes('[ALERT: CONTRADICTION DETECTED]') ||
            trimmed.includes('[ALERT: DISCREPANCY DETECTED]') ||
            trimmed.includes('[DISCREPANCY DETECTED]');

          const isTrend = 
            trimmed.includes('[CHRONOLOGICAL TREND DETECTED]') || 
            trimmed.includes('[TREND DETECTED]') ||
            trimmed.includes('[TREND IDENTIFIED]');

          if (isContradiction) {
            let cleanText = trimmed
              .replace(/\[CONTRADICTION DETECTED\]/gi, '')
              .replace(/\[ALERT:\s*CONTRADICTION DETECTED\]/gi, '')
              .replace(/\[ALERT:\s*DISCREPANCY DETECTED\]/gi, '')
              .replace(/\[DISCREPANCY DETECTED\]/gi, '')
              .trim();
            
            return (
              <div 
                key={index} 
                className="p-4 bg-rose-50/70 dark:bg-rose-950/20 border-l-4 border-rose-500 rounded-r-lg shadow-2xs space-y-1.5 my-3 relative overflow-hidden"
              >
                <div className="flex items-center gap-2 text-rose-800 dark:text-rose-400 font-bold font-sans text-[11px] tracking-tight uppercase">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-500 flex-shrink-0 animate-pulse" />
                  <span>Critical Discrepancy Found</span>
                </div>
                <div className="text-slate-800 dark:text-slate-200 text-xs leading-relaxed font-medium">
                  {renderCitationsInString(cleanText)}
                </div>
              </div>
            );
          }

          if (isTrend) {
            let cleanText = trimmed
              .replace(/\[CHRONOLOGICAL TREND DETECTED\]/gi, '')
              .replace(/\[TREND DETECTED\]/gi, '')
              .replace(/\[TREND IDENTIFIED\]/gi, '')
              .trim();

            return (
              <div 
                key={index} 
                className="p-4 bg-emerald-50/60 dark:bg-emerald-950/20 border-l-4 border-emerald-500 rounded-r-lg shadow-2xs space-y-1.5 my-3 relative overflow-hidden"
              >
                <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-400 font-bold font-sans text-[11px] tracking-tight uppercase">
                  <Activity className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  <span>Longitudinal Trend Identified</span>
                </div>
                <div className="text-slate-800 dark:text-slate-200 text-xs leading-relaxed font-semibold">
                  {renderCitationsInString(cleanText)}
                </div>
              </div>
            );
          }

          // Plain paragraph body element
          return (
            <p key={index} className="text-xs leading-relaxed text-slate-700 dark:text-slate-350">
              {renderCitationsInString(para)}
            </p>
          );
        })}
      </div>
    );
  }

  function renderCitationsInString(textSegment: string) {
    const citationRegex = /\[([^\]]+?),\s*p\.(\d+)\]/gi;
    const elements = [];
    let lastOffset = 0;
    let match;

    while ((match = citationRegex.exec(textSegment)) !== null) {
      const [fullMatch, docName, pageNumberStr] = match;
      const matchOffset = match.index;

      if (matchOffset > lastOffset) {
        elements.push(textSegment.substring(lastOffset, matchOffset));
      }

      const pNum = parseInt(pageNumberStr);
      elements.push(
        <button
          key={matchOffset}
          onClick={() => handleCitationJump(docName, pNum)}
          className="citation-link py-0.5 px-1.5 leading-none mx-0.5 bg-slate-100 hover:bg-emerald-100 dark:bg-slate-850 dark:hover:bg-emerald-950 text-[10px] text-slate-700 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-300 font-medium font-mono rounded border border-slate-200/50 dark:border-slate-800 transition-colors inline-flex items-center gap-0.5"
          title={`Jump to ${docName} - Page ${pNum}`}
        >
          <span>{docName}, p.{pNum}</span>
        </button>
      );

      lastOffset = citationRegex.lastIndex;
    }

    if (lastOffset < textSegment.length) {
      elements.push(textSegment.substring(lastOffset));
    }

    return elements.length > 0 ? elements : textSegment;
  }
}
