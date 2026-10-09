import {
  AbstractMesh,
  AnimationGroup,
  ArcRotateCamera,
  AssetContainer,
  BackgroundMaterial,
  BoundingBox,
  Color3,
  Color4,
  CubeTexture,
  DefaultRenderingPipeline,
  DirectionalLight,
  Engine,
  FilesInputStore,
  Frustum,
  GizmoManager,
  HemisphericLight,
  ImageProcessingConfiguration,
  LoadAssetContainerAsync,
  Material,
  Matrix,
  Mesh,
  MeshBuilder,
  MultiMaterial,
  Observable,
  Plane,
  PBRMaterial,
  PointLight,
  PointerDragBehavior,
  PointerEventTypes,
  Quaternion,
  Scene,
  SelectionOutlineLayer,
  ShadowGenerator,
  ShadowLight,
  SpotLight,
  StandardMaterial,
  TransformNode,
  Vector3,
  Viewport,
} from '@babylonjs/core';
import type { BaseTexture, Node } from '@babylonjs/core';
import { registerBuiltInLoaders } from '@babylonjs/loaders/dynamic.js';
import { GridMaterial } from '@babylonjs/materials/grid/gridMaterial.js';
import { ShadowOnlyMaterial } from '@babylonjs/materials/shadowOnly/shadowOnlyMaterial.js';
import { GLTF2Export } from '@babylonjs/serializers/glTF/2.0/glTFSerializer.js';
import { tr } from './i18n';
import { Tools } from './tools';
import type { Axis } from './tools';

registerBuiltInLoaders();

export const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj', 'stl', 'fbx', 'ply', 'splat', 'spz', 'sog', 'usdz', 'babylon'];

export type Tool = 'move' | 'rotate' | 'scale';
export type LightType = 'point' | 'spot' | 'directional';
export type PrimitiveType = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane';
export type GroundMode = 'shadow' | 'solid' | 'none';
export type ChangeKind = 'selection' | 'entities' | 'transform' | 'history' | 'env' | 'photo' | 'tool';

export interface Entity {
  id: number;
  name: string;
  kind: 'model' | 'primitive' | 'light';
  root: Mesh;
  meshes: AbstractMesh[];
  animationGroups: AnimationGroup[];
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
  id: number;
  name: string;
  url?: string;
  main?: File;
  deps?: File[];
}

export interface AddOptions {
  record?: boolean;
  select?: boolean;
}

interface TransformSnapshot {
  p: Vector3;
  q: Quaternion;
  s: Vector3;
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
  { label: 'Boombox', url: 'https://assets.babylonjs.com/meshes/boombox.glb' },
  { label: 'Helmet', url: 'https://assets.babylonjs.com/meshes/flightHelmet.glb' },
  { label: 'Character', url: 'https://assets.babylonjs.com/meshes/HVGirl.glb' },
  { label: 'Robot', url: 'https://assets.babylonjs.com/meshes/Xbot.glb' },
  { label: 'Shark', url: 'https://assets.babylonjs.com/meshes/shark.glb' },
  { label: 'Airplane', url: 'https://assets.babylonjs.com/meshes/aerobatic_plane.glb' },
];

export interface EnvSettings {
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

  env: EnvSettings = { ...DEFAULT_ENV };
  photo: PhotoSettings = { ...DEFAULT_PHOTO };

  private readonly gizmos: GizmoManager;
  private readonly outline: SelectionOutlineLayer;
  private readonly drag: PointerDragBehavior;
  private readonly hemi: HemisphericLight;
  private readonly ground: Mesh;
  private readonly grid: Mesh;
  private envTexture: BaseTexture | null = null;
  private skybox: Mesh | null = null;
  private readonly helpers = new Set<AbstractMesh>();
  /** Measurement/guide visuals: never selected, exported or shown in photos. */
  readonly overlays = new Set<AbstractMesh>();
  readonly tools: Tools;
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
  /** Camera animation: move the pivot (target) and optionally the distance (radius). */
  private cameraTween: { target: Vector3; radius?: number } | null = null;
  private pivotMarker!: Mesh;
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

    this.ground = MeshBuilder.CreateDisc('ground', { radius: 60, tessellation: 96 }, scene);
    this.ground.rotation.x = Math.PI / 2;
    this.ground.isPickable = false;
    this.ground.receiveShadows = true;

