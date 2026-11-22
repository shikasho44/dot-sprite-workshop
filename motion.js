const motionDialog = document.querySelector('#motion-dialog');
const motionInput = document.querySelector('#motion-input');
const motionControls = document.querySelector('#motion-controls');
const motionCanvas = document.querySelector('#motion-mask');
const motionContext = motionCanvas.getContext('2d');
const motionEffect = document.querySelector('#motion-effect');
const motionErase = document.querySelector('#motion-erase');
const motionPreview = document.querySelector('#motion-preview');
const motionToggle = document.querySelector('#motion-toggle');
const motionExport = document.querySelector('#motion-export');
workshopCapabilities.then(value => { motionExport.hidden = value.studio_cli !== true; });
const motionSend = document.querySelector('#motion-send');
const motionStatus = document.querySelector('#motion-status');
const motionGrid = 8;
let motion = null;
let motionRevision = 0;

function drawSelection() {
  const {image, width, height, mask, x, y} = motion;
  motionContext.clearRect(0, 0, motionCanvas.width, motionCanvas.height);
  motionContext.imageSmoothingEnabled = false;
  motionContext.drawImage(image, 0, 0, motionCanvas.width, motionCanvas.height);
  motionContext.fillStyle = '#d2f95680';
  for (let index = 0; index < mask.length; index++) {
    if (mask[index]) motionContext.fillRect(index % width * motionGrid, Math.floor(index / width) * motionGrid, motionGrid, motionGrid);
  }
  if (document.activeElement === motionCanvas && x < width && y < height) {
    motionContext.lineWidth = 2;
    motionContext.strokeStyle = '#141914';
    motionContext.strokeRect(x * motionGrid + 1, y * motionGrid + 1, motionGrid - 2, motionGrid - 2);
    motionContext.strokeStyle = '#ffffff';
    motionContext.strokeRect(x * motionGrid, y * motionGrid, motionGrid, motionGrid);
  }
}

function invalidateMotion() {
  motionPreview.hidden = true;
  motionPreview.removeAttribute('src');
  motionExport.disabled = true;
  motionSend.disabled = true;
  motionToggle.hidden = true;
  motionStatus.textContent = '';
}

function suggestSelection() {
  const {width, height, pixels, mask} = motion;
  mask.fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const [r, g, b, a] = pixels.subarray(i * 4, i * 4 + 4);
      if (motionEffect.value === 'ripple' && a && b - r > 48 && b - g > 22) mask[i] = 1;
      if (motionEffect.value === 'fire' && y < height * .47) mask[i] = 1;
      if (motionEffect.value === 'wind' && y < height * .70) mask[i] = 1;
    }
  }
  invalidateMotion();
  drawSelection();
  if (!mask.some(Boolean)) motionStatus.textContent = '青い部分を見つけられませんでした。動かす範囲を塗ってください。';
}

async function loadMotionImage(source) {
  const revision = ++motionRevision;
  motion?.image.close();
  motion = null;
  motionControls.disabled = true;
  motionContext.clearRect(0, 0, motionCanvas.width, motionCanvas.height);
  invalidateMotion();
  try {
    let blob = source;
    if (typeof source === 'string') {
      if (source.startsWith('data:image/png;base64,')) {
        const pixels = Uint8Array.from(atob(source.split(',')[1]), character => character.charCodeAt(0));
        blob = new Blob([pixels], {type: 'image/png'});
      } else {
        const response = await fetch(source);
        if (!response.ok) throw new Error();
        blob = await response.blob();
      }
    }
    const encoded = await referenceData(blob);
    const image = await createImageBitmap(blob);
    if (revision !== motionRevision) {
      image.close();
      return;
    }
    const {width, height} = image;
    if (width > 64 || height > 64) {
      image.close();
      throw new Error();
    }
    motionCanvas.width = width;
    motionCanvas.height = height;
    motionContext.drawImage(image, 0, 0);
    motion = {
      image, width, height, x: 0, y: 0, mask: new Uint8Array(width * height),
      pixels: motionContext.getImageData(0, 0, width, height).data,
      encoded,
    };
    motionCanvas.width = width * motionGrid;
    motionCanvas.height = height * motionGrid;
    motionControls.disabled = false;
    suggestSelection();
  } catch {
    if (revision === motionRevision) motionStatus.textContent = '縦横64px以下のPNGを読み込んでください。';
  }
}

async function restoreMotion(saved) {
  motionEffect.value = saved.effect;
  motionDialog.showModal();
  await loadMotionImage('data:image/png;base64,' + saved.image);
  if (!motion || saved.mask.length !== motion.mask.length) throw new Error('保存した範囲を復元できませんでした。');
  motion.mask.set(Array.from(saved.mask, Number));
  drawSelection();
  motionStatus.textContent = '元画像と動かす範囲を復元しました。';
}

