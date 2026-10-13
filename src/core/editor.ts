import { reparent, setAffineTransform } from '../edit/groups';
import { Fusion } from '../edit/fuse';
import { Shrinkwrap } from '../edit/shrinkwrap';
import type { LibraryAttribution } from '../library/polyhaven';
import { combine } from '../edit/combine';
import type { Composite } from '../edit/combine';
import { Separator } from '../edit/separate';
import type { SeparationState } from '../edit/separate';
import { loadEnvironment } from './environments';
import type { EnvironmentAsset } from './environments';
import { loadUserTexture, textureStates, applyTextureStates, copyUserTextures, clearUserTextures } from './materialTextures';
import type { TextureSlot } from './materialTextures';
import { materialToJSON, applyMaterial } from './state';
// Focused imports skip Babylon's side effects; without these, the methods below are silent stubs:
// scene picking (taps, measurements, rig, separate) and beginDirectAnimation (simple motions).
// The skybox is built by `createSkybox` below instead of Babylon's scene helpers (≈420 KB).
import '@babylonjs/core/Culling/ray.js';
import '@babylonjs/core/Animations/animatable.js';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { AssetContainer } from '@babylonjs/core/assetContainer.js';
import { BackgroundMaterial } from '@babylonjs/core/Materials/Background/backgroundMaterial.js';
import { BoundingBox } from '@babylonjs/core/Culling/boundingBox.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture.js';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { FilesInputStore } from '@babylonjs/core/Misc/filesInputStore.js';
import { Frustum } from '@babylonjs/core/Maths/math.frustum.js';
import type { GizmoManager } from '@babylonjs/core/Gizmos/gizmoManager.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { invalidateSurfaces, prepareSurface, surfaceNormal } from './surface';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder.js';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { PointLight } from '@babylonjs/core/Lights/pointLight.js';
import { PointerDragBehavior } from '@babylonjs/core/Behaviors/Meshes/pointerDragBehavior.js';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents.js';
import { Scene } from '@babylonjs/core/scene.js';
import { SelectionOutlineLayer } from '@babylonjs/core/Layers/selectionOutlineLayer.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { ShadowLight } from '@babylonjs/core/Lights/shadowLight.js';
import { SpotLight } from '@babylonjs/core/Lights/spotLight.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Viewport } from '@babylonjs/core/Maths/math.viewport.js';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import type { Node } from '@babylonjs/core/node.js';
import { registerBuiltInLoaders } from '@babylonjs/loaders/dynamic.js';
import { GridMaterial } from '@babylonjs/materials/grid/gridMaterial.js';
import { ShadowOnlyMaterial } from '@babylonjs/materials/shadowOnly/shadowOnlyMaterial.js';
import { tr } from './i18n';
import { Tools } from '../tools/tools';
import { findLightPreset, presetIntensity } from './presets';
import { Animator } from '../animation/animation';
import { Poser, captureJoints, restoreJoints } from '../animation/pose';
import { Motion } from '../animation/motion';
import { Rigger, updateHelperBones } from '../rigging/rigging';
import { ModelOptimizer } from '../optimize/optimizer';
import type { Optimization } from '../optimize/optimizer';
import { TextureOptimizer } from '../optimize/textures';
import type { TextureOptimization } from '../optimize/textures';
import type { RigState } from '../rigging/rigging';
import type { MotionSettings } from '../animation/motion';
import type { ClipState } from '../animation/animation';
import type { Axis } from '../tools/tools';
import { forgetHumanoid, jointNodes } from '../rigging/humanoid';
import type { HumanBone } from '../rigging/humanoid';
import { ClipManager } from '../animation/retarget';
import type { AddedClip } from '../animation/retarget';

registerBuiltInLoaders();

export const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj', 'stl', 'fbx', 'ply', 'splat', 'spz', 'sog', 'usdz', 'babylon'];

export type Tool = 'move' | 'rotate' | 'scale';
export type LightType = 'point' | 'spot' | 'directional';
export type PrimitiveType = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane';
export type GroundMode = 'shadow' | 'solid' | 'none';
export type ChangeKind = 'selection' | 'entities' | 'transform' | 'history' | 'env' | 'photo' | 'tool' | 'animation' | 'pose' | 'rig' | 'optimize' | 'activity';

export interface Entity {
  id: number;
  name: string;
  kind: 'model' | 'primitive' | 'light';
  root: Mesh;
  meshes: AbstractMesh[];
  animationGroups: AnimationGroup[];
  /** Clip shown/played (index in `animationGroups`). */
  clipIndex?: number;
  /** Humanoid bones mapped by hand (canonical bone → joint name). */
  boneMap?: Partial<Record<HumanBone, string>>;
  /** Joints were posed by hand (the pose is kept over the paused clip and saved). */
  posed?: boolean;
  /** Clips retargeted from other files (also in `animationGroups`). */
  addedClips?: AddedClip[];
  /** Simple motion (spin, float…) on a child pivot. */
  motion?: MotionSettings;
  /** Skeleton given in the app (manual rigging). */
  rig?: RigState;
  /** Optimized variant (fewer triangles), reversible. */
  optimization?: Optimization;
  /** Compressed or downscaled textures, reversible. */
  textureOptimization?: TextureOptimization;
  /** Part of a model separated from the rest (triangle subsets or cut geometry). */
  separation?: SeparationState;
  composite?: Composite;
  groupMembers?: Entity[];
  groupParent?: Entity;
  castShadows: boolean;
  visible: boolean;
  light?: ShadowLight;
  lightType?: LightType;
  shadowGen?: ShadowGenerator;
  source?: ModelSource;
  primitive?: PrimitiveType;
}

export interface ModelSource {
  container: AssetContainer;
  fitScale: number;
  fitOffset: Vector3;
  asset: AssetRef;
}

/** Where a model came from: user files (main + dependencies) or a URL. Used when saving the project. */
export interface AssetRef {
  attribution?: LibraryAttribution;
  id: number;
  name: string;
  url?: string;
  main?: File;
  deps?: File[];
}

export interface AddOptions {
  /** Place and size the new shape to fill this world box (instead of the free spot in view). */
  fit?: { center: Vector3; size: Vector3 };
  publish?: boolean;
  record?: boolean;
  select?: boolean;
}

interface TransformSnapshot {
  p: Vector3;
  q: Quaternion;
  s: Vector3;
  pre: Matrix;
}

interface Command {
  undo(): void;
  redo(): void;
  entities?: Entity[];
}

export const ENV_PRESETS: Record<string, { label: string; url: string }> = {
  studio: { label: 'Studio', url: 'https://assets.babylonjs.com/environments/studio.env' },
  neutral: { label: 'Neutral', url: 'https://assets.babylonjs.com/environments/environmentSpecular.env' },
  room: { label: 'Room', url: 'https://assets.babylonjs.com/textures/room.env' },
  country: { label: 'Countryside', url: 'https://assets.babylonjs.com/textures/country.env' },
  parking: { label: 'Parking lot', url: 'https://assets.babylonjs.com/textures/parking.env' },
  night: { label: 'Night', url: 'https://assets.babylonjs.com/textures/night.env' },
};

export const SAMPLE_MODELS = [
  // CC0 Mannequin (Quaternius), bundled: rigged (posing, animation library) and static (to try rigging)
  { label: 'Mannequin', url: `${import.meta.env.BASE_URL}models/mannequin.glb` },
  { label: 'Mannequin, no skeleton', url: `${import.meta.env.BASE_URL}models/mannequin-static.glb` },
  { label: 'Boombox', url: 'https://assets.babylonjs.com/meshes/boombox.glb' },
  { label: 'Helmet', url: 'https://assets.babylonjs.com/meshes/flightHelmet.glb' },
  { label: 'Character', url: 'https://assets.babylonjs.com/meshes/HVGirl.glb' },
  { label: 'Robot', url: 'https://assets.babylonjs.com/meshes/Xbot.glb' },
  { label: 'Shark', url: 'https://assets.babylonjs.com/meshes/shark.glb' },
  { label: 'Airplane', url: 'https://assets.babylonjs.com/meshes/aerobatic_plane.glb' },
];

export interface EnvSettings {
  attribution?: LibraryAttribution;
  custom?: string;
  preset: string;
  intensity: number;
  rotation: number;
  skybox: boolean;
  skyboxBlur: number;
  background: string;
  ground: GroundMode;
  groundColor: string;
  grid: boolean;
  ambient: number;
}

export interface PhotoSettings {
  fov: number;
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  vignette: number;
  bloom: number;
  bloomThreshold: number;
  dof: boolean;
  fStop: number;
  focusDistance: number;
  grain: number;
  chromatic: number;
  sharpen: number;
  aspect: string;
}

export const DEFAULT_ENV: EnvSettings = {
  preset: 'studio',
  intensity: 1,
  rotation: 0,
  skybox: true,
  skyboxBlur: 0.6,
  background: '#1b1526',
  ground: 'shadow',
  groundColor: '#2c2438',
  grid: true,
  ambient: 0.15,
};

export const DEFAULT_PHOTO: PhotoSettings = {
  fov: 45,
  exposure: 1,
  contrast: 1.1,
  saturation: 0,
  temperature: 0,
  vignette: 0,
  bloom: 0,
  bloomThreshold: 0.8,
  dof: false,
  fStop: 2.8,
  focusDistance: 5,
  grain: 0,
  chromatic: 0,
  sharpen: 0,
  aspect: 'free',
};

const isTouch = matchMedia('(pointer: coarse)').matches;

/** Creates a light of the given type (used for editor lights and for AR preset lights). */
export function createLight(
  type: LightType,
  name: string,
  scene: Scene,
  opts: { position?: Vector3; direction?: Vector3; angle?: number; color?: Color3 } = {},
): ShadowLight {
  const position = opts.position ?? Vector3.Zero();
  const direction = opts.direction ?? new Vector3(0, 0, 1);
  let light: ShadowLight;
  if (type === 'point') {
    light = new PointLight(name, position, scene);
  } else if (type === 'spot') {
    light = new SpotLight(name, position, direction, opts.angle ?? Math.PI / 4, 2, scene);
  } else {
    light = new DirectionalLight(name, direction, scene);
    light.position.copyFrom(position);
    (light as DirectionalLight).autoCalcShadowZBounds = true;
  }
  const color = opts.color ?? Color3.White();
  light.diffuse = color;
  light.specular = color.clone();
  return light;
}

/** Shadow generator with the app's settings (softer filtering for spot/sun, Poisson for point lights). */
export function createShadowGenerator(light: ShadowLight, type: LightType) {
  const gen = new ShadowGenerator(isTouch ? 1024 : 2048, light);
  if (type === 'point') {
    gen.usePoissonSampling = true;
  } else {
    gen.usePercentageCloserFiltering = true;
    gen.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  }
  gen.bias = 0.0008;
  gen.normalBias = 0.015;
  return gen;
}
const ACCENT = Color3.FromHexString('#e9a83b');

export class Editor {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly pipeline: DefaultRenderingPipeline;
  readonly changed = new Observable<ChangeKind>();
  readonly loading = new Observable<{ name: string; progress: number } | null>();

  entities: Entity[] = [];
  selected: Entity | null = null;
  tool: Tool = 'move';
  snap = false;
  photoMode = false;
  recording = false;
  cameraBackground = false;
  /** In an AR session: helpers hidden, no sky/background, floor becomes a shadow catcher. */
  arMode = false;
  private arSaved: EnvSettings | null = null;

  /** No editing helpers on screen (photo mode or AR). */
  private thumbnailMode = false;
  get cleanView() {
    return this.photoMode || this.arMode || this.thumbnailMode;
  }

  get groundMesh() {
    return this.ground;
  }

  env: EnvSettings = { ...DEFAULT_ENV };
  photo: PhotoSettings = { ...DEFAULT_PHOTO };

