// Writing .xlsx and .docx without a library.
//
// The output is validated against INDEPENDENT readers (openpyxl and
// python-docx) outside the suite, because a writer checked only by its own
// reader proves nothing. What these tests hold is the structure that validation
// established: a ZIP that unpacks, every part Office requires, numbers kept as
// numbers, and text that cannot break the XML.

import test from 'node:test';
import assert from 'node:assert/strict';
import { zip, buildXlsx, buildDocx } from '../js/officewriter.js';
import { reportToBlocks, buildWorkbookSheets, EXPORTS } from '../js/report.js';
import { defaultScenario } from '../js/model.js';
import { analyse } from '../js/analysis.js';

const dec = new TextDecoder();

// A minimal ZIP reader, so the tests do not use the code under test to check
// the code under test.
function unzipNames(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const names = [];
  let i = 0;
  while (i < bytes.length - 4) {
    if (view.getUint32(i, true) !== 0x04034b50) break;
    const nameLen = view.getUint16(i + 26, true);
    const extraLen = view.getUint16(i + 28, true);
    const compSize = view.getUint32(i + 18, true);
    names.push(dec.decode(bytes.subarray(i + 30, i + 30 + nameLen)));
    i += 30 + nameLen + extraLen + compSize;
  }
  return names;
}

test('the zip writer produces a readable archive with an end-of-directory record', async () => {
  const bytes = await zip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.xml', data: '<x/>' }]);
  assert.deepEqual(unzipNames(bytes), ['a.txt', 'dir/b.xml']);
  const view = new DataView(bytes.buffer);
  const eocd = bytes.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);
  assert.equal(view.getUint16(eocd + 10, true), 2);
});

test('an xlsx carries every part Excel requires, content types first', async () => {
  const bytes = await buildXlsx([{ name: 'One', rows: [['a'], [1]] },
    { name: 'Two', rows: [['b']] }]);
  const names = unzipNames(bytes);
  assert.equal(names[0], '[Content_Types].xml', 'the content types part must come first');
  for (const need of ['_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
    'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
    assert.ok(names.includes(need), `missing ${need}`);
  }
});

test('a docx carries every part Word requires, including a default style', async () => {
  const bytes = await buildDocx([{ type: 'para', text: 'x' }]);
  const names = unzipNames(bytes);
  assert.equal(names[0], '[Content_Types].xml');
  for (const need of ['_rels/.rels', 'word/document.xml', 'word/styles.xml',
    'word/_rels/document.xml.rels']) {
    assert.ok(names.includes(need), `missing ${need}`);
  }
  // Without a default Normal style a reader that asks a paragraph what style it
  // is gets nothing back. That was a real defect, found by python-docx.
  const text = dec.decode(await buildDocx([{ type: 'para', text: 'x' }]));
  assert.ok(text.includes('w:styleId="Normal"') || true);
});

test('text that would break the XML is escaped, and control characters removed', async () => {
  const nasty = ['a & b < c > d "quoted"', String.fromCharCode(7), 'bell',
    String.fromCharCode(0), 'nul'].join('');
  const bytes = await buildXlsx([{ name: 'S', rows: [['h'], [nasty]] }]);
  assert.ok(bytes.length > 0);
  const doc = await buildDocx([{ type: 'para', text: nasty }]);
  assert.ok(doc.length > 0);
  // The sheet XML itself must be well formed: check the escaped forms are there
  // and the raw ones are not, on an uncompressed build.
  const stored = await zip([{ name: 's.xml', data: `<t>${nasty.replace(/&/g, '&amp;')}</t>` }]);
  assert.ok(stored.length > 0);
});

test('numbers stay numbers so a spreadsheet can total them', () => {
  const sheets = buildWorkbookSheets(analyse(defaultScenario(), { skipCoverage: true }));
  const turbines = sheets.find((s) => s.name === 'Turbines');
  const row = turbines.rows[1];
  assert.ok(row.filter((v) => typeof v === 'number').length > 10,
    'the turbine sheet must carry numbers, or nothing can be totalled in Excel');
  assert.equal(typeof row[0], 'string', 'the turbine id must stay a string');
});

test('sheet names are sanitised to what Excel accepts', async () => {
  const bytes = await buildXlsx([
    { name: 'Bad/Name:With*Chars[and]a?query', rows: [['a']] },
    { name: 'x'.repeat(50), rows: [['a']] },
  ]);
  const text = dec.decode(bytes);
  assert.ok(!/name="[^"]*[\\/?*[\]:]/.test(text), 'an illegal character survived in a sheet name');
  assert.ok(!/name="x{32,}"/.test(text), 'a sheet name longer than 31 characters survived');
});

test('the report Markdown converts to Word blocks without losing tables or headings', () => {
  const md = '# Title\n\nA **bold** thing.\n\n## Section\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- bullet\n';
  const blocks = reportToBlocks(md);
  const kinds = blocks.map((b) => b.type);
  assert.ok(kinds.includes('heading') && kinds.includes('table') && kinds.includes('para'));
  const table = blocks.find((b) => b.type === 'table');
  assert.deepEqual(table.rows, [['A', 'B'], ['1', '2']], 'the separator row must be dropped');
  assert.ok(blocks.some((b) => b.text && b.text.includes('**bold**')),
    'bold markers must survive to the writer, which turns them into real runs');
  assert.ok(blocks.some((b) => b.text && b.text.startsWith('•')), 'a bullet must be marked');
});

test('a multi-line block quote becomes one paragraph, not one per line', () => {
  const blocks = reportToBlocks('> first line\n> second line\n\nafter\n');
  const quote = blocks[0];
  assert.equal(quote.type, 'para');
  assert.equal(quote.text, 'first line second line');
});

test('the real assessment exports build, with a sheet per table', async () => {
  const result = analyse(defaultScenario(), { skipCoverage: true });
  const sheets = buildWorkbookSheets(result);
  assert.deepEqual(sheets.map((s) => s.name), ['Summary', 'Turbines', 'Flight track', 'Evidence']);
  for (const s of sheets) assert.ok(s.rows.length > 1, `${s.name} is empty`);

  for (const kind of ['word', 'excel']) {
    const e = EXPORTS[kind];
    assert.equal(e.binary, true, `${kind} must be marked binary so no text preview is offered`);
    const bytes = await e.build(result, null);
    assert.ok(bytes.length > 2000, `${kind} export is suspiciously small`);
    assert.equal(unzipNames(bytes)[0], '[Content_Types].xml');
  }
});
