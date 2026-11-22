"""Serve the installed, browser-only Pixel Motion Studio build on this PC."""

import mimetypes
import os
from pathlib import Path
from urllib.parse import urlsplit
from runtime_paths import ROOT, WORKSPACE


APP_FILES = {
    'app.js', 'candidates.js', 'edit-ops.js', 'editor-extras.js', 'guide.html',
    'i18n-en.js', 'i18n.js', 'index.html', 'local-api.js', 'pixel-editor.css',
    'pixel-editor.html', 'pixel-editor.js', 'studio-tools.js', 'styles.css', 'worker.js',
}
MEDIA = {'samples': {'.png', '.json'}, 'fonts': {'.woff2'}, 'img': {'.png', '.svg', '.webp'}}
PUBLIC_STUDIO = 'https://fourthplace43.com/tools/pixel-motion-studio/'
STUDIO_DIST = ROOT / 'studio'
LEGACY_BUILD = WORKSPACE.parent / 'GameCreate/tools/pixel-motion-studio/dist-public'


def studio_asset(request):
    path = urlsplit(request).path
    relative = path.removeprefix('/studio/')
    if relative != 'LICENSES.txt':
        folder, _, name = relative.partition('/')
        if folder == 'app' and name == '':
            relative = 'app/index.html'
        elif folder == 'app' and name in APP_FILES:
            pass
        elif folder not in MEDIA or Path(name).suffix.lower() not in MEDIA[folder]:
            return None

    default = STUDIO_DIST if STUDIO_DIST.is_dir() else LEGACY_BUILD
    root = Path(os.environ.get('PIXEL_MOTION_STUDIO_WEB') or default).resolve()
    asset = (root / relative).resolve()
    if not asset.is_relative_to(root) or not asset.is_file():
        return None
    data = asset.read_bytes()
    mime = mimetypes.guess_type(asset.name)[0] or 'application/octet-stream'
    if relative == 'app/index.html':
        page = data.decode('utf-8').replace('href="../"', f'href="{PUBLIC_STUDIO}"')
        page = page.replace('href="../#', f'href="{PUBLIC_STUDIO}#')
        if default == STUDIO_DIST and root == STUDIO_DIST:
            page = page.replace('<div class="sample-row">', '<div class="sample-row" hidden>')
        page = page.replace(
            '</head>',
            '<link rel="stylesheet" href="/studio-link.css">'
            '<script src="/handoff.js" defer></script><script src="/project-api.js" defer></script>'
            '<script src="/studio-link.js" defer></script></head>',
            1,
        )
        data = page.encode('utf-8')
    return data, mime
