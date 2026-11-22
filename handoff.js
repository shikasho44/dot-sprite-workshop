// Same-tab, same-origin transfer. PNG data never goes into the URL.
const spriteHandoff = {
  key: 'dotstudio-handoff-v1',
  destinations: {studio: '/studio/app/', workshop: '/'},

  async pack(source, name) {
    let blob = source;
    if (typeof source === 'string') {
      if (source.startsWith('data:image/png;base64,')) return {name, data: source.split(',')[1]};
      const response = await fetch(source);
      if (!response.ok) throw new Error('PNGを読み込めませんでした。');
      blob = await response.blob();
    }
    if (blob.size > 2 * 1024 * 1024) throw new Error('2 MB以下のPNGを選んでください。');
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error('PNGを読み込めませんでした。'));
      reader.readAsDataURL(blob);
    });
    return {name, data};
  },

  send(destination, files, fps = null) {
    if (!Object.hasOwn(this.destinations, destination)) throw new Error('送り先を確認してください。');
    const json = JSON.stringify({destination, files, fps, at: Date.now()});
    if (json.length > 3_000_000) throw new Error('素材が大きいため、PNGを保存して読み込んでください。');
    sessionStorage.setItem(this.key, json);
    location.href = this.destinations[destination] + '#sprite-handoff';
  },

  take(destination) {
    if (location.hash !== '#sprite-handoff') return null;
    const raw = sessionStorage.getItem(this.key);
    sessionStorage.removeItem(this.key);
    history.replaceState(history.state, '', location.pathname + location.search);
    if (!raw || raw.length > 3_000_000) return null;
    const payload = JSON.parse(raw);
    if (payload.destination !== destination || Date.now() - payload.at > 120_000 ||
        !Array.isArray(payload.files) || !payload.files.length || payload.files.length > 64) return null;
    const files = payload.files.map(({data, name}, index) => {
      const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
      const signature = [137, 80, 78, 71, 13, 10, 26, 10];
      if (!signature.every((value, offset) => bytes[offset] === value)) throw new Error('PNGを読み込めませんでした。');
      const filename = typeof name === 'string' && /^[a-zA-Z0-9_.-]{1,90}\.png$/.test(name) ? name : `frame-${index}.png`;
      return new File([bytes], filename, {type: 'image/png'});
    });
    return {files, fps: payload.fps};
  },
};