    this.grid = MeshBuilder.CreateGround('grid', { width: 60, height: 60 }, scene);
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

    this.gizmos = new GizmoManager(scene, isTouch ? 2 : 1.5);
    this.gizmos.usePointerToAttachGizmos = false;
    this.gizmos.clearGizmoOnEmptyPointerEvent = false;
    this.gizmos.scaleRatio = isTouch ? 1.5 : 1.1;
    this.gizmos.positionGizmoEnabled = true;
    this.gizmos.rotationGizmoEnabled = true;
    this.gizmos.scaleGizmoEnabled = true;
    const g = this.gizmos.gizmos;
    g.positionGizmo!.planarGizmoEnabled = true;
    for (const gz of [g.positionGizmo!, g.rotationGizmo!, g.scaleGizmo!]) {
      gz.onDragStartObservable.add(() => this.beginTransform());
      gz.onDragEndObservable.add(() => {
        this.tools.clearSmartLines();
        this.endTransform();
      });
    }
    // Position gizmo: track the raw position ourselves so grid snapping and smart guides don't get "sticky"
    const pg = g.positionGizmo!;
    let raw: Vector3 | null = null;
    pg.onDragStartObservable.add(() => {
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
        const e = this.selected;
        if (!e || !raw) return;
        raw.addInPlace(ev.delta);
        this.moveTo(e, raw.clone(), axes);
      });
    }
    this.gizmos.positionGizmoEnabled = false;
    this.gizmos.rotationGizmoEnabled = false;
    this.gizmos.scaleGizmoEnabled = false;

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
      if (info.type === PointerEventTypes.POINTERTAP) {
        if (this.tools.measureMode) return;
        if (this.gizmos.isHovered) return;
        const util = this.gizmos.utilityLayer.utilityLayerScene.pick(scene.pointerX, scene.pointerY);
        if (util?.hit) return;
        const pick = scene.pick(scene.pointerX, scene.pointerY, this.pickable);
        const ev = info.event as PointerEvent;
        const additive = this.multiSelect || ev.shiftKey || ev.ctrlKey || ev.metaKey;
        const entity = pick?.pickedMesh ? this.entityOf(pick.pickedMesh) : null;
        if (additive && !entity) return;
        this.select(entity, additive);
      } else if (info.type === PointerEventTypes.POINTERDOUBLETAP) {
        const pick = scene.pick(scene.pointerX, scene.pointerY, this.pickable);
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
    camera.onViewMatrixChangedObservable.add(() => (this.lastCameraMove = performance.now()));

    this.tools = new Tools(this);

    this.pivotMarker = MeshBuilder.CreateSphere('pivot', { diameter: 1, segments: 12 }, scene);
    const pivotMat = new StandardMaterial('pivot', scene);
    pivotMat.disableLighting = true;
    pivotMat.emissiveColor = ACCENT;
    pivotMat.alpha = 0.85;
    this.pivotMarker.material = pivotMat;
    this.pivotMarker.renderingGroupId = 2;
    this.pivotMarker.isPickable = false;
    this.pivotMarker.setEnabled(false);
    this.overlays.add(this.pivotMarker);
    this.applyEnv();
    this.addDefaultLight();

    this.engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => this.engine.resize());
  }

  // ---------- Events / history ----------

  private emit(kind: ChangeKind) {
    this.changed.notifyObservers(kind);
  }

  private batch: Command[] | null = null;

  /** Groups several changes into a single undo step. */
  private group(fn: () => void) {
    const cmds: Command[] = [];
    this.batch = cmds;
    try {
      fn();
    } finally {
      this.batch = null;
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
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
    this.emit('history');
    this.emit('transform');
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.redo();
    this.undoStack.push(cmd);
    this.emit('history');
    this.emit('transform');
  }

  private snapshot(e: Entity): TransformSnapshot {
    return { p: e.root.position.clone(), q: e.root.rotationQuaternion!.clone(), s: e.root.scaling.clone() };
  }

  private restore(e: Entity, t: TransformSnapshot) {
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
      if (id) return this.entities.find((e) => e.id === id) ?? null;
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
    for (const m of entity.meshes) m.receiveShadows = true;
    this.attach(entity);
    if (record) this.push({ undo: () => this.detach(entity), redo: () => this.attach(entity), entities: [entity] });
    if (select) this.select(entity);
  }

  private attach(entity: Entity) {
    entity.root.setEnabled(true);
    if (entity.light) entity.light.setEnabled(true);
    if (!this.entities.includes(entity)) this.entities.push(entity);
    this.refreshShadows();
    this.emit('entities');
  }

  private detach(entity: Entity) {
    if (this.extra.includes(entity)) this.select(entity, true);
    if (this.selected === entity) this.select(null);
    entity.root.setEnabled(false);
    if (entity.light) entity.light.setEnabled(false);
    entity.animationGroups.forEach((a) => a.stop());
    this.entities = this.entities.filter((e) => e !== entity);
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

  async addFiles(files: File[]) {
    const mains = files.filter((f) => MODEL_EXTENSIONS.includes(ext(f.name)));
    if (!mains.length) throw new Error(tr('No supported 3D file. Use: {list}', { list: MODEL_EXTENSIONS.join(', ') }));
    const others = files.filter((f) => !mains.includes(f));
    let i = 0;
    for (const f of mains) {
      // .gltf and .obj may reference external files (.bin, textures, .mtl)
      const deps = ['gltf', 'obj'].includes(ext(f.name)) ? others : [];
      const asset: AssetRef = { id: this.nextAssetId++, name: f.name.replace(/\.[^.]+$/, ''), main: f, deps };
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
      return await LoadAssetContainerAsync(asset.main ?? asset.url!, this.scene, {
        rootUrl: asset.main ? 'file:' : undefined,
        onProgress: (ev) => {
          if (ev.lengthComputable) this.loading.notifyObservers({ name: asset.name, progress: ev.loaded / ev.total });
        },
      });
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
    this.register(entity, opts.record ?? true, opts.select ?? true);
    return entity;
  }

  private instantiate(container: AssetContainer, name: string, source: ModelSource | null, asset?: AssetRef): Entity {
    const root = this.createRoot(this.uniqueName(name));
    const fit = new TransformNode('fit', this.scene);
    fit.parent = root;
    const inst = container.instantiateModelsToScene((n) => n, true, { doNotInstantiate: true });
    for (const n of inst.rootNodes) n.parent = fit;
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
        mesh = MeshBuilder.CreateBox('box', { size: 1 }, this.scene);
        mesh.position.y = 0.5;
        break;
      case 'sphere':
        mesh = MeshBuilder.CreateSphere('sphere', { diameter: 1, segments: 48 }, this.scene);
        mesh.position.y = 0.5;
        break;
      case 'cylinder':
        mesh = MeshBuilder.CreateCylinder('cylinder', { height: 1, diameter: 1, tessellation: 64 }, this.scene);
        mesh.position.y = 0.5;
        break;
      case 'cone':
        mesh = MeshBuilder.CreateCylinder('cone', { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 64 }, this.scene);
        mesh.position.y = 0.5;
        break;
      case 'torus':
        mesh = MeshBuilder.CreateTorus('torus', { diameter: 1, thickness: 0.3, tessellation: 64 }, this.scene);
        mesh.position.y = 0.15;
        break;
      case 'plane':
        mesh = MeshBuilder.CreateGround('plane', { width: 2, height: 2 }, this.scene);
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
    this.placeNew(entity);
    this.register(entity, opts.record ?? true, opts.select ?? true);
    if ((opts.record ?? true) && !this.isInView(entity)) this.frameAll();
    return entity;
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
    const bulb = MeshBuilder.CreateSphere('bulb', { diameter: 0.22, segments: 12 }, this.scene);
    bulb.material = proxyMat;
    bulb.parent = root;
    const parts: AbstractMesh[] = [bulb];
    if (type !== 'point') {
      const arrow = MeshBuilder.CreateCylinder('arrow', { height: 0.5, diameterTop: 0, diameterBottom: 0.12, tessellation: 12 }, this.scene);
      arrow.rotation.x = Math.PI / 2;
      arrow.position.z = 0.32;
      arrow.material = proxyMat;
      arrow.parent = root;
      parts.push(arrow);
    }
    for (const p of parts) {
      this.helpers.add(p);
      p.isVisible = !this.photoMode;
    }

    let light: ShadowLight;
    if (type === 'point') {
      light = new PointLight(root.name, Vector3.Zero(), this.scene);
    } else if (type === 'spot') {
      light = new SpotLight(root.name, Vector3.Zero(), new Vector3(0, 0, 1), opts.angle ?? Math.PI / 4, 2, this.scene);
    } else {
      light = new DirectionalLight(root.name, new Vector3(0, 0, 1), this.scene);
      (light as DirectionalLight).autoCalcShadowZBounds = true;
    }
    light.parent = root;
    light.diffuse = color;
    light.specular = color;
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
      const gen = new ShadowGenerator(isTouch ? 1024 : 2048, entity.light);
      if (entity.lightType === 'point') {
        gen.usePoissonSampling = true;
      } else {
        gen.usePercentageCloserFiltering = true;
        gen.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
      }
      gen.bias = 0.0008;
      gen.normalBias = 0.015;
      entity.shadowGen = gen;
    } else if (!on && entity.shadowGen) {
      entity.shadowGen.dispose();
      entity.shadowGen = undefined;
    }
    this.refreshShadows();
  }

  private refreshShadows() {
    const casters = this.entities.filter((e) => e.kind !== 'light' && e.castShadows && e.visible).flatMap((e) => e.meshes);
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
    let copy: Entity;
    if (entity.kind === 'model' && entity.source) {
      copy = this.instantiate(entity.source.container, entity.name.replace(/ \d+$/, ''), entity.source);
      copy.castShadows = entity.castShadows;
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
    copy.root.rotationQuaternion!.copyFrom(entity.root.rotationQuaternion!);
    copy.root.scaling.copyFrom(entity.root.scaling);
    copy.root.position.copyFrom(entity.root.position).addInPlace(new Vector3(0.6, 0, 0.6));
    this.select(copy);
    return copy;
  }

  remove(entity?: Entity) {
    if (!entity) {
      const items = this.selection;
      if (items.length > 1) return this.group(() => items.forEach((e) => this.remove(e)));
      entity = this.selected ?? undefined;
    }
    if (!entity) return;
    this.detach(entity);
    this.push({ undo: () => this.attach(entity), redo: () => this.detach(entity), entities: [entity] });
  }

  rename(entity: Entity, name: string) {
    entity.name = name || entity.name;
    this.emit('entities');
  }

  setVisible(entity: Entity, visible: boolean) {
    entity.visible = visible;
    for (const m of entity.meshes) m.isVisible = visible;
    if (entity.light) entity.light.setEnabled(visible);
    this.refreshShadows();
    this.emit('entities');
  }

  setCastShadows(entity: Entity, on: boolean) {
    entity.castShadows = on;
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
    this.select(null);
    this.tools.clear();
    const all = new Set<Entity>(this.entities);
    for (const cmd of [...this.undoStack, ...this.redoStack]) for (const e of cmd.entities ?? []) all.add(e);
    const containers = new Set<AssetContainer>();
    for (const e of all) {
      e.animationGroups.forEach((a) => a.dispose());
      e.shadowGen?.dispose();
      e.light?.dispose();
      for (const m of e.root.getChildMeshes()) this.helpers.delete(m);
      if (e.kind === 'model') this.materialsOf(e).forEach((m) => m.dispose(false, true));
      e.root.dispose(false, e.kind !== 'model');
      if (e.source) containers.add(e.source.container);
    }
    containers.forEach((c) => c.dispose());
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

  /** Selects an object. With `additive`, toggles it in a multi-selection instead. */
  select(entity: Entity | null, additive = false) {
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

  private applyTool() {
    const e = this.selected;
    const tool = e?.kind === 'light' && this.tool === 'scale' ? 'move' : this.tool;
    const show = !!e && !this.photoMode && !this.tools?.measureMode;
    this.gizmos.positionGizmoEnabled = show && tool === 'move';
    this.gizmos.rotationGizmoEnabled = show && tool === 'rotate';
    this.gizmos.scaleGizmoEnabled = show && tool === 'scale';
    const g = this.gizmos.gizmos;
    g.positionGizmo!.snapDistance = 0; // grid snapping is done in moveTo()
    g.rotationGizmo!.snapDistance = this.snap ? Math.PI / 12 : 0;
    g.scaleGizmo!.snapDistance = this.snap ? 0.1 : 0;
    this.gizmos.attachToMesh(show ? e!.root : null);
    if (e) {
      e.root.removeBehavior(this.drag);
      if (show && tool === 'move') e.root.addBehavior(this.drag);
    }
  }

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
  setDimension(entity: Entity, axis: Axis, value: number) {
    const b = this.boundsOf(entity);
    if (value <= 0 || b.size[axis] <= 1e-9) return;
    this.transformMany([entity], (e) => {
      e.root.scaling.scaleInPlace(value / b.size[axis]);
      e.root.position.y += b.min.y - this.boundsOf(e).min.y;
    });
  }

  private readonly pickable = (m: AbstractMesh) => m.isPickable && m.isEnabled() && m.isVisible && !this.overlays.has(m);

  /** Surface point of a model/shape under the screen position, with its world normal. */
  pickSurface(x: number, y: number) {
    const pick = this.scene.pick(x, y, (m) => this.pickable(m) && !this.helpers.has(m));
    if (!pick?.hit || !pick.pickedMesh || !pick.pickedPoint) return null;
    const entity = this.entityOf(pick.pickedMesh);
    if (!entity || entity.kind === 'light') return null;
    const normal = pick.getNormal(true, true) ?? Vector3.Up();
    return { entity, mesh: pick.pickedMesh, faceId: pick.faceId, point: pick.pickedPoint, normal };
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
    for (const m of entity.meshes) m.computeWorldMatrix(true);
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
      this.cameraTween = { target: entity.root.position.clone(), radius: 4 };
      return;
    }
    const { center, size } = this.boundsOf(entity);
    this.cameraTween = { target: center, radius: this.fitRadius(size) };
  }

  frameAll() {
    const b = this.sceneBounds();
    this.cameraTween = b ? { target: b.center, radius: this.fitRadius(b.size) } : { target: new Vector3(0, 0.8, 0), radius: 6 };
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
    const k = 1 - Math.pow(0.001, this.engine.getDeltaTime() / 1000 / 0.6);
    const target = Vector3.Lerp(this.camera.target, tw.target, k);
    // setTarget keeps the camera where it is and turns it to look at the new pivot
    this.camera.setTarget(target);
    if (tw.radius !== undefined) this.camera.radius += (tw.radius - this.camera.radius) * k;
    const radiusDone = tw.radius === undefined || Math.abs(this.camera.radius - tw.radius) < 0.001;
    if (Vector3.Distance(target, tw.target) < 0.001 && radiusDone) this.cameraTween = null;
  }

  /**
   * Makes a point (or the selected object's center) the camera pivot without zooming:
   * dragging then orbits around it.
   */
  orbitAround(target: Entity | Vector3 | null = this.selected) {
    if (!target) return;
    const point = target instanceof Vector3 ? target : target.kind === 'light' ? target.root.position.clone() : this.boundsOf(target).center;
    this.cameraTween = { target: point };
  }

  /** Small dot at the pivot, shown while the camera moves so it's clear what it orbits around. */
  private updatePivotMarker() {
    const now = performance.now();
    const show = !this.photoMode && (now - this.lastCameraMove < 450 || !!this.cameraTween);
    this.pivotMarker.setEnabled(show);
    if (!show) return;
    const t = this.camera.target;
    this.pivotMarker.position.copyFrom(t);
    this.pivotMarker.scaling.setAll(this.worldPerPixel(t) * 9);
  }

  // ---------- Materials ----------

  materialsOf(entity: Entity): Material[] {
    const set = new Set<Material>();
    for (const m of entity.meshes) {
      const mat = m.material;
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

  applyEnv(partial: Partial<EnvSettings> = {}) {
    const prevPreset = this.env.preset;
    Object.assign(this.env, partial);
    const env = this.env;
    const scene = this.scene;

    if (!this.envTexture || env.preset !== prevPreset) {
      const old = this.envTexture;
      const tex = CubeTexture.CreateFromPrefilteredData(ENV_PRESETS[env.preset].url, scene);
      this.envTexture = tex;
      scene.environmentTexture = tex;
      this.skybox?.dispose(false, true);
      this.skybox = scene.createDefaultSkybox(tex, true, 1000, env.skyboxBlur, true);
      if (this.skybox) this.skybox.isPickable = false;
      old?.dispose();
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
    this.grid.setEnabled(env.grid && !this.photoMode);
    this.refreshShadows();
    this.emit('env');
  }

  /** Ready-made light setups, photo mode style. They replace the current lights. */
  applyLightPreset(id: string) {
    this.group(() => this.applyLightPresetInner(id));
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
    // Point/spot lights fall off with the square of the distance
    const pw = (v: number) => v * k * k;
    const bright = { skybox: true, ground: 'shadow' as GroundMode, background: '#1a1215' };
    this.setPhoto({ ...DEFAULT_PHOTO, fov: this.photo.fov, aspect: this.photo.aspect });
    switch (id) {
      case 'studio':
        this.applyEnv({ ...bright, preset: 'studio', intensity: 0.7, skyboxBlur: 0.7 });
        this.addLight('directional', { ...opt, position: at(-3, 5, -3), intensity: 2.6, color: '#fff2e0' });
        this.addLight('point', { ...opt, position: at(3, 2, -2), intensity: pw(12), color: '#dbe8ff', shadows: false });
        this.addLight('spot', { ...opt, position: at(0, 3, 4), intensity: pw(45), color: '#ffffff', shadows: false });
        break;
      case 'sunset':
        this.applyEnv({ ...bright, preset: 'country', intensity: 0.35, skyboxBlur: 0.4 });
        this.addLight('directional', { ...opt, position: at(-6, 1.6, -3), intensity: 3.5, color: '#ff8a3d' });
        this.addLight('point', { ...opt, position: at(3, 2.5, 3), intensity: pw(15), color: '#5b7cff', shadows: false });
        this.setPhoto({ temperature: 30, bloom: 0.3, vignette: 0.6 });
        break;
      case 'neon':
        this.applyEnv({ intensity: 0.08, background: '#07070c', skybox: false, ground: 'solid', groundColor: '#101018' });
        this.addLight('point', { ...opt, position: at(-2, 1.5, -1), intensity: pw(40), color: '#ff2fd6', shadows: true });
        this.addLight('point', { ...opt, position: at(2, 1.5, 1), intensity: pw(40), color: '#20e3ff', shadows: false });
        this.addLight('spot', { ...opt, position: at(0, 4, 0.1), intensity: pw(30), color: '#b388ff' });
        this.setPhoto({ bloom: 0.8, bloomThreshold: 0.5, saturation: 30, chromatic: 6, vignette: 1 });
        break;
      case 'dramatic':
        this.applyEnv({ intensity: 0.05, background: '#050505', skybox: false, ground: 'solid', groundColor: '#121212' });
        this.addLight('spot', { ...opt, position: at(0.5, 5, 1), intensity: pw(120), color: '#fff5e8', angle: Math.PI / 6 });
        this.setPhoto({ contrast: 1.4, vignette: 1.2 });
        break;
      case 'daylight':
        this.applyEnv({ ...bright, preset: 'country', intensity: 1, skyboxBlur: 0.2 });
        this.addLight('directional', { ...opt, position: at(4, 8, 3), intensity: 3, color: '#fff8ec' });
        break;
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
    const pick = this.scene.pick(x, y, (m) => this.pickable(m) && !this.helpers.has(m));
    if (!pick?.hit || !pick.pickedPoint) return;
    this.setPhoto({ focusDistance: Vector3.Distance(this.camera.position, pick.pickedPoint) });
  }

  setPhotoMode(on: boolean) {
    this.photoMode = on;
    for (const h of this.helpers) h.isVisible = !on;
    this.grid.setEnabled(this.env.grid && !on);
    this.outline.isEnabled = !on;
    this.applyTool();
    this.emit('photo');
  }

  /** Renders the scene without helpers (gizmos, grid, outline) and returns the image cropped to the chosen aspect. */
  async capture(multiplier = 2): Promise<Blob> {
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

  async exportGLB() {
    const exclude = new Set<Node>([this.ground, this.grid, ...this.helpers, ...this.overlays]);
    if (this.skybox) exclude.add(this.skybox);
    const data = await GLTF2Export.GLBAsync(this.scene, 'scene', {
      shouldExportNode: (node) => {
        if (exclude.has(node) || node.name === 'ambient') return false;
        return node.isEnabled();
      },
    });
    data.downloadFiles();
  }
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
