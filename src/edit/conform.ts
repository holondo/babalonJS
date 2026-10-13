import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Editor } from '../core/editor';
import type { FaceSelection } from './selection';
import { Deform } from './deform';
import type { DeformState } from './deform';

export type GuideShape = 'sphere' | 'cylinder' | 'box';
/**
 * Like Blender's Shrinkwrap wrap modes. Outside: what's inside the shape moves out to it (fills
 * grooves). Inside: what's outside moves in (flattens bumps). Surface: both.
 */
export type ConformMode = 'fill' | 'flatten' | 'both';

/**
 * A translucent shape placed over the model with the gizmo: the target for "Conform to shape"
 * and the piece added by "Add shape". Unit size (like the app's primitives), centered.
 */
export class ShapeGuide {
  readonly mesh: Mesh;
  readonly shape: GuideShape;
  private readonly material: StandardMaterial;
  private readonly editor: Editor;
  /** Scaling when the shape was fitted; Size multiplies it (keeps the proportions). */
  private readonly base = new Vector3(1, 1, 1);
  size = 1;

  constructor(editor: Editor, shape: GuideShape) {
    this.editor = editor; this.shape = shape;
    const scene = editor.scene;
    this.mesh = shape === 'sphere' ? MeshBuilder.CreateSphere('Shape guide', { diameter: 1, segments: 48 }, scene)
      : shape === 'cylinder' ? MeshBuilder.CreateCylinder('Shape guide', { height: 1, diameter: 1, tessellation: 64 }, scene)
      : MeshBuilder.CreateBox('Shape guide', { size: 1 }, scene);
    this.mesh.rotationQuaternion = Quaternion.Identity();
    this.material = new StandardMaterial('Shape guide', scene);
    // Neutral white: apart from the lilac selection and from gold or purple models
    this.material.diffuseColor = this.material.emissiveColor = Color3.White();
    this.material.alpha = 0.2; this.material.disableLighting = true; this.material.backFaceCulling = false;
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
    editor.overlays.add(this.mesh);
  }

  /** Uniform size, relative to the fitted one. */
  setSize(size: number) {
    this.size = size;
    this.mesh.scaling.copyFrom(this.base).scaleInPlace(size);
    this.editor.invalidate();
  }

  /** Largest side of the shape, in world units. */
  extent() { const s = this.mesh.scaling; return Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z)); }

  /** Places the shape around the selected faces (or the whole object). */
  fit(selection: FaceSelection) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    const v = new Vector3();
    const any = selection.count > 0;
    for (const [mesh, faces] of selection.faces) {
      const p = mesh.getPositionData(true, true) ?? mesh.getVerticesData('position')!, world = mesh.computeWorldMatrix(true), idx = mesh.getIndices()!, m = faces.mask;
      for (let f = 0; f < idx.length / 3; f++) {
        if (any && !m[f]) continue;
        for (let j = 0; j < 3; j++) {
          const i = idx[f * 3 + j] * 3;
          Vector3.TransformCoordinatesFromFloatsToRef(p[i], p[i + 1], p[i + 2], world, v);
          if (v.x < x0) x0 = v.x; if (v.y < y0) y0 = v.y; if (v.z < z0) z0 = v.z;
          if (v.x > x1) x1 = v.x; if (v.y > y1) y1 = v.y; if (v.z > z1) z1 = v.z;
        }
      }
    }
    if (!Number.isFinite(x0)) return;
    this.mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.mesh.rotationQuaternion!.copyFrom(Quaternion.Identity());
    const size = new Vector3(Math.max(x1 - x0, 1e-3), Math.max(y1 - y0, 1e-3), Math.max(z1 - z0, 1e-3));
    // A sphere fits the bounding box's largest side evenly; others take the box itself
    if (this.shape === 'sphere') this.mesh.scaling.setAll(Math.max(size.x, size.y, size.z));
    else if (this.shape === 'cylinder') { const d = Math.max(size.x, size.z); this.mesh.scaling.set(d, size.y, d); }
    else this.mesh.scaling.copyFrom(size);
    this.base.copyFrom(this.mesh.scaling);
    this.size = 1;
    this.editor.invalidate();
  }

  dispose() {
    this.editor.overlays.delete(this.mesh);
    this.mesh.dispose();
    this.material.dispose();
    this.editor.invalidate();
  }
}

