"""Run FLUX.2 image editing using the local ComfyUI inference library."""

import json
from pathlib import Path
import sys

from runtime_paths import COMFY
request = json.load(sys.stdin)
sys.path.insert(0, str(COMFY))
sys.argv[1:] = ['--disable-dynamic-vram', '--disable-smart-memory', '--preview-method', 'none']
sys.dont_write_bytecode = True

import comfy.options

comfy.options.enable_args_parsing()

import numpy as np
import torch
from PIL import Image

import comfy.model_management as memory
import comfy.samplers
import comfy.sd
import comfy.utils
from comfy_extras.nodes_custom_sampler import Guider_Basic, Noise_RandomNoise
from comfy_extras.nodes_flux import EmptyFlux2LatentImage, Flux2Scheduler
from node_helpers import conditioning_set_values


@torch.inference_mode()
def edit():
    files = request['weights']
    folder = Path(request['job'])
    clip = comfy.sd.load_clip([files['encoder']], clip_type=comfy.sd.CLIPType.FLUX2)
    tokens = clip.tokenize(request['prompt'])
    conditioning = clip.encode_from_tokens_scheduled(tokens)
    memory.unload_all_models()
    del clip
    memory.soft_empty_cache()

    vae = comfy.sd.VAE(sd=comfy.utils.load_torch_file(files['vae']))
    with Image.open(folder / 'input.png') as image:
        pixels = torch.from_numpy(np.array(image.convert('RGB'))).float().div_(255).unsqueeze(0)
    reference = vae.encode(pixels)
    conditioning = conditioning_set_values(conditioning, {'reference_latents': [reference]}, append=True)
    model = comfy.sd.load_diffusion_model(files['model'])
    if model is None:
        raise RuntimeError('FLUX.2 checkpoint not recognized by this ComfyUI build')
    guider = Guider_Basic(model)
    guider.set_conds(conditioning)
    samples = EmptyFlux2LatentImage.execute(384, 384).result[0]
    latent = samples['samples']
    sigmas = Flux2Scheduler.execute(4, 384, 384).result[0]
    sampler = comfy.samplers.sampler_object('euler')
    edits = []
    for index in range(4):
        seed = request['seed'] + index
        noise = Noise_RandomNoise(seed).generate_noise(samples)
        edits.append(guider.sample(noise, latent, sampler, sigmas, seed=seed, disable_pbar=True).cpu())
    memory.unload_all_models()
    del model, guider
    memory.soft_empty_cache()
    for index, output in enumerate(edits):
        native = vae.decode(output).squeeze(0).float().mul(255).clamp_(0, 255).byte().cpu().numpy()
        Image.fromarray(native).save(folder / f'edit-{index}.png')
    memory.unload_all_models()


if __name__ == '__main__':
    edit()
