import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import { Activity, CircleAlert as AlertCircle } from 'lucide-react';
import type { MedicalDocument } from '../types';
import { linkifyCitations, resolveCitation, splitAnswerBlocks, type CitationToken } from '../lib/answer';

interface AnswerViewProps {
  text: string;
  documents: Pick<MedicalDocument, 'id' | 'name' | 'pageCount'>[];
  onCitationClick: (docId: string, pageNumber: number, citation: CitationToken) => void;
}

const UNRESOLVED_REASON: Record<string, string> = {
  'unknown-document': 'No loaded document has this name',
  'ambiguous-document': 'This name matches more than one loaded document',
  'page-out-of-range': 'This page does not exist in the document',
};

/**
 * Renders a model answer as Markdown. Inline `[Document, p.N]` citations become buttons
 * when they resolve to a loaded document and an existing page; otherwise they are shown
 * struck through so an invented citation is visible instead of silently clickable.
 */
export default function AnswerView({ text, documents, onCitationClick }: AnswerViewProps) {
  const blocks = splitAnswerBlocks(text);

  const renderMarkdown = (source: string) => {
    const { markdown, citations } = linkifyCitations(source);

    const components: Components = {
      a({ href, children }) {
        const match = href?.match(/^#cite-(\d+)$/);
        if (!match) {
          return <a href={href} target="_blank" rel="noreferrer noopener" className="underline">{children}</a>;
        }
        const citation = citations[Number(match[1])];
        const label = `${citation.docName}, p.${citation.pageNumber}`;
        const resolved = resolveCitation(citation.docName, citation.pageNumber, documents);
        if (!resolved.ok) {
          return (
            <span
              className="citation-unresolved mx-0.5 px-1.5 py-0.5 text-[10px] font-mono rounded border border-dashed border-slate-300 dark:border-slate-700 text-slate-400 line-through"
              title={`Unverified citation: ${UNRESOLVED_REASON[resolved.reason]}`}
            >
              {label}
            </span>
          );
        }
        return (
          <button
            type="button"
            onClick={() => onCitationClick(resolved.docId, resolved.pageNumber, citation)}
            className="citation-link py-0.5 px-1.5 leading-none mx-0.5 bg-slate-100 hover:bg-emerald-100 dark:bg-slate-800 dark:hover:bg-emerald-950 text-[10px] text-slate-700 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-300 font-medium font-mono rounded border border-slate-200/50 dark:border-slate-700 transition-colors inline-flex items-center"
            title={`Open ${resolved.docName}, page ${resolved.pageNumber}`}
          >
            {label}
          </button>
        );
      },
      h1: ({ children }) => <h3 className="text-sm font-bold mt-3 mb-1">{children}</h3>,
      h2: ({ children }) => <h3 className="text-sm font-bold mt-3 mb-1">{children}</h3>,
      h3: ({ children }) => <h4 className="text-xs font-bold mt-3 mb-1 uppercase tracking-wide">{children}</h4>,
      h4: ({ children }) => <h4 className="text-xs font-bold mt-2 mb-1">{children}</h4>,
      p: ({ children }) => <p className="text-xs leading-relaxed my-2">{children}</p>,
      ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1 text-xs">{children}</ul>,
      ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1 text-xs">{children}</ol>,
      blockquote: ({ children }) => (
        <blockquote className="border-l-2 border-slate-300 dark:border-slate-700 pl-3 my-2 text-slate-600 dark:text-slate-300">{children}</blockquote>
      ),
      code: ({ children }) => <code className="font-mono text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded">{children}</code>,
    };

    return (
      <Markdown
        components={components}
        urlTransform={url => (url.startsWith('#cite-') ? url : defaultUrlTransform(url))}
      >
        {markdown}
      </Markdown>
    );
  };

  return (
    <div className="answer-view text-slate-700 dark:text-slate-200">
      {blocks.map((block, i) => {
        if (block.kind === 'markdown') {
          return <div key={i}>{renderMarkdown(block.text)}</div>;
        }
        const isConflict = block.kind === 'conflict';
        return (
          <div
            key={i}
            className={`p-3 my-3 border-l-4 rounded-r-lg ${isConflict
              ? 'bg-rose-50/70 dark:bg-rose-950/20 border-rose-500'
              : 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-500'}`}
          >
            <div className={`flex items-center gap-2 font-bold text-[11px] uppercase ${isConflict ? 'text-rose-800 dark:text-rose-400' : 'text-emerald-800 dark:text-emerald-400'}`}>
              {isConflict
                ? <AlertCircle className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
                : <Activity className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
              <span>{isConflict ? 'Documents disagree' : 'Change over time'}</span>
            </div>
            {renderMarkdown(block.text)}
          </div>
        );
      })}
    </div>
  );
}
