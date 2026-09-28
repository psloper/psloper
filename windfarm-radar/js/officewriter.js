// Writing Office files, in the page, with no library.
//
// The tool already READS .xlsx by treating it as what it is: a ZIP of XML,
// unpacked with the platform's own DecompressionStream. Writing is the same
// trick in reverse, with CompressionStream. That keeps this a static, offline,
// dependency-free drop, which is the whole point of it.
//
// What is produced is deliberately minimal but VALID: no charts, no themes, a
// bold header row and nothing else. Both formats were checked by opening the
// output in LibreOffice and converting it back out, not by inspection.

// --------------------------------------------------------------------- zip

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  // Store the entry uncompressed where the platform has no CompressionStream.
  // A stored ZIP is still a valid ZIP and Office opens it.
  if (typeof CompressionStream === 'undefined') return null;
  const cs = new CompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const enc = new TextEncoder();

/**
 * Build a ZIP from [{ name, data }], data being a string or Uint8Array.
 * No directory entries and no zip64: an Office file has a handful of small
 * members and needs neither.
 */
export async function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const raw = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const name = enc.encode(e.name);
    const deflated = await deflateRaw(raw);
    const useDeflate = deflated !== null && deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0, true);
    local.setUint16(8, method, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, 0x21, true);       // 1980-01-01, so output is reproducible
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, body);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0, true);
    cd.setUint16(10, method, true);
    cd.setUint16(12, 0, true);
    cd.setUint16(14, 0x21, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);

    offset += 30 + name.length + body.length;
  }

  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);

  const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

// -------------------------------------------------------------------- xml

// Control characters are illegal in XML 1.0 and Excel refuses the whole file
// rather than skipping the cell, so they are stripped here.
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');

const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(CONTROL, '');

import { AUTHOR } from './authorship.js';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// --------------------------------------------------- document properties
//
// Word and Excel read the author from docProps/core.xml, so an exported
// report carries its developer inside the file and not only in the visible
// text. Both packages get the same part.

const CORE_CT = '<Override PartName="/docProps/core.xml" '
  + 'ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>';
const CORE_REL = '<Relationship Id="rIdCore" '
  + 'Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" '
  + 'Target="docProps/core.xml"/>';

function corePropsPart() {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const who = esc(AUTHOR.organisation ? `${AUTHOR.name}, ${AUTHOR.organisation}` : AUTHOR.name);
  return {
    name: 'docProps/core.xml',
    data: XML + '<cp:coreProperties '
      + 'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
      + 'xmlns:dc="http://purl.org/dc/elements/1.1/" '
      + 'xmlns:dcterms="http://purl.org/dc/terms/" '
      + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
      + `<dc:creator>${who}</dc:creator>`
      + `<cp:lastModifiedBy>${who}</cp:lastModifiedBy>`
      + '<dc:title>Wind farm / radar screening assessment</dc:title>'
      + `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>`
      + `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>`
      + '</cp:coreProperties>',
  };
}

// ------------------------------------------------------------------- xlsx

