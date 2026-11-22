const studioActions = document.createElement('nav');
studioActions.className = 'workshop-links';
studioActions.setAttribute('aria-label', 'ドット絵工房との連携');
const workshopHome = document.createElement('a');
// Studio normalizes bare "/" links to its own index.html.
workshopHome.href = '/#projects';
workshopHome.textContent = 'ドット絵工房を開く';
const sendWorkshop = document.createElement('button');
sendWorkshop.type = 'button';
sendWorkshop.textContent = '選択中のコマをドット絵工房へ';
const saveStudio = document.createElement('button');
saveStudio.type = 'button';
saveStudio.textContent = 'Studioの作業を保存';
const studioLinkStatus = document.createElement('p');
studioLinkStatus.setAttribute('role', 'status');
studioActions.append(workshopHome, sendWorkshop, saveStudio, studioLinkStatus);
document.querySelector('.intro').after(studioActions);
let studioProject = projectAPI.remembered() || 1;

sendWorkshop.addEventListener('click', async () => {
  if (!frames[selected] || busy) {
    studioLinkStatus.textContent = '渡したいコマを読み込み、選択してください。';
    return;
  }
  sendWorkshop.disabled = true;
  try {
    const source = manifest ? outUrl(selected) : frames[selected].blob;
    const item = await spriteHandoff.pack(source, `studio-frame-${selected + 1}.png`);
    projectAPI.remember(studioProject);
    spriteHandoff.send('workshop', [item]);
  } catch (error) {
    studioLinkStatus.textContent = error.message;
    sendWorkshop.disabled = false;
  }
});

saveStudio.addEventListener('click', async () => {
  if (!frames.length || busy) {
    studioLinkStatus.textContent = '作業中のコマが読み込まれてから保存してください。';
    return;
  }
  saveStudio.disabled = true;
  studioLinkStatus.textContent = 'Studioの作業を保存しています…';
  try {
    const output = manifest && !dirty;
    const sources = frames.map((frame, index) => output ? outUrl(index) : frame.blob);
    const current = settings();
    const submitted = output ? {...current, mode: 'preserve', height: 0, background: 'keep',
      colors: 0, trim: false, hardAlpha: false, steady: false} : current;
    const selectedFrame = selected;
    const items = await Promise.all(sources.map((source, index) =>
      spriteHandoff.pack(source, `frame-${String(index).padStart(3, '0')}.png`)));
    await projectAPI.request('/projects/studio', {
      project: studioProject, label: `Studioの作業 · ${items.length}コマ`,
      files: items, fps: submitted.fps, selected: selectedFrame, settings: submitted,
    });
    studioLinkStatus.textContent = 'Studioの作業をプロジェクトに保存しました。';
  } catch (error) {
    studioLinkStatus.textContent = error.message;
  } finally {
    saveStudio.disabled = false;
  }
});

function applyStudioSettings(saved, fps) {
  const defaults = {mode: 'preserve', background: 'keep', trim: false, hardAlpha: false,
    height: 0, colors: 0, steady: false};
  const values = {...defaults, ...saved, fps};
  for (const id of ['mode', 'background', 'height', 'colors', 'detail', 'despill', 'trim', 'hardAlpha',
    'steady', 'fps', 'keyColor', 'keyTolerance']) {
    const field = $(id);
    if (!field || values[id] == null) continue;
    if (field.type === 'checkbox') field.checked = values[id] === true;
    else if (field.tagName !== 'SELECT' || [...field.options].some(option => option.value === String(values[id]))) {
      field.value = id === 'height' && !values[id] ? '' : values[id];
    }
  }
  for (const id of ['mode', 'background']) $(id).dispatchEvent(new Event('change', {bubbles: true}));
}

window.addEventListener('pageshow', async () => {
  sendWorkshop.disabled = false;
  try {
    const match = location.hash.match(/^#project-entry-([1-9]\d{0,17})$/);
    let handoff;
    if (match) {
      const entry = await projectAPI.entry(match[1]);
      if (entry.kind !== 'studio') throw new Error('Studioの連番を選んでください。');
      studioProject = entry.project;
      projectAPI.remember(studioProject);
      handoff = {...entry.data, files: projectAPI.files(entry.data.files)};
    } else {
      handoff = spriteHandoff.take('studio');
    }
    if (!handoff) return;
    applyStudioSettings(handoff.settings, handoff.fps);
    await addFiles(handoff.files, true);
    markDirty();
    if (frames.length === handoff.files.length) {
      if (handoff.selected) select(handoff.selected);
      studioLinkStatus.textContent = `${frames.length}コマをプロジェクトから開きました。`;
    }
  } catch (error) {
    studioLinkStatus.textContent = error.message;
  }
});
