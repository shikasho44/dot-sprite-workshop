"""Run both released sprite generators on this PC."""

import argparse
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import os
from pathlib import Path
import re
import secrets
import sys
import threading
from time import perf_counter
import webbrowser

from runtime_paths import ROOT as HERE, PIXEL, UBA, TRANSLATION, choose_device
MODELS = {'pixelart-50m': 32, 'ubanova-16': 16}
COMPARE = 'compare'
REFERENCE = 'reference'
JAPANESE = re.compile(r'[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff66-\uff9f々]')
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
sys.dont_write_bytecode = True
sys.path[:0] = [str(PIXEL), str(UBA)]


class Generators:
    def __init__(self):
        self.loaded = {}
        self.lock = threading.Lock()
        self.translator = None
        self.device = None

    def use_device(self, torch):
        if self.device is None:
            self.device = choose_device(torch)
        return self.device

    def translate(self, prompt, torch):
        if not JAPANESE.search(prompt):
            return prompt, None, 0
        started = perf_counter()
        if self.translator is None:
            from transformers import MarianMTModel, MarianTokenizer

            tokenizer = MarianTokenizer.from_pretrained(TRANSLATION, local_files_only=True)
            model = MarianMTModel.from_pretrained(TRANSLATION, local_files_only=True).to(self.device).eval()
            self.translator = tokenizer, model
        tokenizer, model = self.translator
        tokens = tokenizer(prompt, return_tensors='pt').to(self.device)
        with torch.inference_mode():
            output = model.generate(**tokens, max_new_tokens=128)
        translated = tokenizer.decode(output[0], skip_special_tokens=True).strip().rstrip('.。')
        translated = re.sub(r'^(?:a|an|the)\s+', '', translated, flags=re.IGNORECASE)
        if not translated or JAPANESE.search(translated):
            raise ValueError('英訳できませんでした。説明を短くするか、英語で入力してください。')
        return translated, translated, perf_counter() - started

    def load_pixelart(self, torch):
        from safetensors.torch import load_file
        from pixelart.model import UNet, sample
        from pixelart.postprocess import to_rgba_u8
        from pixelart.text import TextEncoder, caption_for_prompt

        runtime = PIXEL
        cfg = json.loads((runtime / 'config.json').read_text(encoding='utf-8'))
        model = UNet(**cfg['model_cfg']).to(self.device).eval()
        model.load_state_dict(load_file(runtime / 'model.safetensors'))
        encoder = TextEncoder(self.device, cfg['text_encoder'])
        defaults = cfg['sampler_defaults']

        def generate(prompt, seed):
            tok, mask, pool = (x.to(self.device) for x in encoder.encode([caption_for_prompt(prompt)] * 4))
            ntok, nmask, npool = (x.to(self.device) for x in encoder.encode(['']))
            noise = torch.Generator(device=self.device).manual_seed(seed)
            result = sample(model, tok.float(), mask, pool.float(), ntok.float().expand(4, -1, -1),
                            nmask.expand(4, -1), npool.float().expand(4, -1), steps=defaults['steps'],
                            cfg=defaults['cfg'], cfg_interval=tuple(defaults['cfg_interval']), generator=noise)
            return to_rgba_u8(result.cpu())

        return generate

    def load_ubanova(self):
        import infer

        infer.CLIP_MODEL_NAME = str(PIXEL / 'models/clip_text')
        engine = infer.SpriteGenerator(str(UBA / 'model.pt'), str(UBA / 'palette.npy'), device=self.device)
        return lambda prompt, seed: engine.generate(prompt, n=4, seed=seed)

    def generate(self, key, prompt):
        with self.lock:
            import torch

            self.use_device(torch)
            prompt, translation, translation_seconds = self.translate(prompt, torch)
            seed = secrets.randbits(31)
            if key == COMPARE:
                result = {'model': COMPARE, 'batches': [self.generate_batch(name, prompt, seed, torch) for name in MODELS]}
            else:
                result = self.generate_batch(key, prompt, seed, torch)
            return {**result, 'translation': translation, 'translation_seconds': translation_seconds}

    def generate_batch(self, key, prompt, seed, torch):
        load_start = perf_counter()
        cold = key not in self.loaded
        if cold:
            self.loaded[key] = self.load_pixelart(torch) if key == 'pixelart-50m' else self.load_ubanova()
        if self.device == 'cuda':
            torch.cuda.synchronize()
        ready = perf_counter()
        images = self.loaded[key](prompt, seed)
        if self.device == 'cuda':
            torch.cuda.synchronize()
        elapsed = perf_counter() - ready
        size = MODELS[key]
        if len(images) != 4 or any(im.mode != 'RGBA' or im.size != (size, size) for im in images):
            raise RuntimeError('Unexpected sprite count or format')
        encoded = []
        for image in images:
            with BytesIO() as data:
                image.save(data, format='PNG')
                encoded.append(base64.b64encode(data.getvalue()).decode('ascii'))
        return {'model': key, 'size': size, 'seed': seed, 'seconds': elapsed,
                'load_seconds': ready - load_start if cold else 0, 'images': encoded}

    def reference_preview(self, raw):
        from reference import encode_png, load_input, remove_background, sprite

        return {'model': REFERENCE, 'size': 32, 'seed': secrets.randbits(31),
                'original': encode_png(sprite(remove_background(load_input(raw)))), 'images': []}

    def generate_from_image(self, prompt, raw):
        from reference import encode_png, load_input, redraw, remove_background, sprite

        image = remove_background(load_input(raw))
        original = encode_png(sprite(image))
        with self.lock:
            import torch

            if self.use_device(torch) != 'cuda':
                raise ValueError('AIでの描き直しにはCUDA対応のNVIDIA GPUが必要です。変換見本はCPUでも作れます。')
            # Short Japanese edit requests often omit the verb (e.g. 金色に).
            request = prompt + 'してください' if prompt.endswith('に') else prompt
            instruction, translation, translation_seconds = self.translate(request, torch)
            # The edit process owns the GPU until all four candidates are ready.
            self.loaded.clear()
            self.translator = None
            torch.cuda.empty_cache()
            seed = secrets.randbits(31)
            images, seconds = redraw(image, instruction, seed)
        return {'model': REFERENCE, 'size': 32, 'seed': seed, 'seconds': seconds,
                'translation': translation, 'translation_seconds': translation_seconds,
                'original': original, 'images': images}


