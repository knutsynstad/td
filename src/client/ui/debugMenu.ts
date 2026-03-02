import type { DebugViewState } from '../gameContext';
import type { CorridorFlowField } from '../domains/world/pathfinding/corridorFlowField';
import type { WorldGrid } from '../rendering/overlays/worldGrid';

export type DebugMenuContext = {
  app: HTMLElement;
  debugViewState: DebugViewState;
  playerShootRangeRing: { visible: boolean };
  worldGrid: WorldGrid;
  flowFieldDebugOverlay: {
    clear: () => void;
    upsert: (field: CorridorFlowField) => void;
  };
  getCastleFlowField: () => CorridorFlowField;
  triggerEventBanner: (text: string, duration?: number) => void;
};

export type DebugMenuResult = {
  root: HTMLDivElement;
  applyDebugViewState: () => void;
  syncDebugMenuInputs: () => void;
  setDebugMenuOpen: (open: boolean) => void;
  toggleDebugMenu: () => void;
  isDebugMenuOpen: () => boolean;
};

export const createDebugMenu = (ctx: DebugMenuContext): DebugMenuResult => {
  const {
    app,
    debugViewState,
    playerShootRangeRing,
    worldGrid,
    flowFieldDebugOverlay,
    getCastleFlowField,
    triggerEventBanner,
  } = ctx;

  let isOpen = false;

  const debugMenuRoot = document.createElement('div');
  debugMenuRoot.className = 'debug-menu';
  debugMenuRoot.innerHTML = `
    <div class="debug-menu__header">Debug Views <span class="debug-menu__hint">[&#96;]</span></div>
    <label class="debug-menu__row">
      <input type="checkbox" data-debug-toggle="flowField" />
      <span>Flow Field Debug</span>
    </label>
    <label class="debug-menu__row">
      <input type="checkbox" data-debug-toggle="playerShootRange" />
      <span>Player Shoot Range</span>
    </label>
    <label class="debug-menu__row">
      <input type="checkbox" data-debug-toggle="worldGrid" />
      <span>World Grid</span>
    </label>
    <button type="button" class="debug-menu__action" data-debug-action="resetGame">
      Reset Game
    </button>
  `;
  app.appendChild(debugMenuRoot);

  const debugFlowFieldInput = debugMenuRoot.querySelector<HTMLInputElement>(
    'input[data-debug-toggle="flowField"]'
  );
  const debugPlayerRangeInput = debugMenuRoot.querySelector<HTMLInputElement>(
    'input[data-debug-toggle="playerShootRange"]'
  );
  const debugWorldGridInput = debugMenuRoot.querySelector<HTMLInputElement>(
    'input[data-debug-toggle="worldGrid"]'
  );
  const debugResetGameButton = debugMenuRoot.querySelector<HTMLButtonElement>(
    'button[data-debug-action="resetGame"]'
  );

  const requestResetGame = async (): Promise<string | null> => {
    const endpoints = ['/api/game/reset', '/internal/menu/reset-game'];
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        if (!response.ok) continue;
        const payload = await response.json();
        if (
          typeof payload === 'object' &&
          payload !== null &&
          typeof payload.showToast === 'string'
        ) {
          return payload.showToast;
        }
      } catch {
        // Try next endpoint
      }
    }
    return null;
  };

  const applyDebugViewState = () => {
    playerShootRangeRing.visible = debugViewState.playerShootRange;
    worldGrid.setVisible(debugViewState.worldGrid);
    if (!debugViewState.flowField) {
      flowFieldDebugOverlay.clear();
    } else {
      flowFieldDebugOverlay.upsert(getCastleFlowField());
    }
  };

  const syncDebugMenuInputs = () => {
    if (debugFlowFieldInput)
      debugFlowFieldInput.checked = debugViewState.flowField;
    if (debugPlayerRangeInput)
      debugPlayerRangeInput.checked = debugViewState.playerShootRange;
    if (debugWorldGridInput)
      debugWorldGridInput.checked = debugViewState.worldGrid;
  };

  const setDebugMenuOpen = (open: boolean) => {
    isOpen = open;
    debugMenuRoot.classList.toggle('is-open', open);
  };

  const toggleDebugMenu = () => {
    setDebugMenuOpen(!isOpen);
  };

  debugFlowFieldInput?.addEventListener('change', () => {
    debugViewState.flowField = debugFlowFieldInput.checked;
    applyDebugViewState();
  });
  debugPlayerRangeInput?.addEventListener('change', () => {
    debugViewState.playerShootRange = debugPlayerRangeInput.checked;
    applyDebugViewState();
  });
  debugWorldGridInput?.addEventListener('change', () => {
    debugViewState.worldGrid = debugWorldGridInput.checked;
    applyDebugViewState();
  });
  debugResetGameButton?.addEventListener('click', () => {
    if (debugResetGameButton.disabled) return;
    debugResetGameButton.disabled = true;
    void requestResetGame()
      .then((toast) => {
        if (toast) {
          triggerEventBanner(toast, 3.6);
          return;
        }
        triggerEventBanner('Failed to reset game');
      })
      .finally(() => {
        debugResetGameButton.disabled = false;
      });
  });

  syncDebugMenuInputs();
  applyDebugViewState();
  setDebugMenuOpen(false);

  return {
    root: debugMenuRoot,
    applyDebugViewState,
    syncDebugMenuInputs,
    setDebugMenuOpen,
    toggleDebugMenu,
    isDebugMenuOpen: () => isOpen,
  };
};