/**
 * Closest point on the unit shape's surface (local space, centered), and whether the point is inside.
 * Written into `out`.
 */
function surfacePoint(shape: GuideShape, x: number, y: number, z: number, out: Vector3): boolean {
  if (shape === 'sphere') {
    const r = Math.hypot(x, y, z);
    if (r < 1e-9) { out.set(0, 0.5, 0); return true; }
    out.set(x / r * 0.5, y / r * 0.5, z / r * 0.5);
    return r < 0.5;
  }
  if (shape === 'cylinder') {
    const rr = Math.hypot(x, z), inside = rr < 0.5 && Math.abs(y) < 0.5;
    // Candidates: the side (radial), or the closer cap
    const sx = rr < 1e-9 ? 0.5 : x / rr * 0.5, sz = rr < 1e-9 ? 0 : z / rr * 0.5, sy = Math.max(-0.5, Math.min(0.5, y));
    const k = rr > 0.5 ? 0.5 / rr : 1, cy = y >= 0 ? 0.5 : -0.5;
    const side = (x - sx) ** 2 + (y - sy) ** 2 + (z - sz) ** 2, cap = (x - x * k) ** 2 + (y - cy) ** 2 + (z - z * k) ** 2;
    if (inside) {
      // Inside: the nearest wall (side or cap)
      if (0.5 - rr < 0.5 - Math.abs(y)) out.set(sx, y, sz); else out.set(x, cy, z);
    } else if (side < cap) out.set(sx, sy, sz); else out.set(x * k, cy, z * k);
    return inside;
  }
  // Box: inside → nearest face; outside → clamp
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  const inside = ax < 0.5 && ay < 0.5 && az < 0.5;
  if (inside) {
    const dx = 0.5 - ax, dy = 0.5 - ay, dz = 0.5 - az;
    if (dx <= dy && dx <= dz) out.set(Math.sign(x || 1) * 0.5, y, z);
    else if (dy <= dz) out.set(x, Math.sign(y || 1) * 0.5, z);
    else out.set(x, y, Math.sign(z || 1) * 0.5);
  } else out.set(Math.max(-0.5, Math.min(0.5, x)), Math.max(-0.5, Math.min(0.5, y)), Math.max(-0.5, Math.min(0.5, z)));
  return inside;
}

/**
 * Moves the model's own vertices to the shape's surface (like Blender's Shrinkwrap): grooves fill
 * up to it, bumps flatten to it. Only vertices inside the shape, or outside it within `reach`
 * (world units, fading out), move, so only the part touching the shape changes. Works on the
 * surface as shown (pose and shape keys) and maps each move back through the vertex's skinning.
 * Texture, UVs and skin weights stay (no new geometry). Returns the before/after states per mesh.
 */
