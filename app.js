const form = document.querySelector('#generator');
const promptField = document.querySelector('#prompt');
const submit = document.querySelector('#submit');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const tile = document.querySelector('#tile');
const translation = document.querySelector('#translation');
const referenceFields = document.querySelector('#reference-fields');
const referenceInput = document.querySelector('#reference-image');
const referenceError = document.querySelector('#reference-error');
const textModels = document.querySelector('#text-models');
const textExamples = document.querySelector('#text-examples');
const promptLabel = document.querySelector('label[for="prompt"]');
let imageEdit = false;
const workshopCapabilities = fetch('/capabilities')
  .then(response => response.ok ? response.json() : {})
  .catch(() => ({}));

function makeTiles(images, filePrefix) {
  return images.map((url, index) => {
    const node = tile.content.firstElementChild.cloneNode(true);
    const image = node.querySelector('img');
    const link = node.querySelector('a');
    const number = index + 1;
    image.src = url;
    image.alt = `候補 ${number}`;
    node.querySelector('span').textContent = String(number).padStart(2, '0');
    link.href = url;
    link.download = `${filePrefix}-${number}.png`;
    link.setAttribute('aria-label', `候補 ${number} をPNGで保存`);
    return node;
  });
}

function modelName(model) {
  return model === 'ubanova-16' ? 'UbaNova-16' : 'pixelart-50m';
}

function batchTiles(batch) {
  return makeTiles(batch.images.map(image => 'data:image/png;base64,' + image), `${batch.model}-${batch.seed}`);
}

function batchDetails(batch) {
  const loading = batch.load_seconds ? ` · 初回読込 ${batch.load_seconds.toFixed(2)}秒` : '';
  return `${batch.size} × ${batch.size} px · 生成 ${batch.seconds.toFixed(2)}秒${loading}`;
}

function resultGroup(name, details, items) {
  const group = document.createElement('section');
  group.className = 'result-group';
  const title = document.createElement('h3');
  title.textContent = name;
  const note = document.createElement('p');
  note.textContent = details;
  const grid = document.createElement('div');
  grid.className = items.length === 1 ? 'original-tile' : 'tiles';
  grid.append(...items);
  group.append(title, note, grid);
  return group;
}

function showBatches(data) {
  if (data.model === 'reference') {
    showReference(data);
    return;
  }
  const comparing = data.model === 'compare';
  results.className = comparing ? 'comparison' : 'tiles';
  if (!comparing) {
    results.replaceChildren(...batchTiles(data));
    status.textContent = `${modelName(data.model)} · ${batchDetails(data)}`;
    return;
  }
  results.replaceChildren(...data.batches.map(batch => {
    const group = resultGroup(modelName(batch.model), batchDetails(batch), batchTiles(batch));
    group.dataset.model = batch.model;
    return group;
  }));
  status.textContent = '2モデル · 計8案';
}

function showReference(data) {
  const groups = [
    ['変換見本', '元の形と色を残した32 × 32 px',
      makeTiles(['data:image/png;base64,' + data.original], `original-${data.seed}`)],
  ];
  if (data.images.length) {
    groups.push(['AIで描き直した4案', `FLUX.2 Klein 4B · 32 × 32 px · ${data.seconds.toFixed(1)}秒`,
      makeTiles(data.images.map(image => 'data:image/png;base64,' + image), `reference-${data.seed}`)]);
  }
  results.className = 'reference-results';
  results.replaceChildren(...groups.map(([name, detail, items]) => resultGroup(name, detail, items)));
  status.textContent = data.images.length ? '変換見本1枚 · AI 4案' : '変換見本1枚 · 32 × 32 px';
}

function referenceData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('画像を読み込めませんでした。'));
    reader.readAsDataURL(file);
  });
}

function setReferenceFile(file) {
  const selection = new DataTransfer();
  selection.items.add(file);
  referenceInput.files = selection.files;
  referenceInput.dispatchEvent(new Event('change', {bubbles: true}));
}

