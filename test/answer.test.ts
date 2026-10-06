import { describe, expect, it } from 'vitest';
import {
  applyDocDateCorrection,
  linkifyCitations,
  normalizeDocName,
  parseAnswerJson,
  resolveCitation,
  splitAnswerBlocks,
  splitCitations,
} from '../src/lib/answer';
import { SAMPLE_DOCUMENTS } from '../src/sampleData';
import type { TimelineEntry } from '../src/types';

const docs = [
  { id: 'a', name: 'Apex_Cardiology_Summary_Doe_John.pdf', pageCount: 3 },
  { id: 'b', name: 'Apex_Cardiology_90_Day_Lipid_Panel_Doe.pdf', pageCount: 2 },
];

describe('parseAnswerJson', () => {
  it('parses the structured answer and keeps only well-formed findings', () => {
    const text = JSON.stringify({
      finalAnswer: 'LDL fell [Apex_Cardiology_90_Day_Lipid_Panel_Doe.pdf, p.2].',
      findings: [
        { docName: 'Apex_Cardiology_90_Day_Lipid_Panel_Doe.pdf', pageNumber: 2, finding: 'LDL 88 mg/dL' },
        { docName: '', pageNumber: 1, finding: 'no doc' },
        { docName: 'x.pdf', pageNumber: 0, finding: 'bad page' },
        { docName: 'x.pdf', pageNumber: 1.5, finding: 'fractional page' },
      ],
      conflicts: 'Statin dose differs.',
    });
    const parsed = parseAnswerJson(text);
    expect(parsed.finalAnswer).toContain('LDL fell');
    expect(parsed.findings).toEqual([
      { docName: 'Apex_Cardiology_90_Day_Lipid_Panel_Doe.pdf', pageNumber: 2, finding: 'LDL 88 mg/dL' },
    ]);
    expect(parsed.conflicts).toBe('Statin dose differs.');
  });

  it('accepts a fenced JSON block and the older subAnswers shape', () => {
    const text = '```json\n' + JSON.stringify({
      answer: 'ok',
      subAnswers: [{ docName: 'd.pdf', pageNumber: 1, answer: 'fact' }],
    }) + '\n```';
    const parsed = parseAnswerJson(text);
    expect(parsed.finalAnswer).toBe('ok');
    expect(parsed.findings).toEqual([{ docName: 'd.pdf', pageNumber: 1, finding: 'fact' }]);
    expect(parsed.conflicts).toBe('No discrepancies reported.');
  });

  it('falls back to the raw text when the model did not return JSON', () => {
    const parsed = parseAnswerJson('Plain text answer [d.pdf, p.1]');
    expect(parsed.finalAnswer).toBe('Plain text answer [d.pdf, p.1]');
    expect(parsed.findings).toEqual([]);
  });

  it('does not show an empty answer', () => {
    expect(parseAnswerJson('').finalAnswer).toBe('The model returned no answer.');
    expect(parseAnswerJson('{"findings": []}').finalAnswer).toBe('The model returned no answer.');
    expect(parseAnswerJson('[1,2]').finalAnswer).toBe('[1,2]');
  });
});

describe('splitCitations', () => {
  it('finds multiple citations and keeps the text between them', () => {
    const segs = splitCitations('BP 145/92 [Doc A.pdf, p.1] then 128/80 [Doc B.pdf, p.2].');
    expect(segs.map(s => s.type)).toEqual(['text', 'citation', 'text', 'citation', 'text']);
    expect(segs[1]).toMatchObject({ citation: { docName: 'Doc A.pdf', pageNumber: 1 } });
    expect(segs[3]).toMatchObject({ citation: { docName: 'Doc B.pdf', pageNumber: 2 } });
  });

  it('handles document names that contain commas', () => {
    const segs = splitCitations('See [Smith, John - Labs.pdf, p.3]');
    expect(segs[1]).toMatchObject({ citation: { docName: 'Smith, John - Labs.pdf', pageNumber: 3 } });
  });

  it('accepts "page N" and "pg. N" variants', () => {
    expect(splitCitations('[Doc, page 4]')[0]).toMatchObject({ citation: { pageNumber: 4 } });
    expect(splitCitations('[Doc, pg. 5]')[0]).toMatchObject({ citation: { pageNumber: 5 } });
  });

  it('returns a single text segment when there are no citations', () => {
    expect(splitCitations('No sources here [just brackets].')).toEqual([
      { type: 'text', text: 'No sources here [just brackets].' },
    ]);
  });
});

