#!/usr/bin/env python3
"""Щоденна резервна копія даних CARCAR: база (безпечно, навіть поки сервер працює) і ключі push.

Копії — у /var/backups/carcar, зберігаються останні 14. Відновлення:
  sudo systemctl stop carcar-sync
  sudo cp /var/backups/carcar/data-2026-10-15.db /var/lib/carcar/data.db
  sudo systemctl start carcar-sync
"""
import datetime
import glob
import os
import shutil
import sqlite3
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else '/var/lib/carcar/data.db'
DST = sys.argv[2] if len(sys.argv) > 2 else '/var/backups/carcar'
KEEP = 14

os.makedirs(DST, mode=0o700, exist_ok=True)
day = datetime.date.today().isoformat()
target = os.path.join(DST, f'data-{day}.db')
src = sqlite3.connect(f'file:{SRC}?mode=ro', uri=True)
dst = sqlite3.connect(target)
with dst:
    src.backup(dst)
dst.close()
src.close()
os.chmod(target, 0o600)
vapid = os.path.join(os.path.dirname(SRC), 'vapid.pem')
if os.path.exists(vapid):
    shutil.copy2(vapid, os.path.join(DST, 'vapid.pem'))
for old in sorted(glob.glob(os.path.join(DST, 'data-*.db')))[:-KEEP]:
    os.remove(old)
print('Резервна копія:', target)
