#!/usr/bin/env python3
"""Rebuild the single-page artifact HTML from index.html and css/style.css.

The artifact is a multi-file artifact: this produces only the page. The js/
directory is published alongside it unchanged, so the only transformations
needed are to inline the stylesheet, drop the document wrapper, and repoint the
import map at the artifact's own root.

Usage: python3 calibration/build_artifact.py <output.html>
"""
import re, sys


def main(out_path):
    html = open('index.html', encoding='utf-8').read()
    css = open('css/style.css', encoding='utf-8').read()

    importmap = re.search(r'<script type="importmap">.*?</script>', html, re.S).group(0)
    importmap = importmap.replace('../js/vendor/', './js/vendor/')

    body = html[html.index('<body>') + len('<body>'):html.index('</body>')]

    page = (
        '<title>Wind Farm Radar Assessor</title>\n\n'
        + importmap + '\n\n'
        + '<style>\n' + css + '\n</style>\n'
        + body.rstrip() + '\n'
    )
    open(out_path, 'w', encoding='utf-8').write(page)
    print(f'{out_path}: {len(page)} bytes')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'artifact.html')