function colName(i) {
  let s = '';
  let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

/**
 * A picture in an Office document is four things in different places: the
 * bytes as a package part, a relationship pointing at them, a content type for
 * the extension, and a drawing element in the document that references the
 * relationship. Miss any one and the file opens with a broken-image box or
 * fails to open at all, so the helpers below keep the four together.
 *
 * Office measures pictures in EMU, 914400 to the inch. At the 96 dpi a browser
 * canvas reports, one pixel is 9525 EMU.
 */
const EMU_PER_PX = 9525;

/** Fit an image inside a width in pixels, keeping its aspect ratio. */
function fitPx(img, maxWidthPx) {
  const w = Math.max(1, img.widthPx || 640);
  const h = Math.max(1, img.heightPx || 360);
  if (w <= maxWidthPx) return { w, h };
  return { w: maxWidthPx, h: Math.max(1, Math.round((h * maxWidthPx) / w)) };
}

function sheetXml(rows, hasDrawing) {
  const body = rows.map((row, r) => {
    const cells = row.map((v, c) => {
      const ref = colName(c) + (r + 1);
      const style = r === 0 ? ' s="1"' : '';
      if (v === null || v === undefined || v === '') return `<c r="${ref}"${style}/>`;
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
      return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  // <drawing> must come AFTER <sheetData>; the schema is a sequence and Excel
  // refuses a file that puts it first.
  const drawing = hasDrawing ? `<drawing xmlns:r="${rel}" r:id="rIdDraw"/>` : '';
  return XML + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<sheetData>${body}</sheetData>${drawing}</worksheet>`;
}

/**
 * Build an .xlsx from [{ name, rows }]. The first row of each sheet is bold.
 * Numbers are written as numbers so Excel can total them; everything else goes
 * in as an inline string, which avoids a shared-string table entirely.
 */
export async function buildXlsx(sheets) {
  const safe = sheets.map((s, i) => ({
    // Excel rejects these characters in a sheet name and truncates past 31.
    name: (s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31),
    rows: s.rows,
    images: (s.images || []).filter((im) => im && im.png && im.png.length),
  }));
  // One flat media list across the workbook, because a package part name has
  // to be unique whatever sheet points at it.
  const media = [];
  for (const sh of safe) {
    sh.rels = sh.images.map((im) => {
      media.push(im.png);
      return { file: `image${media.length}.png`, im };
    });
  }
  const anyImages = media.length > 0;
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

  return zip([
    { name: '[Content_Types].xml',
      data: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/>`
        + `<Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/>`
        + (anyImages ? '<Default Extension="png" ContentType="image/png"/>' : '')
        + safe.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" `
          + `ContentType="${ct}.worksheet+xml"/>`).join('')
        + safe.map((sh, i) => (sh.rels.length
          ? `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/`
            + 'vnd.openxmlformats-officedocument.drawing+xml"/>'
          : '')).join('')
        + CORE_CT + '</Types>' },
    { name: '_rels/.rels',
      data: XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + `<Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/>`
        + CORE_REL + '</Relationships>' },
    corePropsPart(),
    { name: 'xl/workbook.xml',
      data: XML + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        + `xmlns:r="${rel}"><sheets>`
        + safe.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
        + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels',
      data: XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + safe.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" `
          + `Target="worksheets/sheet${i + 1}.xml"/>`).join('')
        + `<Relationship Id="rId${safe.length + 1}" Type="${rel}/styles" Target="styles.xml"/>`
        + '</Relationships>' },
    { name: 'xl/styles.xml',
      data: XML + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
        + '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        + '<fills count="2"><fill><patternFill patternType="none"/></fill>'
        + '<fill><patternFill patternType="gray125"/></fill></fills>'
        + '<borders count="1"><border/></borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
        // Without a declared default style, readers warn and substitute their own.
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + '</styleSheet>' },
    ...safe.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows, s.rels.length > 0),
    })),
    // A sheet that carries pictures needs its own rels file pointing at its
    // drawing, and the drawing needs rels pointing at the media.
    ...safe.flatMap((sh, i) => (sh.rels.length ? [
      { name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        data: XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
          + 'relationships">'
          + `<Relationship Id="rIdDraw" Type="${rel}/drawing" `
          + `Target="../drawings/drawing${i + 1}.xml"/></Relationships>` },
      { name: `xl/drawings/drawing${i + 1}.xml`, data: drawingXml(sh.rels) },
      { name: `xl/drawings/_rels/drawing${i + 1}.xml.rels`,
        data: XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
          + 'relationships">'
          + sh.rels.map((r, k) => `<Relationship Id="rId${k + 1}" Type="${rel}/image" `
            + `Target="../media/${r.file}"/>`).join('')
          + '</Relationships>' },
    ] : [])),
    ...media.map((png, i) => ({ name: `xl/media/image${i + 1}.png`, data: png })),
  ]);
}

/**
 * A spreadsheet drawing, one picture per anchor.
 *
 * oneCellAnchor pins the top-left to a cell and then gives an absolute size,
 * which is what keeps a chart image the shape it was rendered at. twoCellAnchor
 * would stretch it to whatever the column widths happen to be.
 */
