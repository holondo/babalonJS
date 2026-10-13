import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Viewport } from '@babylonjs/core/Maths/math.viewport.js';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { CreateTube } from '@babylonjs/core/Meshes/Builders/tubeBuilder.js';
import { CreateLathe } from '@babylonjs/core/Meshes/Builders/latheBuilder.js';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { PlaneDragGizmo } from '@babylonjs/core/Gizmos/planeDragGizmo.js';
import type { GizmoManager } from '@babylonjs/core/Gizmos/gizmoManager.js';
import type { IGizmo } from '@babylonjs/core/Gizmos/gizmo.js';
import type { PointerDragBehavior } from '@babylonjs/core/Behaviors/Meshes/pointerDragBehavior.js';
import type { Scene } from '@babylonjs/core/scene.js';

export const TRANSFORM_AXIS_COLORS = ['#F4777C', '#50D9B1', '#8295F5'] as const;
const DIRECTIONS = [Vector3.Right(), Vector3.Up(), Vector3.Forward()];
const PLANES = [[1, 2], [0, 2], [0, 1]] as const;
const LENGTH = .11;
type Control = IGizmo & { dragBehavior: PointerDragBehavior; angle?: number };
type Theme = { base: StandardMaterial; hover: StandardMaterial; dim: StandardMaterial };

/** Visual meshes and invisible colliders only: Babylon still owns transform math and dragging. */
export class TransformGizmoVisuals {
  moveCenter: PlaneDragGizmo | null = null;
  private readonly manager: GizmoManager;
  private readonly scene: Scene;
  private readonly decorated = new WeakSet<object>();
  private readonly themes = new Map<string, Theme>();
  private readonly light: HemisphericLight;
  private readonly roots: Mesh[] = [];
  private readonly hitHandles: Mesh[] = [];
  private readonly rotationHandles: { root: Mesh; axis: number; visible: Mesh; hit: Mesh }[] = [];
  private readonly touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  private active: Control | null = null;
  private angleLabel: Mesh | null = null;
  private angleTexture: DynamicTexture | null = null;
  private lastAngle = '';
  private hitDiameter = 0;
  private readonly cameraNormal = new Vector3();
  private readonly localPoint = new Vector3();
  private readonly worldPoint = new Vector3();
  private readonly viewProjection = new Matrix();
  private readonly placed = new Float64Array(6);
  private layoutView = -1;
  private layoutProjection = -1;
  private layoutNode = -1;
  private layoutRatio = -1;
  private layoutObserver: ReturnType<Scene['onBeforeRenderObservable']['add']> = null;
  private readonly screenPoint = new Vector3();
  private readonly viewport = new Viewport(0, 0, 1, 1);
  private readonly observer;
  private readonly pointerObserver;

