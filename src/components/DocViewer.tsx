import { useEffect, useRef, useState } from 'react';
import { MedicalDocument } from '../types';
import { FileText, Calendar, Edit2, Check, X, AlertCircle, ChevronLeft, ChevronRight, Eye, RefreshCw } from 'lucide-react';

interface DocViewerProps {
  doc: MedicalDocument | null;
  activePage: number;
  onPageChange: (page: number) => void;
  onUpdateDocDate: (docId: string, newDate: string) => void;
  highlightText?: string;
}

export default function DocViewer({
  doc,
  activePage,
  onPageChange,
  onUpdateDocDate,
  highlightText
}: DocViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contentContainerRef = useRef<HTMLDivElement | null>(null);
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'canvas' | 'text'>('text');
  const [isEditingDate, setIsEditingDate] = useState(false);
  const [editedDate, setEditedDate] = useState('');
  const [canvasLoading, setCanvasLoading] = useState(false);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  // Scroll to top and trigger clear green flash transition on page change
  useEffect(() => {
    if (contentContainerRef.current) {
      contentContainerRef.current.scrollTop = 0;
    }
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(timer);
  }, [doc?.id, activePage]);

  // Sync edits
  useEffect(() => {
    if (doc) {
      setEditedDate(doc.uploadDate);
    }
  }, [doc]);

  // Load PDF.js Document object for canvas modes
  useEffect(() => {
    if (!doc) {
      setPdfDocument(null);
      return;
    }

    const pdfjs = (window as any).pdfjsLib;
    if (!pdfjs) {
      setViewMode('text');
      return;
    }

    setCanvasLoading(true);
    setCanvasError(null);
    let isCurrent = true;

    // Use raw File if provided client-side, otherwise fallback to text mode safely
    if (doc.rawFile) {
      doc.rawFile.arrayBuffer().then(buf => {
        return pdfjs.getDocument({ data: buf }).promise;
      }).then(pdf => {
        if (isCurrent) {
          setPdfDocument(pdf);
          setCanvasLoading(false);
          // If doc loaded, we can default to canvas view
          setViewMode('canvas');
        }
      }).catch(err => {
        console.error("Failed to load native PDF canvas data", err);
        if (isCurrent) {
          setCanvasError("Canvas rendering unavailable for this PDF. Falling back to Reader view.");
          setCanvasLoading(false);
          setViewMode('text');
        }
      });
    } else {
      setCanvasLoading(false);
      setViewMode('text');
    }

    return () => {
      isCurrent = false;
    };
  }, [doc]);

  // Render Page on Canvas
  useEffect(() => {
    if (!pdfDocument || viewMode !== 'canvas' || !canvasRef.current) return;
    
    let isCurrent = true;
    setCanvasLoading(true);
    setCanvasError(null);

    // Safeguard page bounds
    const safePageNum = Math.max(1, Math.min(activePage, doc?.pageCount || 1));

    pdfDocument.getPage(safePageNum).then((page: any) => {
      if (!isCurrent || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) return;

      // Render at readable crisp scale
      const viewport = page.getViewport({ scale: 1.25 });
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };

      return page.render(renderContext).promise;
    }).then(() => {
      if (isCurrent) {
        setCanvasLoading(false);
      }
    }).catch(err => {
      console.error("Canvas draw context error", err);
      if (isCurrent) {
        setCanvasError("Canvas rendering failed. Please toggle to Dark-Friendly Reader View.");
        setCanvasLoading(false);
        setViewMode('text');
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [pdfDocument, activePage, viewMode, doc?.pageCount]);

  if (!doc) {
    return (
      <div id="no-doc-selected-state" className="flex flex-col items-center justify-center h-full p-8 text-center text-gray-450 dark:text-gray-500 font-sans">
        <FileText className="w-12 h-12 mb-4 opacity-30 stroke-[1.5]" />
        <p className="text-sm font-medium tracking-wide">No Clinical Document Selected</p>
        <p className="max-w-xs mt-1 text-xs opacity-70">
          Upload or select a file from the sidebar to inspect page details, citations, and metadata.
        </p>
      </div>
    );
  }

  const getActivePageText = () => {
    const page = doc.pages.find(p => p.pageNumber === activePage);
    return page ? page.text : "Empty page or content unreadable.";
  };

  // Helper to wrap matched text with highlights safely with robust sentence/keyword fallback
  const renderHighlightedText = (text: string) => {
    if (!highlightText || !highlightText.trim()) return text;
    
    const cleanHighlight = highlightText.trim();
    try {
      // 1. Direct match
      const escaped = escapeRegExp(cleanHighlight);
      if (new RegExp(escaped, 'i').test(text)) {
        const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
        return parts.map((part, i) => 
          part.toLowerCase() === cleanHighlight.toLowerCase() ? (
            <mark key={i} className="bg-emerald-100 dark:bg-emerald-900/40 border-b-2 border-emerald-500/80 text-emerald-950 dark:text-emerald-250 font-bold px-1.5 py-0.5 rounded-sm shadow-2xs">
              {part}
            </mark>
          ) : part
        );
      }

      // 2. Sliding word chunks fallback (matches sentences with OCR whitespace deviations)
      const words = cleanHighlight.split(/\s+/).filter(w => w.length > 3);
      if (words.length >= 3) {
        const chunkSize = Math.min(5, Math.ceil(words.length / 2));
        let bestSubChunk = '';
        for (let i = 0; i <= words.length - chunkSize; i++) {
          const sub = words.slice(i, i + chunkSize).join(' ');
          if (sub.length > 12 && new RegExp(escapeRegExp(sub), 'i').test(text)) {
            bestSubChunk = sub;
            break;
          }
        }
        
        if (bestSubChunk) {
          const escapedChunk = escapeRegExp(bestSubChunk);
          const parts = text.split(new RegExp(`(${escapedChunk})`, 'gi'));
          return parts.map((part, i) => 
            part.toLowerCase() === bestSubChunk.toLowerCase() ? (
              <mark key={i} className="bg-emerald-100 dark:bg-emerald-905/40 border-b-2 border-emerald-500/80 text-emerald-955 dark:text-emerald-250 font-bold px-1.5 py-0.5 rounded-sm shadow-2xs">
                {part}
              </mark>
            ) : part
          );
        }
      }
      return text;
    } catch {
      return text;
    }
  };

  function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const handleSaveDate = () => {
    if (editedDate.trim()) {
      onUpdateDocDate(doc.id, editedDate.trim());
      setIsEditingDate(false);
    }
  };

  return (
    <div id={`doc-viewer-${doc.id}`} className="flex flex-col h-full bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-lg shadow-xs overflow-hidden">
      {/* Viewer Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800 gap-3">
        <div className="truncate">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100 font-display truncate" title={doc.name}>
            {doc.name}
          </h2>
          <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
            <span className="font-mono">{doc.sizeString} &bull; {doc.pageCount} pages</span>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3 opacity-60" />
              {isEditingDate ? (
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    value={editedDate}
                    onChange={e => setEditedDate(e.target.value)}
                    className="px-1.5 py-0.5 max-h-5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200 text-[11px] focus:outline-hidden"
                  />
                  <button onClick={handleSaveDate} className="text-emerald-600 hover:text-emerald-500">
                    <Check className="w-3 h-3" />
                  </button>
                  <button onClick={() => { setIsEditingDate(false); setEditedDate(doc.uploadDate); }} className="text-rose-500 hover:text-rose-400">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1 group">
                  <span className="font-mono">Clinically Dated: {doc.uploadDate}</span>
                  <button 
                    onClick={() => setIsEditingDate(true)}
                    className="p-0.5 rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:text-slate-600 dark:hover:text-slate-200 transition-opacity duration-150"
                    title="Correct report date for timeline accuracy"
                  >
                    <Edit2 className="w-2.5 h-2.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic View Toggles */}
        <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-md self-start sm:self-center">
          <button
            onClick={() => setViewMode('canvas')}
            disabled={!doc.rawFile}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-sm transition-all duration-150 ${
              viewMode === 'canvas'
                ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-xs'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
            title={!doc.rawFile ? "Canvas mode not available for virtual pages" : "Authentic PDF Layout Renderer"}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Canvas</span>
          </button>
          <button
            onClick={() => setViewMode('text')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-sm transition-all duration-150 ${
              viewMode === 'text'
                ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-xs'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
            title="Fluid, large-font readable viewer aligned with Dark mode themes"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Text Reader</span>
          </button>
        </div>
      </div>

      {/* Pages Navigation Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-50/20 dark:bg-slate-900/20 border-b border-slate-100 dark:border-slate-800 select-none">
        <span className="text-xs font-mono text-slate-500">
          Page {activePage} of {doc.pageCount}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(Math.max(1, activePage - 1))}
            disabled={activePage === 1}
            className="p-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input
            type="number"
            min={1}
            max={doc.pageCount}
            value={activePage}
            onChange={e => {
              const pagesVal = parseInt(e.target.value);
              if (pagesVal >= 1 && pagesVal <= doc.pageCount) {
                onPageChange(pagesVal);
              }
            }}
            className="w-10 px-1 py-0.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-center text-xs font-mono focus:outline-hidden"
          />
          <button
            onClick={() => onPageChange(Math.min(doc.pageCount, activePage + 1))}
            disabled={activePage === doc.pageCount}
            className="p-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Page Content Renderer */}
      <div 
        ref={contentContainerRef}
        className={`flex-1 overflow-auto relative p-6 transition-all duration-300 ${
          flash 
            ? 'bg-emerald-500/[0.08] dark:bg-emerald-500/[0.04] ring-2 ring-emerald-500/30 dark:ring-emerald-400/20 shadow-inner' 
            : 'bg-slate-50/30 dark:bg-slate-950/10'
        }`}
      >
        
        {/* Loading Overlay */}
        {canvasLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/70 dark:bg-slate-900/75 backdrop-blur-xs z-10">
            <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin opacity-80" />
            <p className="mt-2 text-xs font-mono text-slate-500">Rendering visual canvas page...</p>
          </div>
        )}

        {/* Error Callouts */}
        {canvasError && (
          <div className="p-3 mb-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-md text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{canvasError}</span>
          </div>
        )}

        {viewMode === 'canvas' ? (
          <div className="flex justify-center items-start min-h-full">
            <div className="border border-slate-200 dark:border-slate-800 shadow-sm bg-white rounded-sm overflow-hidden p-1 max-w-full">
              <canvas ref={canvasRef} className="max-w-full h-auto block" />
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto font-sans leading-relaxed text-slate-700 dark:text-slate-300 select-text whitespace-pre-wrap selection:bg-emerald-200 dark:selection:bg-emerald-900/50">
            {/* Elegant Typographic Display */}
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50/5 dark:bg-emerald-900/5 border-l-2 border-emerald-500/30 rounded-r-md">
                <span className="text-[10px] uppercase tracking-wider font-mono text-emerald-600 dark:text-emerald-400 font-semibold block mb-1">
                  Verified Text Extraction &bull; Page {activePage}
                </span>
                <p className="text-xs text-slate-400 leading-normal">
                  You can copy text from clinical records directly. Key citation highlights are integrated inline.
                </p>
              </div>

              <div className="text-sm tracking-wide md:text-base leading-relaxed font-sans mt-4">
                {renderHighlightedText(getActivePageText())}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Highlighter Status Footer */}
      {highlightText && (
        <div className="px-4 py-2 bg-emerald-50/40 dark:bg-emerald-950/20 border-t border-emerald-100 dark:border-emerald-950 text-[11px] font-mono text-emerald-700 dark:text-emerald-400 flex items-center justify-between">
          <span className="truncate">Active locator: &ldquo;{highlightText}&rdquo;</span>
          <span className="flex-shrink-0 text-emerald-500 font-semibold uppercase text-[9px] tracking-wider ml-2 px-1 py-0.5 rounded-xs bg-emerald-100/50 dark:bg-emerald-950/60">Citation active</span>
        </div>
      )}
    </div>
  );
}