function drawingXml(rels) {
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const xdr = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
  const rns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const body = rels.map((r, k) => {
    const { w, h } = fitPx(r.im, 900);
    const row = Math.max(0, r.im.anchorRow || 0);
    const col = Math.max(0, r.im.anchorCol || 0);
    return '<xdr:oneCellAnchor>'
      + `<xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff>`
      + `<xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
      + `<xdr:ext cx="${w * EMU_PER_PX}" cy="${h * EMU_PER_PX}"/>`
      + '<xdr:pic><xdr:nvPicPr>'
      + `<xdr:cNvPr id="${k + 2}" name="${esc(r.im.name || `Picture ${k + 1}`)}"`
      + `${r.im.caption ? ` descr="${esc(r.im.caption)}"` : ''}/>`
      + '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>'
      + `<xdr:blipFill><a:blip xmlns:r="${rns}" r:embed="rId${k + 1}"/>`
      + '<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>'
      + '<xdr:spPr><a:xfrm><a:off x="0" y="0"/>'
      + `<a:ext cx="${w * EMU_PER_PX}" cy="${h * EMU_PER_PX}"/></a:xfrm>`
      + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>'
      + '</xdr:pic><xdr:clientData/></xdr:oneCellAnchor>';
  }).join('');
  return XML + `<xdr:wsDr xmlns:xdr="${xdr}" xmlns:a="${a}">${body}</xdr:wsDr>`;
}

// ------------------------------------------------------------------- docx

function run(text, bold) {
  return '<w:r>' + (bold ? '<w:rPr><w:b/></w:rPr>' : '')
    + `<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

// Bold spans written **like this** become real bold runs rather than literal
// asterisks, because the report text this is built from is Markdown.
function inlineRuns(text) {
  const out = [];
  const re = /\*\*(.+?)\*\*/g;
  let i = 0;
  let m = re.exec(text);
  while (m) {
    if (m.index > i) out.push(run(text.slice(i, m.index), false));
    out.push(run(m[1], true));
    i = m.index + m[0].length;
    m = re.exec(text);
  }
  if (i < text.length) out.push(run(text.slice(i), false));
  return out.join('') || run('', false);
}

function para(text, style) {
  const pr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${pr}${inlineRuns(text || '')}</w:p>`;
}

function table(rows) {
  const width = Math.max(...rows.map((r) => r.length));
  const w = Math.floor(9000 / width);
  const grid = '<w:tblGrid>' + Array.from({ length: width },
    () => `<w:gridCol w:w="${w}"/>`).join('') + '</w:tblGrid>';
  const body = rows.map((row, r) => '<w:tr>' + Array.from({ length: width },
    (_, c) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>`
      + `<w:p>${run(row[c] === undefined ? '' : row[c], r === 0)}</w:p></w:tc>`).join('')
    + '</w:tr>').join('');
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((s) => `<w:${s} w:val="single" w:sz="4" w:color="999999"/>`).join('');
  return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>'
    + `<w:tblBorders>${borders}</w:tblBorders></w:tblPr>${grid}${body}</w:tbl>`;
}

/**
 * One picture, inline in its own paragraph, with the caption beneath it.
 *
 * An A4 page here has 800 twentieths-of-a-point of margin each side, leaving
 * about 6.6 inches of text width, so pictures are fitted to 630 px at 96 dpi
 * rather than overflowing the page.
 */
function imagePara(b) {
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const pic = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
  const wp = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const rns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const { w, h } = fitPx(b, 630);
  const cx = w * EMU_PER_PX;
  const cy = h * EMU_PER_PX;
  const name = esc(b.name || 'Figure');
  const drawing = '<w:drawing>'
    + `<wp:inline xmlns:wp="${wp}" distT="0" distB="0" distL="0" distR="0">`
    + `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`
    + `<wp:docPr id="${(b.__rel.file.match(/\d+/) || [1])[0]}" name="${name}"`
    + `${b.caption ? ` descr="${esc(b.caption)}"` : ''}/>`
    + `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${a}" noChangeAspect="1"/>`
    + '</wp:cNvGraphicFramePr>'
    + `<a:graphic xmlns:a="${a}"><a:graphicData uri="${pic}">`
    + `<pic:pic xmlns:pic="${pic}"><pic:nvPicPr>`
    + `<pic:cNvPr id="0" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip xmlns:r="${rns}" r:embed="${b.__rel.id}"/>`
    + '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
    + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
  const figure = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>${drawing}</w:r></w:p>`;
  if (!b.caption) return figure;
  return figure + '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
    + `<w:r><w:rPr><w:i/><w:sz w:val="18"/><w:color w:val="555555"/></w:rPr>`
    + `<w:t xml:space="preserve">${esc(b.caption)}</w:t></w:r></w:p>`;
}

/**
 * Build a .docx from blocks:
 *   { type: 'heading', level: 1..3, text }
 *   { type: 'para', text }              (**bold** is honoured)
 *   { type: 'table', rows: [[...]] }    (first row is the header)
 *   { type: 'rule' }
 *   { type: 'image', png: Uint8Array, widthPx, heightPx, caption, name }
 */
export async function buildDocx(blocks) {
  // Pictures are collected first so each gets a stable part name and
  // relationship id before the body that references them is written.
  const media = [];
  for (const b of blocks) {
    if (b.type === 'image' && b.png && b.png.length) {
      media.push({ png: b.png, file: `image${media.length + 1}.png`, id: `rIdImg${media.length + 1}` });
      b.__rel = media[media.length - 1];
    }
  }

  const body = blocks.map((b) => {
    if (b.type === 'heading') return para(b.text, 'Heading' + Math.min(b.level || 1, 3));
    if (b.type === 'table') return table(b.rows) + '<w:p/>';
    if (b.type === 'image') return b.__rel ? imagePara(b) : para(b.caption || '');
    if (b.type === 'rule') {
      return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="BBBBBB"/>'
        + '</w:pBdr></w:pPr></w:p>';
    }
    return para(b.text);
  }).join('');

  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const wns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const styles = XML + `<w:styles xmlns:w="${wns}">`
    + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>'
    + '<w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>'
    // Every paragraph resolves to a style. A document with no default Normal
    // style opens in Word but breaks a reader that asks what style a
    // paragraph is, which is how this was caught.
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
    + '<w:name w:val="Normal"/><w:qFormat/></w:style>'
    + [1, 2, 3].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}">`
      + `<w:name w:val="heading ${n}"/>`
      + `<w:pPr><w:spacing w:before="${280 - n * 40}" w:after="120"/></w:pPr>`
      + `<w:rPr><w:b/><w:sz w:val="${(20 - n * 3) * 2}"/></w:rPr></w:style>`).join('')
    + '</w:styles>';

  return zip([
    { name: '[Content_Types].xml',
      data: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        + (media.length ? '<Default Extension="png" ContentType="image/png"/>' : '')
        + CORE_CT + '</Types>' },
    { name: '_rels/.rels',
      data: XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + `<Relationship Id="rId1" Type="${rel}/officeDocument" Target="word/document.xml"/>`
        + CORE_REL + '</Relationships>' },
    corePropsPart(),
    { name: 'word/_rels/document.xml.rels',
      data: XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + `<Relationship Id="rId1" Type="${rel}/styles" Target="styles.xml"/>`
        + media.map((m) => `<Relationship Id="${m.id}" Type="${rel}/image" `
          + `Target="media/${m.file}"/>`).join('')
        + '</Relationships>' },
    { name: 'word/styles.xml', data: styles },
    ...media.map((m) => ({ name: `word/media/${m.file}`, data: m.png })),
    { name: 'word/document.xml',
      data: XML + `<w:document xmlns:w="${wns}"><w:body>${body}`
        + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        + '<w:pgMar w:top="800" w:right="800" w:bottom="800" w:left="800"/>'
        + '</w:sectPr></w:body></w:document>' },
  ]);
}
