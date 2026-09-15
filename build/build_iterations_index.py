"""Build iterations/index.json from the repository itself.

One row per directory under iterations/ that holds an index.html: its number and
slug from the directory name, the page's own <title>, and the last commit that
touched the directory (full SHA, UTC date, subject). If the directory has a
SOURCE.json (written when a version is copied in from Ventusltd/testcode), its
source repository, path and SHA are carried too. Nothing is typed by hand.

Run from the repository root:  python build/build_iterations_index.py
"""
import json, re, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IT = ROOT / 'iterations'

def git(*a):
    return subprocess.run(['git', *a], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()

rows = []
for d in sorted(p for p in IT.iterdir() if p.is_dir() and (p / 'index.html').exists()):
    m = re.match(r'^(\d+)-(.+)$', d.name)
    if not m:
        continue
    html = (d / 'index.html').read_text(encoding='utf-8')
    t = re.search(r'<title>(.*?)</title>', html, re.S)
    log = git('log', '-1', '--format=%H%x1f%cI%x1f%s', '--', f'iterations/{d.name}')
    sha, date, subject = (log.split('\x1f') + ['', '', ''])[:3] if log else ('', '', '')
    row = {'n': int(m.group(1)), 'dir': d.name, 'slug': m.group(2),
           'title': t.group(1).strip() if t else d.name,
           'commit': sha, 'committed': date, 'subject': subject}
    src = d / 'SOURCE.json'
    if src.exists():
        row['source'] = json.loads(src.read_text(encoding='utf-8'))
    rows.append(row)

out = {'schema': 'galaxies-wafers.iterations.v1', 'count': len(rows), 'iterations': rows}
(IT / 'index.json').write_text(json.dumps(out, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
print(f'iterations/index.json: {len(rows)} iterations')
