const studioActions = document.createElement('nav');
studioActions.className = 'workshop-links';
studioActions.setAttribute('aria-label', 'ドット絵工房との連携');
const workshopHome = document.createElement('a');
workshopHome.href = '/';
workshopHome.textContent = 'ドット絵工房を開く';
const sendWorkshop = document.createElement('button');
sendWorkshop.type = 'button';
sendWorkshop.textContent = '選択中のコマをドット絵工房へ';
const studioLinkStatus = document.createElement('p');
studioLinkStatus.setAttribute('role', 'status');
studioActions.append(workshopHome, sendWorkshop, studioLinkStatus);
document.querySelector('.intro').after(studioActions);

sendWorkshop.addEventListener('click', async () => {
  if (!frames[selected] || busy) {
    studioLinkStatus.textContent = '渡したいコマを読み込み、選択してください。';
    return;
  }
  sendWorkshop.disabled = true;
  try {
    const source = manifest ? outUrl(selected) : frames[selected].blob;
    const item = await spriteHandoff.pack(source, `studio-frame-${selected + 1}.png`);
    spriteHandoff.send('workshop', [item]);
  } catch (error) {
    studioLinkStatus.textContent = error.message;
    sendWorkshop.disabled = false;
  }
});

window.addEventListener('pageshow', async () => {
  sendWorkshop.disabled = false;
  try {
    const handoff = spriteHandoff.take('studio');
    if (!handoff) return;
    $('mode').value = 'preserve';
    $('background').value = 'keep';
    $('trim').checked = false;
    $('hardAlpha').checked = false;
    $('height').value = '';
    $('colors').value = '0';
    $('steady').checked = false;
    if (Number.isInteger(handoff.fps) && handoff.fps >= 1 && handoff.fps <= 60) {
      $('fps').value = handoff.fps;
    }
    await addFiles(handoff.files, true);
    markDirty();
    if (frames.length === handoff.files.length) {
      studioLinkStatus.textContent = `ドット絵工房から${frames.length}コマを受け取りました。`;
    }
  } catch (error) {
    studioLinkStatus.textContent = error.message;
  }
});