document.querySelector('#motion-open').addEventListener('click', () => motionDialog.showModal());
document.querySelector('#motion-close').addEventListener('click', () => motionDialog.close());
document.querySelector('#results').addEventListener('click', event => {
  if (!event.target.closest('[data-motion]')) return;
  const image = event.target.closest('.tile').querySelector('img');
  motionInput.value = '';
  motionDialog.showModal();
  loadMotionImage(image.src);
});
motionInput.addEventListener('change', async () => {
  const file = motionInput.files[0];
  if (!file) return;
  if (file.size > 72 * 1024 || !file.name.toLowerCase().endsWith('.png')) {
    motionInput.value = '';
    motionStatus.textContent = '72 KB以下のPNGを選んでください。';
    return;
  }
  await loadMotionImage(file);
});
motionDialog.addEventListener('close', () => {
  motionRevision++;
  motion?.image.close();
  motion = null;
  motionControls.disabled = true;
  motionInput.disabled = false;
  motionInput.value = '';
  motionContext.clearRect(0, 0, motionCanvas.width, motionCanvas.height);
  invalidateMotion();
});

document.querySelector('#motion-auto').addEventListener('click', suggestSelection);
document.querySelector('#motion-clear').addEventListener('click', () => {
  motion.mask.fill(0);
  invalidateMotion();
  drawSelection();
});
motionEffect.addEventListener('change', invalidateMotion);

function paint(x, y) {
  motion.x = x;
  motion.y = y;
  motion.mask[y * motion.width + x] = motionErase.checked ? 0 : 1;
  invalidateMotion();
  drawSelection();
}

function paintPointer(event) {
  if (!motion || motionControls.disabled) return;
  const rect = motionCanvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) * motion.width / rect.width);
  const y = Math.floor((event.clientY - rect.top) * motion.height / rect.height);
  if (x >= 0 && x < motion.width && y >= 0 && y < motion.height) paint(x, y);
}

function showMotionPlayback(playing) {
  motion.playing = playing;
  motionPreview.src = 'data:image/png;base64,' + (playing ? motion.preview.apng : motion.preview.still);
  motionToggle.textContent = playing ? '停止' : '再生';
}

motionToggle.addEventListener('click', () => showMotionPlayback(!motion.playing));

motionCanvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  motionCanvas.setPointerCapture(event.pointerId);
  paintPointer(event);
});
motionCanvas.addEventListener('pointermove', event => {
  if (motionCanvas.hasPointerCapture(event.pointerId)) paintPointer(event);
});
motionCanvas.addEventListener('focus', () => { if (motion) drawSelection(); });
motionCanvas.addEventListener('blur', () => { if (motion) drawSelection(); });
motionCanvas.addEventListener('keydown', event => {
  if (!motion || motionControls.disabled) return;
  if (event.key === ' ') {
    event.preventDefault();
    paint(motion.x, motion.y);
    return;
  }
  const directions = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  motion.x = Math.max(0, Math.min(motion.width - 1, motion.x + direction[0]));
  motion.y = Math.max(0, Math.min(motion.height - 1, motion.y + direction[1]));
  drawSelection();
});

async function submitMotion(action) {
  const project = activeProject();
  const revision = motionRevision;
  const payload = {image: motion.encoded, effect: motionEffect.value, mask: motion.mask.join('')};
  motionControls.disabled = true;
  motionInput.disabled = true;
  motionStatus.textContent = {
    preview: 'プレビューを作っています…',
    export: 'Pixel Motion Studioで書き出しています…',
    frames: 'PNG連番を準備しています…',
  }[action];
  try {
    const response = await fetch('/motion-' + action, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error((await response.json()).error);
    if (action === 'export') {
      const data = await response.blob();
      if (revision !== motionRevision) return;
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'pixel-motion-studio.zip';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      motionStatus.textContent = 'PNG連番、スプライトシート、GIF、APNGをZIPで保存しました。';
    } else if (action === 'frames') {
      const data = await response.json();
      if (revision !== motionRevision) return;
      const files = data.images.map((frame, index) => ({
        name: `frame-${String(index).padStart(3, '0')}.png`,
        data: frame,
      }));
      await projectAPI.sendStudio(project, 'Studioへ渡したモーション · ' + files.length + 'コマ', files, data.fps, payload);
    } else {
      const data = await response.json();
      if (revision !== motionRevision) return;
      motion.preview = data;
      showMotionPlayback(!matchMedia('(prefers-reduced-motion: reduce)').matches);
      motionPreview.hidden = false;
      motionToggle.hidden = false;
      motionExport.disabled = false;
      motionSend.disabled = false;
      motionStatus.textContent = `${data.frames}コマ · ${data.fps} fps · ループ再生`;
    }
  } catch (error) {
    if (revision === motionRevision) motionStatus.textContent = error.message || '処理に失敗しました。';
  } finally {
    if (revision === motionRevision) {
      motionControls.disabled = false;
      motionInput.disabled = false;
    }
  }
}

document.querySelector('#motion-play').addEventListener('click', () => submitMotion('preview'));
motionExport.addEventListener('click', () => submitMotion('export'));
motionSend.addEventListener('click', () => submitMotion('frames'));
