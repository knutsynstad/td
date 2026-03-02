import * as THREE from 'three';
import type { GroundBounds } from '../../domains/world/coords';
import type { InstancedModelLayer } from '../overlays/instancedModelLayer';
import type { StagingIslandsOverlay } from '../overlays/stagingIslands';
import type { WaterDistanceField } from '../terrain';
import {
  buildCoastlineLandKeys,
  buildWaterDistanceField,
  buildWaterSurfaceGeometry,
} from '../terrain';

export type GroundWaterContext = {
  scene: THREE.Scene;
  pathTileKeys: Set<string>;
  groundTileLayer: InstancedModelLayer;
  stagingIslandsOverlay: StagingIslandsOverlay;
  gridSize: number;
  worldBounds: number;
  waterLevel: number;
  waterRingOuterPadding: number;
};

export type GroundWaterResult = {
  ground: THREE.Mesh;
  groundMaterial: THREE.Material;
  groundPlane: THREE.Plane;
  waterMesh: THREE.Mesh;
  waterMaterial: THREE.ShaderMaterial;
  waterDistanceFieldRef: { current: WaterDistanceField };
  updateGroundFromBounds: (bounds: GroundBounds) => void;
  updateWaterFromBounds: (_bounds: GroundBounds) => void;
  rebuildWaterDistanceField: () => void;
  lastGroundBoundsRef: { current: GroundBounds | null };
};

