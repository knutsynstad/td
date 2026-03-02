import * as THREE from 'three';

export type CoinHudSetupInput = {
  app: HTMLElement;
  coinHudCanvasEl: HTMLCanvasElement;
};

export type CoinHudSetupResult = {
  coinHudScene: THREE.Scene;
  coinHudCamera: THREE.PerspectiveCamera;
  coinHudRenderer: THREE.WebGLRenderer;
  coinHudRoot: THREE.Group;
  coinTrailCanvasEl: HTMLCanvasElement;
  coinTrailScene: THREE.Scene;
  coinTrailCamera: THREE.OrthographicCamera;
  coinTrailRenderer: THREE.WebGLRenderer;
};

export const createCoinHudSetup = ({
  app,
  coinHudCanvasEl,
}: CoinHudSetupInput): CoinHudSetupResult => {
  const coinHudScene = new THREE.Scene();
  const coinHudCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  coinHudCamera.position.set(0, 0.8, 3);
  coinHudCamera.lookAt(0, 0, 0);
  const coinHudRenderer = new THREE.WebGLRenderer({
    canvas: coinHudCanvasEl,
    antialias: true,
    alpha: true,
  });
  coinHudRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  coinHudRenderer.setSize(36, 36, false);
  coinHudRenderer.outputColorSpace = THREE.SRGBColorSpace;
  const coinHudAmbient = new THREE.AmbientLight(0xffffff, 1.05);
  coinHudScene.add(coinHudAmbient);
  const coinHudKey = new THREE.DirectionalLight(0xffffff, 1.15);
  coinHudKey.position.set(1.5, 2, 2);
  coinHudScene.add(coinHudKey);
  const coinHudRoot = new THREE.Group();
  coinHudScene.add(coinHudRoot);

  const coinTrailCanvasEl = document.createElement('canvas');
  coinTrailCanvasEl.style.position = 'fixed';
  coinTrailCanvasEl.style.inset = '0';
  coinTrailCanvasEl.style.width = '100%';
  coinTrailCanvasEl.style.height = '100%';
  coinTrailCanvasEl.style.pointerEvents = 'none';
  coinTrailCanvasEl.style.zIndex = '1800';
  app.appendChild(coinTrailCanvasEl);

  const coinTrailScene = new THREE.Scene();
  const coinTrailCamera = new THREE.OrthographicCamera(
    0,
    window.innerWidth,
    window.innerHeight,
    0,
    -20,
    20
  );
  const coinTrailAmbient = new THREE.AmbientLight(0xffffff, 1.1);
  coinTrailScene.add(coinTrailAmbient);
  const coinTrailKey = new THREE.DirectionalLight(0xffffff, 1.2);
  coinTrailKey.position.set(0.6, 0.8, 1.2);
  coinTrailScene.add(coinTrailKey);
  const coinTrailRenderer = new THREE.WebGLRenderer({
    canvas: coinTrailCanvasEl,
    antialias: true,
    alpha: true,
  });
  coinTrailRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  coinTrailRenderer.setSize(window.innerWidth, window.innerHeight, false);
  coinTrailRenderer.outputColorSpace = THREE.SRGBColorSpace;

  return {
    coinHudScene,
    coinHudCamera,
    coinHudRenderer,
    coinHudRoot,
    coinTrailCanvasEl,
    coinTrailScene,
    coinTrailCamera,
    coinTrailRenderer,
  };
};
