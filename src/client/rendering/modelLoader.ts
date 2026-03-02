import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';

export type ModelLoaderResult = {
  loadModel: (
    url: string,
    onLoad: (gltf: { scene: THREE.Object3D }) => void,
    onError?: (error: unknown) => void
  ) => void;
  loadOptional: (
    url: string,
    onLoad: (gltf: { scene: THREE.Object3D }) => void
  ) => void;
  onAllComplete: (fn: () => void) => void;
};

export const createModelLoader = (opts: {
  requiredCount: number;
  onProgress: (percent: number) => void;
}): ModelLoaderResult => {
  const { requiredCount, onProgress } = opts;
  const loader = new GLTFLoader();
  let completed = 0;
  let allCompleteCallback: (() => void) | null = null;

  const markComplete = () => {
    completed = Math.min(requiredCount, completed + 1);
    onProgress(Math.round(Math.min(100, (completed / requiredCount) * 100)));
    if (completed >= requiredCount && allCompleteCallback) {
      allCompleteCallback();
    }
  };

  const loadModel = (
    url: string,
    onLoad: (gltf: { scene: THREE.Object3D }) => void,
    onError?: (error: unknown) => void
  ) => {
    let settled = false;
    const finalize = () => {
      if (settled) return;
      settled = true;
      markComplete();
    };
    loader.load(
      url,
      (gltf) => {
        try {
          onLoad(gltf);
        } finally {
          finalize();
        }
      },
      undefined,
      (error) => {
        try {
          if (onError) {
            onError(error);
          } else {
            console.error(`Failed to load model: ${url}`, error);
          }
        } finally {
          finalize();
        }
      }
    );
  };

  const loadOptional = (
    url: string,
    onLoad: (gltf: { scene: THREE.Object3D }) => void
  ) => {
    loader.load(url, (gltf) => onLoad(gltf));
  };

  return {
    loadModel,
    loadOptional,
    onAllComplete: (fn) => {
      allCompleteCallback = fn;
      if (completed >= requiredCount) fn();
    },
  };
};
