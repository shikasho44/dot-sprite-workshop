"""Fetch only the fixed upstream files required by this release."""

import argparse
from errno import EXDEV
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
from urllib.request import urlopen
from zipfile import ZipFile
from runtime_paths import DATA, ROOT


BASE = (
    ('azyg0s/pixelart-50m', '5ae1940ba86eccc3cfa17952008f406a8b7c9c25', 'pixelart-50m', {
        'model.safetensors': 'e8a739fa8024675250493196db40bc5f3d100e5b9468f14d5dbce075ffd8d307',
    }, ['LICENSE', 'config.json', 'pixelart/__init__.py', 'pixelart/model.py',
        'pixelart/text.py', 'pixelart/postprocess.py']),
    ('ubanova/UbaNova-16', '2c112bbfafafaa4990a90953452bab275dec10c2', 'ubanova-16', {
        'model.pt': '1471da79e3331ac4494b19070ac425b5ee6098526af7bbb90a2087e4d9f57764',
        'palette.npy': 'bad6e5a7e34f663c0233119807a9840dd966b6c4f1b847f6fc166bf476fdf6dc',
    }, ['LICENSE', 'NOTICE', 'infer.py']),
    ('openai/clip-vit-base-patch32', '3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268', 'pixelart-50m/models/clip_text', {
        'pytorch_model.bin': 'a63082132ba4f97a80bea76823f544493bffa8082296d62d71581a4feff1576f',
    }, ['README.md', 'config.json', 'merges.txt', 'special_tokens_map.json', 'tokenizer_config.json', 'vocab.json']),
    ('Helsinki-NLP/opus-mt-ja-en', '0770961a39ba6bd66305b149c3f4110bcafca2e6', 'translation', {
        'pytorch_model.bin': 'ed649116c143fc2d7aea690246f4b2b7caa814e9e00a8d5bbe047822b18de022',
    }, ['README.md', 'config.json', 'generation_config.json', 'source.spm', 'target.spm', 'tokenizer_config.json', 'vocab.json']),
)
EDIT = (
    ('black-forest-labs/FLUX.2-klein-4b-fp8', '5b4408e59397a4a37ccb46afe426d8ed86379441', 'image-edit', {
        'diffusion_models/flux-2-klein-4b-fp8.safetensors': '97ed34fe0567e436200f2faee3939b88f2b5d99f8af2a4dc16532c4245c0ccb6',
    }, []),
    ('Comfy-Org/Flux-2-Klein-4B', '5b3abca5c0dc1ecd4eaf3340868d09063fc1c965', 'image-edit', {
        'text_encoders/qwen_3_4b_fp4_flux2.safetensors': '3eab03a77adb0ee5304a4e677d5c10ac22f9049c1d7c894adca4f8bb39206ca8',
        'vae/flux2-vae.safetensors': '868fe7b343cc8f3a19dbcfcafbc3d5f888802be3f89bd81b65b3621a066ce8f3',
    }, []),
)
COMFY_REV = '8ff6dc384ba5c410266b40e137799e049459d4f2'
DOWNLOADS = Path(os.environ.get('SPRITE_DOWNLOAD_CACHE') or
                 (Path(os.environ.get('LOCALAPPDATA') or Path.home()) / 'DotSpriteWorkshop' / 'dl'))
INTEGRITY = json.loads((ROOT / 'model-integrity.json').read_text(encoding='utf-8'))


