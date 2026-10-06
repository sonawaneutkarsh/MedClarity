/**
 * Pure helpers for the answer flow: parsing the model's JSON, resolving
 * `[Document, p.N]` citations against the documents that are actually
 * loaded, splitting callout blocks, and correcting a document date.
 *
 * Nothing here touches the network or React, so it is covered by unit tests.
 */
import type { MedicalDocument, SourceFinding, TimelineEntry } from '../types';

export interface ParsedAnswer {
  finalAnswer: string;
  findings: SourceFinding[];
  conflicts: string;
}

const NO_CONFLICTS = 'No discrepancies reported.';

/**
 * Parses the JSON returned by the single question-answering call.
 * If the model returned something that is not JSON, the raw text is shown as the answer.
 */
export function parseAnswerJson(text: string): ParsedAnswer {
  const raw = (text || '').trim();
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(unfenced);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    const answer = [parsed.finalAnswer, parsed.answer, parsed.report].find(
      v => typeof v === 'string' && v.trim()
    );
    const findingsSource = Array.isArray(parsed.findings)
      ? parsed.findings
      : Array.isArray(parsed.subAnswers) ? parsed.subAnswers : [];
    const findings: SourceFinding[] = findingsSource
      .map((f: any) => ({
        docName: String(f?.docName ?? '').trim(),
        pageNumber: Number(f?.pageNumber),
        finding: String(f?.finding ?? f?.answer ?? '').trim(),
      }))
      .filter((f: SourceFinding) => f.docName && Number.isInteger(f.pageNumber) && f.pageNumber > 0 && f.finding);
    const conflicts = typeof parsed.conflicts === 'string' && parsed.conflicts.trim()
      ? parsed.conflicts.trim()
      : NO_CONFLICTS;
    return {
      finalAnswer: answer ? answer.trim() : 'The model returned no answer.',
      findings,
      conflicts,
    };
  } catch {
    return { finalAnswer: raw || 'The model returned no answer.', findings: [], conflicts: NO_CONFLICTS };
  }
}

/** Lower-case, drop a trailing ".pdf", and remove everything except letters and digits. */
export function normalizeDocName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9]/g, '');
}

export type CitationResolution =
  | { ok: true; docId: string; docName: string; pageNumber: number }
  | { ok: false; reason: 'unknown-document' | 'ambiguous-document' | 'page-out-of-range'; docName: string; pageNumber: number };

/**
 * Maps a cited document name + page to a loaded document.
 * 1. Exact match after normalization.
 * 2. Otherwise, a containment match is accepted only when exactly one document matches
 *    and the shorter name is at least 6 characters (so "a" cannot match everything).
 * The page must exist in that document.
 */
export function resolveCitation(
  docName: string,
  pageNumber: number,
  documents: Pick<MedicalDocument, 'id' | 'name' | 'pageCount'>[]
): CitationResolution {
  const target = normalizeDocName(docName);
  const fail = (reason: 'unknown-document' | 'ambiguous-document' | 'page-out-of-range') =>
    ({ ok: false as const, reason, docName, pageNumber });

  if (!target) return fail('unknown-document');

  let candidates = documents.filter(d => normalizeDocName(d.name) === target);
  if (candidates.length === 0) {
    candidates = documents.filter(d => {
      const n = normalizeDocName(d.name);
      const shorter = Math.min(n.length, target.length);
      return shorter >= 6 && (n.includes(target) || target.includes(n));
    });
  }

  if (candidates.length === 0) return fail('unknown-document');
  if (candidates.length > 1) return fail('ambiguous-document');

  const doc = candidates[0];
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.pageCount) {
    return fail('page-out-of-range');
  }
  return { ok: true, docId: doc.id, docName: doc.name, pageNumber };
}

export interface CitationToken {
  docName: string;
  pageNumber: number;
  raw: string;
}

export type TextSegment = { type: 'text'; text: string } | { type: 'citation'; citation: CitationToken };

const CITATION_RE = /\[([^\]\n]+?),\s*p(?:age|g)?\.?\s*(\d+)\]/gi;

/** Splits text into plain-text and `[Document, p.N]` citation segments. */
export function splitCitations(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(CITATION_RE)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ type: 'text', text: text.slice(last, index) });
    segments.push({
      type: 'citation',
      citation: { docName: match[1].trim(), pageNumber: parseInt(match[2], 10), raw: match[0] },
    });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });
  return segments;
}

/**
 * Rewrites citations as Markdown links with a `#cite-N` fragment so the Markdown renderer
 * can turn them into buttons. Returns the rewritten text and the citations in order.
 */
export function linkifyCitations(text: string): { markdown: string; citations: CitationToken[] } {
  const citations: CitationToken[] = [];
  const markdown = splitCitations(text)
    .map(seg => {
      if (seg.type === 'text') return seg.text;
      const i = citations.push(seg.citation) - 1;
      return `[${seg.citation.docName.replace(/[[\]]/g, '')}, p.${seg.citation.pageNumber}](#cite-${i})`;
    })
    .join('');
  return { markdown, citations };
}

export type AnswerBlock =
  | { kind: 'markdown'; text: string }
  | { kind: 'conflict' | 'trend'; text: string };

const CONFLICT_TAGS = /\[(?:ALERT:\s*)?(?:CONTRADICTION|DISCREPANCY) DETECTED\]/gi;
const TREND_TAGS = /\[(?:CHRONOLOGICAL )?TREND (?:DETECTED|IDENTIFIED)\]/gi;

/**
 * Splits an answer on blank lines and pulls out paragraphs tagged as conflicts or trends.
 * Consecutive untagged paragraphs stay together so Markdown lists and headings render normally.
 */
export function splitAnswerBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length) {
      blocks.push({ kind: 'markdown', text: buffer.join('\n\n') });
      buffer = [];
    }
  };

  for (const para of (text || '').split(/\n\s*\n/)) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    const isConflict = new RegExp(CONFLICT_TAGS.source, 'i').test(trimmed);
    const isTrend = !isConflict && new RegExp(TREND_TAGS.source, 'i').test(trimmed);
    if (isConflict || isTrend) {
      flush();
      const clean = trimmed
        .replace(CONFLICT_TAGS, '')
        .replace(TREND_TAGS, '')
        .replace(/^>\s?/gm, '')
        .trim();
      blocks.push({ kind: isConflict ? 'conflict' : 'trend', text: clean });
    } else {
      buffer.push(para.replace(/^\n+|\n+$/g, ''));
    }
  }
  flush();
  return blocks;
}

/**
 * Applies a corrected report date to a document's timeline.
 * Only entries that carried the old document date (the date the model fell back to)
 * move to the new date; events with their own distinct dates keep them.
 */
export function applyDocDateCorrection(
  entries: TimelineEntry[],
  oldDate: string,
  newDate: string
): TimelineEntry[] {
  const newEpoch = Date.parse(newDate);
  const oldEpoch = Date.parse(oldDate);
  return entries.map(entry => {
    const anchoredToOldDate =
      entry.date === oldDate ||
      entry.isoDate === oldDate ||
      (!Number.isNaN(oldEpoch) && entry.epochTime === oldEpoch);
    if (!anchoredToOldDate) return entry;
    return {
      ...entry,
      date: newDate,
      isoDate: newDate,
      epochTime: Number.isNaN(newEpoch) ? entry.epochTime : newEpoch,
    };
  });
}

export function countPages(documents: Pick<MedicalDocument, 'pageCount'>[]): number {
  return documents.reduce((n, d) => n + d.pageCount, 0);
}