ENGINE = Generators()
PAGES = {
    '/': (HERE / 'index.html', 'text/html; charset=utf-8'),
    '/style.css': (HERE / 'style.css', 'text/css; charset=utf-8'),
    '/app.js': (HERE / 'app.js', 'text/javascript; charset=utf-8'),
    '/motion.js': (HERE / 'motion.js', 'text/javascript; charset=utf-8'),
    '/handoff.js': (HERE / 'handoff.js', 'text/javascript; charset=utf-8'),
    '/workshop-link.js': (HERE / 'workshop-link.js', 'text/javascript; charset=utf-8'),
    '/studio-link.js': (HERE / 'studio-link.js', 'text/javascript; charset=utf-8'),
    '/studio-link.css': (HERE / 'studio-link.css', 'text/css; charset=utf-8'),
    **{f'/sample/{i}.png': (HERE / f'samples/chest_{i}.png', 'image/png') for i in range(1, 5)},
}


class Handler(BaseHTTPRequestHandler):
    def allowed_host(self):
        return self.headers.get('Host') in {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}

    def send_data(self, status, data, mime, filename=None):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if filename:
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, status, data):
        self.send_data(status, json.dumps(data, ensure_ascii=False).encode(), 'application/json; charset=utf-8')

    def do_GET(self):
        if not self.allowed_host():
            self.send_error(403)
        elif self.path == '/health':
            self.send_json(200, {'app': 'pixel-sprite-maker'})
        elif self.path == '/capabilities':
            from motion import studio_cli
            from reference import editing_available

            image_edit = editing_available()
            if image_edit:
                import torch

                image_edit = torch.cuda.is_available()
            self.send_json(200, {'image_edit': image_edit, 'studio_cli': studio_cli() is not None})
        elif self.path.startswith('/studio/'):
            from studio_mount import studio_asset

            asset = studio_asset(self.path)
            if asset is None:
                self.send_error(404, 'Pixel Motion Studio browser asset not found')
            else:
                self.send_data(200, *asset)
        elif self.path in PAGES:
            path, mime = PAGES[self.path]
            try:
                data = path.read_bytes()
            except OSError:
                self.send_error(404)
                return
            self.send_data(200, data, mime)
        else:
            self.send_error(404)

    def do_POST(self):
        if not self.allowed_host() or self.headers.get('Origin', f'http://{self.headers.get("Host")}') != f'http://{self.headers.get("Host")}':
            self.send_error(403)
            return
        if self.path in {'/motion-preview', '/motion-export', '/motion-frames'}:
            self.do_motion()
            return
        if self.path not in {'/generate', '/generate-from-image', '/reference-preview'}:
            self.send_error(404)
            return
        image_mode = self.path != '/generate'
        preview_only = self.path == '/reference-preview'
        try:
            size = int(self.headers.get('Content-Length', '0'))
            limit = 14 * 1024 * 1024 if image_mode else 4096
            if self.headers.get_content_type() != 'application/json' or not 0 < size <= limit:
                raise ValueError()
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise ValueError()
            model, prompt = payload.get('model'), payload.get('prompt')
            if not preview_only and (not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 200):
                raise ValueError()
            if image_mode:
                image = payload.get('image')
                if not isinstance(image, str) or not image:
                    raise ValueError()
            elif not isinstance(model, str) or (model not in MODELS and model != COMPARE):
                raise ValueError()
        except ValueError:
            message = '10 MB以下の画像を選び、指示を1〜200文字で入力してください。' if image_mode else 'モデルを選び、文章を1〜200文字で入力してください。'
            self.send_json(400, {'error': message})
            return
        try:
            if preview_only:
                result = ENGINE.reference_preview(image)
            elif image_mode:
                result = ENGINE.generate_from_image(prompt.strip(), image)
            else:
                result = ENGINE.generate(model, prompt.strip())
        except ValueError as exc:
            self.send_json(422, {'error': str(exc)})
            return
        except Exception as exc:
            print(f'Generation failed: {exc}', file=sys.stderr, flush=True)
            self.send_json(500, {'error': '生成に失敗しました。起動ウィンドウのログを確認してから、もう一度お試しください。'})
            return
        self.send_json(200, result)

    def do_motion(self):
        from motion import frame_sequence, motion_frames, preview, studio_zip

        try:
            size = int(self.headers.get('Content-Length', '0'))
            if self.headers.get_content_type() != 'application/json' or not 0 < size <= 104_000:
                raise ValueError()
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise ValueError()
        except ValueError:
            self.send_json(400, {'error': 'PNGと範囲指定を確認してください。'})
            return
        try:
            frames = motion_frames(payload)
            if self.path == '/motion-export':
                data = studio_zip(frames)
                self.send_data(200, data, 'application/zip', 'pixel-motion-studio.zip')
            elif self.path == '/motion-frames':
                self.send_json(200, frame_sequence(frames))
            else:
                self.send_json(200, preview(frames))
        except ValueError as exc:
            self.send_json(422, {'error': str(exc)})
        except Exception as exc:
            print(f'Motion failed: {exc}', file=sys.stderr, flush=True)
            self.send_json(500, {'error': 'モーションを書き出せませんでした。起動ウィンドウを確認してください。'})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--open', action='store_true')
    args = parser.parse_args()
    url = f'http://127.0.0.1:{args.port}/'
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    except OSError:
        if args.open:
            from urllib.request import urlopen

            try:
                with urlopen(url + 'health', timeout=2) as response:
                    if json.load(response) == {'app': 'pixel-sprite-maker'}:
                        webbrowser.open(url)
                        return
            except (OSError, ValueError):
                pass
        raise
    with server:
        print(f'Pixel Sprite Maker: {url}', flush=True)
        if args.open:
            threading.Thread(target=webbrowser.open, args=(url,), daemon=True).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            return


if __name__ == '__main__':
    main()
