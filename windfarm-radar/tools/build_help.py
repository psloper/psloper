#!/usr/bin/env python3
"""Generate the in-app help panel from docs/DATA-IN-AND-OUT.md.

The guide has to exist in two places: as a file people can read in the
repository, and inside the page where they actually need it. Generating one
from the other is the only way to stop them drifting apart.

Run: python3 tools/build_help.py
"""
import json, re

SRC = 'docs/DATA-IN-AND-OUT.md'
DST = 'js/report.js'
START = 'export const IMPORT_HTML = '


def inline(t):
    t = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    t = t.replace('\\*', '*').replace('&', '&amp;').replace('&amp;lt;', '&lt;')
    t = t.replace('<strong>', '\x01').replace('</strong>', '\x02')
    t = t.replace('<code>', '\x03').replace('</code>', '\x04')
    t = t.replace('<', '&lt;').replace('>', '&gt;')
    return (t.replace('\x01', '<strong>').replace('\x02', '</strong>')
             .replace('\x03', '<code>').replace('\x04', '</code>'))


def convert(md):
    out, quote, para, table = [], [], [], False
    lines = md.split('\n')

    def flush_para():
        if para:
            out.append('<p>' + inline(' '.join(para)) + '</p>')
            para.clear()

    def flush_quote():
        if quote:
            out.append('<p class="hint">' + inline(' '.join(quote)) + '</p>')
            quote.clear()

    i = 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith('|'):
            flush_para(); flush_quote()
            cells = [c.strip() for c in ln.strip().strip('|').split('|')]
            if i + 1 < len(lines) and re.match(r'^\|[\s:|-]+\|$', lines[i + 1]):
                out.append('<table><thead><tr>'
                           + ''.join(f'<th>{inline(c)}</th>' for c in cells)
                           + '</tr></thead><tbody>')
                table = True
                i += 2
                continue
            if table:
                out.append('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in cells) + '</tr>')
                i += 1
                continue
        if table and not ln.startswith('|'):
            out.append('</tbody></table>')
            table = False
        if ln.startswith('> '):
            flush_para(); quote.append(ln[2:])
        elif ln.startswith('#'):
            flush_para(); flush_quote()
            level = len(ln) - len(ln.lstrip('#'))
            tag = {1: 'h3', 2: 'h4', 3: 'h5'}.get(level, 'h5')
            out.append(f'<{tag}>{inline(ln[level:].strip())}</{tag}>')
        elif ln.strip() == '---':
            flush_para(); flush_quote(); out.append('<hr />')
        elif not ln.strip():
            flush_para(); flush_quote()
        else:
            flush_quote(); para.append(ln.strip())
        i += 1
    flush_para(); flush_quote()
    if table:
        out.append('</tbody></table>')
    return '\n'.join(out)


def main():
    html = convert(open(SRC, encoding='utf-8').read())
    src = open(DST, encoding='utf-8').read()
    i = src.index(START)
    j = src.index('\n', src.index(';', i))
    src = src[:i] + START + json.dumps(html) + ';' + src[j:]
    open(DST, 'w', encoding='utf-8').write(src)
    print(f'{DST}: IMPORT_HTML regenerated, {len(html)} characters')


if __name__ == '__main__':
    main()
