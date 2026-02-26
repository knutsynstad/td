import { requestExpandedMode } from '@devvit/web/client';
import './splash.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (app === null) throw new Error('Missing #app');

const vignette = document.createElement('div');
vignette.className = 'splash-vignette';
app.appendChild(vignette);

const overlay = document.createElement('div');
overlay.className = 'splash-overlay';
overlay.innerHTML = `
  <div class="play-button-wrap">
    <div class="play-button-tape play-button-tape--top" aria-hidden="true"></div>
    <button id="playButton" class="play-button" type="button">
      <span class="play-button__label">Tap to Explore</span>
      <span class="play-button__meta">Model Showcase & Rig Demos</span>
    </button>
    <div class="play-button-tape play-button-tape--bottom" aria-hidden="true"></div>
  </div>
`;
app.appendChild(overlay);

const playButton = overlay.querySelector<HTMLButtonElement>('#playButton');
if (playButton !== null) {
  playButton.addEventListener('click', (event) => {
    requestExpandedMode(event, 'sandbox');
  });
}