  constructor(manager: GizmoManager) {
    this.manager = manager;
    this.scene = manager.utilityLayer.utilityLayerScene;
    this.light = new HemisphericLight('Transform satin light', new Vector3(.3, 1, -.4), this.scene);
    this.light.intensity = .75;
    this.light.includedOnlyMeshes = [];
    this.observer = this.scene.onBeforeRenderObservable.add(() => this.update());
    // A foreground arc must not steal a touch aimed at another ring's visible grip.
    this.pointerObserver = this.scene.onPointerObservable.add(info => {
      if (this.active) return;
      const engine = this.scene.getEngine(), canvas = engine.getRenderingCanvas();
      if (!canvas) return;
      this.viewport.width = engine.getRenderWidth(); this.viewport.height = engine.getRenderHeight();
      let nearest: Mesh | null = null, distance = (this.touch ? 24 : 14) ** 2;
      for (const hit of this.hitHandles) {
        if (!hit.isEnabled()) continue;
        Vector3.ProjectToRef(hit.getAbsolutePosition(), Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), this.viewport, this.screenPoint);
        if (this.screenPoint.z < 0 || this.screenPoint.z > 1) continue;
        const dx = this.screenPoint.x * canvas.clientWidth / this.viewport.width - this.scene.pointerX;
        const dy = this.screenPoint.y * canvas.clientHeight / this.viewport.height - this.scene.pointerY;
        const squared = dx * dx + dy * dy;
        if (squared < distance) { nearest = hit; distance = squared; }
      }
      if (nearest) {
        const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, mesh => mesh === nearest);
        if (pick?.hit && info.pickInfo) Object.assign(info.pickInfo, pick);
      }
    }, PointerEventTypes.POINTERDOWN | PointerEventTypes.POINTERMOVE, true);
  }

  ensure() {
    const previousRoots = this.roots.length;
    const { positionGizmo: move, rotationGizmo: rotate, scaleGizmo: scale } = this.manager.gizmos;
    if (move && !this.decorated.has(move)) {
      this.decorated.add(move);
      [move.xGizmo, move.yGizmo, move.zGizmo].forEach((control, axis) => this.axis(control, axis, false));
      [move.xPlaneGizmo, move.yPlaneGizmo, move.zPlaneGizmo].forEach((control, axis) => this.petal(control, axis));
      const center = this.moveCenter = new PlaneDragGizmo(Vector3.Forward(), Color3.White(), this.manager.utilityLayer);
      center.updateGizmoRotationToMatchAttachedMesh = false;
      center.dragBehavior.useObjectOrientationForDragging = false;
      center.dragBehavior.onDragStartObservable.add((event, state) => move.onDragStartObservable.notifyObservers(event, state.mask));
      center.dragBehavior.onDragObservable.add((event, state) => move.onDragObservable.notifyObservers(event, state.mask));
      center.dragBehavior.onDragEndObservable.add((event, state) => move.onDragEndObservable.notifyObservers(event, state.mask));
      this.center(center, false);
    }
    if (rotate && !this.decorated.has(rotate)) {
      this.decorated.add(rotate);
      [rotate.xGizmo, rotate.yGizmo, rotate.zGizmo].forEach((control, axis) => this.ring(control, axis));
    }
    if (scale && !this.decorated.has(scale)) {
      this.decorated.add(scale);
      [scale.xGizmo, scale.yGizmo, scale.zGizmo].forEach((control, axis) => this.axis(control, axis, true));
      this.center(scale.uniformScaleGizmo, true);
    }
    this.hitDiameter = 0;
    this.layoutView = -1;
    this.update();
    if (this.roots.length !== previousRoots) {
      this.scene.onBeforeRenderObservable.remove(this.layoutObserver);
      this.layoutObserver = this.scene.onBeforeRenderObservable.add(() => this.layoutGrips());
    }
  }

  private theme(axis: number, kind: 'solid' | 'sheet' | 'ring'): Theme {
    const key = `${axis}:${kind}`;
    let theme = this.themes.get(key);
    if (theme) return theme;
    // Hex colors are sRGB; StandardMaterial lighting operates in linear space.
    const color = Color3.FromHexString(axis < 3 ? TRANSFORM_AXIS_COLORS[axis] : '#DAD5E2').toLinearSpace();
    const make = (name: string, alpha: number, glow: number) => {
      const material = new StandardMaterial(`Transform ${key} ${name}`, this.scene);
      material.diffuseColor = color;
      material.emissiveColor = color.scale(glow);
      material.specularColor = Color3.White().scale(.06);
      material.specularPower = 64;
      material.alpha = alpha;
      material.backFaceCulling = false;
      return material;
    };
    const alpha = kind === 'sheet' ? .32 : kind === 'ring' ? .72 : axis === 3 ? .65 : .95;
    theme = { base: make('satin', alpha, .03), hover: make('active', .98, .08), dim: make('inactive', alpha * .3, .01) };
    this.themes.set(key, theme);
    return theme;
  }

  private install(control: Control, root: Mesh, visible: Mesh[], hits: Mesh[], axis: number, kind: 'solid' | 'sheet' | 'ring') {
    const theme = this.theme(axis, kind);
    root.isPickable = false;
    for (const mesh of visible) { mesh.parent = root; mesh.isPickable = false; mesh.material = theme.base; this.light.includedOnlyMeshes!.push(mesh); }
    for (const mesh of hits) { mesh.parent = root; mesh.visibility = 0; mesh.isPickable = true; mesh.material = theme.base; mesh.metadata = { transformHandle: root.name, axis, kind }; }
    control.setCustomMesh(root);
    this.manager.addToAxisCache(new Map([[root, { gizmoMeshes: visible, colliderMeshes: hits, material: theme.base, hoverMaterial: theme.hover, disableMaterial: theme.dim, active: false, dragBehavior: control.dragBehavior }]]));
    this.roots.push(root);
    control.dragBehavior.onDragStartObservable.add(() => {
      this.active = control;
      if (kind === 'ring') this.showAngle(root, axis);
    });
    control.dragBehavior.onDragEndObservable.add(() => {
      this.active = null;
      this.angleLabel?.setEnabled(false);
    });
  }

  private axis(control: Control, axis: number, scale: boolean) {
    const root = new Mesh(`Transform ${scale ? 'scale' : 'move'} ${'XYZ'[axis]}`, this.scene);
    const direction = DIRECTIONS[axis];
    const shaft = CreateCylinder('Satin shaft', { height: LENGTH - .02, diameter: .004, tessellation: 12 }, this.scene);
    shaft.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Up(), direction, new Quaternion());
    shaft.position.copyFrom(direction.scale((LENGTH - .02) / 2));
    let tip: Mesh;
    if (scale) tip = roundedCube('Rounded scale tip', .024, this.scene);
    else {
      tip = CreateLathe('Rounded arrow tip', { shape: [new Vector3(0, -.012, 0), new Vector3(.009, -.012, 0), new Vector3(.011, -.008, 0), new Vector3(.009, -.002, 0), new Vector3(.004, .011, 0), new Vector3(0, .016, 0)], tessellation: 20, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
      tip.rotationQuaternion = shaft.rotationQuaternion.clone();
    }
    tip.position.copyFrom(direction.scale(LENGTH));
    const hit = CreateSphere('Invisible fingertip target', { diameter: 1, segments: 12 }, this.scene);
    hit.position.copyFrom(tip.position);
    this.hitHandles.push(hit);
    const shaftHit = CreateCylinder('Invisible shaft target', { height: LENGTH - .03, diameter: .025, tessellation: 8 }, this.scene);
    shaftHit.rotationQuaternion = shaft.rotationQuaternion.clone();
    shaftHit.position.copyFrom(direction.scale((LENGTH + .03) / 2));
    this.install(control, root, [shaft, tip], [hit, shaftHit], axis, 'solid');
  }

  private petal(control: Control, axis: number) {
    const root = new Mesh(`Transform move ${['YZ', 'XZ', 'XY'][axis]}`, this.scene);
    const [u, v] = PLANES[axis];
    const points: Vector3[] = [];
    // Rounded triangular patch in the positive quadrant, with a clear central gap.
    for (let i = 0; i <= 16; i++) {
      const angle = i / 16 * Math.PI / 2;
      points.push(DIRECTIONS[u].scale(.017 + Math.cos(angle) * .045).add(DIRECTIONS[v].scale(.017 + Math.sin(angle) * .045)));
    }
    points.push(DIRECTIONS[u].scale(.02).add(DIRECTIONS[v].scale(.02)));
    const petal = patch('Translucent plane petal', points, this.scene);
    const hit = CreateSphere('Invisible plane target', { diameter: 1, segments: 12 }, this.scene);
    hit.position.copyFrom(DIRECTIONS[u].scale(.04).add(DIRECTIONS[v].scale(.04)));
    this.hitHandles.push(hit);
    this.install(control, root, [petal], [hit], axis, 'sheet');
  }

  private ring(control: Control, axis: number) {
    const root = new Mesh(`Transform rotate ${'XYZ'[axis]}`, this.scene);
    const [u, v] = PLANES[axis];
    const path = Array.from({ length: 65 }, (_, i) => DIRECTIONS[u].scale(Math.cos(i / 64 * Math.PI * 2) * .115).add(DIRECTIONS[v].scale(Math.sin(i / 64 * Math.PI * 2) * .115)));
    const ring = CreateTube('Satin rotation ring', { path, radius: .0018, tessellation: 8 }, this.scene);
    const collider = CreateTube('Invisible rotation arc', { path, radius: .01, tessellation: 6 }, this.scene);
    const angle = [.8, 2.4, .45][axis];
    const handle = CreateSphere('Rotation grip', { diameter: .017, segments: 16 }, this.scene);
    handle.position.copyFrom(DIRECTIONS[u].scale(Math.cos(angle) * .115).add(DIRECTIONS[v].scale(Math.sin(angle) * .115)));
    const hit = CreateSphere('Invisible rotation grip', { diameter: 1, segments: 12 }, this.scene);
    hit.position.copyFrom(handle.position);
    this.hitHandles.push(hit);
    this.install(control, root, [ring, handle], [collider, hit], axis, 'ring');
    this.rotationHandles.push({ root, axis, visible: handle, hit });
  }

  private center(control: Control, scale: boolean) {
    const root = new Mesh(`Transform ${scale ? 'uniform scale' : 'camera move'}`, this.scene);
    const body = scale ? roundedCube('Translucent uniform scale', .023, this.scene) : CreateSphere('Neutral free move', { diameter: .022, segments: 20 }, this.scene);
    const hit = CreateSphere('Invisible center target', { diameter: 1, segments: 12 }, this.scene);
    this.hitHandles.push(hit);
    this.install(control, root, [body], [hit], 3, 'solid');
  }

  private showAngle(root: Mesh, axis: number) {
    if (!this.angleLabel) {
      this.angleTexture = new DynamicTexture('Rotation angle feedback', { width: 256, height: 96 }, this.scene, false);
      this.angleTexture.hasAlpha = true;
      const material = new StandardMaterial('Rotation angle label', this.scene);
      material.diffuseTexture = this.angleTexture;
      material.emissiveColor = Color3.White();
      material.disableLighting = true;
      material.useAlphaFromDiffuseTexture = true;
      this.angleLabel = CreatePlane('Rotation angle', { width: .1, height: .037 }, this.scene);
      this.angleLabel.material = material;
      this.angleLabel.billboardMode = Mesh.BILLBOARDMODE_ALL;
      this.angleLabel.isPickable = false;
    }
    this.angleLabel.parent = root;
    this.angleLabel.position.set(0, .15, 0);
    this.angleLabel.metadata = { axis };
    this.angleLabel.setEnabled(true);
    this.lastAngle = '';
  }

  private update() {
    const camera = this.scene.activeCamera;
    if (!camera) return;
    const height = this.scene.getEngine().getRenderingCanvas()?.clientHeight || this.scene.getEngine().getRenderHeight();
    const pixels = height < 900 && this.scene.getEngine().getAspectRatio(camera) < 1 ? 64 : 76;
    const ratio = (camera.mode === 1 ? 1 : 2 * Math.tan(camera.fov / 2)) * pixels / (height * LENGTH);
    if (this.manager.scaleRatio !== ratio) this.manager.scaleRatio = ratio;
    const diameter = (this.touch ? 48 : 28) * LENGTH / pixels;
    if (this.hitDiameter !== diameter) {
      for (const mesh of this.hitHandles) mesh.scaling.setAll(diameter);
      this.hitDiameter = diameter;
    }
    const move = this.manager.gizmos.positionGizmo;
    if (this.moveCenter) {
      if (this.moveCenter.attachedNode !== move?.attachedNode) this.moveCenter.attachedNode = move?.attachedNode ?? null;
      this.moveCenter.scaleRatio = ratio;
      if (this.moveCenter.attachedNode && !this.moveCenter.dragBehavior.dragging) {
        camera.getDirectionToRef(this.scene.useRightHandedSystem ? Vector3.RightHandedForwardReadOnly : DIRECTIONS[2], this.cameraNormal);
        this.moveCenter.dragBehavior.options.dragPlaneNormal = this.cameraNormal;
      }
    }
    if (this.active?.angle !== undefined && this.angleTexture && this.angleLabel?.isEnabled()) {
      const text = `${'XYZ'[this.angleLabel.metadata.axis]}  ${(this.active.angle * 180 / Math.PI).toFixed(1)}°`;
      if (text !== this.lastAngle) {
        this.angleTexture.drawText(text, null, 66, 'bold 48px sans-serif', '#FFFFFF', '#251C35', true);
        this.lastAngle = text;
      }
    }
  }

  /** Run after native gizmo updates, and only when the camera or attachment changed. */
  private layoutGrips() {
    const camera = this.scene.activeCamera, node = this.manager.gizmos.rotationGizmo?.attachedNode;
    if (this.active || !camera || !node || !this.manager.rotationGizmoEnabled) return;
    const view = camera.getViewMatrix(), projection = camera.getProjectionMatrix(), world = node.getWorldMatrix();
    if (this.layoutView === view.updateFlag && this.layoutProjection === projection.updateFlag && this.layoutNode === world.updateFlag && this.layoutRatio === this.manager.scaleRatio) return;
    this.layoutView = view.updateFlag; this.layoutProjection = projection.updateFlag; this.layoutNode = world.updateFlag; this.layoutRatio = this.manager.scaleRatio;
    view.multiplyToRef(projection, this.viewProjection);
    const engine = this.scene.getEngine(), canvas = engine.getRenderingCanvas();
    this.viewport.width = engine.getRenderWidth(); this.viewport.height = engine.getRenderHeight();
    const sx = (canvas?.clientWidth ?? this.viewport.width) / this.viewport.width, sy = (canvas?.clientHeight ?? this.viewport.height) / this.viewport.height;
    let count = 0;
    for (const grip of this.rotationHandles) {
      if (!grip.root.isEnabled() || !grip.root.parent) continue;
      const matrix = grip.root.parent.getWorldMatrix();
      Vector3.TransformCoordinatesToRef(Vector3.ZeroReadOnly, matrix, this.worldPoint);
      Vector3.ProjectToRef(this.worldPoint, Matrix.IdentityReadOnly, this.viewProjection, this.viewport, this.screenPoint);
      const originX = this.screenPoint.x * sx, originY = this.screenPoint.y * sy;
      const [u, v] = PLANES[grip.axis];
      let best = -Infinity, angle = 0, bestX = 0, bestY = 0;
      for (let i = 0; i < 32; i++) {
        const candidate = i / 32 * Math.PI * 2, a = Math.cos(candidate) * .115, b = Math.sin(candidate) * .115;
        this.localPoint.set(DIRECTIONS[u].x * a + DIRECTIONS[v].x * b, DIRECTIONS[u].y * a + DIRECTIONS[v].y * b, DIRECTIONS[u].z * a + DIRECTIONS[v].z * b);
        Vector3.TransformCoordinatesToRef(this.localPoint, matrix, this.worldPoint);
        Vector3.ProjectToRef(this.worldPoint, Matrix.IdentityReadOnly, this.viewProjection, this.viewport, this.screenPoint);
        const x = this.screenPoint.x * sx, y = this.screenPoint.y * sy, up = originY - y;
        let separation = 60;
        for (let j = 0; j < count; j++) separation = Math.min(separation, Math.hypot(x - this.placed[j * 2], y - this.placed[j * 2 + 1]));
        const preference = grip.axis === 0 ? 35 : grip.axis === 1 ? -55 : 0;
        const score = up * .6 + separation * 1.4 - Math.abs(x - originX - preference) * .35 - (up < -2 ? 1000 : 0);
        if (score > best) { best = score; angle = candidate; bestX = x; bestY = y; }
      }
      const a = Math.cos(angle) * .115, b = Math.sin(angle) * .115;
      grip.visible.position.set(DIRECTIONS[u].x * a + DIRECTIONS[v].x * b, DIRECTIONS[u].y * a + DIRECTIONS[v].y * b, DIRECTIONS[u].z * a + DIRECTIONS[v].z * b);
      grip.hit.position.copyFrom(grip.visible.position);
      this.placed[count * 2] = bestX; this.placed[count * 2 + 1] = bestY; count++;
    }
  }

  dispose() {
    this.scene.onBeforeRenderObservable.remove(this.observer);
    this.scene.onBeforeRenderObservable.remove(this.layoutObserver);
    this.scene.onPointerObservable.remove(this.pointerObserver);
    this.moveCenter?.dispose();
    this.angleLabel?.dispose(false, true);
    this.angleTexture?.dispose();
    this.light.dispose();
    for (const root of this.roots) root.dispose();
    for (const theme of this.themes.values()) { theme.base.dispose(); theme.hover.dispose(); theme.dim.dispose(); }
  }
}

