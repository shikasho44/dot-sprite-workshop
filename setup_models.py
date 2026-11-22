"""Fetch only the fixed upstream files required by this release."""

import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
from urllib.request import urlopen
from zipfile import ZipFile
from huggingface_hub.errors import HfHubHTTPError

from runtime_paths import DATA


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


def sha256(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def fetch_models(groups):
    from huggingface_hub import hf_hub_download

    for repo, revision, folder, weights, small in groups:
        install = DATA / folder
        # Hugging Face adds long cache filenames. Keep them away from deeply nested ZIP folders.
        bucket = hashlib.sha256(f'{repo}@{revision}'.encode()).hexdigest()[:10]
        staging = DOWNLOADS / bucket
        for name in [*small, *weights]:
            expected = weights.get(name)
            dest = install / name
            if expected and dest.is_file() and sha256(dest) == expected:
                print(f'[OK] {name}', flush=True)
                continue
            print(f'[取得] {repo} / {name}', flush=True)
            cached = staging / name
            force = bool(expected and cached.is_file() and sha256(cached) != expected)
            got = Path(hf_hub_download(repo_id=repo, revision=revision, filename=name, local_dir=staging,
                                       force_download=force, token=False))
            if expected and sha256(got) != expected:
                raise RuntimeError(f'ファイルの照合に失敗しました: {got.name}。もう一度セットアップを実行してください。')
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not expected:
                shutil.copyfile(got, dest)
            else:
                partial = dest.with_suffix(dest.suffix + '.partial')
                shutil.move(got, partial)
                partial.replace(dest)


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
    try:
        main()
    except (OSError, RuntimeError, HfHubHTTPError, subprocess.CalledProcessError) as error:
        print(f'セットアップ失敗: {error}', file=sys.stderr)
        raise SystemExit(1) from None
