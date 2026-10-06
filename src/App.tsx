import { useState, useEffect, useRef, useMemo, DragEvent, ChangeEvent, FormEvent, MouseEvent } from 'react';
import { parsePdfFile, extractClinicalReportDate } from './lib/pdfParser';
import {
  testApiKey,
  answerQuestion,
  rewriteAnswer,
  generateSuggestedInquiries,
  extractTimelineEntries
} from './lib/gemini';
import { applyDocDateCorrection, countPages, resolveCitation, type CitationToken } from './lib/answer';
import { SAMPLE_DOCUMENTS, SAMPLE_QUESTIONS } from './sampleData';
import { MedicalDocument, ChatMessage, TimelineEntry } from './types';
import DocViewer from './components/DocViewer';
import TimelineView from './components/TimelineView';
import SuggestedQuestions from './components/SuggestedQuestions';
import MedicalDictionaryPopup from './components/MedicalDictionaryPopup';
import AnswerView from './components/AnswerView';
import { Activity, Plus, Trash2, Trash, Loader as Loader2, Send, Sparkles, CircleAlert as AlertCircle, BrainCircuit, Key, Sun, Moon, FileText, History, RefreshCw, Info } from 'lucide-react';

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

  // Restore a key only if the user entered one earlier in this browser session.
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
    const key = e.target.value;
    setApiKey(key);
    if (!key.trim()) {
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
      } catch (err: any) {
        setUploadError(`Failed to read "${file.name}": ` + (err?.message || "File corrupt or password protected."));
      }
    }

    if (newlyParsedDocs.length > 0) {
      setDocuments(prev => {
        const next = [...prev, ...newlyParsedDocs];
        if (prev.length === 0) {
          setSelectedDocId(newlyParsedDocs[0].id);
          setActivePage(1);
        }
        triggerRecommendationsUpdate(next);
        return next;
      });
    }

    setDocUploadLoading(false);

    // Run background enrichment after docs are already visible
    for (const doc of newlyParsedDocs) {
      if (keyState !== 'valid') continue;

      try {
        const clinicalDate = await extractClinicalReportDate(
          apiKey,
          doc.name,
          doc.pages[0]?.text || '',
          doc.uploadDate
        );

        const timeline = await extractTimelineEntries(
          apiKey,
          doc.id,
          doc.name,
          clinicalDate,
          doc.pages
        );

        setDocuments(prev =>
          prev.map(d =>
            d.id === doc.id
              ? { ...d, uploadDate: clinicalDate, timelineEntries: timeline }
              : d
          )
        );
      } catch (e) {
        console.error("Background enrichment failed for", doc.name, e);
      }
    }
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

  // Manual correction of a document's report date from the center panel.
  // Only timeline events that inherited the old document date move with it.
  const handleUpdateDocDate = (docId: string, newDate: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;
    setDocuments(prev => prev.map(doc => doc.id === docId
      ? {
          ...doc,
          uploadDate: newDate,
          timelineEntries: applyDocDateCorrection(doc.timelineEntries || [], doc.uploadDate, newDate)
        }
      : doc
    ));
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

  // Load the bundled fictional sample records (no upload or key needed to browse them)
  const handleLoadSampleRecords = () => {
    const sampleDocs = SAMPLE_DOCUMENTS;

    setDocuments(sampleDocs);
    setSelectedDocId(sampleDocs[0].id);
    setActivePage(1);

    // Auto populate custom suggested research questions as a guide
    setSuggestedQuestionsList(SAMPLE_QUESTIONS);
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

  // Citation click: the citation was already resolved against the loaded documents.
  const handleCitationJump = (docId: string, pageNumber: number, _citation: CitationToken) => {
    setSelectedDocId(docId);
    setActivePage(pageNumber);
    setCenterPanelMode('viewer');

    // Highlight the finding the model reported for this page, if it returned one.
    let highlightSnippet = '';
    for (let i = messages.length - 1; i >= 0 && !highlightSnippet; i--) {
      const findings = messages[i].rawContext?.findings || [];
      const match = findings.find(f => {
        const r = resolveCitation(f.docName, f.pageNumber, documents);
        return r.ok && r.docId === docId && r.pageNumber === pageNumber;
      });
      if (match) highlightSnippet = match.finding;
    }
    setActiveHighlightSnippet(highlightSnippet);

    setTimeout(() => {
      document.getElementById(`doc-viewer-${docId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  // Text highlighting gloss lookup triggers
  const handleMouseSelectionUp = (e: MouseEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    if (!selection) return;

    const selectedText = selection.toString().trim();

    // Ensure we trigger on valid words, and avoid long paragraphs that degrade search performance
    if (selectedText.length > 2 && selectedText.length < 50 && keyState === 'valid') {
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

  const nowLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Submit Q&A: one Gemini request over all loaded documents.
  const handleSubmitQuestion = async (e: FormEvent | null, forceQuestion?: string) => {
    if (e) e.preventDefault();
    const query = (forceQuestion || chatInput).trim();
    if (!query) return;

    const userMessage: ChatMessage = { id: `msg-user-${Date.now()}`, sender: 'user', timestamp: nowLabel(), text: query };

    const blockedReason = keyState !== 'valid'
      ? 'Enter a valid Gemini API key in the top bar first. The key stays in this browser session.'
      : documents.length === 0
        ? "Upload at least one medical PDF, or click 'Load Sample Medical Files', before asking a question."
        : null;
    if (blockedReason) {
      setMessages(prev => [...prev, userMessage, {
        id: `msg-assistant-warning-${Date.now()}`,
        sender: 'assistant',
        timestamp: nowLabel(),
        text: '',
        error: blockedReason,
        readingLevel
      }]);
      setChatInput('');
      return;
    }

    setChatInput('');
    setIsGenerating(true);

    const assistantMessageId = `msg-assistant-${Date.now()}`;
    setMessages(prev => [...prev, userMessage, {
      id: assistantMessageId,
      sender: 'assistant',
      timestamp: nowLabel(),
      text: '',
      isGenerating: true,
      readingLevel,
      rawContext: { originalQuestion: query, findings: [], conflicts: '' }
    }]);

    const docsSnapshot = documents;
    try {
      const { finalAnswer, findings, conflicts, model } = await answerQuestion(apiKey, query, docsSnapshot, readingLevel);
      setMessages(prev => prev.map(m => m.id === assistantMessageId
        ? {
            ...m,
            text: finalAnswer,
            isGenerating: false,
            provenance: { model, documentCount: docsSnapshot.length, pageCount: countPages(docsSnapshot) },
            rawContext: { originalQuestion: query, findings, conflicts }
          }
        : m
      ));
    } catch (error: any) {
      console.error('Question failed:', error);
      setMessages(prev => prev.map(m => m.id === assistantMessageId
        ? { ...m, isGenerating: false, error: error?.message || 'The request failed.' }
        : m
      ));
    } finally {
      setIsGenerating(false);
    }
  };

  // Rewrite an answer at the other reading level from the findings already returned.
  const handleReadingLevelToggle = async (level: 'simple' | 'clinical', msg: ChatMessage) => {
    if (!msg.rawContext || isGenerating) return;

    setIsGenerating(true);
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isGenerating: true, notice: undefined } : m));

    try {
      const { originalQuestion, findings, conflicts } = msg.rawContext;
      const { text, model } = await rewriteAnswer(apiKey, originalQuestion, findings, conflicts, level);
      setMessages(prev => prev.map(m => m.id === msg.id
        ? {
            ...m,
            text,
            isGenerating: false,
            readingLevel: level,
            provenance: m.provenance ? { ...m.provenance, model } : m.provenance
          }
        : m
      ));
    } catch (err: any) {
      console.error('Reading-level rewrite failed:', err);
      setMessages(prev => prev.map(m => m.id === msg.id
        ? { ...m, isGenerating: false, notice: `Could not rewrite the answer: ${err?.message || 'unknown error'}` }
        : m
      ));
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
                    className={`w-2.5 h-2.5 rounded-full ml-2 transition-all duration-300 ${keyState === 'valid'
                        ? 'bg-emerald-500 shadow-sm animate-glow'
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
            title="Toggle dark mode"
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
            className={`p-5 border-2 border-dashed m-4 rounded-lg flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-150 ${isDragging
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
                  className={`group flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all duration-150 relative ${isActive
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
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${centerPanelMode === 'viewer'
                  ? 'bg-slate-900 border-slate-900 text-white dark:bg-slate-800 dark:border-slate-805 dark:text-slate-200'
                  : 'bg-white border-slate-250 hover:bg-slate-50 text-slate-650 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/60'
                }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Medical Reports</span>
            </button>

            <button
              onClick={() => setCenterPanelMode('timeline')}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${centerPanelMode === 'timeline'
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
                onTextSelection={(term, context, x, y) => {
                  setLookupTerm(term);
                  setLookupContext(context);
                  setLookupPos({ x, y });
                  setIsLookupOpen(true);
                }}
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

        {/* Right column: questions and answers */}
        <section className="w-full md:w-96 flex flex-col bg-white dark:bg-slate-900 border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 overflow-hidden">

          {/* Suggested Inquiries segment */}
          <div className="p-4 border-b border-slate-250 dark:border-slate-800 flex-shrink-0">
            <h3 className="text-[10px] font-bold font-mono text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
              Answer style
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
                  className={`px-2 py-1 text-[10px] font-semibold rounded-xs transition-all cursor-pointer ${readingLevel === 'simple'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-3xs'
                      : 'text-slate-500 dark:text-slate-400'
                    }`}
                >
                  Simple
                </button>
                <button
                  onClick={() => setReadingLevel('clinical')}
                  className={`px-2 py-1 text-[10px] font-semibold rounded-xs transition-all cursor-pointer ${readingLevel === 'clinical'
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
                      <div className={`p-4 rounded-lg break-words text-xs shadow-3xs border max-w-full leading-relaxed ${isAssistant
                          ? 'bg-slate-100/50 dark:bg-slate-900/60 border-slate-250 dark:border-slate-800 text-slate-850 dark:text-slate-200'
                          : 'bg-slate-900 dark:bg-slate-800 text-white border-transparent shadow-xs'
                        }`}>

                        {/* Error output */}
                        {msg.error ? (
                          <div className="space-y-2 mt-1">
                            <div className="p-3 bg-rose-50/50 dark:bg-rose-950/25 border border-rose-200/50 text-rose-800 dark:text-rose-450 rounded-lg text-[11px] flex gap-2">
                              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-500" />
                              <div className="flex-1">
                                <p className="font-semibold text-rose-900 dark:text-rose-350">Request failed</p>
                                <p className="mt-0.5 text-[10.5px] leading-relaxed select-text">{msg.error}</p>
                              </div>
                            </div>
                            {msg.rawContext?.originalQuestion && (
                              <button
                                onClick={() => handleSubmitQuestion(null, msg.rawContext?.originalQuestion)}
                                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-[10px] uppercase rounded-md flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                              >
                                <RefreshCw className="w-3 h-3" />
                                <span>Retry</span>
                              </button>
                            )}
                          </div>
                        ) : isAssistant && msg.isGenerating && !msg.text ? (
                          <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 font-mono text-[10px] py-4">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
                            <span>Reading {documents.length} document{documents.length === 1 ? '' : 's'} ({countPages(documents)} pages) in one Gemini request...</span>
                          </div>
                        ) : (
                          <div className="text-xs text-slate-800 dark:text-slate-100">
                            {isAssistant ? (
                              <AnswerView text={msg.text} documents={documents} onCitationClick={handleCitationJump} />
                            ) : (
                              <span className="whitespace-pre-wrap">{msg.text}</span>
                            )}
                          </div>
                        )}

                        {isAssistant && msg.notice && (
                          <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-400">{msg.notice}</p>
                        )}

                        {isAssistant && msg.provenance && !msg.isGenerating && (
                          <details className="mt-3 text-[10px] text-slate-500 dark:text-slate-400">
                            <summary className="cursor-pointer select-none font-semibold">How this answer was produced</summary>
                            <ul className="mt-1.5 space-y-1 pl-1">
                              <li>One <span className="font-mono">{msg.provenance.model}</span> request over {msg.provenance.documentCount} document{msg.provenance.documentCount === 1 ? '' : 's'} ({msg.provenance.pageCount} pages of extracted text).</li>
                              <li>{msg.rawContext?.findings.length ?? 0} page-level findings returned. Citations are checked against the loaded documents; unverified ones are struck through.</li>
                              {msg.rawContext?.conflicts && <li>Model's conflict summary: {msg.rawContext.conflicts}</li>}
                            </ul>
                          </details>
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
}
