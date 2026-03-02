import { buildCoinCostMarkup } from './components/coinCost';

export type AppMarkupOptions = {
  coinCostWall: number;
  coinCostTower: number;
};

export const createAppMarkup = ({
  coinCostWall,
  coinCostTower,
}: AppMarkupOptions): string =>
  `
  <div id="loadingScreen" class="loading-screen" role="status" aria-live="polite">
    <div class="loading-screen__panel">
      <div class="loading-screen__title">Loading world</div>
      <div class="loading-screen__subtitle">Preparing models and scene</div>
      <div class="loading-screen__bar" aria-hidden="true">
        <div id="loadingProgressFill" class="loading-screen__bar-fill"></div>
      </div>
      <div id="loadingProgressLabel" class="loading-screen__progress">0%</div>
    </div>
  </div>
  <div id="hud" class="hud">
    <div class="hud-corner hud-corner--top-left">
      <div class="hud-status-stack">
        <div class="wave-display">Wave <span id="wave">0</span></div>
        <div class="hud-meta">
          <div id="mobsRow" class="hud-status">
            <div class="hud-status__primary"></div>
            <div class="hud-status__secondary">0 mobs left</div>
          </div>
          <div id="nextWaveRow" class="hud-status">
            <div class="hud-status__primary"></div>
            <div class="hud-status__secondary">Next wave in 0 sec</div>
          </div>
        </div>
      </div>
    </div>
    <div class="hud-corner hud-corner--top-right">
      <div class="hud-coins">
        <div class="hud-coins__icon-view">
          <canvas id="coinHudCanvas" class="hud-coins__coin-canvas" aria-label="Coins"></canvas>
        </div>
        <span id="coinsCount" class="hud-coins__value">100</span>
      </div>
    </div>
    <div class="hud-overlay">
      <div id="finalCountdown" class="final-countdown"></div>
    </div>
    <div class="build-mode-overlay" id="buildModeOverlay">
      <div class="build-mode-header">
        <span class="build-mode-title" id="buildModeTitle">Place Wall</span>
        <span class="build-mode-hint" id="buildModeHint"></span>
      </div>
      <button class="build-mode-cancel" id="buildModeCancel">Cancel</button>
    </div>
    <div class="hud-corner hud-corner--bottom-right">
      <div class="hud-actions">
        <div class="build-buttons">
          <button id="buildWall" class="hud-button build-button">
            <span class="button-label">Wall</span>
            <span id="wallCount" class="hud-badge">${buildCoinCostMarkup(coinCostWall, 'Coin cost')}</span>
          </button>
          <button id="buildTower" class="hud-button build-button">
            <span class="button-label">Tower</span>
            <span id="towerCount" class="hud-badge">${buildCoinCostMarkup(coinCostTower, 'Coin cost')}</span>
          </button>
        </div>
        <button id="shootButton" class="shoot-button"><span class="button-label">Shoot</span></button>
      </div>
    </div>
    <div class="hud-corner hud-corner--bottom-left">
      <div class="hud-minimap-wrap" id="hudMinimapWrap">
        <div class="hud-minimap-tape-section hud-minimap-tape-section--top" aria-hidden="true"></div>
        <button
          id="hudMinimapToggle"
          class="hud-minimap-toggle"
          type="button"
          aria-label="Expand minimap"
          aria-expanded="false"
        >
          <canvas id="hudMinimap" class="hud-minimap" aria-label="Mob minimap"></canvas>
        </button>
        <div class="hud-minimap-tape-section hud-minimap-tape-section--bottom" aria-hidden="true"></div>
      </div>
    </div>
  </div>
  <div id="bannerOverlay" class="banner-overlay">
    <div id="eventBanner" class="event-banner"></div>
  </div>
`;