export function conformToShape(selection: FaceSelection, guide: ShapeGuide, mode: ConformMode, strength: number, reach: number) {
  const changes: { mesh: Mesh; before: DeformState; after: DeformState }[] = [];
  const shapeWorld = guide.mesh.computeWorldMatrix(true), toShape = shapeWorld.clone().invert();
  const onlySelected = selection.count > 0;
  const local = new Vector3(), target = new Vector3(), here = new Vector3(), delta = new Vector3();
  const skin = new Matrix(), skinInverse = new Matrix();
  for (const [mesh, faces] of selection.faces) {
    if (onlySelected && !faces.size) continue;
    const deform = new Deform(mesh, selection.neighbors(mesh));
    const world = mesh.computeWorldMatrix(true), toMesh = world.clone().invert();
    const p = deform.positions, idx = mesh.getIndices()!;
    const shown = mesh.getPositionData(true, true) ?? p;
    const bones = mesh.skeleton ? mesh.skeleton.getTransformMatrices(mesh) : null;
    const boneIds = bones ? mesh.getVerticesData('matricesIndices') : null, boneWeights = bones ? mesh.getVerticesData('matricesWeights') : null;
    const extraIds = bones ? mesh.getVerticesData('matricesIndicesExtra') : null, extraWeights = bones ? mesh.getVerticesData('matricesWeightsExtra') : null;
    let allowed: Uint8Array | null = null;
    if (onlySelected) {
      allowed = new Uint8Array(p.length / 3);
      const m = faces.mask;
      for (let f = 0; f < m.length; f++) if (m[f]) { allowed[idx[f * 3]] = 1; allowed[idx[f * 3 + 1]] = 1; allowed[idx[f * 3 + 2]] = 1; }
    }
    const moved: number[] = [];
    for (let v = 0; v < p.length / 3; v++) {
      if (allowed && !allowed[v]) continue;
      Vector3.TransformCoordinatesFromFloatsToRef(shown[v * 3], shown[v * 3 + 1], shown[v * 3 + 2], world, here);
      Vector3.TransformCoordinatesToRef(here, toShape, local);
      const inside = surfacePoint(guide.shape, local.x, local.y, local.z, target);
      if ((mode === 'fill' && !inside) || (mode === 'flatten' && inside)) continue;
      Vector3.TransformCoordinatesToRef(target, shapeWorld, target);
      let weight = strength;
      if (!inside) {
        const d = Vector3.Distance(here, target);
        if (d >= reach) continue;
        const t = 1 - d / reach;
        weight *= t * t * (3 - 2 * t);
      }
      // World move -> mesh space -> bind space (undo the vertex's skinning)
      target.subtractToRef(here, delta).scaleInPlace(weight);
      Vector3.TransformNormalToRef(delta, toMesh, delta);
      if (bones && boneIds && boneWeights) {
        skinMatrix(bones, boneIds, boneWeights, extraIds, extraWeights, v, skin);
        if (Math.abs(skin.determinant()) > 1e-12) { skin.invertToRef(skinInverse); Vector3.TransformNormalToRef(delta, skinInverse, delta); }
      }
      p[v * 3] += delta.x; p[v * 3 + 1] += delta.y; p[v * 3 + 2] += delta.z;
      deform.touch(v); moved.push(v);
    }
    if (!moved.length) { Deform.restore(mesh, deform.startState()); continue; }
    deform.updateNormals(moved);
    deform.finish();
    changes.push({ mesh, before: deform.startState(), after: deform.state() });
  }
  return changes;
}

/** Blended bone matrix of one vertex (its skinning). */
function skinMatrix(bones: Float32Array, ids: ArrayLike<number>, weights: ArrayLike<number>, extraIds: ArrayLike<number> | null, extraWeights: ArrayLike<number> | null, v: number, out: Matrix) {
  const m = new Float32Array(16);
  const add = (i: ArrayLike<number>, w: ArrayLike<number>) => {
    for (let c = 0; c < 4; c++) {
      const weight = w[v * 4 + c];
      if (!weight) continue;
      const o = i[v * 4 + c] * 16;
      for (let k = 0; k < 16; k++) m[k] += bones[o + k] * weight;
    }
  };
  add(ids, weights);
  if (extraIds && extraWeights) add(extraIds, extraWeights);
  Matrix.FromArrayToRef(m, 0, out);
}

/** World transform of the guide as an app primitive's root (primitives sit on their base). */
export function primitiveTransform(guide: ShapeGuide) {
  const scaling = new Vector3(), rotation = new Quaternion(), position = new Vector3();
  guide.mesh.computeWorldMatrix(true).decompose(scaling, rotation, position);
  // The primitive's mesh is lifted by half its height inside its root
  const lift = Vector3.TransformCoordinates(new Vector3(0, 0.5 * scaling.y, 0), Matrix.FromQuaternionToRef(rotation, new Matrix()));
  return { position: position.subtract(lift), rotation, scaling };
}