def sha256(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def inspect_file(path, spec):
    if not path.is_file():
        return 'missing'
    if path.stat().st_size != spec['size'] or sha256(path) != spec['sha256']:
        return 'damaged'
    return 'ok'


def model_inventory(groups, locations=None):
    for repo, revision, folder, weights, small in groups:
        bucket = hashlib.sha256(f'{repo}@{revision}'.encode()).hexdigest()[:10]
        staging = DOWNLOADS / bucket
        install = locations.get(folder, DATA / folder) if locations else DATA / folder
        for name in [*small, *weights]:
            dest = install / name
            spec = INTEGRITY[f'{folder}/{name}']
            yield repo, revision, folder, name, dest, staging, spec, inspect_file(dest, spec)


def fetch_models(groups, locations=None):
    from filelock import FileLock, Timeout
    from huggingface_hub import hf_hub_download

    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    repaired = 0
    try:
        with FileLock(str(DOWNLOADS / 'repair.lock'), timeout=0):
            for repo, revision, folder, name, dest, staging, spec, status in model_inventory(groups, locations):
                if status == 'ok':
                    print(f'[正常・据え置き] {folder}/{name}', flush=True)
                    continue
                repair_file(repo, revision, name, dest, staging, spec, hf_hub_download)
                repaired += 1
    except Timeout as exc:
        raise RuntimeError('別のセットアップまたは修復が進行中です。終了後にもう一度実行してください。') from exc
    return repaired


def repair_file(repo, revision, name, dest, staging, spec, download):
    cached = staging / name
    cache_state = inspect_file(cached, spec)
    if cache_state == 'ok':
        print(f'[キャッシュから復元] {repo} / {name}', flush=True)
        got = cached
    else:
        print(f'[取得] {repo} / {name}', flush=True)
        got = Path(download(repo_id=repo, revision=revision, filename=name, local_dir=staging,
                            force_download=cache_state == 'damaged', token=False))
        if inspect_file(got, spec) != 'ok':
            raise RuntimeError(f'取得したファイルを照合できませんでした: {name}')
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Atomically swap in verified bytes. Keep the cache if the destination is locked.
    try:
        got.replace(dest)
    except OSError as error:
        if error.errno != EXDEV:
            raise
        with TemporaryDirectory(dir=dest.parent, prefix='.repair-') as temp:
            staged = Path(temp) / 'verified'
            shutil.copyfile(got, staged)
            staged.replace(dest)
        got.unlink()


def install_comfy():
    installed = DATA / 'ComfyUI'
    if not (installed / 'comfy/sd.py').is_file():
        DATA.mkdir(parents=True, exist_ok=True)
        DOWNLOADS.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(dir=DOWNLOADS, prefix='comfy-') as temp:
            root = Path(temp)
            archive = root / 'comfy.zip'
            print('[取得] ComfyUI 推論ライブラリ', flush=True)
            url = f'https://codeload.github.com/Comfy-Org/ComfyUI/zip/{COMFY_REV}'
            with urlopen(url, timeout=90) as response, archive.open('wb') as stream:
                shutil.copyfileobj(response, stream)
            with ZipFile(archive) as source:
                for name in source.namelist():
                    if not (root / name).resolve().is_relative_to(root):
                        raise RuntimeError('ComfyUIのアーカイブ形式を確認できません。')
                source.extractall(root)
            unpacked = root / f'ComfyUI-{COMFY_REV}'
            if not (unpacked / 'comfy/sd.py').is_file():
                raise RuntimeError('ComfyUIのダウンロードが不完全です。')
            shutil.move(unpacked, installed)
    constraint = DATA / 'image-edit-constraints.txt'
    constraint.write_text('torch==2.13.0\ntransformers==5.14.1\n', encoding='utf-8')
    subprocess.run([sys.executable, '-m', 'pip', 'install', '-c', str(constraint),
                    '-r', str(installed / 'requirements.txt'),
                    '--extra-index-url', 'https://download.pytorch.org/whl/cu130'], check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image-edit', action='store_true')
    args = parser.parse_args()
    if args.image_edit:
        import torch

        if not torch.cuda.is_available():
            raise RuntimeError('NVIDIA版の Setup.cmd を実行し、CUDA対応GPUを確認してください。')
        install_comfy()
        fetch_models(EDIT)
    else:
        fetch_models(BASE)
        (DATA / '.base-ready').touch()


if __name__ == '__main__':
    from huggingface_hub.errors import HfHubHTTPError

    try:
        main()
    except (OSError, RuntimeError, HfHubHTTPError, subprocess.CalledProcessError) as error:
        print(f'セットアップ失敗: {error}', file=sys.stderr)
        raise SystemExit(1) from None
