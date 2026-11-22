"""Prepare a local reference image, run editing, and finish transparent sprites."""

import base64
from binascii import Error as Base64Error
from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from time import perf_counter

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from runtime_paths import ROOT as HERE, EDIT_ASSETS as ASSETS, COMFY
WEIGHTS = {
    'model': ASSETS / 'diffusion_models/flux-2-klein-4b-fp8.safetensors',
    'encoder': ASSETS / 'text_encoders/qwen_3_4b_fp4_flux2.safetensors',
    'vae': ASSETS / 'vae/flux2-vae.safetensors',
}
MAX_IMAGE_BYTES = 10 * 1024 * 1024


def editing_available():
    return (os.environ.get('SPRITE_DEVICE', 'auto').lower() != 'cpu' and
            (COMFY / 'comfy' / 'sd.py').is_file() and all(path.is_file() for path in WEIGHTS.values()))


class ReferenceError(ValueError):
    """A reference-mode error the user can resolve in the app."""


def load_input(data):
    try:
        raw = base64.b64decode(data, validate=True)
        if len(raw) > MAX_IMAGE_BYTES:
            raise ReferenceError('10 MB以下の画像を選んでください。')
        with Image.open(BytesIO(raw)) as source:
            if source.format not in {'PNG', 'JPEG', 'WEBP'}:
                raise ReferenceError('PNG・JPEG・WebPから選んでください。')
            if source.width * source.height > 20_000_000:
                raise ReferenceError('2,000万画素以下の画像を選んでください。')
            image = ImageOps.exif_transpose(source).convert('RGBA')
    except (Base64Error, UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise ReferenceError('画像を読み込めませんでした。PNG・JPEG・WebPを選び直してください。') from exc
    image.thumbnail((640, 640), Image.Resampling.LANCZOS)
    return image


def remove_background(image, *, generated=False):
    """Preserve source alpha, or cut out a subject from an opaque image."""
    rgba = np.asarray(image.convert('RGBA')).copy()
    height, width = rgba.shape[:2]
    alpha = rgba[..., 3]
    if not np.any(alpha < 245):
        rgb = rgba[..., :3].astype(np.int16)
        corners = rgb[[0, 0, height - 1, height - 1], [0, width - 1, 0, width - 1]]
        background = np.median(corners, axis=0)
        difference = np.max(np.abs(rgb - background), axis=2)
        border = np.concatenate((difference[0], difference[-1], difference[:, 0], difference[:, -1]))
        import cv2

        threshold = 64 if generated else 32
        if np.mean(border <= threshold) >= 0.66:
            _, labels, _, _ = cv2.connectedComponentsWithStats((difference <= threshold).astype(np.uint8), connectivity=8)
            outer = np.unique(np.concatenate((labels[0], labels[-1], labels[:, 0], labels[:, -1])))
            remove = np.isin(labels, outer[outer > 0])
            # Enclosed background such as a key ring. Leave small isolated highlights intact.
            close = (difference <= (29 if generated else 8)).astype(np.uint8)
            _, holes, stats, _ = cv2.connectedComponentsWithStats(close, connectivity=8)
            above = np.flatnonzero(stats[:, cv2.CC_STAT_AREA] >= max(12, width * height // 450))
            remove |= np.isin(holes, above[above > 0])
        elif width >= 16 and height >= 16:
            mask = np.zeros((height, width), dtype=np.uint8)
            margin = max(1, min(width, height) // 40)
            bounds = margin, margin, width - margin * 2, height - margin * 2
            models = [np.zeros((1, 65), dtype=np.float64) for _ in range(2)]
            try:
                cv2.grabCut(np.ascontiguousarray(rgba[..., :3]), mask, bounds, *models, 3, cv2.GC_INIT_WITH_RECT)
            except cv2.error as exc:
                raise ReferenceError('背景を判別できませんでした。透過PNGか、単色背景の画像を使ってください。') from exc
            remove = (mask == cv2.GC_BGD) | (mask == cv2.GC_PR_BGD)
        else:
            raise ReferenceError('画像が小さすぎて背景を判別できませんでした。')
        alpha[remove] = 0
    mask = Image.fromarray((alpha >= 85).astype(np.uint8) * 255)
    bounds = mask.getbbox()
    if bounds is None or min(bounds[2] - bounds[0], bounds[3] - bounds[1]) < 3:
        raise ReferenceError('被写体を切り抜けませんでした。輪郭が見える画像を選んでください。')
    return Image.fromarray(rgba).crop(bounds)


def fitted(image, size, edge, background):
    target = ImageOps.contain(image, (edge, edge), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (size, size), background)
    canvas.alpha_composite(target, ((size - target.width) // 2, (size - target.height) // 2))
    return canvas


def sprite(image):
    rgba = np.asarray(fitted(image, 32, 28, (0, 0, 0, 0))).copy()
    opaque = rgba[..., 3] >= 105
    if not np.any(opaque):
        raise ReferenceError('32×32で被写体を識別できませんでした。大きめに切り抜いた画像を使ってください。')
    colors = Image.fromarray(rgba[..., :3][opaque][None])
    palette = colors.quantize(colors=16, method=Image.Quantize.MEDIANCUT)
    reduced = Image.fromarray(rgba[..., :3]).quantize(palette=palette, dither=Image.Dither.NONE).convert('RGB')
    rgba[..., :3] = np.asarray(reduced)
    rgba[~opaque] = 0
    rgba[..., 3] = opaque * 255
    return Image.fromarray(rgba)


def encode_png(image):
    with BytesIO() as dest:
        image.save(dest, format='PNG')
        return base64.b64encode(dest.getvalue()).decode('ascii')


def redraw(image, instruction, seed):
    if not editing_available():
        raise ReferenceError('AIで描き直すには Setup-Image-Editing.cmd を実行してください。')
    prompt = (
        f'Edit the object in the reference image: {instruction}. '
        'Redraw that same single object as a crisp 32-bit-era pixel-art game inventory icon. '
        'Preserve the recognizable silhouette, orientation, proportions, and negative spaces unless the requested edit changes them. '
        'Use chunky hard-edged pixel clusters, a limited color palette, and a simple dark outline. '
        'Center the complete object with generous margins on a uniform pure white background, including any holes. '
        'No letters, interface, gradient background, shadow, extra objects, frame, or ground plane.'
    )
    start = perf_counter()
    with TemporaryDirectory(prefix='sprite-reference-') as job:
        folder = Path(job)
        fitted(image, 384, 305, (255, 255, 255, 255)).convert('RGB').save(folder / 'input.png')
        payload = {'weights': {name: str(path) for name, path in WEIGHTS.items()},
                   'job': job, 'seed': seed, 'prompt': prompt}
        process = subprocess.run([sys.executable, '-X', 'utf8', str(HERE / 'reference_worker.py')],
                                 input=json.dumps(payload), encoding='utf-8', capture_output=True, errors='replace',
                                 timeout=360, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if process.returncode:
            print(process.stderr[-6500:], file=sys.stderr, flush=True)
            raise RuntimeError('FLUX.2 reference worker failed')
        candidates = []
        for index in range(4):
            with Image.open(folder / f'edit-{index}.png') as result:
                candidates.append(encode_png(sprite(remove_background(result, generated=True))))
    return candidates, perf_counter() - start