export const createGroundWaterSystem = (
  ctx: GroundWaterContext
): GroundWaterResult => {
  const lastGroundBoundsRef = { current: null as GroundBounds | null };
  const waterOuterEdge = ctx.worldBounds + ctx.waterRingOuterPadding;

  const initialWaterLandKeys = buildCoastlineLandKeys(
    ctx.worldBounds,
    ctx.gridSize,
    ctx.stagingIslandsOverlay.getLandTileKeys()
  );
  const waterDistanceField = buildWaterDistanceField(
    initialWaterLandKeys,
    waterOuterEdge,
    ctx.gridSize
  );
  const waterMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDistanceTex: { value: waterDistanceField.texture },
      uBounds: {
        value: new THREE.Vector4(
          waterDistanceField.minX,
          waterDistanceField.minZ,
          waterDistanceField.sizeX,
          waterDistanceField.sizeZ
        ),
      },
      uWaterColor: { value: new THREE.Color(0x3f8fb2) },
      uFoamColor: { value: new THREE.Color(0xc9f3fb) },
    },
    transparent: true,
    depthWrite: false,
    vertexShader: `
      varying vec2 vWorldXZ;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldXZ = worldPos.xz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vWorldXZ;
      uniform float uTime;
      uniform sampler2D uDistanceTex;
      uniform vec4 uBounds;
      uniform vec3 uWaterColor;
      uniform vec3 uFoamColor;

      void main() {
        vec2 uv = (vWorldXZ - uBounds.xy) / uBounds.zw;
        uv = clamp(uv, 0.0, 1.0);
        vec4 distanceSample = texture2D(uDistanceTex, uv);
        float distanceToLand = distanceSample.r;

        vec3 baseColor = uWaterColor;
        float emitRate = 0.90;
        float travelSpeed = 0.08;
        float stroke = 0.028;
        float fadeDistance = 2.0;
        float cycle = fract(uTime * emitRate);
        float blur = stroke * 0.5;
        float startOffset = -(0.5 * stroke + blur);
        float center = startOffset + cycle * travelSpeed;
        float halfStroke = max(0.00075, stroke * 0.5);
        float distToCenter = abs(distanceToLand - center);
        float band = 1.0 - smoothstep(halfStroke - blur, halfStroke + blur, distToCenter);
        float lifeFade = 1.0 - cycle;
        float distanceFade = exp(-distanceToLand / max(0.0001, fadeDistance));
        float ringFoam = band * lifeFade * distanceFade;
        float foamAmount = clamp(ringFoam * 0.42, 0.0, 1.0);
        vec3 color = mix(baseColor, uFoamColor, foamAmount * 0.65);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const waterMesh = new THREE.Mesh(
    buildWaterSurfaceGeometry(
      initialWaterLandKeys,
      waterDistanceField,
      ctx.gridSize
    ),
    waterMaterial
  );
  waterMesh.position.set(0, ctx.waterLevel - 0.01, 0);
  waterMesh.castShadow = false;
  waterMesh.receiveShadow = false;
  ctx.scene.add(waterMesh);

  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x52a384 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.visible = false;
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  ground.receiveShadow = true;
  ctx.scene.add(ground);

  const updateGroundFromBounds = (bounds: GroundBounds) => {
    const clampedBounds: GroundBounds = {
      minX: Math.max(bounds.minX, -ctx.worldBounds),
      maxX: Math.min(bounds.maxX, ctx.worldBounds),
      minZ: Math.max(bounds.minZ, -ctx.worldBounds),
      maxZ: Math.min(bounds.maxZ, ctx.worldBounds),
    };
    if (
      clampedBounds.minX > clampedBounds.maxX ||
      clampedBounds.minZ > clampedBounds.maxZ
    ) {
      return;
    }
    if (
      lastGroundBoundsRef.current &&
      lastGroundBoundsRef.current.minX === clampedBounds.minX &&
      lastGroundBoundsRef.current.maxX === clampedBounds.maxX &&
      lastGroundBoundsRef.current.minZ === clampedBounds.minZ &&
      lastGroundBoundsRef.current.maxZ === clampedBounds.maxZ
    ) {
      return;
    }
    lastGroundBoundsRef.current = clampedBounds;
    const width = clampedBounds.maxX - clampedBounds.minX;
    const depth = clampedBounds.maxZ - clampedBounds.minZ;
    ground.scale.set(width, depth, 1);
    ground.position.set(
      (clampedBounds.minX + clampedBounds.maxX) * 0.5,
      0,
      (clampedBounds.minZ + clampedBounds.maxZ) * 0.5
    );
    const positions: THREE.Vector3[] = [];
    const minX = Math.ceil(clampedBounds.minX / ctx.gridSize) * ctx.gridSize;
    const maxX = Math.floor(clampedBounds.maxX / ctx.gridSize) * ctx.gridSize;
    const minZ = Math.ceil(clampedBounds.minZ / ctx.gridSize) * ctx.gridSize;
    const maxZ = Math.floor(clampedBounds.maxZ / ctx.gridSize) * ctx.gridSize;
    for (let x = minX; x <= maxX; x += ctx.gridSize) {
      for (let z = minZ; z <= maxZ; z += ctx.gridSize) {
        const key = `${x},${z}`;
        if (ctx.pathTileKeys.has(key)) continue;
        positions.push(new THREE.Vector3(x, 0, z));
      }
    }
    ctx.groundTileLayer.setPositions(positions);
  };

  const waterDistanceFieldRef = { current: waterDistanceField };

  const rebuildWaterDistanceField = () => {
    const nextLandKeys = buildCoastlineLandKeys(
      ctx.worldBounds,
      ctx.gridSize,
      ctx.stagingIslandsOverlay.getLandTileKeys()
    );
    const next = buildWaterDistanceField(
      nextLandKeys,
      waterOuterEdge,
      ctx.gridSize
    );
    const nextGeometry = buildWaterSurfaceGeometry(
      nextLandKeys,
      next,
      ctx.gridSize
    );
    waterMesh.geometry.dispose();
    waterMesh.geometry = nextGeometry;
    waterDistanceFieldRef.current.texture.dispose();
    waterDistanceFieldRef.current = next;
    waterMaterial.uniforms.uDistanceTex.value = next.texture;
    waterMaterial.uniforms.uBounds.value.set(
      next.minX,
      next.minZ,
      next.sizeX,
      next.sizeZ
    );
  };

  ctx.stagingIslandsOverlay.setTilesChangedListener(rebuildWaterDistanceField);

  return {
    ground,
    groundMaterial,
    groundPlane,
    waterMesh,
    waterMaterial,
    waterDistanceFieldRef,
    updateGroundFromBounds,
    updateWaterFromBounds: (_bounds: GroundBounds) => {},
    rebuildWaterDistanceField,
    lastGroundBoundsRef,
  };
};