function showGeneration(data) {
  showBatches(data);
  translation.querySelector('span').textContent = data.translation || '';
  translation.hidden = !data.translation;
}

function restoreGeneration(saved) {
  const data = saved.result;
  const reference = data.model === 'reference';
  document.querySelector(reference ? 'input[value="reference"]' : 'input[value="text"]').checked = true;
  if (!reference) document.querySelector('input[name="model"][value="' + CSS.escape(data.model) + '"]').checked = true;
  referenceInput.value = '';
  if (reference && saved.input?.data) {
    const file = projectAPI.files([{data: saved.input.data, name: saved.input.name || 'reference.png'}])[0];
    setReferenceFile(file);
  }
  promptField.value = saved.prompt || '';
  status.classList.remove('error');
  syncGenerator();
  showGeneration(data);
}

results.replaceChildren(...makeTiles(Array.from({length: 4}, (_, i) => `/sample/${i + 1}.png`), 'sample-chest'));

function syncGenerator() {
  const values = new FormData(form);
  const imageMode = values.get('mode') === 'reference';
  const previewOnly = imageMode && !imageEdit;
  referenceFields.hidden = !imageMode;
  referenceInput.required = imageMode;
  textModels.hidden = imageMode;
  textExamples.hidden = imageMode;
  document.querySelector('#reference-setup').hidden = !previewOnly;
  document.querySelector('#prompt-hint').hidden = previewOnly;
  promptLabel.hidden = promptField.hidden = previewOnly;
  promptField.required = !previewOnly;
  promptLabel.textContent = imageMode ? '画像に加えたい変更' : '描きたいもの';
  promptField.placeholder = imageMode ? '例　金色に…' : '例　金色の鍵…';
  submit.textContent = imageMode ? (previewOnly ? '変換見本を作る' : '見本と4案を生成')
    : (values.get('model') === 'compare' ? '各4案を生成' : '4案を生成');
}
workshopCapabilities.then(value => { imageEdit = value.image_edit === true; syncGenerator(); });
form.addEventListener('change', event => {
  if (event.target.name === 'mode' || event.target.name === 'model') {
    referenceError.textContent = '';
    syncGenerator();
  }
});
referenceInput.addEventListener('change', () => { referenceError.textContent = ''; });

for (const example of document.querySelectorAll('[data-prompt]')) {
  example.addEventListener('click', () => {
    promptField.value = example.dataset.prompt;
    promptField.focus();
  });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled) return;
  const values = new FormData(form);
  const isReference = values.get('mode') === 'reference';
  const previewOnly = isReference && !imageEdit;
  const prompt = promptField.value.trim();
  if (!previewOnly && !prompt) {
    promptField.value = '';
    promptField.reportValidity();
    return;
  }
  const file = referenceInput.files[0];
  if (isReference && (!file || file.size > 10 * 1024 * 1024)) {
    referenceError.textContent = file ? '10 MB以下の画像を選んでください。' : '元画像を選んでください。';
    referenceInput.focus();
    return;
  }
  submit.disabled = true;
  results.setAttribute('aria-busy', 'true');
  status.classList.remove('error');
  status.textContent = isReference ? (previewOnly ? '変換見本を作成中…' : '画像をもとに4案を生成中…')
    : '処理中… 初回はモデルを読み込みます';
  try {
    await projectReady;
    const project = activeProject();
    const request = isReference ? {prompt, image: await referenceData(file), image_name: file.name}
      : {model: values.get('model'), prompt};
    if (project) request.project = project;
    const endpoint = isReference ? (previewOnly ? '/reference-preview' : '/generate-from-image') : '/generate';
    const response = await fetch(endpoint, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(request),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    showGeneration(data);
    if (data.history_id && activeProject() === project) await showHistory();
    if (data.history_error) projectStatus.textContent = data.history_error;
  } catch (error) {
    status.classList.add('error');
    status.textContent = error instanceof TypeError ? '接続が切れました。起動ウィンドウを確認してください。' : error.message;
  } finally {
    results.setAttribute('aria-busy', 'false');
    submit.disabled = false;
  }
});