describe('linkifyCitations', () => {
  it('turns citations into #cite-N links in order', () => {
    const { markdown, citations } = linkifyCitations('A [X.pdf, p.1] and B [Y.pdf, p.2]');
    expect(markdown).toBe('A [X.pdf, p.1](#cite-0) and B [Y.pdf, p.2](#cite-1)');
    expect(citations.map(c => c.docName)).toEqual(['X.pdf', 'Y.pdf']);
  });
});

describe('resolveCitation', () => {
  it('matches exact names regardless of case, punctuation and .pdf', () => {
    expect(normalizeDocName('Apex_Cardiology_Summary_Doe_John.PDF')).toBe('apexcardiologysummarydoejohn');
    expect(resolveCitation('apex cardiology summary doe john', 2, docs)).toEqual({
      ok: true, docId: 'a', docName: 'Apex_Cardiology_Summary_Doe_John.pdf', pageNumber: 2,
    });
  });

  it('accepts a unique partial name', () => {
    expect(resolveCitation('90 Day Lipid Panel', 1, docs)).toMatchObject({ ok: true, docId: 'b' });
  });

  it('rejects names that match several documents', () => {
    expect(resolveCitation('Apex Cardiology', 1, docs)).toMatchObject({ ok: false, reason: 'ambiguous-document' });
  });

  it('rejects very short names instead of matching everything', () => {
    expect(resolveCitation('Doe', 1, docs)).toMatchObject({ ok: false, reason: 'unknown-document' });
  });

  it('rejects unknown documents and pages that do not exist', () => {
    expect(resolveCitation('Discharge Summary.pdf', 1, docs)).toMatchObject({ ok: false, reason: 'unknown-document' });
    expect(resolveCitation('Apex_Cardiology_90_Day_Lipid_Panel_Doe.pdf', 3, docs)).toMatchObject({ ok: false, reason: 'page-out-of-range' });
    expect(resolveCitation('Apex_Cardiology_90_Day_Lipid_Panel_Doe.pdf', 0, docs)).toMatchObject({ ok: false, reason: 'page-out-of-range' });
  });

  it('resolves every page of the bundled sample documents', () => {
    for (const d of SAMPLE_DOCUMENTS) {
      for (const p of d.pages) {
        expect(resolveCitation(d.name, p.pageNumber, SAMPLE_DOCUMENTS)).toMatchObject({ ok: true, docId: d.id });
      }
    }
  });
});

describe('splitAnswerBlocks', () => {
  it('separates conflict and trend callouts and keeps Markdown together', () => {
    const text = [
      '### Summary',
      '- item one\n- item two',
      '[CONTRADICTION DETECTED] Allergy history differs [A.pdf, p.1].',
      '> [TREND IDENTIFIED] LDL fell from 155 to 88.',
      'Closing paragraph.',
    ].join('\n\n');
    const blocks = splitAnswerBlocks(text);
    expect(blocks.map(b => b.kind)).toEqual(['markdown', 'conflict', 'trend', 'markdown']);
    expect(blocks[0].text).toBe('### Summary\n\n- item one\n- item two');
    expect(blocks[1].text).toBe('Allergy history differs [A.pdf, p.1].');
    expect(blocks[2].text).toBe('LDL fell from 155 to 88.');
  });

  it('recognizes the ALERT: variants', () => {
    expect(splitAnswerBlocks('[ALERT: DISCREPANCY DETECTED] x')[0].kind).toBe('conflict');
    expect(splitAnswerBlocks('[CHRONOLOGICAL TREND DETECTED] y')[0].kind).toBe('trend');
  });
});

describe('applyDocDateCorrection', () => {
  const entry = (date: string, event: string): TimelineEntry => ({
    date, isoDate: date, event, sourceDocId: 'a', sourceDocName: 'A.pdf', pageNumber: 1,
    type: 'general', epochTime: Date.parse(date),
  });

  it('moves only the events that carried the old document date', () => {
    const entries = [entry('2026-03-12', 'Visit'), entry('2026-03-10', 'Lab draw'), entry('2026-06-01', 'Follow-up')];
    const result = applyDocDateCorrection(entries, '2026-03-12', '2026-03-14');
    expect(result.map(e => e.date)).toEqual(['2026-03-14', '2026-03-10', '2026-06-01']);
    expect(result[0].epochTime).toBe(Date.parse('2026-03-14'));
    expect(result[1]).toBe(entries[1]);
  });

  it('keeps distinct events distinct (regression: all entries used to collapse to one date)', () => {
    const entries = [entry('2026-01-05', 'A'), entry('2026-02-05', 'B')];
    const result = applyDocDateCorrection(entries, '2026-03-12', '2026-04-01');
    expect(new Set(result.map(e => e.date)).size).toBe(2);
  });
});
