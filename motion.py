"""Make a fixed-canvas loop from selected pixels in a single sprite."""

import base64
from io import BytesIO
from math import sin, tau
import os
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory

from PIL import Image, UnidentifiedImageError


EFFECTS = {'ripple', 'fire', 'wind'}
FRAMES = 10
FPS = 10
MAX_SIDE = 64


def motion_frames(payload):
    try:
        raw = base64.b64decode(payload['image'], validate=True)
        with Image.open(BytesIO(raw), formats=('PNG',)) as image:
            width, height = image.size
            if not (1 <= width <= MAX_SIDE and 1 <= height <= MAX_SIDE) or image.is_animated:
                raise ValueError()
            source = image.convert('RGBA')
    except (KeyError, TypeError, ValueError, UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise ValueError('縦横64px以下の静止PNGを選んでください。') from None

    mask = payload.get('mask')
    effect = payload.get('effect')
    if not isinstance(effect, str) or effect not in EFFECTS:
        raise ValueError('動きの種類を選んでください。')
    if not isinstance(mask, str) or len(mask) != width * height or set(mask) - {'0', '1'} or '1' not in mask:
        raise ValueError('動かす範囲を塗ってください。')
    selected = {(i % width, i // width) for i, bit in enumerate(mask) if bit == '1'}
    if not any(source.getpixel(point)[3] for point in selected):
        raise ValueError('動かす絵の上にも範囲を塗ってください。')
    top = min(y for _, y in selected)
    bottom = max(y for _, y in selected)

    frames = []
    for index in range(FRAMES):
        phase = tau * index / FRAMES
        frame = source.copy()
        for x, y in selected:
            height_factor = (bottom - y + 1) / (bottom - top + 1)
            if effect == 'ripple':
                dx = round(1.45 * sin(phase + .34 * y))
                dy = round(1.30 * sin(phase - .29 * x))
                candidates = ((x + dx, y + dy), (x + dx, y), (x, y + dy), (x, y))
                pixel = source.getpixel(next(point for point in candidates if point in selected))
            else:
                dx = round((.55 + 1.55 * height_factor) * sin(phase + .27 * y))
                dy = round(1.65 * height_factor * sin(phase + .2 * y)) if effect == 'fire' else 0
                shifted = (x - dx, y + dy)
                pixel = source.getpixel(shifted) if shifted in selected else (0, 0, 0, 0)
            frame.putpixel((x, y), pixel)
        frames.append(frame)
    if len({frame.tobytes() for frame in frames}) == 1:
        raise ValueError('この範囲では動きが出ません。色や輪郭を含む範囲を塗ってください。')
    return frames


def preview(frames):
    stream = BytesIO()
    frames[0].save(stream, format='PNG', save_all=True, append_images=frames[1:], duration=1000 // FPS,
                   loop=0, disposal=0, blend=0)
    still = BytesIO()
    frames[0].save(still, format='PNG')
    return {
        'apng': base64.b64encode(stream.getvalue()).decode('ascii'),
        'still': base64.b64encode(still.getvalue()).decode('ascii'),
        'fps': FPS,
        'frames': len(frames),
    }


def frame_sequence(frames):
    images = []
    for frame in frames:
        data = BytesIO()
        frame.save(data, format='PNG')
        images.append(base64.b64encode(data.getvalue()).decode('ascii'))
    return {'images': images, 'fps': FPS}


def studio_cli():
    from runtime_paths import ROOT, WORKSPACE

    bundled = ROOT / 'studio/cli/pixel-motion-studio.cjs'
    legacy = WORKSPACE.parent / 'GameCreate/tools/pixel-motion-studio/dist-cli/bin/pixel-motion-studio.cjs'
    installed = bundled if bundled.is_file() else legacy
    cli = Path(os.environ.get('PIXEL_MOTION_STUDIO_CLI') or installed)
    node = shutil.which('node')
    return (node, cli) if node and cli.is_file() else None


def studio_zip(frames):
    configured = studio_cli()
    if not configured:
        raise ValueError('Pixel Motion Studio CLIとNode.jsを配置し、起動し直してください。')
    node, cli = configured
    with TemporaryDirectory(prefix='pixel-sprite-motion-') as temp:
        job = Path(temp)
        inputs = job / 'input'
        inputs.mkdir()
        for index, frame in enumerate(frames):
            frame.save(inputs / f'frame-{index:03}.png')
        output = job / 'studio'
        process = subprocess.run(
            [node, str(cli.resolve()), 'convert', str(inputs), '--out', str(output),
             '--mode', 'preserve', '--no-trim', '--background', 'keep', '--soft-alpha', '--fps', str(FPS), '--json'],
            capture_output=True, timeout=30, check=False,
        )
        # A partial archive could omit preview formats. Expose only complete jobs.
        if process.returncode != 0 or not (output / 'frames.zip').is_file():
            raise RuntimeError(process.stderr.decode('utf-8', errors='replace').strip() or 'Studio export failed')
        return (output / 'frames.zip').read_bytes()
