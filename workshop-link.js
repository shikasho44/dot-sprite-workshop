const spriteLinkStatus = document.querySelector('#studio-handoff-status');

async function sendCandidateToStudio(button) {
  const card = button.closest('.tile');
  const link = card.querySelector('a[download]');
  button.disabled = true;
  spriteLinkStatus.textContent = 'Pixel Motion Studioへ渡しています…';
  try {
    const item = await spriteHandoff.pack(link.href, link.download);
    spriteHandoff.send('studio', [item]);
  } catch (error) {
    spriteLinkStatus.textContent = error.message;
    button.disabled = false;
  }
}

document.querySelector('#results').addEventListener('click', event => {
  const button = event.target.closest('[data-to-studio]');
  if (button) sendCandidateToStudio(button);
});

function receiveStudioImage() {
  try {
    const transfer = spriteHandoff.take('workshop');
    if (!transfer) return;
    const picker = document.querySelector('#reference-image');
    const selection = new DataTransfer();
    selection.items.add(transfer.files[0]);
    document.querySelector('input[name="mode"][value="reference"]').click();
    picker.files = selection.files;
    picker.dispatchEvent(new Event('change', {bubbles: true}));
    spriteLinkStatus.textContent = 'Pixel Motion StudioからPNGを受け取りました。';
    if (document.querySelector('#prompt').hidden) picker.focus();
    else document.querySelector('#prompt').focus();
  } catch (error) {
    spriteLinkStatus.textContent = error.message;
  }
}

window.addEventListener('pageshow', () => {
  document.querySelectorAll('[data-to-studio]:disabled').forEach(button => { button.disabled = false; });
  receiveStudioImage();
});
