import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AnswerView from '../src/components/AnswerView';

const docs = [{ id: 'a', name: 'Lab_Report.pdf', pageCount: 2 }];
const render = (text: string) =>
  renderToStaticMarkup(<AnswerView text={text} documents={docs} onCitationClick={() => {}} />);

describe('AnswerView', () => {
  it('renders Markdown headings, bold text and lists instead of raw symbols', () => {
    const html = render('### Results\n\n**LDL** improved:\n\n- 155 mg/dL\n- 88 mg/dL');
    expect(html).toContain('<h4');
    expect(html).toContain('<strong>LDL</strong>');
    expect(html).toContain('<li>155 mg/dL</li>');
    expect(html).not.toContain('###');
    expect(html).not.toContain('**');
  });

  it('turns a valid citation into a button and strikes through an invalid one', () => {
    const html = render('Value [Lab_Report.pdf, p.2]. Other [Lab_Report.pdf, p.9]. Made up [Ghost.pdf, p.1].');
    expect(html.match(/<button/g)?.length).toBe(1);
    expect(html).toContain('title="Open Lab_Report.pdf, page 2"');
    expect(html.match(/citation-unresolved/g)?.length).toBe(2);
    expect(html).toContain('This page does not exist in the document');
    expect(html).toContain('No loaded document has this name');
  });

  it('renders conflict callouts with a label', () => {
    const html = render('[CONTRADICTION DETECTED] Allergy history differs [Lab_Report.pdf, p.1].');
    expect(html).toContain('Documents disagree');
    expect(html).not.toContain('CONTRADICTION DETECTED');
  });

  it('escapes raw HTML from the model', () => {
    const html = render('Hello <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
  });
});
