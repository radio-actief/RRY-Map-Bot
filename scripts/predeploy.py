"""
Runs before every deploy (the stack's pre-deploy step), inside the NEW image, with the live data
directory mounted at /live:

1. back up the live database to ``belgian_nodes_BU-pre-<version>-<UTC stamp>.db`` (SQLite backup
   API, so a running sync is no problem), keeping the newest ``KEEP`` of those backups;
2. copy the image's ``data/*.json`` and ``data/*.geojson`` over the live ones, so the repo is the
   source of the static data. The database, logs and anything else in /live are left alone.

    docker run --rm -v /path/to/stack/data:/live <image>:latest \\
        python3 scripts/predeploy.py /live
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

DB_NAME = 'belgian_nodes.db'
BACKUP_GLOB = 'belgian_nodes_BU-pre-*.db'
DATA_PATTERNS = ('*.json', '*.geojson')
KEEP = 5


def backup_database(live: Path, version: str, stamp: str, keep: int = KEEP) -> Optional[Path]:
    """Back up the live database; None when there is none yet. Older release backups beyond `keep` go."""
    db = live / DB_NAME
    if not db.is_file():
        return None
    target = live / f'belgian_nodes_BU-pre-{version}-{stamp}.db'
    src = sqlite3.connect(f'file:{db}?mode=ro', uri=True, timeout=30)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)
        if dst.execute('PRAGMA integrity_check').fetchone() != ('ok',):
            raise RuntimeError(f'backup {target.name} failed its integrity check')
    finally:
        dst.close()
        src.close()
    # Oldest first by the stamp at the end of the name (versions don't sort as text).
    backups = sorted(live.glob(BACKUP_GLOB), key=lambda p: p.stem.rsplit('-', 2)[-2:])
    for old in backups[:-keep]:
        old.unlink()
    return target


def copy_data(image_data: Path, live: Path) -> list[str]:
    """Copy the image's static data files over the live ones; returns their names."""
    copied = []
    for pattern in DATA_PATTERNS:
        for f in sorted(image_data.glob(pattern)):
            tmp = live / f'.{f.name}.part'
            shutil.copyfile(f, tmp)
            tmp.replace(live / f.name)
            copied.append(f.name)
    return copied


def run(image_root: Path, live: Path, stamp: Optional[str] = None, keep: int = KEEP) -> Optional[Path]:
    version = json.loads((image_root / 'package.json').read_text())['version']
    stamp = stamp or datetime.now(timezone.utc).strftime('%Y%m%d-%H%M')
    backup = backup_database(live, version, stamp, keep)
    copied = copy_data(image_root / 'data', live)
    print(f'predeploy {version}: backup {backup.name if backup else "skipped (no database)"}; '
          f'data files updated: {", ".join(copied) or "none"}')
    return backup


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: predeploy.py <live data dir>')
    run(Path(__file__).resolve().parent.parent, Path(sys.argv[1]))
