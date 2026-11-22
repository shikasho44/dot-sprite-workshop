"""Resolve installed assets, with a fallback for the original development workspace."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('SPRITE_DATA') or ROOT / 'data').resolve()
WORKSPACE = ROOT.parent.parent
LEGACY = WORKSPACE / 'outputs' if (WORKSPACE / 'tools' / ROOT.name).resolve() == ROOT else DATA


def installed(name, legacy, marker):
    local = DATA / name
    old = LEGACY / legacy
    return old if DATA == ROOT / 'data' and not (local / marker).is_file() and (old / marker).is_file() else local


PIXEL = installed('pixelart-50m', 'pixelart-50m_2026-11-19/runtime', 'model.safetensors')
UBA = installed('ubanova-16', 'ubanova-16_2026-11-19/runtime', 'model.pt')
TRANSLATION = installed('translation', 'pixel-sprite-maker_2026-11-19/opus-mt-ja-en', 'pytorch_model.bin')
EDIT_ASSETS = installed('image-edit', 'pixel-sprite-maker_2026-11-19/flux2-klein-4b', 'diffusion_models/flux-2-klein-4b-fp8.safetensors')
COMFY = Path(os.environ.get('SPRITE_COMFYUI') or DATA / 'ComfyUI').resolve()


def choose_device(torch):
    requested = os.environ.get('SPRITE_DEVICE', 'auto').lower()
    if requested not in {'auto', 'cpu', 'cuda'}:
        raise ValueError('SPRITE_DEVICE は auto、cpu、cuda のいずれかにしてください。')
    if requested == 'cuda' and not torch.cuda.is_available():
        raise ValueError('CUDAを使えません。CPU版のセットアップを試してください。')
    device = 'cuda' if requested != 'cpu' and torch.cuda.is_available() else 'cpu'
    if device == 'cpu':
        torch.set_num_threads(min(8, os.cpu_count() or 1))
    return device
