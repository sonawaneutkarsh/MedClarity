import { useState, useMemo } from 'react';
import { TimelineEntry } from '../types';
import { Calendar, Tag, FileText, ArrowUpDown, ShieldAlert, ArrowRight } from 'lucide-react';

interface TimelineViewProps {
  entries: TimelineEntry[];
  onNodeClick: (docId: string, pageNumber: number, textMatch: string) => void;
}

export default function TimelineView({ entries, onNodeClick }: TimelineViewProps) {
  const [filterType, setFilterType] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Filter & Sort entries
  const processedEntries = useMemo(() => {
    let result = [...entries];
    
    if (filterType !== 'all') {
      result = result.filter(item => item.type === filterType);
    }

    result.sort((a, b) => {
      const timeA = a.epochTime || 0;
      const timeB = b.epochTime || 0;
      return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
    });

    return result;
  }, [entries, filterType, sortOrder]);

  const getTagColor = (type: string) => {
    switch (type) {
      case 'clinical_finding':
        return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/30';
      case 'treatment':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30';
      case 'lab_result':
        return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-800/40';
    }
  };

  const getFriendlyLabel = (type: string) => {
    switch (type) {
      case 'clinical_finding': return 'Finding';
      case 'treatment': return 'Treatment';
      case 'lab_result': return 'Lab Result';
      default: return 'General';
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 p-6 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xs overflow-hidden">
      {/* Header filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4 mb-6">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 font-display flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-500" />
            <span>Chronological Medical Timeline</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Comparative patient timeline extracted automatically across all records.
          </p>
        </div>

        {/* Toolbar Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Node Category filter */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-2 py-1.5 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded text-xs focus:outline-hidden"
          >
            <option value="all">All Events</option>
            <option value="clinical_finding">Findings Only</option>
            <option value="treatment">Treatments Only</option>
            <option value="lab_result">Lab Results Only</option>
            <option value="general">General</option>
          </select>

          {/* Sort order toggle */}
          <button
            onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded text-xs transition-colors"
            title="Toggle sort direction"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            <span className="font-mono">{sortOrder === 'asc' ? 'Oldest First' : 'Newest First'}</span>
          </button>
        </div>
      </div>

      {/* Main Timeline Stream */}
      <div className="flex-1 overflow-y-auto pr-2 relative">
        {processedEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center h-48 text-slate-400 dark:text-slate-500">
            <ShieldAlert className="w-10 h-10 mb-2 opacity-30 stroke-[1.5]" />
            <p className="text-xs font-semibold">No Chronological Data Available</p>
            <p className="text-[10px] opacity-70 mt-1 max-w-[200px]">
              Upload PDFs with clinical text content to view their structured medical progression over time.
            </p>
          </div>
        ) : (
          <div className="relative border-l border-slate-200 dark:border-slate-800 ml-4 pl-6 space-y-6">
            {processedEntries.map((entry, idx) => {
              const cleanedTextMatch = entry.event ? entry.event.split(' ')[0] || '' : '';
              
              return (
                <div
                  key={`${entry.sourceDocId}-${idx}`}
                  onClick={() => onNodeClick(entry.sourceDocId, entry.pageNumber, entry.event)}
                  className="group relative cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/20 p-3 rounded-lg border border-transparent hover:border-slate-200 dark:hover:border-slate-800/60 transition-all duration-200"
                >
                  {/* Timeline bullet dot */}
                  <div className="absolute -left-[31px] top-4 w-2.5 h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 group-hover:bg-emerald-500 border-2 border-white dark:border-slate-900 group-hover:border-emerald-250 ring-2 ring-transparent group-hover:ring-emerald-500/10 transition-all" />

                  {/* Header Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
                        {entry.date}
                      </span>
                      <span className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full border ${getTagColor(entry.type)}`}>
                        {getFriendlyLabel(entry.type)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400 dark:text-slate-500">
                      <FileText className="w-3 h-3" />
                      <span className="truncate max-w-[120px]" title={entry.sourceDocName}>
                        {entry.sourceDocName}
                      </span>
                      <span>p.{entry.pageNumber}</span>
                    </div>
                  </div>

                  {/* Body Occurrence summary */}
                  <p className="text-xs text-slate-700 dark:text-slate-300 font-sans leading-relaxed mt-2 pl-0.5">
                    {entry.event}
                  </p>

                  {/* Immediate Cite link hover indicator */}
                  <div className="flex items-center gap-1 text-[10px] font-mono text-emerald-600 dark:text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity duration-150 mt-1 pl-0.5">
                    <span>Jump to documentation source</span>
                    <ArrowRight className="w-2.5 h-2.5" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
