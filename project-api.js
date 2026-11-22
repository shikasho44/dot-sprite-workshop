const projectAPI = {
  selection: 'dot-sprite-project-v1',

  async request(url, data) {
    const response = await fetch(url, data === undefined ? undefined : {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'プロジェクトを開けませんでした。');
    return body;
  },

  remember(project) {
    try { localStorage.setItem(this.selection, String(project)); } catch { /* History remains on disk. */ }
  },

  remembered() {
    try { return Number(localStorage.getItem(this.selection)); } catch { return 0; }
  },

  entry(id) { return this.request('/projects/entries/' + id); },

  openStudio(id) {
    location.href = '/studio/app/#project-entry-' + id;
  },

  async sendStudio(project, label, files, fps, motion = null) {
    const {id} = await this.request('/projects/studio', {project, label, files, fps, motion});
    this.openStudio(id);
  },

  files(frames) {
    return frames.map(({data, name}) => {
      const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
      return new File([bytes], name, {type: 'image/png'});
    });
  },
};
