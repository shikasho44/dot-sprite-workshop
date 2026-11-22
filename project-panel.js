const projectSelect = document.querySelector('#project-select');
const projectCreate = document.querySelector('#project-create');
const projectList = document.querySelector('#project-history');
const projectStatus = document.querySelector('#project-status');
const projectMore = document.querySelector('#project-more');
let historyCursor = null;
let historyRevision = 0;

function activeProject() {
  return Number(projectSelect.value) || null;
}

async function loadProjects(preferred) {
  const projects = await projectAPI.request('/projects');
  const wanted = preferred || projectAPI.remembered();
  projectSelect.replaceChildren(...projects.map(project => new Option(project.name, project.id)));
  projectSelect.value = String(projects.some(project => project.id === wanted) ? wanted : projects[0].id);
  projectAPI.remember(activeProject());
}

function entryButton(name, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = name;
  button.onclick = async () => {
    button.disabled = true;
    try { await handler(); } catch (error) { projectStatus.textContent = error.message; }
    finally { button.disabled = false; }
  };
  return button;
}

function renderHistoryItem(entry) {
  const item = document.createElement('li');
  const title = document.createElement('strong');
  title.textContent = entry.label;
  const time = document.createElement('time');
  time.dateTime = entry.created;
  time.textContent = new Date(entry.created).toLocaleString('ja-JP');
  const actions = document.createElement('span');
  if (entry.kind === 'studio') {
    actions.append(entryButton('Studioで開き直す', () => projectAPI.openStudio(entry.id)));
    if (entry.has_motion) actions.append(entryButton('動かす範囲を開く', async () => {
      const stored = await projectAPI.entry(entry.id);
      await restoreMotion(stored.data.motion);
    }));
  } else {
    actions.append(entryButton('候補を開き直す', async () => {
      if (submit.disabled) throw new Error('生成が終わってから履歴を開いてください。');
      const stored = await projectAPI.entry(entry.id);
      if (stored.project !== activeProject() || submit.disabled) return;
      restoreGeneration(stored.data);
      projectStatus.textContent = '保存した候補を開きました。再生成せずそのまま使えます。';
      document.querySelector('#results-title').focus();
    }));
  }
  const description = document.createElement('span');
  description.append(title, time);
  item.append(description, actions);
  return item;
}

async function refreshHistory(append = false) {
  const project = activeProject();
  if (!project) return;
  const revision = ++historyRevision;
  const cursor = append ? historyCursor : null;
  if (!append) projectList.replaceChildren();
  projectMore.hidden = true;
  const url = '/projects/' + project + '/history' + (cursor ? '?before=' + cursor : '');
  const data = await projectAPI.request(url);
  if (revision !== historyRevision) return;
  historyCursor = data.before;
  projectList.append(...data.entries.map(renderHistoryItem));
  projectMore.hidden = !data.before;
  projectStatus.textContent = projectList.childElementCount ? '' : '保存した候補やStudioの連番がここに表示されます。';
}

async function showHistory(append = false) {
  try { await refreshHistory(append); }
  catch (error) { projectStatus.textContent = error.message; }
}

const projectReady = loadProjects().then(() => showHistory()).catch(error => {
  projectStatus.textContent = error.message;
});

projectSelect.addEventListener('change', () => {
  projectAPI.remember(activeProject());
  showHistory();
});

projectCreate.addEventListener('submit', async event => {
  event.preventDefault();
  const name = document.querySelector('#project-name');
  const button = projectCreate.querySelector('button');
  button.disabled = true;
  try {
    const {id} = await projectAPI.request('/projects', {name: name.value});
    await loadProjects(id);
    name.value = '';
    await showHistory();
    projectSelect.focus();
  } catch (error) { projectStatus.textContent = error.message; }
  finally { button.disabled = false; }
});
projectMore.addEventListener('click', () => showHistory(true));
