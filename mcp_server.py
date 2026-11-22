"""Local stdio MCP adapter for the running workshop."""

import json
import os
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

from mcp import types
from mcp.server.mcpserver import MCPServer


server = MCPServer('dot-sprite-workshop', version='1.0.0')
port = int(os.environ.get('SPRITE_MCP_PORT', '8765'))
opener = build_opener(ProxyHandler({}))


def workshop_request(endpoint, payload):
    request = Request(
        f'http://127.0.0.1:{port}{endpoint}',
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with opener.open(request, timeout=240) as response:
            return json.load(response)
    except HTTPError as exc:
        raise ValueError(json.load(exc).get('error', f'HTTP {exc.code}')) from None
    except URLError:
        raise ValueError('ドット絵工房をPCで起動してからやり直してください。') from None


def sprite_results(result, images):
    details = {key: value for key, value in result.items() if key not in {'images', 'original', 'batches'}}
    return [
        types.TextContent(type='text', text=json.dumps(details, ensure_ascii=False)),
        *(types.ImageContent(type='image', data=image, mimeType='image/png') for image in images),
    ]


@server.tool(structured_output=False)
def generate_sprites(prompt: str, model: Literal['pixelart-50m', 'ubanova-16'] = 'pixelart-50m'):
    """Generate four transparent PNG sprites from a Japanese or English prompt on this PC."""
    result = workshop_request('/generate', {'prompt': prompt, 'model': model})
    return sprite_results(result, result['images'])


@server.tool(structured_output=False)
def edit_sprite(prompt: str, image_base64: str):
    """Return one 32px conversion sample and four local AI edits. Supply a PNG, JPEG or WebP as raw base64."""
    result = workshop_request('/generate-from-image', {'prompt': prompt, 'image': image_base64})
    return sprite_results(result, [result['original'], *result['images']])


if __name__ == '__main__':
    server.run()
