import { useEffect, useState } from 'react';
import { lookupMedicalDefinition } from '../lib/gemini';
import { BookOpen, RefreshCw, X, ShieldAlert } from 'lucide-react';

interface MedicalDictionaryPopupProps {
  term: string;
  context: string;
  x: number;
  y: number;
  apiKey: string;
  onClose: () => void;
}

export default function MedicalDictionaryPopup({
  term,
  context,
  x,
  y,
  apiKey,
  onClose
}: MedicalDictionaryPopupProps) {
  const [definition, setDefinition] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!term || !apiKey) return;

    let isCurrent = true;
    setIsLoading(true);
    setError(null);
    setDefinition('');

    lookupMedicalDefinition(apiKey, term, context)
      .then(def => {
        if (isCurrent) {
          setDefinition(def);
          setIsLoading(false);
        }
      })
      .catch(err => {
        console.error("Definition lookup failed", err);
        if (isCurrent) {
          setError("Definition lookup unavailable. Check API connectivity.");
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [term, apiKey, context]);

  // Adjust placement to keep inside bounds of screen slightly
  const style = {
    position: 'absolute' as 'absolute',
    left: `${Math.max(10, Math.min(x - 140, window.innerWidth - 300))}px`,
    top: `${y - 120}px`,
    zIndex: 50
  };

  return (
    <div
      style={style}
      className="w-72 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl p-3 text-xs select-none font-sans mt-2 transition-all duration-200 backdrop-blur-md"
    >
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-900 pb-2 mb-2">
        <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
          <BookOpen className="w-3.5 h-3.5" />
          <span className="font-mono text-[10px] uppercase font-bold tracking-wider">Clinical Definition</span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-0.5 rounded transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      <div className="text-slate-800 dark:text-slate-200">
        <span className="font-semibold block text-slate-900 dark:text-white mb-1">
          &ldquo;{term}&rdquo;
        </span>

        {isLoading ? (
          <div className="flex items-center gap-1.5 py-3 text-slate-500 font-mono text-[10px]">
            <RefreshCw className="w-3 h-3 text-emerald-500 animate-spin" />
            <span>Consulting clinical dictionary...</span>
          </div>
        ) : error ? (
          <div className="p-2 text-[10px] bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200/50 rounded text-rose-800 dark:text-rose-400 flex items-start gap-1">
            <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <p className="text-[11px] leading-relaxed dark:text-slate-300">
            {definition}
          </p>
        )}
      </div>

      <div className="mt-2 pt-1 border-t border-slate-100 dark:border-slate-900 text-[9px] font-mono text-slate-400">
        Highlight or click term again for new explanation
      </div>
    </div>
  );
}
