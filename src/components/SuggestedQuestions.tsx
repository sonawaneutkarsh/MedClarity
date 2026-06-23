import { Sparkles, HelpCircle, ArrowRight } from 'lucide-react';

interface SuggestedQuestionsProps {
  questions: string[];
  onQuestionClick: (question: string) => void;
  isLoading?: boolean;
}

export default function SuggestedQuestions({
  questions,
  onQuestionClick,
  isLoading = false
}: SuggestedQuestionsProps) {
  if (questions.length === 0) return null;

  return (
    <div className="bg-slate-100/60 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-lg p-3.5 font-sans mb-4 transition-all hover:bg-slate-100/80">
      <div className="flex items-center gap-2 mb-2.5">
        <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 animate-glow" />
        <h4 className="text-[10px] font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider font-mono">
          Suggested Inquiries
        </h4>
        {isLoading && (
          <span className="text-[9px] text-slate-500 dark:text-slate-400 font-mono animate-pulse">
            (Updating...)
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {questions.map((q, idx) => (
          <button
            key={idx}
            onClick={() => onQuestionClick(q)}
            className="flex items-start text-left p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 hover:border-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-400 dark:hover:border-emerald-700/80 rounded-md text-slate-900 dark:text-slate-100 text-[11px] hover:bg-slate-50/50 shadow-2xs group transition-all duration-150 active:scale-[0.995] cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5 mr-2 text-slate-500 dark:text-slate-400 group-hover:text-emerald-500 dark:group-hover:text-emerald-400 flex-shrink-0 mt-0.5 transition-colors" />
            <div className="flex-1 min-w-0 pr-1">
              <p className="leading-snug font-medium">
                {q}
              </p>
            </div>
            <ArrowRight className="w-3 h-3 text-slate-400 dark:text-slate-600 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 flex-shrink-0 mt-0.5 transition-all duration-150" />
          </button>
        ))}
      </div>
    </div>
  );
}
