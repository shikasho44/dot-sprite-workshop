"""Check an installation without starting the browser or contacting any server."""

import argparse
from importlib.metadata import PackageNotFoundError, version
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys

from runtime_paths import COMFY, DATA, EDIT_ASSETS, PIXEL, ROOT, TRANSLATION, UBA
from setup_models import BASE, DOWNLOADS, EDIT, fetch_models, model_inventory


LOCATIONS = {'pixelart-50m': PIXEL, 'ubanova-16': UBA,
             'pixelart-50m/models/clip_text': PIXEL / 'models/clip_text',
             'translation': TRANSLATION, 'image-edit': EDIT_ASSETS}
STATUS = {'ok': '正常', 'missing': '未取得', 'damaged': '破損・内容不一致'}


def run_probe(args):
    try:
        return subprocess.run(args, capture_output=True, encoding='utf-8', errors='replace',
                              timeout=15, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None


def gpu_status():
    cards = run_probe(['nvidia-smi', '--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'])
    names = cards.stdout.strip() if cards and cards.returncode == 0 else ''
    then = ('import json, torch; a=torch.cuda.is_available(); '
            'print(json.dumps({"build":str(torch.__version__), "cuda":bool(a)}))')
    probe = run_probe([sys.executable, '-X', 'utf8', '-c', then])
    if probe and probe.returncode == 0:
        runtime = json.loads(probe.stdout.strip().splitlines()[-1])
        if runtime['cuda']:
            verify = run_probe([sys.executable, '-c', "import torch; torch.empty(1, device='cuda')"])
            runtime['cuda'] = bool(verify and verify.returncode == 0)
        return names, runtime
    return names, None


def free_space(path):
    actual = path.resolve()
    while not actual.exists() and actual != actual.parent:
        actual = actual.parent
    return shutil.disk_usage(actual).free


def size_text(byte_count):
    if byte_count >= 1024**3:
        return f'{byte_count / 1024**3:.2f} GiB'
    if byte_count >= 1024**2:
        return f'{byte_count / 1024**2:.1f} MiB'
    if byte_count >= 1024:
        return f'{byte_count / 1024:.1f} KiB'
    return f'{byte_count} B'


def missing_packages():
    needed = ['torch']
    needed.extend(line.split('==', 1)[0].split('[', 1)[0] for line in
                  (ROOT / 'requirements.txt').read_text(encoding='utf-8').splitlines()
                  if line and not line.startswith('#'))
    missing = []
    for package in needed:
        try:
            version(package)
        except PackageNotFoundError:
            missing.append(package)
    return missing


def check_models(label, rows):
    missing = [row for row in rows if row[-1] != 'ok']
    print(f'\n[{label}] SHA-256照合 {len(rows) - len(missing)}/{len(rows)}ファイル')
    for row in missing:
        print(f'  [{STATUS[row[-1]]}] {row[2]}/{row[3]}')
    bytes_left = sum(row[-2]['size'] for row in missing)
    print(f'  不足・不一致ファイルの合計サイズ: {size_text(bytes_left)}')
    return bytes_left


def diagnose():
    bits = struct.calcsize('P') * 8
    print(f'\n[Python] {sys.version.split()[0]} / {bits}ビット\n  {sys.executable}')
    if bits != 64 or sys.version_info[:2] != (3, 12):
        print('  配布版のセットアップには Python 3.12 (64ビット) と py ランチャーが必要です。')
    missing = missing_packages()
    print('  未導入: ' + ', '.join(missing) if missing else '  基本ライブラリ: 導入済み')
    cards, runtime = gpu_status()
    print('\n[GPU]')
    print('  NVIDIA (名称、VRAM、ドライバー): ' + (cards.replace('\n', '\n  ') or 'nvidia-smiで未検出'))
    if not cards and sys.platform == 'win32':
        adapters = run_probe(['powershell', '-NoProfile', '-Command',
                              '[Console]::OutputEncoding=[Text.Encoding]::UTF8; '
                              'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name'])
        if adapters and adapters.returncode == 0 and adapters.stdout.strip():
            print('  Windowsの表示アダプター: ' + ', '.join(adapters.stdout.strip().splitlines()))
    if runtime:
        configured = os.environ.get('SPRITE_DEVICE', 'auto').lower()
        print(f'  PyTorch: {runtime["build"]} / CUDA実行: {"利用可" if runtime["cuda"] else "利用不可"}')
        backend = 'CPU' if configured == 'cpu' or not runtime['cuda'] else 'NVIDIA CUDA'
        print(f'  設定: {configured} / 通常利用: {backend}')
        if configured == 'cuda' and not runtime['cuda']:
            print('  CUDA指定で起動できません。CPU設定に戻すかNVIDIAドライバーを確認してください。')
    else:
        print('  PyTorchを読み込めません。未導入の場合は Setup.cmd、DLLエラーの場合はREADMEを参照してください。')
    print('\n[空き容量]')
    for label, path in [('アプリとモデル', DATA), ('モデル一時取得', DOWNLOADS),
                        ('実行中のPython環境', Path(sys.executable).parent)]:
        print(f'  {label}: {size_text(free_space(path))} 空き · {path}')
    base_rows = list(model_inventory(BASE, LOCATIONS))
    edit_rows = list(model_inventory(EDIT, LOCATIONS))
    base_bytes = check_models('基本モデル', base_rows)
    edit_bytes = check_models('追加のAI画像編集（任意）', edit_rows)
    comfy_ready = (COMFY / 'comfy/sd.py').is_file()
    print('  ComfyUI推論ライブラリ: ' + ('配置済み' if comfy_ready else '未導入'))
    if base_bytes and min(free_space(DATA), free_space(DOWNLOADS)) < base_bytes:
        print('  基本モデルの取得前に空き容量を確認してください。')
    if edit_bytes and min(free_space(DATA), free_space(DOWNLOADS)) < edit_bytes:
        print('  追加モデルを取得する場合は空き容量を確認してください。')
    print('\n修復は内容が不足・不一致のモデルにだけ適用します。\n'
          'Pythonやライブラリの初回導入は Setup.cmd、画像編集の初回導入は Setup-Image-Editing.cmd を使います。')


def repair(edit):
    try:
        version('huggingface_hub')
        version('filelock')
    except PackageNotFoundError as exc:
        raise RuntimeError('先に Setup.cmd でPythonライブラリを準備してください。') from exc
    count = fetch_models(EDIT if edit else BASE, LOCATIONS)
    if not edit and not missing_packages() and all(LOCATIONS[key] == DATA / key for key in ('pixelart-50m', 'ubanova-16', 'translation')):
        (DATA / '.base-ready').touch()
    print(f'\n修復完了: {count}ファイルを復元しました。')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', nargs='?', choices=['menu', 'check', 'repair', 'repair-edit'], default='menu')
    action = parser.parse_args().action
    if action in ('menu', 'check'):
        diagnose()
    if action == 'menu':
        answer = input('\n[R] 基本モデルを修復  [I] 追加モデルを修復  [Enter] 終了: ').strip().lower()
        action = {'r': 'repair', 'i': 'repair-edit'}.get(answer, 'check')
    if action.startswith('repair'):
        repair(action == 'repair-edit')


if __name__ == '__main__':
    try:
        main()
    except (EOFError, KeyboardInterrupt):
        print('\n中断しました。次回も未取得のファイルから確認できます。')
        raise SystemExit(1) from None
    except Exception as error:
        print(f'\n診断・修復を完了できませんでした: {error}', file=sys.stderr)
        raise SystemExit(1) from None
