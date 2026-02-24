import { requestExpandedMode } from '@devvit/web/client';
import './splash.css';

const app = document.querySelector<HTMLDivElement>('#app');

if (app !== null) {
  app.innerHTML = `
    <main class="splash-root">
      <button id="playButton" class="play-button" type="button">Play</button>
    </main>
  `;

  const playButton = document.querySelector<HTMLButtonElement>('#playButton');
  if (playButton !== null) {
    playButton.addEventListener('click', (event) => {
      requestExpandedMode(event, 'game');
    });
  }
}
