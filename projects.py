"""Local project data shared by Workshop and the bundled Studio."""

import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import sqlite3

from runtime_paths import DATA


SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY,
    project INTEGER NOT NULL REFERENCES projects(id),
    kind TEXT NOT NULL CHECK (kind IN ('generation','studio')),
    label TEXT NOT NULL,
    created TEXT NOT NULL,
    has_motion INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_history ON history(project, id DESC);
INSERT OR IGNORE INTO projects VALUES (1, '作業中', '');
"""
PAGE_SIZE = 30
MAX_STUDIO_BYTES = 32 * 1024 * 1024
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'


def now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds')


@contextmanager
def connection():
    DATA.mkdir(parents=True, exist_ok=True)
    database = sqlite3.connect(DATA / 'projects.sqlite3', timeout=10)
    database.row_factory = sqlite3.Row
    try:
        database.execute('PRAGMA foreign_keys = ON')
        database.executescript(SCHEMA)
        with database:
            yield database
    finally:
        database.close()


def list_projects():
    with connection() as db:
        return [dict(row) for row in db.execute('SELECT * FROM projects ORDER BY updated DESC, id DESC')]


def create_project(name):
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 60:
        raise ValueError('プロジェクト名を1〜60文字で入力してください。')
    with connection() as db:
        project = db.execute('INSERT INTO projects(name, updated) VALUES (?, ?)', (name.strip(), now())).lastrowid
    return project


def list_history(project, before):
    with connection() as db:
        rows = db.execute('''
            SELECT id, kind, label, created, has_motion FROM history
            WHERE project = ? AND (? IS NULL OR id < ?)
            ORDER BY id DESC LIMIT ?
        ''', (project, before, before, PAGE_SIZE + 1)).fetchall()
    return {'entries': [dict(row) for row in rows[:PAGE_SIZE]],
            'before': rows[PAGE_SIZE - 1]['id'] if len(rows) > PAGE_SIZE else None}


def get_entry(entry):
    with connection() as db:
        row = db.execute('SELECT * FROM history WHERE id = ?', (entry,)).fetchone()
    if row is None:
        return None
    item = dict(row)
    item['data'] = json.loads(item['data'])
    return item


def save_entry(project, kind, label, payload):
    if type(project) is not int or not 0 < project < 2**63:
        raise ValueError('保存先のプロジェクトを選んでください。')
    timestamp = now()
    with connection() as db:
        if not db.execute('UPDATE projects SET updated = ? WHERE id = ?', (timestamp, project)).rowcount:
            raise ValueError('保存先のプロジェクトが見つかりません。')
        entry = db.execute(
            'INSERT INTO history(project, kind, label, created, has_motion, data) VALUES (?, ?, ?, ?, ?, ?)',
            (project, kind, label, timestamp, bool(payload.get('motion')), json.dumps(payload, ensure_ascii=False)),
        ).lastrowid
    return entry


def save_generation(project, prompt, result, original=None):
    label = prompt or '画像から変換見本'
    model = {'compare': '2モデル比較', 'pixelart-50m': 'pixelart-50m', 'ubanova-16': 'UbaNova-16'}.get(result['model'])
    if model:
        label += ' · ' + model
    return save_entry(project, 'generation', label, {'prompt': prompt, 'result': result, 'input': original})


def save_studio(payload):
    label = payload.get('label')
    files = payload.get('files')
    fps = payload.get('fps')
    selected = payload.get('selected', 0)
    settings = payload.get('settings')
    motion = payload.get('motion')
    if (not isinstance(label, str) or not 1 <= len(label.strip()) <= 120 or
            not isinstance(files, list) or not 1 <= len(files) <= 64 or
            (fps is not None and (type(fps) is not int or not 1 <= fps <= 60)) or
            type(selected) is not int or not 0 <= selected < len(files) or
            (settings is not None and (not isinstance(settings, dict) or len(json.dumps(settings)) > 2000))):
        raise ValueError('Studioのコマと再生設定を確認してください。')
    if motion is not None:
        if (not isinstance(motion, dict) or motion.get('effect') not in ('ripple', 'fire', 'wind') or
                not isinstance(motion.get('image'), str) or len(motion['image']) > 100_000 or
                not isinstance(motion.get('mask'), str) or not 1 <= len(motion['mask']) <= 4096 or
                set(motion['mask']) - {'0', '1'}):
            raise ValueError('保存するモーションの範囲を確認してください。')
        motion = {key: motion[key] for key in ('effect', 'image', 'mask')}
    for item in files:
        if (not isinstance(item, dict) or not isinstance(item.get('name'), str) or
                not isinstance(item.get('data'), str) or not 1 <= len(item['name']) <= 100 or
                len(item['data']) > 12_000_000):
            raise ValueError('StudioにはPNGを1〜64枚保存できます。')
        try:
            raw = base64.b64decode(item['data'], validate=True)
            if not raw.startswith(PNG_SIGNATURE):
                raise ValueError()
        except ValueError:
            raise ValueError('保存するコマにPNGとして読めない画像があります。') from None
    return save_entry(payload.get('project'), 'studio', label.strip(), {
        'files': files, 'fps': fps, 'selected': selected, 'settings': settings, 'motion': motion,
    })