function patch(name: string, points: Vector3[], scene: Scene) {
  const mesh = new Mesh(name, scene), data = new VertexData();
  data.positions = points.flatMap(p => p.asArray());
  data.indices = [];
  for (let i = 1; i < points.length - 1; i++) data.indices.push(0, i, i + 1);
  data.normals = [];
  VertexData.ComputeNormals(data.positions, data.indices, data.normals);
  data.applyToMesh(mesh);
  return mesh;
}

function roundedCube(name: string, size: number, scene: Scene) {
  const mesh = new Mesh(name, scene), data = new VertexData();
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  const half = size / 2, radius = size * .18, inner = half - radius, steps = 6;
  for (let face = 0; face < 6; face++) {
    const axis = Math.floor(face / 2), sign = face % 2 ? 1 : -1, [u, v] = PLANES[axis], offset = positions.length / 3;
    for (let row = 0; row <= steps; row++) for (let col = 0; col <= steps; col++) {
      const p = [0, 0, 0]; p[axis] = sign * half; p[u] = (col / steps * 2 - 1) * half; p[v] = (row / steps * 2 - 1) * half;
      const center = p.map(value => Math.max(-inner, Math.min(inner, value)));
      const normal = new Vector3(p[0] - center[0], p[1] - center[1], p[2] - center[2]).normalize();
      positions.push(center[0] + normal.x * radius, center[1] + normal.y * radius, center[2] + normal.z * radius); normals.push(normal.x, normal.y, normal.z);
    }
    for (let row = 0; row < steps; row++) for (let col = 0; col < steps; col++) { const a = offset + row * (steps + 1) + col, b = a + 1, c = a + steps + 1; indices.push(a, b, c, b, c + 1, c); }
  }
  data.positions = positions; data.normals = normals; data.indices = indices; data.applyToMesh(mesh);
  return mesh;
}