  private gizmos: GizmoManager | null = null;
  private gizmoLoad: Promise<void> | null = null;
  gizmoLoading = false;
  gizmoError: string | null = null;
  private readonly outline: SelectionOutlineLayer;
  private readonly drag: PointerDragBehavior;
  private readonly hemi: HemisphericLight;
  private readonly ground: Mesh;
  private readonly grid: Mesh;
  private envTexture: BaseTexture | null = null;
  private environmentSource = '';
  readonly environments = new Map<string, EnvironmentAsset>();
  private skybox: Mesh | null = null;
  readonly helpers = new Set<AbstractMesh>();
  /** Measurement/guide visuals: never selected, exported or shown in photos. */
  readonly overlays = new Set<AbstractMesh>();
  readonly tools: Tools;
  /** Clip playback of objects. */
  readonly anim = new Animator(this);
  /** Posing skeletons by hand. */
  readonly pose: Poser;
  /** Clips from the library or imported files, retargeted onto humanoids. */
  readonly clips = new ClipManager(this);
  /** Spin, float, pulse, sway for any object. */
  readonly motions = new Motion(this);
  /** Manual rigging of static humanoids. */
  readonly rigger = new Rigger(this);
  /** Optimized variants of heavy models. */
  readonly optimizer = new ModelOptimizer(this);
  readonly fusion = new Fusion(this);
  readonly wrap = new Shrinkwrap(this);
  readonly separator = new Separator(this);
  readonly textureOptimizer = new TextureOptimizer(this);
  /** Other selected objects besides `selected` (which is the reference for alignment). */
  extra: Entity[] = [];
  /** Touch: taps add to / remove from the selection instead of replacing it. */
  multiSelect = false;
  private followStart: { entity: Entity; pos: Vector3 }[] = [];
  private primaryStart: Vector3 | null = null;
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private pending: { entity: Entity; before: TransformSnapshot }[] | null = null;
  private dragStart: { pos: Vector3; point: Vector3 } | null = null;
  private nextId = 1;
  /** Camera animation: move the pivot (target) and optionally the distance (radius), eased over time. */
  private cameraTween: { from: Vector3; to: Vector3; fromRadius: number; toRadius?: number; start: number; duration: number } | null = null;
  /** Ring that pulses where a new orbit center is set. */
  private pivotRing!: Mesh;
  private pulseStart = -Infinity;
  /** Current orbit center when it was set on purpose (cleared when the camera pans away). */
  orbitPoint: Vector3 | null = null;
  orbitEntity: Entity | null = null;
  private lastCameraMove = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, false);
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));
    const scene = (this.scene = new Scene(this.engine));
    scene.clearColor = Color4.FromHexString(this.env.background + 'ff');

    const camera = (this.camera = new ArcRotateCamera('camera', -Math.PI / 2 + 0.6, 1.15, 6, new Vector3(0, 0.8, 0), scene));
    camera.minZ = 0.05;
    camera.maxZ = 3000;
    camera.lowerRadiusLimit = 0.2;
    camera.upperRadiusLimit = 400;
    camera.wheelDeltaPercentage = 0.01;
    camera.pinchDeltaPercentage = 0.004;
    camera.useNaturalPinchZoom = true;
    camera.panningSensibility = isTouch ? 600 : 1500;
    camera.angularSensibilityX = camera.angularSensibilityY = isTouch ? 600 : 1000;
    camera.inertia = 0.85;
    camera.panningInertia = 0.85;
    camera.attachControl(canvas, true);

    this.hemi = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
    this.hemi.intensity = this.env.ambient;
    this.hemi.groundColor = new Color3(0.15, 0.15, 0.18);

    this.ground = CreateDisc('ground', { radius: 60, tessellation: 96 }, scene);
    this.ground.rotation.x = Math.PI / 2;
    this.ground.isPickable = false;
    this.ground.receiveShadows = true;

    this.grid = CreateGround('grid', { width: 60, height: 60 }, scene);
    const gridMat = new GridMaterial('gridMat', scene);
    gridMat.mainColor = new Color3(0, 0, 0);
    gridMat.lineColor = new Color3(0.55, 0.58, 0.65);
    gridMat.opacity = 0.55;
    gridMat.gridRatio = 0.5;
    gridMat.majorUnitFrequency = 2;
    gridMat.minorUnitVisibility = 0.35;
    gridMat.zOffset = -2;
    gridMat.backFaceCulling = false;
    this.grid.material = gridMat;
    this.grid.isPickable = false;

    this.outline = new SelectionOutlineLayer('outline', scene);
    this.outline.outlineColor = ACCENT;
    this.outline.outlineThickness = 2.5;

    this.pipeline = new DefaultRenderingPipeline('pipeline', true, scene, [camera]);
    this.pipeline.samples = 4;
    this.pipeline.fxaaEnabled = true;
    this.pipeline.imageProcessingEnabled = true;
    this.pipeline.imageProcessing.toneMappingEnabled = true;
    this.pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    this.applyPhoto();

    // Drag the selected object straight across the floor (touch friendly)
    this.drag = new PointerDragBehavior({ dragPlaneNormal: Vector3.Up() });
    this.drag.moveAttached = false;
    this.drag.useObjectOrientationForDragging = false;
    this.drag.onDragStartObservable.add((e) => {
      if (!this.selected) return;
      this.beginTransform();
      this.startFollow();
      this.dragStart = { pos: this.selected.root.position.clone(), point: e.dragPlanePoint.clone() };
    });
    this.drag.onDragObservable.add((e) => {
      if (!this.selected || !this.dragStart) return;
      const p = this.dragStart.pos.add(e.dragPlanePoint.subtract(this.dragStart.point));
      p.y = this.selected.root.position.y;
      this.moveTo(this.selected, p, { x: true, y: false, z: true });
    });
    this.drag.onDragEndObservable.add(() => {
      this.dragStart = null;
      this.tools.clearSmartLines();
      this.endTransform();
    });

    scene.onPointerObservable.add((info) => {
      if (this.photoMode) {
        if (info.type === PointerEventTypes.POINTERTAP && this.photo.dof) this.focusAt(scene.pointerX, scene.pointerY);
        return;
      }
      if (this.tools.handlePointer(info)) return;
      // Separate mode: taps select faces of the model being separated
      if (this.separator.active) {
        if (info.type === PointerEventTypes.POINTERTAP) {
          const ev = info.event as PointerEvent;
          this.separator.tap(scene.pointerX, scene.pointerY, ev.shiftKey ? 'add' : ev.ctrlKey || ev.metaKey || ev.altKey ? 'remove' : null);
        }
        return;
      }
      // Rigging: a missed tap must not drop the joints being placed
      if (this.rigger.active) {
        // Tapping away from the joints (and the gizmo) drops the joint selection
        if (info.type === PointerEventTypes.POINTERTAP && this.rigger.selected && !this.gizmos?.utilityLayer.utilityLayerScene.pick(scene.pointerX, scene.pointerY)?.hit) this.rigger.selectJoint(null);
        return;
      }
      if (info.type === PointerEventTypes.POINTERTAP) {
        if (this.tools.measuring) return;
        const ev = info.event as PointerEvent;
        // "Hovered" only means something for a mouse: after a touch drag on a gizmo it stays
        // stuck and would swallow every later tap. The geometric pick below covers touch.
        if (ev.pointerType === 'mouse' && this.gizmos?.isHovered) return;
        const util = this.gizmos?.utilityLayer.utilityLayerScene.pick(scene.pointerX, scene.pointerY);
        if (util?.hit) return;
        const pick = this.pickScene(scene.pointerX, scene.pointerY);
        const entity = pick?.pickedMesh ? this.entityOf(pick.pickedMesh) : null;
        // Tapping empty space always deselects (also with multi-select on)
        if (!entity) return this.select(null);
        const additive = this.multiSelect || ev.shiftKey || ev.ctrlKey || ev.metaKey;
        this.select(entity, additive);
      } else if (info.type === PointerEventTypes.POINTERDOUBLETAP) {
        const pick = this.pickScene(scene.pointerX, scene.pointerY);
        const entity = pick?.pickedMesh ? this.entityOf(pick.pickedMesh) : null;
        if (entity) {
          this.focus(entity);
        } else {
          // Double-tap on empty floor: orbit around that point
          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), this.camera);
          const d = ray.intersectsPlane(new Plane(0, 1, 0, 0));
          if (d !== null && d > 0 && d < this.camera.radius * 20) this.orbitAround(ray.origin.add(ray.direction.scale(d)));
        }
      }
    });

    scene.onBeforeRenderObservable.add(() => {
      this.updateCameraTween();
      this.updatePivotMarker();
    });
    camera.onViewMatrixChangedObservable.add(() => {
      this.lastCameraMove = performance.now();
      // Keep drawing a little after the camera stops (splat sorting, labels)
      this.invalidate(1000);
      // Panning moves the center: the object is no longer the orbit center
      if (this.orbitPoint && !this.cameraTween && Vector3.Distance(this.camera.target, this.orbitPoint) > 1e-3) {
        this.orbitPoint = null;
        this.orbitEntity = null;
        this.emit('tool');
      }
    });

    this.tools = new Tools(this);
    this.pose = new Poser(this);

    // A flat ring facing the camera
    this.pivotRing = CreateTorus('pivotRing', { diameter: 1, thickness: 0.06, tessellation: 48 }, scene);
    this.pivotRing.rotation.x = Math.PI / 2;
    this.pivotRing.bakeCurrentTransformIntoVertices();
    this.pivotRing.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const ringMat = new StandardMaterial('pivotRing', scene);
    ringMat.disableLighting = true;
    ringMat.emissiveColor = ACCENT;
    this.pivotRing.material = ringMat;
    this.pivotRing.renderingGroupId = 2;
    this.pivotRing.isPickable = false;
    this.pivotRing.setEnabled(false);
    this.overlays.add(this.pivotRing);
    this.applyEnv();
    this.addDefaultLight();

    // Nothing in the app needs "what's under the pointer" on every move; this avoids testing every
    // triangle of heavy models while the mouse/finger moves (drags still get the pointer ray).
    scene.skipPointerMovePicking = true;

    // Draw on demand: only while something changes, so an idle editor doesn't heat the phone
    this.changed.add(kind => { if (kind !== 'activity') this.invalidate(); });
    scene.onAfterAnimationsObservable.add(() => this.rigger.updateHelpers());
    canvas.addEventListener('pointermove', event => {
      if (event.buttons) this.invalidate();
      else if (this.selected && !this.cleanView) this.invalidate(33);
    }, { passive: true });
    for (const type of ['pointerdown', 'pointerup', 'wheel', 'keydown', 'input', 'change']) {
      window.addEventListener(type, () => this.invalidate(), { capture: true, passive: true });
    }
    this.engine.runRenderLoop(() => {
      if (this.needsRender()) scene.render();
    });
    window.addEventListener('resize', () => {
      this.engine.resize();
      this.invalidate();
    });
  }

  // ---------- Events / history ----------

  private activeUntil = 0;
  private lastCameraState = '';

  /** Keeps the scene drawing for a while (call after any change that should show on screen). */
  invalidate(ms = 1500) {
    this.activeUntil = Math.max(this.activeUntil, performance.now() + ms);
  }

  /** True while something is moving or loading; otherwise the last frame stays on screen. */
  private needsRender() {
    // An AR session shows the camera feed: every frame must be drawn
    if (this.arMode || this.recording || this.cameraBackground) return true;
    if (performance.now() < this.activeUntil) return true;
    const c = this.camera;
    if (c.inertialAlphaOffset || c.inertialBetaOffset || c.inertialRadiusOffset || c.inertialPanningX || c.inertialPanningY) return true;
    if (this.cameraTween) return true;
    // Camera changed from code (not from a touch): compare with the last drawn state
    const state = `${c.alpha},${c.beta},${c.radius},${c.target.x},${c.target.y},${c.target.z},${c.fov}`;
    if (state !== this.lastCameraState) {
      this.lastCameraState = state;
      return true;
    }
    if (this.scene.getWaitingItemsCount() > 0) return true;
    // Running animations (paused ones don't need new frames)
    if (this.scene.animatables.some((a) => !a.paused)) return true;
    return false;
  }

  /** Time of the last camera movement (used to sample the scene only once it settles). */
  get lastCameraMoveTime() {
    return this.lastCameraMove;
  }

  private emit(kind: ChangeKind) {
    if (kind !== 'activity') invalidateSurfaces();
    if (kind === 'pose' || kind === 'animation' || kind === 'transform' || kind === 'entities' || kind === 'history') this.rigger.difference.clear();
    this.changed.notifyObservers(kind);
  }

  /** Tells the interface that something changed (for modules that work with the editor). */
  notify(kind: ChangeKind) {
    this.emit(kind);
  }

  /** Adds an undo step for a change made outside the editor's own methods. */
  record(cmd: { undo: () => void; redo: () => void }) {
    this.push(cmd);
  }

  private edits = new Map<unknown, () => void>();

  /** Capture once per gesture; callers commit on change, not on every input. */
  beginEdit<T>(key: unknown, capture: () => T, apply: (state: T) => void) {
    if (this.edits.has(key)) return;
    this.commitEdits();
    const before = capture();
    this.edits.set(key, () => {
      const after = capture();
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      const restore = (state: T) => { apply(state); this.invalidate(); this.emit('transform'); };
      this.push({ undo: () => restore(before), redo: () => restore(after) });
    });
  }

  endEdit(key: unknown) {
    const commit = this.edits.get(key);
    this.edits.delete(key);
    commit?.();
  }

  commitEdits() {
    for (const key of this.edits.keys()) this.endEdit(key);
  }

  private batch: Command[] | null = null;

  /** Groups several changes into a single undo step. */
  group(fn: () => void) {
    const cmds: Command[] = [];
    const parentBatch = this.batch;
    this.batch = cmds;
    try {
      fn();
    } finally {
      this.batch = parentBatch;
    }
    if (cmds.length)
      this.push({
        undo: () => [...cmds].reverse().forEach((c) => c.undo()),
        redo: () => cmds.forEach((c) => c.redo()),
        entities: cmds.flatMap((c) => c.entities ?? []),
      });
  }

  private push(cmd: Command) {
    if (this.batch) {
      this.batch.push(cmd);
      return;
    }
    this.undoStack.push(cmd);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.emit('history');
  }

  get canUndo() {
    if (this.rigger.active) return this.rigger.canUndo;
    return this.undoStack.length > 0;
  }
  get canRedo() {
    if (this.rigger.active) return this.rigger.canRedo;
    return this.redoStack.length > 0;
  }

  undo() {
    if (this.fusion.busy || this.fusion.preview) this.fusion.cancel();
    this.commitEdits();
    // While placing a rig's joints, undo/redo step through the joint moves
    if (this.rigger.active) return this.rigger.undo();
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
    this.emit('history');
    this.emit('transform');
  }

  redo() {
    if (this.fusion.busy || this.fusion.preview) this.fusion.cancel();
    this.commitEdits();
    if (this.rigger.active) return this.rigger.redo();
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.redo();
    this.undoStack.push(cmd);
    this.emit('history');
    this.emit('transform');
  }

  private snapshot(e: Entity): TransformSnapshot {
    return { p: e.root.position.clone(), q: e.root.rotationQuaternion!.clone(), s: e.root.scaling.clone(), pre: e.root.getPivotMatrix().clone() };
  }

  private restore(e: Entity, t: TransformSnapshot) {
    e.root.setPreTransformMatrix(t.pre);
    e.root.position.copyFrom(t.p);
    e.root.rotationQuaternion!.copyFrom(t.q);
    e.root.scaling.copyFrom(t.s);
  }

  /** Starts a transform change of the whole selection (for undo). Repeated calls are ignored. */
  beginTransform(entities = this.selection) {
    if (this.pending || !entities.length) return;
    this.pending = entities.map((entity) => ({ entity, before: this.snapshot(entity) }));
  }

  endTransform() {
    if (!this.pending) return;
    const changes = this.pending
      .map(({ entity, before }) => ({ entity, before, after: this.snapshot(entity) }))
      .filter(({ before, after }) => !(before.p.equalsWithEpsilon(after.p) && before.q.equalsWithEpsilon(after.q) && before.s.equalsWithEpsilon(after.s)));
    this.pending = null;
    if (!changes.length) return;
    this.push({
      undo: () => changes.forEach((c) => this.restore(c.entity, c.before)),
      redo: () => changes.forEach((c) => this.restore(c.entity, c.after)),
    });
    this.emit('transform');
  }

  /** Changes several objects in a single undo step. */
  transformMany(entities: Entity[], fn: (e: Entity) => void) {
    if (!entities.length) return;
    this.endTransform();
    this.beginTransform(entities);
    for (const e of entities) fn(e);
    this.endTransform();
  }

  /** Remembers where the other selected objects are, so they follow the primary one while dragging. */
  private startFollow() {
    this.primaryStart = this.selected?.root.position.clone() ?? null;
    this.followStart = this.extra.map((entity) => ({ entity, pos: entity.root.position.clone() }));
  }

  /** Moves the primary selection to `pos` (grid snap + smart guides) and drags the rest along. */
  private moveTo(e: Entity, pos: Vector3, axes: Record<Axis, boolean>) {
    if (this.snap) {
      for (const k of ['x', 'y', 'z'] as Axis[]) if (axes[k]) pos[k] = Math.round(pos[k] / 0.25) * 0.25;
    }
    const p = this.tools.snap(e, pos, axes);
    e.root.position.copyFrom(p);
    if (this.primaryStart) {
      const delta = p.subtract(this.primaryStart);
      for (const f of this.followStart) f.entity.root.position.copyFrom(f.pos.add(delta));
    }
  }

  // ---------- Entities ----------

  private entityOf(mesh: AbstractMesh): Entity | null {
    let node: Node | null = mesh;
    while (node) {
      const id = node.metadata?.entityId;
      if (id) { const e = this.entities.find((e) => e.id === id); return e?.groupParent ?? e ?? null; }
      node = node.parent;
    }
    return null;
  }

  private createRoot(name: string): Mesh {
    const root = new Mesh(name, this.scene);
    root.rotationQuaternion = Quaternion.Identity();
    root.isPickable = false;
    return root;
  }

  private register(entity: Entity, record = true, select = true) {
    entity.root.metadata = { entityId: entity.id };
    this.anim.watch(entity);
    for (const m of entity.meshes) m.receiveShadows = true;
    this.attach(entity);
    if (record) this.push({ undo: () => this.detach(entity), redo: () => this.attach(entity), entities: [entity] });
    if (select) this.select(entity);
  }

  /** Clip state of deleted objects, put back if the deletion is undone. */
  private readonly detachedClips = new WeakMap<Entity, ClipState>();

  private attach(entity: Entity) {
    entity.root.setEnabled(!entity.groupMembers || entity.visible);
    const clip = this.detachedClips.get(entity);
    if (clip) this.anim.apply(entity, clip);
    this.motions.resume(entity);
    if (entity.light) entity.light.setEnabled(true);
    if (!this.entities.includes(entity)) this.entities.push(entity);
    if (entity.groupParent) entity.groupParent.meshes = entity.groupParent.groupMembers!.filter(e => this.entities.includes(e)).flatMap(e => e.meshes);
    this.refreshShadows();
    this.emit('entities');
  }

  private detach(entity: Entity) {
    if (this.extra.includes(entity)) this.select(entity, true);
    if (this.selected === entity) this.select(null);
    entity.root.setEnabled(false);
    if (entity.light) entity.light.setEnabled(false);
    if (entity.animationGroups.length) this.detachedClips.set(entity, this.anim.state(entity));
    this.motions.suspend(entity);
    entity.animationGroups.forEach((a) => a.stop());
    this.entities = this.entities.filter((e) => e !== entity);
    if (entity.groupParent) entity.groupParent.meshes = entity.groupParent.groupMembers!.filter(e => this.entities.includes(e)).flatMap(e => e.meshes);
    this.refreshShadows();
    this.emit('entities');
  }

  private uniqueName(base: string) {
    const names = new Set(this.entities.map((e) => e.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  /** Places a new object on the floor, next to what is already in the scene (without overlapping). */
  private placeNew(entity: Entity) {
    const others = this.entities.filter((e) => e.kind !== 'light' && e.visible && e !== entity);
    const own = this.boundsOf(entity);
    if (!others.length) {
      const t = this.camera.target;
      entity.root.position.set(t.x, 0, t.z);
      return;
    }
    const scene = this.sceneBounds(others)!;
    const halfWidth = (own.max.x - own.min.x) / 2;
    const gap = Math.max(0.2, (scene.max.x - scene.min.x) * 0.05);
    entity.root.position.set(scene.max.x + gap + halfWidth, 0, (scene.min.z + scene.max.z) / 2);
  }

  /** Bounding box of the visible objects (or of the given ones). */
  sceneBounds(items = this.entities.filter((e) => e.kind !== 'light' && e.visible)) {
    if (!items.length) return null;
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const e of items) {
      const b = this.boundsOf(e);
      min.minimizeInPlace(b.min);
      max.maximizeInPlace(b.max);
    }
    return { min, max, center: min.add(max).scale(0.5), size: max.subtract(min) };
  }

  async addFiles(files: File[], attribution?: LibraryAttribution) {
    const mains = files.filter((f) => MODEL_EXTENSIONS.includes(ext(f.name)));
    if (!mains.length) throw new Error(tr('No supported 3D file. Use: {list}', { list: MODEL_EXTENSIONS.join(', ') }));
    const others = files.filter((f) => !mains.includes(f));
    let i = 0;
    for (const f of mains) {
      // .gltf and .obj may reference external files (.bin, textures, .mtl)
      const deps = ['gltf', 'obj'].includes(ext(f.name)) ? others : [];
      const asset: AssetRef = { attribution, id: this.nextAssetId++, name: f.name.replace(/\.[^.]+$/, ''), main: f, deps };
      await this.loadModel(asset, i++);
    }
  }

  async addFromUrl(url: string, name: string) {
    await this.loadModel({ id: this.nextAssetId++, name, url }, 0);
  }

  nextAssetId = 1;

  /** Loads a model's data (without adding it to the scene). */
  async loadAsset(asset: AssetRef): Promise<AssetContainer> {
    this.loading.notifyObservers({ name: asset.name, progress: 0 });
    try {
      if (asset.main) for (const f of [asset.main, ...(asset.deps ?? [])]) FilesInputStore.FilesToLoad[f.name.toLowerCase()] = f;
      // GLB scene exports can contain cameras; the loader needs their constructor registration.
      await import('@babylonjs/core/Cameras/universalCamera.js');
      const container = await LoadAssetContainerAsync(asset.main ?? asset.url!, this.scene, {
        rootUrl: asset.main ? 'file:' : undefined,
        // Animations start on the instances placed in the scene, never on the hidden template
        // (which also keeps the template's joints in their rest pose, needed for retargeting)
        pluginOptions: { gltf: { animationStartMode: 0 /* GLTFLoaderAnimationStartMode.NONE */ } },
        onProgress: (ev) => {
          if (ev.lengthComputable) this.loading.notifyObservers({ name: asset.name, progress: ev.loaded / ev.total });
        },
      });
      for (const node of [...container.transformNodes, ...container.meshes]) {
        const matrix = node.metadata?.gltf?.extras?.babalonAffine;
        if (Array.isArray(matrix) && matrix.length === 16 && matrix.every(Number.isFinite)) {
          node.rotationQuaternion ??= Quaternion.Identity();
          setAffineTransform(node, Matrix.FromArray(matrix));
        }
      }
      container.animationGroups.forEach((g) => g.stop());
      return container;
    } finally {
      this.loading.notifyObservers(null);
    }
  }

  private async loadModel(asset: AssetRef, index: number) {
    const wasEmpty = !this.entities.some((e) => e.kind !== 'light');
    const container = await this.loadAsset(asset);
    const entity = this.instantiate(container, asset.name, null, asset);
    this.placeNew(entity);
    this.register(entity);
    if (wasEmpty && index === 0) this.focus(entity);
    else if (!this.isInView(entity)) this.frameAll();
  }

  /** Creates a scene object from an already loaded model (used when opening projects). */
  spawnModel(container: AssetContainer, name: string, source: ModelSource | null, asset: AssetRef, opts: AddOptions = {}) {
    const entity = this.instantiate(container, name, source, asset);
    if (opts.publish !== false) this.register(entity, opts.record ?? true, opts.select ?? true);
    return entity;
  }

  private instantiate(container: AssetContainer, name: string, source: ModelSource | null, asset?: AssetRef): Entity {
    const root = this.createRoot(this.uniqueName(name));
    const fit = new TransformNode('fit', this.scene);
    fit.parent = root;
    const inst = container.instantiateModelsToScene((n) => n, true, { doNotInstantiate: true });
    for (const n of inst.rootNodes) {
      n.parent = fit;
      for (const node of [n, ...n.getDescendants()]) if (node instanceof TransformNode) {
        const matrix = node.metadata?.gltf?.extras?.babalonAffine;
        if (Array.isArray(matrix) && matrix.length === 16 && matrix.every(Number.isFinite)) {
          node.rotationQuaternion ??= Quaternion.Identity(); setAffineTransform(node, Matrix.FromArray(matrix));
        }
      }
    }
    const meshes = root.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0 || m.getClassName().includes('Splat'));

    if (!source) {
      // Normalize: center on XZ, rest on the floor and rescale models that are too big/small
      root.computeWorldMatrix(true);
      for (const m of meshes) m.computeWorldMatrix(true);
      const { min, max } = fit.getHierarchyBoundingVectors(true);
      const size = max.subtract(min);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const scale = maxDim > 10 || maxDim < 0.1 ? 1.6 / maxDim : 1;
      const offset = new Vector3(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2).scale(scale);
      source = { container, fitScale: scale, fitOffset: offset, asset: asset! };
    }
    fit.scaling.setAll(source.fitScale);
    fit.position.copyFrom(source.fitOffset);

    const anims = inst.animationGroups;
    if (anims.length) anims[0].start(true);
    return {
      id: this.nextId++,
      name: root.name,
      kind: 'model',
      root,
      meshes,
      animationGroups: anims,
      clipIndex: 0,
      castShadows: true,
      visible: true,
      source,
    };
  }

  addPrimitive(type: PrimitiveType, opts: AddOptions = {}) {
    const labels: Record<PrimitiveType, string> = {
      box: tr('Cube'),
      sphere: tr('Sphere'),
      cylinder: tr('Cylinder'),
      cone: tr('Cone'),
      torus: tr('Torus'),
      plane: tr('Plane'),
    };
    const root = this.createRoot(this.uniqueName(labels[type]));
    let mesh: Mesh;
    switch (type) {
      case 'box':
        mesh = CreateBox('box', { size: 1 }, this.scene);
        mesh.position.y = 0.5;
        break;
      case 'sphere':
        mesh = CreateSphere('sphere', { diameter: 1, segments: 48 }, this.scene);
        mesh.position.y = 0.5;
        break;
      case 'cylinder':
        mesh = CreateCylinder('cylinder', { height: 1, diameter: 1, tessellation: 64 }, this.scene);
        mesh.position.y = 0.5;
        break;
      case 'cone':
        mesh = CreateCylinder('cone', { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 64 }, this.scene);
        mesh.position.y = 0.5;
        break;
      case 'torus':
        mesh = CreateTorus('torus', { diameter: 1, thickness: 0.3, tessellation: 64 }, this.scene);
        mesh.position.y = 0.15;
        break;
      case 'plane':
        mesh = CreateGround('plane', { width: 2, height: 2 }, this.scene);
        mesh.position.y = 0.001;
        break;
    }
    const mat = new PBRMaterial(`${root.name} material`, this.scene);
    mat.albedoColor = Color3.FromHexString('#d9d9de');
    mat.metallic = 0;
    mat.roughness = 0.5;
    mat.backFaceCulling = type !== 'plane';
    mesh.material = mat;
    mesh.parent = root;
    const entity: Entity = {
      id: this.nextId++,
      name: root.name,
      kind: 'primitive',
      root,
      meshes: [mesh],
      animationGroups: [],
      castShadows: true,
      visible: true,
      primitive: type,
    };
    if (opts.fit) this.fitShape(entity, opts.fit.center, opts.fit.size);
    else this.placeNew(entity);
    this.register(entity, opts.record ?? true, opts.select ?? true);
    if ((opts.record ?? true) && !this.isInView(entity)) this.frameAll();
    return entity;
  }

  /** Sizes and places a shape in a world box: round shapes stay round across their round axes. */
  private fitShape(entity: Entity, center: Vector3, size: Vector3) {
    const own = this.boundsOf(entity).size, t = size.clone();
    const type = entity.primitive;
    if (type === 'sphere') t.setAll(Math.max(t.x, t.y, t.z));
    else if (type === 'cylinder' || type === 'cone' || type === 'torus') t.x = t.z = Math.max(t.x, t.z);
    const s = (target: number, base: number) => (base > 1e-6 ? Math.max(target, 1e-3) / base : 1);
    entity.root.scaling.set(s(t.x, own.x), type === 'plane' ? 1 : s(t.y, own.y), s(t.z, own.z));
    const b = this.boundsOf(entity);
    entity.root.position.addInPlace(center.subtract(b.center));
    entity.root.computeWorldMatrix(true);
  }

  /**
   * Quick shape on what's selected (Blender adds at the 3D cursor; here the selection is the
   * cursor): fitted to the selected faces in mesh mode (which then ends), otherwise half the size of
   * the selected object, in its middle. With a target, both end up selected, the target first, ready
   * for Boolean or Shrinkwrap.
   */
  addShapeOnSelection(type: PrimitiveType) {
    const faces = this.separator.active ? this.separator.selection : null;
    const target = faces ? faces.entity : this.selected && this.selected.kind !== 'light' ? this.selected : null;
    let fit: AddOptions['fit'];
    const box = faces?.count ? faces.bounds() : null;
    if (box) fit = { center: box.center, size: box.size };
    else if (target) { const b = this.boundsOf(target); fit = { center: b.center, size: b.size.scale(0.5) }; }
    if (faces) this.separator.cancel();
    const shape = this.addPrimitive(type, { fit, select: !target });
    if (target) { this.select(target); this.select(shape, true); }
    return shape;
  }

  addLight(
    type: LightType,
    opts: { position?: Vector3; target?: Vector3; intensity?: number; color?: string; shadows?: boolean; select?: boolean; record?: boolean; angle?: number } = {},
  ) {
    const labels: Record<LightType, string> = { point: tr('Point light'), spot: tr('Spotlight'), directional: tr('Sun') };
    const root = this.createRoot(this.uniqueName(labels[type]));
    const color = Color3.FromHexString(opts.color ?? '#ffffff');

    const proxyMat = new StandardMaterial('lightProxy', this.scene);
    proxyMat.disableLighting = true;
    proxyMat.emissiveColor = color;
    const bulb = CreateSphere('bulb', { diameter: 0.22, segments: 12 }, this.scene);
    bulb.material = proxyMat;
    bulb.parent = root;
    const parts: AbstractMesh[] = [bulb];
    if (type !== 'point') {
      const arrow = CreateCylinder('arrow', { height: 0.5, diameterTop: 0, diameterBottom: 0.12, tessellation: 12 }, this.scene);
      arrow.rotation.x = Math.PI / 2;
      arrow.position.z = 0.32;
      arrow.material = proxyMat;
      arrow.parent = root;
      parts.push(arrow);
    }
    for (const p of parts) {
      this.helpers.add(p);
      p.isVisible = !this.cleanView;
    }

    const light = createLight(type, root.name, this.scene, { angle: opts.angle, color });
    light.parent = root;
    light.intensity = opts.intensity ?? (type === 'directional' ? 2 : 30);

    root.position.copyFrom(opts.position ?? this.camera.target.add(new Vector3(2, 3, -2)));
    root.lookAt(opts.target ?? new Vector3(this.camera.target.x, 0.5, this.camera.target.z));

    const entity: Entity = {
      id: this.nextId++,
      name: root.name,
      kind: 'light',
      root,
      meshes: [],
      animationGroups: [],
      castShadows: false,
      visible: true,
      light,
      lightType: type,
    };
    this.setLightShadows(entity, opts.shadows ?? type !== 'point');
    this.register(entity, opts.record ?? true, opts.select ?? true);
    return entity;
  }

  setLightShadows(entity: Entity, on: boolean) {
    if (!entity.light) return;
    if (on && !entity.shadowGen) {
      entity.shadowGen = createShadowGenerator(entity.light, entity.lightType ?? 'directional');
    } else if (!on && entity.shadowGen) {
      entity.shadowGen.dispose();
      entity.shadowGen = undefined;
    }
    this.refreshShadows();
  }

  private refreshShadows() {
    const casters = [...new Set(this.entities.filter((e) => e.kind !== 'light' && !e.groupMembers && e.castShadows && e.visible && e.root.isEnabled()).flatMap((e) => e.meshes))];
    const shadowLights = this.entities.filter((e) => e.shadowGen);
    for (const l of shadowLights) {
      const map = l.shadowGen!.getShadowMap()!;
      map.renderList = [...casters];
    }
    if (this.ground.material instanceof ShadowOnlyMaterial) {
      const key = shadowLights.find((l) => l.lightType !== 'point') ?? shadowLights[0];
      if (key) this.ground.material.activeLight = key.light!;
    }
  }

  async setMaterialTexture(material: Material | Material[], slot: TextureSlot, file: File | null) {
    const path = file ? await loadUserTexture(this.scene, file) : null;
    const targets = (Array.isArray(material) ? material : [material]).filter((m) => this.scene.materials.includes(m));
    if (!targets.length) return;
    this.beginEdit(material, () => targets.map(materialToJSON), (states) => targets.forEach((m, i) => applyMaterial(m, states[i])));
    for (const m of targets) {
      const state = textureStates(m);
      if (path) state[slot] = { path, u: 1, v: 1, rotation: 0 };
      else delete state[slot];
      applyTextureStates(m, state);
    }
    this.endEdit(material);
    this.notify('transform');
  }

  duplicate(entity?: Entity) {
    if (!entity) {
      const items = this.selection;
      if (items.length > 1) {
        const copies: Entity[] = [];
        this.group(() => items.forEach((e) => this.duplicate(e) && copies.push(this.selected!)));
        this.select(copies[0] ?? null);
        copies.slice(1).forEach((c) => this.select(c, true));
        return;
      }
      entity = this.selected ?? undefined;
    }
    if (!entity) return;
    if (entity.groupMembers) {
      let result: Entity | undefined;
      this.group(() => {
        const copies = entity.groupMembers!.filter(e => this.entities.includes(e)).map(e => this.duplicate(e)).filter((e): e is Entity => !!e);
        result = this.groupObjects(copies);
        result.root.rotationQuaternion!.copyFrom(entity.root.rotationQuaternion!);
        result.root.scaling.copyFrom(entity.root.scaling);
        result.root.position.copyFrom(entity.root.position).addInPlace(new Vector3(.6, 0, .6));
        copies.forEach((e, i) => this.restore(e, this.snapshot(entity.groupMembers![i])));
      });
      return result;
    }
    let copy: Entity;
    if (entity.kind === 'model' && entity.source) {
      copy = this.createModelCopy(entity);
      this.register(copy, true, false);
    } else if (entity.kind === 'primitive' && entity.primitive) {
      copy = this.addPrimitive(entity.primitive);
      const src = entity.meshes[0].material;
      if (src) copy.meshes[0].material = src.clone(`${copy.name} material`);
    } else if (entity.kind === 'light' && entity.light && entity.lightType) {
      copy = this.addLight(entity.lightType, {
        intensity: entity.light.intensity,
        color: entity.light.diffuse.toHexString(),
        shadows: !!entity.shadowGen,
        select: false,
      });
    } else return;
    if (entity.kind !== 'model') this.copyMaterials(entity, copy);
    if (entity.optimization && !entity.optimization.session) this.optimizer.copy(entity, copy);
    if (entity.textureOptimization) this.textureOptimizer.copy(entity, copy);
    if (entity.rig) this.rigger.copy(entity, copy);
    if (entity.motion) this.motions.set(copy, { ...entity.motion }, false);
    if (entity.kind !== 'model' || entity.rig) this.copyAnimationState(entity, copy);
    copy.root.setPreTransformMatrix(entity.root.getPivotMatrix().clone());
    copy.root.rotationQuaternion!.copyFrom(entity.root.rotationQuaternion!);
    copy.root.scaling.copyFrom(entity.root.scaling);
    copy.root.position.copyFrom(entity.root.position).addInPlace(new Vector3(0.6, 0, 0.6));
    this.select(copy);
    return copy;
  }

  spawnGroup(members: Entity[], name = tr('Group'), opts: AddOptions = {}, preserveWorld = true) {
    const root = this.createRoot(this.uniqueName(name));
    const group: Entity = { id: this.nextId++, name: root.name, kind: 'model', root, meshes: members.flatMap(e => e.meshes), animationGroups: [], castShadows: true, visible: true, groupMembers: members };
    if (preserveWorld) {
      const bounds = members.map(e => this.boundsOf(e));
      const min = bounds[0].min.clone(), max = bounds[0].max.clone();
      bounds.forEach(b => { min.minimizeInPlace(b.min); max.maximizeInPlace(b.max); });
      root.position.set((min.x + max.x) / 2, min.y, (min.z + max.z) / 2);
    }
    for (const e of members) {
      if (preserveWorld) reparent(e.root, root);
      else e.root.parent = root;
      e.groupParent = group;
    }
    this.register(group, opts.record ?? true, opts.select ?? true);
    return group;
  }

  groupObjects(members = this.selection) {
    if (members.length < 2) throw new Error(tr('Select at least two objects.'));
    if (members.some(e => e.groupMembers || e.groupParent || e.kind === 'light')) throw new Error(tr('Ungroup these objects before creating another group.'));
    const group = this.spawnGroup(members, tr('Group'), { record: false });
    const parent = (on: boolean) => {
      for (const e of members) { reparent(e.root, on ? group.root : null); e.groupParent = on ? group : undefined; }
      if (on) this.attach(group); else this.detach(group);
      this.select(on ? group : members[0]);
    };
    this.push({ undo: () => parent(false), redo: () => parent(true), entities: [group, ...members] });
    return group;
  }

  ungroup(group = this.selected) {
    if (!group?.groupMembers) return;
    const members = group.groupMembers;
    const local = members.map(e => this.snapshot(e));
    const apply = (on: boolean) => {
      for (const [i, e] of members.entries()) {
        if (on) { e.root.parent = group.root; this.restore(e, local[i]); }
        else reparent(e.root, null);
        e.groupParent = on ? group : undefined;
      }
      if (on) this.attach(group); else this.detach(group);
      this.select(on ? group : members[0]);
    };
    apply(false);
    this.push({ undo: () => apply(true), redo: () => apply(false), entities: [group, ...members] });
  }

  editableModel(entity: Entity) {
    if (entity.kind === 'model') return entity;
    const result = combine(this, [entity], 1); this.rename(result, entity.name); return result;
  }

  combine(entities = this.selection) { return combine(this, entities); }

  /**
   * Before editing geometry: an optimized model becomes its optimized version (undoable), instead
   * of refusing. Returns how many models were frozen (to tell the user).
   */
  async prepareGeometryEdit(entities: Entity[]) {
    let frozen = 0;
    for (const e of entities) if (e.optimization && !e.optimization.session) { await this.optimizer.freeze(e); frozen++; }
    return frozen;
  }

  private copyMaterials(entity: Entity, copy: Entity) {
    const sourceMaterials = this.materialsOf(entity);
    this.materialsOf(copy).forEach((m, i) => {
      const source = sourceMaterials[i];
      if (!source) return;
      if (m.metadata) m.metadata = { ...m.metadata };
      copyUserTextures(source, m);
      applyMaterial(m, materialToJSON(source));
    });
  }

  private copyAnimationState(entity: Entity, copy: Entity) {
    if (entity.addedClips?.length) this.clips.copy(entity, copy);
    if (copy.animationGroups.length === entity.animationGroups.length && copy.animationGroups.length) this.anim.apply(copy, this.anim.state(entity));
    if (entity.posed) {
      // Same skeleton: copy the hand-made pose joint by joint
      const from = jointNodes(entity);
      jointNodes(copy).forEach((n, i) => from[i] && restoreJoints(captureJoints([from[i]]).map((s) => ({ ...s, node: n }))));
      copy.posed = true;
    }
  }

  /** Unregistered copy for preparing a rig comparison without exposing partial results. */
  createModelCopy(entity: Entity) {
    if (!entity.source) throw new Error(tr('This model cannot be copied.'));
    const copy = this.instantiate(entity.source.container, entity.name.replace(/ \d+$/, ''), entity.source);
    copy.castShadows = entity.castShadows;
    copy.root.setPreTransformMatrix(entity.root.getPivotMatrix().clone());
    copy.root.rotationQuaternion!.copyFrom(entity.root.rotationQuaternion!);
    copy.root.scaling.copyFrom(entity.root.scaling);
    copy.root.position.copyFrom(entity.root.position);
    copy.composite = entity.composite;
    this.copyMaterials(entity, copy);
    if (entity.boneMap) { copy.boneMap = { ...entity.boneMap }; forgetHumanoid(copy); }
    if (entity.separation) this.separator.copy(entity, copy);
    // App rigs are copied after their geometry is prepared by the caller; imported skeletons
    // already exist here, so a separated part can retain its clips and current pose.
    if (!entity.rig) this.copyAnimationState(entity, copy);
    copy.root.setEnabled(false);
    return copy;
  }

  /** Adds the part made by separating a model (inside the separation's undo group). */
  publishSeparated(copy: Entity) {
    this.register(copy, true, false);
  }

  /** Publish prepared copies together; undo removes the complete comparison. */
  addModelComparison(copies: Entity[], source: Entity) {
    const visible = source.visible;
    this.group(() => {
      copies.forEach(e => this.register(e, true, false));
      this.setVisible(source, false);
      this.record({ undo: () => this.setVisible(source, visible), redo: () => this.setVisible(source, false) });
    });
    this.select(copies[0] ?? null);
    this.frameAll();
  }

  remove(entity?: Entity) {
    if (!entity) {
      const items = this.selection;
      if (items.length > 1) return this.group(() => items.forEach((e) => this.remove(e)));
      entity = this.selected ?? undefined;
    }
    if (!entity) return;
    if (entity.groupMembers) return this.group(() => {
      entity!.groupMembers!.filter(e => this.entities.includes(e)).forEach(e => this.remove(e));
      this.detach(entity!);
      this.push({ undo: () => this.attach(entity!), redo: () => this.detach(entity!), entities: [entity!] });
    });
    this.detach(entity);
    this.push({ undo: () => this.attach(entity), redo: () => this.detach(entity), entities: [entity] });
  }

  rename(entity: Entity, name: string) {
    entity.name = name || entity.name;
    this.emit('entities');
  }

  setVisible(entity: Entity, visible: boolean) {
    entity.visible = visible;
    if (entity.groupMembers) { entity.root.setEnabled(visible); this.refreshShadows(); this.emit('entities'); return; }
    for (const m of entity.meshes) m.isVisible = visible;
    if (entity.light) entity.light.setEnabled(visible);
    this.refreshShadows();
    this.emit('entities');
  }

  setCastShadows(entity: Entity, on: boolean) {
    entity.castShadows = on;
    entity.groupMembers?.forEach(e => { e.castShadows = on; });
    this.refreshShadows();
  }

  clearScene() {
    for (const e of [...this.entities]) this.detach(e);
    this.undoStack = [];
    this.redoStack = [];
    this.emit('history');
  }

  private addDefaultLight() {
    this.addLight('directional', { position: new Vector3(4, 7, 3), intensity: 2.5, color: '#fff4e5', select: false, record: false });
  }

  /** New project: empty scene with default environment, effects and light. */
  newScene() {
    this.resetScene();
    this.applyEnv({ ...DEFAULT_ENV });
    this.setPhoto({ ...DEFAULT_PHOTO });
    this.addDefaultLight();
    this.camera.setTarget(new Vector3(0, 0.8, 0));
    this.camera.alpha = -Math.PI / 2 + 0.6;
    this.camera.beta = 1.15;
    this.camera.radius = 6;
  }

  /** Really deletes everything (including what the undo history holds) to start/open another project. */
  resetScene() {
    this.fusion.cancel();
    this.wrap.cancel();
    this.separator.cancel();
    this.edits.clear();
    this.select(null);
    this.tools.clear();
    const all = new Set<Entity>(this.entities);
    for (const cmd of [...this.undoStack, ...this.redoStack]) for (const e of cmd.entities ?? []) all.add(e);
    const containers = new Set<AssetContainer>();
    for (const e of all) {
      this.motions.stop(e);
      e.rig?.skeleton.dispose();
      e.animationGroups.forEach((a) => a.dispose());
      e.shadowGen?.dispose();
      e.light?.dispose();
      for (const m of e.root.getChildMeshes()) this.helpers.delete(m);
      if (e.kind === 'model') this.materialsOf(e).forEach((m) => m.dispose(false, true));
      e.root.dispose(false, e.kind !== 'model');
      if (e.source) containers.add(e.source.container);
    }
    containers.forEach((c) => c.dispose());
    clearUserTextures(this.scene);
    this.environments.forEach((asset) => asset.texture.dispose());
    this.environments.clear();
    this.env.custom = undefined;
    this.environmentSource = '';
    this.entities = [];
    this.undoStack = [];
    this.redoStack = [];
    this.refreshShadows();
    this.emit('entities');
    this.emit('history');
  }

  // ---------- Selection and tools ----------

  /** Selected objects, the primary (reference) one first. */
  get selection(): Entity[] {
    return this.selected ? [this.selected, ...this.extra] : [];
  }

  /** Selects every object (Blender's A). */
  selectAll() {
    const all = this.entities.filter((e) => !e.groupParent);
    if (!all.length) return;
    this.select(all[0]);
    for (const e of all.slice(1)) this.select(e, true);
  }

  /** Selects an object. With `additive`, toggles it in a multi-selection instead. */
  select(entity: Entity | null, additive = false) {
    if (entity && entity !== this.selected && (this.fusion.busy || this.fusion.preview)) this.fusion.cancel();
    if (additive && entity && this.selection.some(e => e === entity.groupParent || e.groupParent === entity)) additive = false;
    if (additive && entity && this.selected) {
      if (entity === this.selected) {
        // Removing the primary: the next selected object becomes the reference
        const [next, ...rest] = this.extra;
        this.extra = rest;
        this.setPrimary(next ?? null);
      } else if (this.extra.includes(entity)) {
        this.extra = this.extra.filter((e) => e !== entity);
      } else {
        this.extra.push(entity);
      }
    } else {
      if (this.selected === entity && !this.extra.length) return;
      this.extra = [];
      this.setPrimary(entity);
    }
    this.outline.clearSelection();
    for (const e of this.selection) {
      const meshes = e.kind === 'light' ? e.root.getChildMeshes() : e.meshes;
      if (meshes.length) this.outline.addSelection(meshes);
    }
    this.applyTool();
    this.emit('selection');
  }

  private setPrimary(entity: Entity | null) {
    this.endTransform();
    if (this.pose.entity && this.pose.entity !== entity) this.pose.stop();
    if (this.rigger.entity && this.rigger.entity !== entity) this.rigger.cancel();
    if (this.selected) this.selected.root.removeBehavior(this.drag);
    this.selected = entity;
  }

  setMultiSelect(on: boolean) {
    this.multiSelect = on;
    this.emit('tool');
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.applyTool();
    this.emit('tool');
  }

  setSnap(on: boolean) {
    this.snap = on;
    this.applyTool();
    this.emit('tool');
  }

  /** Shadows again after meshes changed (e.g. a model got a skeleton). */
  refreshShadowCasters() {
    this.refreshShadows();
  }

  /** Looks at `center` from the direction `dir` (unit vector), fitting a box of `size`. */
  viewFrom(dir: Vector3, center: Vector3, size: Vector3) {
    this.camera.alpha = Math.atan2(dir.z, dir.x);
    this.camera.beta = Math.acos(Math.max(-0.999, Math.min(0.999, dir.y)));
    this.animateCamera(center, this.fitRadius(size));
  }

  /** Re-applies the gizmo for the current tool, selection or pose joint. */
  refreshTool() {
    this.applyTool();
  }

  private readonly configuredGizmos = new WeakSet<object>();
  private readonly configuredTools = new Set<Tool>();

  private loadGizmos() {
    this.gizmoLoading = true;
    this.gizmoError = null;
    this.gizmoLoad = import('@babylonjs/core/Gizmos/gizmoManager.js').then(({ GizmoManager }) => {
      const manager = this.gizmos = new GizmoManager(this.scene, isTouch ? 2 : 1.5);
      manager.usePointerToAttachGizmos = false;
      manager.clearGizmoOnEmptyPointerEvent = false;
      manager.scaleRatio = isTouch ? 1.5 : 1.1;
      this.applyTool();
      this.invalidate();
    }).catch(error => {
      this.gizmoError = error instanceof Error ? error.message : String(error);
    }).finally(() => {
      this.gizmoLoad = null;
      this.gizmoLoading = false;
      this.notify('activity');
    });
    this.notify('activity');
  }

  /** Allocate each tool on first use and bind its observers exactly once. */
  private enableGizmos(move: boolean, rotate: boolean, scale: boolean) {
    if (!this.gizmos) return;
    this.gizmos.positionGizmoEnabled = move;
    this.gizmos.rotationGizmoEnabled = rotate;
    this.gizmos.scaleGizmoEnabled = scale;
    const g = this.gizmos.gizmos;
    for (const gz of [g.positionGizmo, g.rotationGizmo, g.scaleGizmo]) {
      if (!gz || this.configuredGizmos.has(gz)) continue;
      this.configuredGizmos.add(gz);
      gz.onDragStartObservable.add(() => (this.separator.transform ? this.separator.transform.begin() : this.rigger.active ? this.rigger.remember() : this.pose.active ? this.pose.begin() : this.beginTransform()));
      gz.onDragEndObservable.add(() => {
        if (this.separator.transform) return this.separator.transform.end();
        if (this.rigger.active) return this.rigger.endHandleDrag();
        if (this.pose.active) return this.pose.end();
        this.tools.clearSmartLines();
        this.endTransform();
      });
    }
    if (g.scaleGizmo && !this.configuredTools.has('scale')) {
      this.configuredTools.add('scale');
      // Scale gizmo: with Shift (or the option) one axis handle scales all three, keeping proportions
      const sg = g.scaleGizmo!;
      let scaleStart: Vector3 | null = null;
      sg.onDragStartObservable.add(() => { scaleStart = (sg.attachedNode as TransformNode | null)?.scaling.clone() ?? null; });
      for (const axis of [sg.xGizmo, sg.yGizmo, sg.zGizmo]) {
        axis.dragBehavior.onDragObservable.add(() => {
          const node = sg.attachedNode as TransformNode | null;
          if (!this.proportional || !node || !scaleStart) return;
          // The axis that changed most sets the factor for all
          let ratio = 1;
          for (const k of ['x', 'y', 'z'] as Axis[]) {
            const r = scaleStart[k] ? node.scaling[k] / scaleStart[k] : 1;
            if (Math.abs(r - 1) > Math.abs(ratio - 1)) ratio = r;
          }
          node.scaling.copyFrom(scaleStart).scaleInPlace(ratio);
        });
      }
    }
    if (g.positionGizmo && !this.configuredTools.has('move')) {
      this.configuredTools.add('move');
      g.positionGizmo.planarGizmoEnabled = true;
      // Position gizmo: track the raw position ourselves so grid snapping and smart guides don't get "sticky"
      const pg = g.positionGizmo!;
      let raw: Vector3 | null = null;
      pg.onDragStartObservable.add(() => {
        if (this.pose.active || this.rigger.active || this.separator.active) return;
        raw = this.selected?.root.position.clone() ?? null;
        this.startFollow();
      });
      const axisGizmos: [{ dragBehavior: PointerDragBehavior }, Record<Axis, boolean>][] = [
        [pg.xGizmo, { x: true, y: false, z: false }],
        [pg.yGizmo, { x: false, y: true, z: false }],
        [pg.zGizmo, { x: false, y: false, z: true }],
        [pg.xPlaneGizmo, { x: false, y: true, z: true }],
        [pg.yPlaneGizmo, { x: true, y: false, z: true }],
        [pg.zPlaneGizmo, { x: true, y: true, z: false }],
      ];
      for (const [gizmo, axes] of axisGizmos) {
        gizmo.dragBehavior.onDragObservable.add((ev) => {
          // Posing: the gizmo drags the IK target, the arm/leg follows
          if (this.fusion.busy || this.fusion.preview) return;
          if (this.separator.active) { this.invalidate(); return; }
          if (this.rigger.active) return this.rigger.dragHandle();
          if (this.pose.active) return this.pose.dragIk();
          const e = this.selected;
          if (!e || !raw) return;
          raw.addInPlace(ev.delta);
          this.moveTo(e, raw.clone(), axes);
        });
      }
    }
  }

  private applyTool() {
    const e = this.selected;
    if (!this.gizmos) {
      if (e && !this.cleanView && !this.gizmoLoad) this.loadGizmos();
      return;
    }
    if (this.fusion.busy || this.fusion.preview) {
      this.enableGizmos(false, false, false);
      this.gizmos.attachToMesh(null); e?.root.removeBehavior(this.drag); return;
    }
    if (this.rigger?.active) {
      // Rigging: joints are dragged on screen; a selected joint also gets the move gizmo (one axis at a time)
      const handle = this.rigger.gizmoHandle();
      this.enableGizmos(!!handle && !this.cleanView, false, false);
      if (this.gizmos.gizmos.positionGizmo) this.gizmos.gizmos.positionGizmo.snapDistance = 0;
      this.gizmos.attachToNode(handle && !this.cleanView ? handle : null);
      e?.root.removeBehavior(this.drag);
      return;
    }
    if (this.separator?.active) {
      // The selected region's handle takes the gizmo
      const handle = this.separator.transform?.handle;
      const show = !!handle && !this.cleanView;
      this.enableGizmos(show && this.tool === 'move', show && this.tool === 'rotate', show && this.tool === 'scale');
      this.gizmos.attachToMesh(show ? handle! : null);
      e?.root.removeBehavior(this.drag);
      return;
    }
    const posing = this.pose?.active && this.pose.entity === e && !this.cleanView;
    if (posing || this.pose?.active) {
      const target = posing ? this.pose.gizmoTarget() : null;
      this.enableGizmos(target?.mode === 'move', target?.mode === 'rotate', false);
      const g = this.gizmos.gizmos;
      if (g.rotationGizmo) g.rotationGizmo.snapDistance = 0;
      if (g.positionGizmo) g.positionGizmo.snapDistance = 0;
      // Joint axes are arbitrary: turn joints around the world axes
      if (g.rotationGizmo) g.rotationGizmo.updateGizmoRotationToMatchAttachedMesh = false;
      this.gizmos.attachToNode(target?.node ?? null);
      e?.root.removeBehavior(this.drag);
      return;
    }
    const tool = e?.kind === 'light' && this.tool === 'scale' ? 'move' : this.tool;
    const show = !!e && !this.cleanView && !this.tools?.measuring && !this.separator?.active;
    this.enableGizmos(show && tool === 'move', show && tool === 'rotate', show && tool === 'scale');
    const g = this.gizmos.gizmos;
    if (g.positionGizmo) g.positionGizmo.snapDistance = 0; // grid snapping is done in moveTo()
    if (g.rotationGizmo) g.rotationGizmo.snapDistance = this.snap ? Math.PI / 12 : 0;
    if (g.rotationGizmo) g.rotationGizmo.updateGizmoRotationToMatchAttachedMesh = true;
    if (g.scaleGizmo) g.scaleGizmo.snapDistance = this.snap ? 0.1 : 0;
    this.gizmos.attachToMesh(show ? e!.root : null);
    if (e) {
      e.root.removeBehavior(this.drag);
      if (show && tool === 'move') e.root.addBehavior(this.drag);
    }
  }

  /** Scaling keeps the proportions (Shift while dragging the gizmo). */
  proportional = false;

  // ---------- Live transform (slider bar, G/R/S keys): the selected objects or faces ----------

  private live: { faces: boolean; center: Vector3; start: { entity: Entity | null; p: Vector3; q: Quaternion; s: Vector3 }[] } | null = null;

  /**
   * Starts a transform driven by a control instead of the gizmo. In mesh mode it moves the
   * selected faces; otherwise the selected objects, around their middle (Blender's median point).
   * Returns the center, or null when there's nothing to transform.
   */
  beginLive(): Vector3 | null {
    if (this.live) return this.live.center;
    const faces = this.separator.transform;
    if (faces) {
      faces.begin();
      const h = faces.handle;
      this.live = { faces: true, center: h.position.clone(), start: [{ entity: null, p: h.position.clone(), q: h.rotationQuaternion!.clone(), s: h.scaling.clone() }] };
      return this.live.center;
    }
    if (this.separator.active) return null;
    const entities = this.selection;
    if (!entities.length) return null;
    this.beginTransform(entities);
    const start = entities.map((entity) => ({ entity, p: entity.root.position.clone(), q: entity.root.rotationQuaternion!.clone(), s: entity.root.scaling.clone() }));
    const center = start.reduce((sum, t) => sum.addInPlace(t.p), Vector3.Zero()).scaleInPlace(1 / start.length);
    this.live = { faces: false, center, start };
    return center;
  }

  /** Sets the live change from where it began: a move, a scale per world axis, a turn around a world axis. */
  setLive(change: { move?: Vector3; scale?: Vector3; axis?: Vector3; angle?: number }) {
    const live = this.live;
    if (!live) return;
    const turn = change.axis && change.angle ? Quaternion.RotationAxis(change.axis, change.angle) : Quaternion.Identity();
    const scale = change.scale ?? Vector3.One(), move = change.move ?? Vector3.Zero();
    const turnMatrix = Matrix.FromQuaternionToRef(turn, new Matrix());
    for (const t of live.start) {
      const node = t.entity ? t.entity.root : this.separator.transform?.handle;
      if (!node) continue;
      // Position around the center: scaled, turned, then moved
      const offset = t.p.subtract(live.center).multiplyInPlace(scale);
      node.position.copyFrom(live.center.add(Vector3.TransformCoordinates(offset, turnMatrix)).addInPlace(move));
      node.rotationQuaternion = turn.multiply(t.q);
      node.scaling.copyFrom(t.s).multiplyInPlace(scale);
    }
    this.invalidate();
  }

  /** Ends the live change: one undo step, or back to where it began. */
  endLive(cancel = false) {
    const live = this.live;
    if (!live) return;
    this.live = null;
    if (cancel) {
      for (const t of live.start) {
        const node = t.entity ? t.entity.root : this.separator.transform?.handle;
        if (!node) continue;
        node.position.copyFrom(t.p); node.rotationQuaternion = t.q.clone(); node.scaling.copyFrom(t.s);
      }
    }
    if (live.faces) this.separator.transform?.end(cancel);
    else this.endTransform();
    this.emit('transform');
    this.invalidate();
  }

  get liveActive() { return !!this.live; }

  /** Applies a transform change coming from UI controls (sliders/buttons). */
  editTransform(fn: (root: Mesh) => void, commit = false) {
    if (!this.selected) return;
    this.beginTransform();
    fn(this.selected.root);
    if (commit) this.endTransform();
  }

  getEuler(entity: Entity) {
    return entity.root.rotationQuaternion!.toEulerAngles();
  }

  dropToGround(entity = this.selected) {
    if (!entity || entity.kind === 'light') return;
    this.editTransform((root) => {
      root.computeWorldMatrix(true);
      for (const m of entity.meshes) m.computeWorldMatrix(true);
      const { min } = root.getHierarchyBoundingVectors(true);
      root.position.y -= min.y;
    }, true);
  }

  resetTransform(entity = this.selected) {
    if (!entity) return;
    this.editTransform((root) => {
      root.rotationQuaternion!.copyFrom(Quaternion.Identity());
      root.scaling.setAll(1);
      if (entity.kind !== 'light') root.position.y = 0;
    }, true);
  }

  aimLightAtSelection(light: Entity, target: Entity | null) {
    const t = target ? this.boundsOf(target).center : this.camera.target;
    this.select(light);
    this.editTransform((root) => root.lookAt(t), true);
  }

  /** Size of the object along an axis; setting it scales the object uniformly (keeps it on the floor). */
  /** Size along the object's own axes (not the world box, so a rotated object keeps its width). */
  objectSize(entity: Entity) {
    const root = entity.root;
    const turn = root.rotationQuaternion!.clone();
    root.rotationQuaternion!.copyFromFloats(0, 0, 0, 1);
    const size = this.boundsOf(entity).size;
    root.rotationQuaternion!.copyFrom(turn);
    root.computeWorldMatrix(true);
    return size;
  }

  /**
   * Sets one dimension (object axes). Proportional scales the whole object; otherwise only that
   * axis. A negative value also mirrors the object on that axis. The object stays on its spot.
   */
  setDimension(entity: Entity, axis: Axis, value: number, proportional = true) {
    const size = this.objectSize(entity)[axis];
    if (!value || size <= 1e-9) return;
    const factor = Math.abs(value) / size;
    this.transformMany([entity], (e) => this.keepPlace(e, () => {
      if (proportional) e.root.scaling.scaleInPlace(factor);
      else e.root.scaling[axis] *= factor;
      if (value < 0) e.root.scaling[axis] *= -1;
    }));
  }

  /** Mirrors the selected objects on one of their axes, in place (undoable). */
  mirror(axis: Axis, entities = this.selection) {
    const list = entities.filter((e) => e.kind !== 'light');
    if (list.length) this.transformMany(list, (e) => this.keepPlace(e, () => (e.root.scaling[axis] *= -1)));
  }

  /** Runs a scale change keeping the object where it was: same center on the floor plan, same bottom. */
  private keepPlace(e: Entity, change: () => void) {
    const before = this.boundsOf(e);
    change();
    e.root.computeWorldMatrix(true);
    const after = this.boundsOf(e);
    e.root.position.addInPlace(new Vector3(before.center.x - after.center.x, before.min.y - after.min.y, before.center.z - after.center.z));
  }

  private readonly pickable = (m: AbstractMesh) => m.isPickable && m.isEnabled() && m.isVisible && !this.overlays.has(m);

  /** Surface point of a model/shape under the screen position, with its world normal. */
  pickSurface(x: number, y: number) {
    const pick = this.pickScene(x, y, true);
    if (!pick?.hit || !pick.pickedMesh || !pick.pickedPoint) return null;
    const entity = this.entityOf(pick.pickedMesh);
    if (!entity || entity.kind === 'light') return null;
    const normal = surfaceNormal(pick.pickedMesh, pick.faceId) ?? pick.getNormal(true, true) ?? Vector3.Up();
    return { entity, mesh: pick.pickedMesh, faceId: pick.faceId, point: pick.pickedPoint, normal };
  }

  private pickScene(x: number, y: number, surface = false) {
    // Prepare deformed geometry only for an explicit pick, never in the render loop.
    for (const entity of this.entities) if (entity.visible) for (const mesh of entity.meshes) {
      if (this.pickable(mesh)) prepareSurface(mesh);
    }
    return this.scene.pick(x, y, (m) => this.pickable(m) && (!surface || !this.helpers.has(m)));
  }

  /** World position → CSS pixels relative to the canvas. */
  toScreen(p: Vector3) {
    const engine = this.engine;
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    const v = Vector3.Project(p, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), new Viewport(0, 0, w, h));
    const canvas = engine.getRenderingCanvas()!;
    return { x: (v.x * canvas.clientWidth) / w, y: (v.y * canvas.clientHeight) / h, visible: v.z > 0 && v.z < 1 };
  }

  /** Size in world units of one screen pixel at a given position. */
  worldPerPixel(p: Vector3) {
    const distance = Math.max(Vector3.Distance(this.camera.position, p), this.camera.minZ);
    const height = this.engine.getRenderingCanvas()!.clientHeight || 1;
    return (2 * distance * Math.tan(this.camera.fov / 2)) / height;
  }

  boundsOf(entity: Entity) {
    entity.root.computeWorldMatrix(true);
    for (const m of entity.meshes) { prepareSurface(m); m.computeWorldMatrix(true); }
    const { min, max } = entity.root.getHierarchyBoundingVectors(true);
    return { min, max, center: min.add(max).scale(0.5), size: max.subtract(min) };
  }

  stats(entity: Entity) {
    let vertices = 0;
    let faces = 0;
    for (const m of entity.meshes) {
      vertices += m.getTotalVertices();
      faces += Math.floor(m.getTotalIndices() / 3);
    }
    return { vertices, faces, materials: this.materialsOf(entity).length };
  }

  // ---------- Camera ----------

  focus(entity = this.selected) {
    if (!entity) return;
    if (entity.kind === 'light') {
      this.animateCamera(entity.root.position.clone(), 4);
      return;
    }
    const { center, size } = this.boundsOf(entity);
    this.animateCamera(center, this.fitRadius(size));
  }

  frameAll() {
    const b = this.sceneBounds();
    if (b) this.animateCamera(b.center, this.fitRadius(b.size));
    else this.animateCamera(new Vector3(0, 0.8, 0), 6);
  }

  private isInView(entity: Entity) {
    const { min, max } = this.boundsOf(entity);
    const planes = Frustum.GetPlanes(this.camera.getTransformationMatrix());
    return new BoundingBox(min, max).isCompletelyInFrustum(planes);
  }

  /** Camera distance so a box of `size` fits on screen (accounts for portrait screens). */
  private fitRadius(size: Vector3) {
    const sphere = Math.max(size.length() / 2, 0.05);
    const aspect = this.engine.getAspectRatio(this.camera);
    const hFov = 2 * Math.atan(Math.tan(this.camera.fov / 2) * aspect);
    return (sphere / Math.sin(Math.min(this.camera.fov, hFov) / 2)) * 1.05;
  }

  private updateCameraTween() {
    const tw = this.cameraTween;
    if (!tw) return;
    const t = Math.min(1, (performance.now() - tw.start) / tw.duration);
    const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // ease in-out
    // setTarget keeps the camera where it is and turns it to look at the new center
    this.camera.setTarget(Vector3.Lerp(tw.from, tw.to, k));
    if (tw.toRadius !== undefined) this.camera.radius = tw.fromRadius + (tw.toRadius - tw.fromRadius) * k;
    if (t >= 1) this.cameraTween = null;
  }

  private animateCamera(to: Vector3, radius?: number, duration = 550) {
    this.cameraTween = { from: this.camera.target.clone(), to: to.clone(), fromRadius: this.camera.radius, toRadius: radius, start: performance.now(), duration };
  }

  /**
   * Makes a point (or the selected object's center) the camera pivot without zooming:
   * dragging then orbits around it.
   */
  orbitAround(target: Entity | Vector3 | null = this.selected) {
    if (!target) return;
    const point = target instanceof Vector3 ? target : target.kind === 'light' ? target.root.position.clone() : this.boundsOf(target).center;
    this.animateCamera(point);
    this.orbitPoint = point.clone();
    this.orbitEntity = target instanceof Vector3 ? null : target;
    this.pulseStart = performance.now();
    this.invalidate(1200);
    this.emit('tool');
  }

  /** The ring expands and fades where the new orbit center was set, then disappears. */
  private updatePivotMarker() {
    const t = (performance.now() - this.pulseStart) / 750;
    const on = t >= 0 && t < 1 && !this.cleanView && !!this.orbitPoint;
    this.pivotRing.setEnabled(on);
    if (!on) return;
    const ease = 1 - Math.pow(1 - t, 3);
    this.pivotRing.position.copyFrom(this.orbitPoint!);
    this.pivotRing.scaling.setAll(this.worldPerPixel(this.orbitPoint!) * (14 + 46 * ease));
    (this.pivotRing.material as StandardMaterial).alpha = 1 - t;
  }

  // ---------- Materials ----------

  materialsOf(entity: Entity): Material[] {
    const set = new Set<Material>();
    for (const m of entity.meshes) {
      const mat = this.rigger.difference.materialOf(m);
      if (!mat) continue;
      if (mat instanceof MultiMaterial) mat.subMaterials.forEach((s) => s && set.add(s));
      else set.add(mat);
    }
    return [...set];
  }

  setWireframe(entity: Entity, on: boolean) {
    for (const mat of this.materialsOf(entity)) mat.wireframe = on;
  }

  // ---------- Environment ----------

  async importEnvironment(file: File, size = 512, path = `environments/${crypto.randomUUID()}/${file.name}`, activate = true) {
    const assets = this.environments;
    this.loading.notifyObservers({ name: file.name, progress: 0 });
    try {
      const asset = await loadEnvironment(this.scene, file, size);
      assets.set(path, asset);
      if (activate) {
        this.beginEdit('environment', () => ({ ...this.env }), (s) => this.applyEnv(s));
        this.applyEnv({ custom: path, attribution: undefined });
        this.endEdit('environment');
      }
      return path;
    } finally { this.loading.notifyObservers(null); }
  }

  applyEnv(partial: Partial<EnvSettings> = {}) {
    if (partial.custom && !this.environments.has(partial.custom)) throw new Error(tr('Could not load environment.'));
    if (partial.preset !== undefined && !('custom' in partial)) partial = { ...partial, custom: undefined, attribution: undefined };
    Object.assign(this.env, partial);
    const env = this.env;
    const scene = this.scene;

    const source = env.custom ?? env.preset;
    if (!this.envTexture || source !== this.environmentSource) {
      const old = this.envTexture;
      const tex = env.custom ? this.environments.get(env.custom)!.texture : CubeTexture.CreateFromPrefilteredData((ENV_PRESETS[env.preset] ?? ENV_PRESETS[DEFAULT_ENV.preset]).url, scene);
      this.environmentSource = source;
      this.envTexture = tex;
      scene.environmentTexture = tex;
      this.skybox?.dispose(false, true);
      this.skybox = createSkybox(scene, tex, env.skyboxBlur);
      if (old && ![...this.environments.values()].some((a) => a.texture === old)) old.dispose();
    }
    scene.environmentIntensity = env.intensity;
    (this.envTexture as CubeTexture).rotationY = env.rotation;
    if (this.skybox) {
      this.skybox.setEnabled(env.skybox);
      const mat = this.skybox.material as PBRMaterial;
      mat.microSurface = 1 - env.skyboxBlur;
      if (mat.reflectionTexture) (mat.reflectionTexture as CubeTexture).rotationY = env.rotation;
    }
    scene.clearColor = Color4.FromHexString(env.background + 'ff');
    this.hemi.intensity = env.ambient;

    const groundColor = Color3.FromHexString(env.groundColor);
    const current = this.ground.material;
    if (env.ground === 'shadow' && !(current instanceof ShadowOnlyMaterial)) {
      current?.dispose();
      const mat = new ShadowOnlyMaterial('groundShadow', scene);
      mat.shadowColor = new Color3(0, 0, 0);
      mat.alpha = 0.6;
      this.ground.material = mat;
    } else if (env.ground === 'solid' && !(current instanceof BackgroundMaterial)) {
      current?.dispose();
      const mat = new BackgroundMaterial('groundSolid', scene);
      mat.shadowLevel = 0.35;
      mat.useRGBColor = false;
      this.ground.material = mat;
    }
    if (this.ground.material instanceof BackgroundMaterial) this.ground.material.primaryColor = groundColor;
    this.ground.setEnabled(env.ground !== 'none');
    this.grid.setEnabled(env.grid && !this.cleanView);
    this.refreshShadows();
    this.emit('env');
  }

  /** Ready-made light setups, photo mode style. They replace the current lights. */
  applyLightPreset(id: string) {
    this.group(() => {
      this.beginEdit('lighting', () => ({ env: { ...this.env }, photo: { ...this.photo } }), (s) => {
        this.applyEnv(s.env);
        this.setPhoto(s.photo);
      });
      this.applyLightPresetInner(id);
      this.endEdit('lighting');
    });
  }

  private applyLightPresetInner(id: string) {
    for (const e of this.entities.filter((x) => x.kind === 'light')) this.remove(e);
    // Preset positions are designed for a ~2 m scene; scale them to the actual scene size
    const b = this.sceneBounds();
    const k = b ? Math.max(b.size.x, b.size.y, b.size.z, 0.5) / 2 : 1;
    const c = b ? new Vector3(b.center.x, b.min.y, b.center.z) : this.camera.target.clone();
    const at = (x: number, y: number, z: number) => c.add(new Vector3(x, y, z).scale(k));
    const focus = b ? b.center : at(0, 0.6, 0);
    const opt = { select: false, target: focus };
    const preset = findLightPreset(id);
    if (!preset) return;
    const { bright, ...env } = preset.env;
    // Bright presets start from the default sky and shadow-catcher floor
    this.applyEnv(bright ? { skybox: true, ground: 'shadow', background: DEFAULT_ENV.background, ...env } : env);
    this.setPhoto({ ...DEFAULT_PHOTO, fov: this.photo.fov, aspect: this.photo.aspect, ...preset.photo });
    for (const l of preset.lights) {
      this.addLight(l.type, { ...opt, position: at(...l.pos), intensity: presetIntensity(l, k), color: l.color, shadows: l.shadows, angle: l.angle });
    }
  }

  // ---------- Photo mode / post-processing ----------

  setPhoto(partial: Partial<PhotoSettings>) {
    Object.assign(this.photo, partial);
    this.applyPhoto();
    this.emit('env');
  }

  private applyPhoto() {
    const p = this.photo;
    const pl = this.pipeline;
    this.camera.fov = (p.fov * Math.PI) / 180;
    const ip = pl.imageProcessing;
    ip.exposure = p.exposure;
    ip.contrast = p.contrast;
    ip.vignetteEnabled = p.vignette > 0;
    ip.vignetteWeight = p.vignette * 4;
    ip.vignetteStretch = 0.5;
    ip.vignetteColor = new Color4(0, 0, 0, 0);
    ip.colorCurvesEnabled = p.saturation !== 0 || p.temperature !== 0;
    if (ip.colorCurves) {
      ip.colorCurves.globalSaturation = p.saturation;
      ip.colorCurves.globalHue = p.temperature >= 0 ? 30 : 210;
      ip.colorCurves.globalDensity = Math.abs(p.temperature) * 0.6;
    }
    pl.bloomEnabled = p.bloom > 0;
    pl.bloomWeight = p.bloom;
    pl.bloomThreshold = p.bloomThreshold;
    pl.bloomKernel = 64;
    pl.bloomScale = 0.5;
    pl.depthOfFieldEnabled = p.dof;
    if (p.dof) {
      pl.depthOfFieldBlurLevel = 1;
      pl.depthOfField.fStop = p.fStop;
      pl.depthOfField.focalLength = 50;
      pl.depthOfField.focusDistance = p.focusDistance * 1000;
    }
    pl.grainEnabled = p.grain > 0;
    pl.grain.intensity = p.grain;
    pl.grain.animated = false;
    pl.chromaticAberrationEnabled = p.chromatic > 0;
    pl.chromaticAberration.aberrationAmount = p.chromatic;
    pl.sharpenEnabled = p.sharpen > 0;
    pl.sharpen.edgeAmount = p.sharpen;
  }

  /** Tap on the scene with depth of field on: focuses on the tapped point. */
  focusAt(x: number, y: number) {
    const pick = this.pickScene(x, y, true);
    if (!pick?.hit || !pick.pickedPoint) return;
    this.beginEdit('focus', () => ({ ...this.photo }), (s) => this.setPhoto(s));
    this.setPhoto({ focusDistance: Vector3.Distance(this.camera.position, pick.pickedPoint) });
    this.endEdit('focus');
  }

  setPhotoMode(on: boolean) {
    if (on && (this.fusion.busy || this.fusion.preview)) this.fusion.cancel();
    if (on) this.wrap.cancel();
    this.photoMode = on;
    this.applyCleanView();
    this.emit('photo');
  }

  private applyCleanView() {
    const clean = this.cleanView;
    for (const h of this.helpers) h.isVisible = !clean;
    this.grid.setEnabled(this.env.grid && !clean);
    this.outline.isEnabled = !clean;
    this.applyTool();
  }

  /** Turns the shadows of every light on/off (AR starts without them to stay light). */
  setShadowsEnabled(on: boolean) {
    for (const e of this.entities) if (e.light && e.shadowGen) e.light.shadowEnabled = on;
  }

  /** Puts the editor's HDR environment back (AR light estimation replaces it). */
  restoreEnvironmentTexture() {
    if (this.envTexture) this.scene.environmentTexture = this.envTexture;
  }

  /**
   * Virtual AR: during an AR session, covers the camera image with the scene's own environment
   * (sky, background, floor), so the phone becomes a window into the virtual scene.
   */
  setARVirtual(virtual: boolean) {
    if (!this.arMode || !this.arSaved) return;
    const s = this.arSaved;
    if (virtual) {
      this.applyEnv({ skybox: s.skybox, ground: s.ground, background: s.background, grid: false });
    } else {
      this.applyEnv({ skybox: false, ground: 'shadow', grid: false });
      this.scene.clearColor = new Color4(0, 0, 0, 0);
    }
  }

  /** Prepares the scene for AR (and restores it afterwards). */
  setARMode(on: boolean) {
    if (on === this.arMode) return;
    if (on) {
      this.select(null);
      this.arSaved = { ...this.env };
      this.arMode = true;
      // Real world as background; the floor only shows shadows on the real ground
      this.applyEnv({ skybox: false, ground: 'shadow', grid: false });
      this.scene.clearColor = new Color4(0, 0, 0, 0);
    } else {
      this.arMode = false;
      // Light estimation replaced the environment lighting during the session
      this.restoreEnvironmentTexture();
      this.setShadowsEnabled(true);
      if (this.arSaved) this.applyEnv(this.arSaved);
      this.arSaved = null;
    }
    this.applyCleanView();
    this.emit('photo');
  }

  async captureThumbnail(size = 240): Promise<Blob> {
    const { CreateScreenshotUsingRenderTargetAsync } = await import('@babylonjs/core/Misc/screenshotTools.js');
    this.thumbnailMode = true;
    this.applyCleanView();
    const overlays = [...this.overlays].map((mesh) => ({ mesh, enabled: mesh.isEnabled(false) }));
    overlays.forEach(({ mesh }) => mesh.setEnabled(false));
    try {
      this.invalidate();
      const data = await CreateScreenshotUsingRenderTargetAsync(this.engine, this.camera, { width: size, height: Math.round(size * 2 / 3) }, 'image/png');
      return await (await fetch(data)).blob();
    } finally {
      overlays.forEach(({ mesh, enabled }) => mesh.setEnabled(enabled));
      this.thumbnailMode = false;
      this.applyCleanView();
      this.invalidate();
    }
  }

  /** Renders the scene without helpers (gizmos, grid, outline) and returns the image cropped to the chosen aspect. */
  async capture(multiplier = 2): Promise<Blob> {
    // The capture waits for rendered frames
    this.invalidate(8000);
    const prevPhoto = this.photoMode;
    if (!prevPhoto) this.setPhotoMode(true);
    const prevScale = this.engine.getHardwareScalingLevel();
    const canvas = this.engine.getRenderingCanvas()!;
    const maxSize = this.engine.getCaps().maxRenderTextureSize || 4096;
    const scale = Math.min(multiplier, maxSize / (canvas.clientWidth / prevScale));
    this.engine.setHardwareScalingLevel(prevScale / Math.max(1, scale));
    this.engine.resize();
    try {
      await new Promise<void>((r) => this.scene.onAfterRenderObservable.addOnce(() => r()));
      await new Promise<void>((r) => this.scene.onAfterRenderObservable.addOnce(() => r()));
      const blob = await new Promise<Blob>((resolve, reject) => {
        this.scene.onAfterRenderObservable.addOnce(() => {
          const out = cropToAspect(canvas, this.photo.aspect);
          out.toBlob((b) => (b ? resolve(b) : reject(new Error(tr('Failed to create image')))), 'image/png');
        });
      });
      return blob;
    } finally {
      this.engine.setHardwareScalingLevel(prevScale);
      this.engine.resize();
      if (!prevPhoto) this.setPhotoMode(false);
    }
  }

  /**
   * The scene as a GLB. Compact: optimized geometry and textures where the user optimized,
   * meshopt-compressed (loaded on demand); otherwise the original models, as they were loaded.
   */
  async exportGLB(compact = false): Promise<Blob> {
    if (this.fusion.preview || this.fusion.busy) this.fusion.cancel();
    this.wrap.cancel();
    this.rigger.difference.clear();
    for (const e of this.entities) if (e.rig) updateHelperBones(e.rig);
    const exclude = new Set<Node>([this.ground, this.grid, ...this.helpers, ...this.overlays]);
    for (const e of this.entities) {
      if (!e.visible) {
        exclude.add(e.root);
        for (const node of e.root.getDescendants()) exclude.add(node);
      }
      // Levels of detail are chosen by the viewer from the distance: not part of the file
      for (const v of e.optimization?.meshes ?? []) for (const lod of v.lodMeshes) exclude.add(lod);
    }
    if (this.skybox) exclude.add(this.skybox);
    exclude.add(this.pose.ikTarget);
    exclude.add(this.rigger.handle);
    const original = compact ? [] : this.entities.filter((e) => e.optimization);
    for (const e of original) this.optimizer.preview(e, true);
    const textures = this.textureOptimizer.forExport(compact);
    let glb: Blob;
    const { affineExport } = await import('../edit/affineExport');
    const restoreAffineExport = affineExport(this.scene);
    try {
      const { GLTF2Export } = await import('@babylonjs/serializers/glTF/2.0/glTFSerializer.js');
      const data = await GLTF2Export.GLBAsync(this.scene, 'scene', {
        shouldExportNode: (node) => {
          if (exclude.has(node) || node.name === 'ambient') return false;
          return node.isEnabled();
        },
      });
      glb = data.files['scene.glb'] as Blob;
    } finally {
      restoreAffineExport();
      textures.restore();
      for (const e of original) this.optimizer.preview(e, false);
      this.invalidate();
    }
    if (!compact) return glb;
    const { compactGLB } = await import('../optimize/export');
    return new Blob([(await compactGLB(new Uint8Array(await glb.arrayBuffer()), textures.ktx2)) as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' });
  }
}

/** The environment as a background (same as Babylon's default PBR skybox, without its ≈420 KB scene helpers). */
function createSkybox(scene: Scene, environment: BaseTexture, blur: number) {
  const box = CreateBox('hdrSkyBox', { size: 1000 }, scene);
  const material = new PBRMaterial('skyBox', scene);
  material.backFaceCulling = false;
  material.reflectionTexture = environment.clone();
  if (material.reflectionTexture) material.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
  material.microSurface = 1 - blur;
  material.disableLighting = true;
  material.twoSidedLighting = true;
  box.material = material;
  box.isPickable = false;
  box.infiniteDistance = true;
  box.ignoreCameraMaxZ = true;
  return box;
}

export function ext(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

export const ASPECTS: Record<string, { label: string; ratio: number | null }> = {
  free: { label: 'Screen', ratio: null },
  '16:9': { label: '16:9', ratio: 16 / 9 },
  '2.39': { label: 'Cinema', ratio: 2.39 },
  '4:3': { label: '4:3', ratio: 4 / 3 },
  '1:1': { label: '1:1', ratio: 1 },
  '4:5': { label: '4:5', ratio: 4 / 5 },
  '9:16': { label: '9:16', ratio: 9 / 16 },
};

/** Rectangle (in pixels) of the usable area for an aspect, centered on screen. */
export function aspectRect(width: number, height: number, aspect: string) {
  const ratio = ASPECTS[aspect]?.ratio;
  if (!ratio) return { x: 0, y: 0, w: width, h: height };
  let w = width;
  let h = width / ratio;
  if (h > height) {
    h = height;
    w = height * ratio;
  }
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

function cropToAspect(canvas: HTMLCanvasElement, aspect: string) {
  const r = aspectRect(canvas.width, canvas.height, aspect);
  const out = document.createElement('canvas');
  out.width = Math.round(r.w);
  out.height = Math.round(r.h);
  out.getContext('2d')!.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, out.width, out.height);
  return out;
}
