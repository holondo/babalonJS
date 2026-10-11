import { userTextureFiles, loadUserTexture } from './materialTextures';
import { materialToJSON, applyMaterial, lightToJSON, applyLight } from './state';
import type { MaterialJSON, LightJSON } from './state';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import { tr } from './i18n';
import type { ToolsJSON } from '../tools/tools';
import { forgetHumanoid, jointNodes } from '../rigging/humanoid';
import type { HumanBone } from '../rigging/humanoid';
import type { MotionSettings } from '../animation/motion';
import type { RigData } from '../rigging/rigging';
import type { OptimizeSettings } from '../optimize/optimizer';
import type { TextureSettings } from '../optimize/textures';
import { captureJoints } from '../animation/pose';
import { ANIMATION_SOURCE } from './presets';
import type { AssetRef, Editor, Entity, EnvSettings, ModelSource, PhotoSettings, PrimitiveType } from './editor';

/** Project file: a .zip with project.json + the original model files in assets/. */
export const PROJECT_EXT = '.babalon';
const APP = 'babalon-js';
const VERSION = 1;

interface TransformJSON {
  p: number[];
  q: number[];
  s: number[];
}

interface EntityJSON {
  kind: Entity['kind'];
  name: string;
  visible: boolean;
  castShadows: boolean;
  t: TransformJSON;
  asset?: number;
  primitive?: PrimitiveType;
  materials?: MaterialJSON[];
  /** Clip state; `loop` and `frame` are missing in older projects. */
  animation?: { index: number; playing: boolean; speed: number; loop?: boolean; frame?: number };
  light?: LightJSON;
  /** Humanoid bones mapped by hand (canonical bone → joint name). */
  boneMap?: Partial<Record<HumanBone, string>>;
  /** Clips retargeted from the built-in library or an imported file (recomputed on open). */
  clips?: { library?: string; asset?: number; clip: string; inPlace: boolean; license?: string }[];
  /** Hand-made pose: per joint (in skeleton order) rotation x, y, z, w and position x, y, z. */
  pose?: number[][];
  /** Simple motion (spin, float, pulse, sway). */
  motion?: MotionSettings;
  /** Skeleton given in the app; `weights` is the path of its skin weights in the project. */
  rig?: RigData & { weights?: string };
  /** Optimized variant; `data` is the path of the kept triangles in the project. */
  optimization?: { settings: OptimizeSettings; error: number; meshes: number[]; data: string; bakes?: { mesh: number; size: number; path: string }[] };
  /** Compressed or downscaled textures, stored in the project (no re-encoding on open). */
  textureOptimization?: { settings: TextureSettings; textures: { index: number; format: 'ktx2' | 'png'; width: number; height: number; path: string }[] };
}

interface AssetJSON {
  id: number;
  name: string;
  url?: string;
  main?: string;
  deps?: string[];
}

export interface ProjectJSON {
  app: typeof APP;
  version: number;
  name: string;
  savedAt: string;
  camera: { alpha: number; beta: number; radius: number; target: number[] };
  env: EnvSettings;
  photo: PhotoSettings;
  assets: AssetJSON[];
  entities: EntityJSON[];
  /** Measurements, guides and units (optional: older projects don't have it). */
  tools?: ToolsJSON;
}

export interface ProjectSnapshot {
  json: ProjectJSON;
  /** path inside the project → content */
  files: Record<string, Blob>;
}

// ---------- Save ----------

export function snapshot(editor: Editor, name: string): ProjectSnapshot {
  const files: Record<string, Blob> = {};
  const assets = new Map<number, AssetJSON>();
  const path = (asset: AssetRef, f: File) => `assets/${asset.id}/${f.name}`;

  const used = editor.entities.flatMap((e) => [e.source?.asset, ...(e.addedClips ?? []).map((c) => ('asset' in c.from ? c.from.asset : undefined))]);
  for (const asset of used) {
    if (!asset || assets.has(asset.id)) continue;
    const json: AssetJSON = { id: asset.id, name: asset.name };
    if (asset.url) json.url = asset.url;
    if (asset.main) {
      json.main = path(asset, asset.main);
      json.deps = (asset.deps ?? []).map((f) => path(asset, f));
      for (const f of [asset.main, ...(asset.deps ?? [])]) files[path(asset, f)] = f;
    }
    assets.set(asset.id, json);
  }

  if (editor.env.custom) {
    const custom = editor.environments.get(editor.env.custom);
    if (custom) files[editor.env.custom] = custom.file;
  }
  const cam = editor.camera;
  return {
    files,
    json: {
      app: APP,
      version: VERSION,
      name,
      savedAt: new Date().toISOString(),
      camera: { alpha: cam.alpha, beta: cam.beta, radius: cam.radius, target: cam.target.asArray() },
      env: { ...editor.env },
      photo: { ...editor.photo },
      assets: [...assets.values()],
      entities: editor.entities.map((e, i) => entityToJSON(editor, e, files, i)),
      tools: editor.tools.toJSON(editor.entities),
    },
  };
}

function entityToJSON(editor: Editor, e: Entity, files: Record<string, Blob>, index: number): EntityJSON {
  const r = e.root;
  const json: EntityJSON = {
    kind: e.kind,
    name: e.name,
    visible: e.visible,
    castShadows: e.castShadows,
    t: { p: r.position.asArray(), q: r.rotationQuaternion!.asArray(), s: r.scaling.asArray() },
  };
  if (e.kind === 'model') json.asset = e.source!.asset.id;
  if (e.kind === 'primitive') json.primitive = e.primitive;
  if (e.kind !== 'light') json.materials = editor.materialsOf(e).map((m) => {
    const state = materialToJSON(m);
    userTextureFiles(editor.scene, state.textures ?? {}, files);
    return state;
  });
  if (e.boneMap) json.boneMap = { ...e.boneMap };
  if (e.motion) json.motion = { ...e.motion };
  const optimized = editor.optimizer.serialize(e);
  if (optimized) {
    const path = `optimized/${index}.bin`;
    files[path] = new Blob([optimized.data as Uint8Array<ArrayBuffer>]);
    json.optimization = {
      settings: optimized.settings,
      error: optimized.error,
      meshes: optimized.meshes,
      data: path,
      bakes: optimized.bakes.map((b, k) => {
        const png = `optimized/${index}-normals-${k}.png`;
        files[png] = new Blob([b.png as Uint8Array<ArrayBuffer>]);
        return { mesh: b.mesh, size: b.size, path: png };
      }),
    };
  }
  const textures = editor.textureOptimizer.serialize(e);
  if (textures) {
    json.textureOptimization = {
      settings: textures.settings,
      textures: textures.textures.map((t, k) => {
        const path = `optimized/${index}-texture-${k}.${t.format}`;
        files[path] = new Blob([t.data as Uint8Array<ArrayBuffer>]);
        return { index: t.index, format: t.format, width: t.width, height: t.height, path };
      }),
    };
  }
  const rig = editor.rigger.serialize(e);
  if (rig) {
    const path = `rigs/${index}.bin`;
    files[path] = new Blob([rig.weights as Uint8Array<ArrayBuffer>]);
    json.rig = { ...rig.data, weights: path };
  }
  if (e.addedClips?.length) {
    json.clips = e.addedClips.map((c) =>
      'library' in c.from
        ? { library: c.from.library, clip: c.clip, inPlace: c.inPlace, license: `${ANIMATION_SOURCE.license} · ${ANIMATION_SOURCE.author}` }
        : { asset: c.from.asset.id, clip: c.clip, inPlace: c.inPlace },
    );
  }
  if (e.animationGroups.length) {
    const { pose: _, ...clip } = editor.anim.state(e);
    json.animation = clip;
  }
  if (e.posed) json.pose = captureJoints(jointNodes(e)).map((j) => [...j.q.asArray(), ...j.p.asArray()].map((v) => +v.toFixed(6)));
  if (e.light) json.light = lightToJSON(e);
  return json;
}

export async function toZip(snap: ProjectSnapshot): Promise<Blob> {
  const entries: Zippable = { 'project.json': [strToU8(JSON.stringify(snap.json, null, 2)), { level: 6 }] };
  for (const [path, blob] of Object.entries(snap.files)) {
    // Models and textures are usually compressed already: storing without recompressing is much faster
    // Data the app writes (rig weights, optimized triangles) compresses well; models and textures don't
    entries[path] = [new Uint8Array(await blob.arrayBuffer()), { level: /^(rigs|optimized)\/.*\.bin$/.test(path) ? 6 : 0 }];
  }
  const data = zipSync(entries);
  return new Blob([data], { type: 'application/zip' });
}

// ---------- Open ----------

export async function fromZip(file: Blob): Promise<ProjectSnapshot> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error(tr('Invalid or corrupted project file.'));
  }
  const raw = entries['project.json'];
  if (!raw) throw new Error(tr('This file is not a babalon JS project.'));
  const json = JSON.parse(strFromU8(raw)) as ProjectJSON;
  if (json.app !== APP) throw new Error(tr('This file is not a babalon JS project.'));
  if (json.version > VERSION) throw new Error(tr('Project created by a newer version of babalon JS.'));
  const files: Record<string, Blob> = {};
  for (const [path, data] of Object.entries(entries)) if (path !== 'project.json') files[path] = new Blob([data as Uint8Array<ArrayBuffer>]);
  return { json, files };
}

/** Replaces the current scene with the project. Returns the names of models that could not be loaded. */
export async function restore(editor: Editor, snap: ProjectSnapshot): Promise<string[]> {
  const { json, files } = snap;
  const toFile = (path: string) => {
    const blob = files[path];
    if (!blob) throw new Error(tr('File missing from project: {path}', { path }));
    return new File([blob], path.split('/').pop()!);
  };

  editor.resetScene();
  for (const [path] of Object.entries(files)) if (path.startsWith('textures/')) await loadUserTexture(editor.scene, toFile(path), path);
  if (json.env.custom) await editor.importEnvironment(toFile(json.env.custom), 512, json.env.custom, false);
  editor.applyEnv({ ...json.env });
  editor.setPhoto({ ...json.photo });

  const assets = new Map<number, AssetRef>();
  for (const a of json.assets) {
    try {
      assets.set(a.id, { id: a.id, name: a.name, url: a.url, main: a.main ? toFile(a.main) : undefined, deps: (a.deps ?? []).map(toFile) });
    } catch {
      // The model will be reported as missing below
    }
  }
  editor.nextAssetId = Math.max(editor.nextAssetId, ...json.assets.map((a) => a.id + 1));

  const loaded = new Map<number, { container: AssetContainer; source: ModelSource | null } | null>();
  const missing = new Set<string>();
  const quiet = { record: false, select: false };
  const byIndex: (Entity | null)[] = [];

  for (const ej of json.entities) {
    let entity: Entity | null = null;
    byIndex.push(null);
    if (ej.kind === 'model') {
      const asset = assets.get(ej.asset!);
      if (!loaded.has(ej.asset!)) {
        try {
          loaded.set(ej.asset!, asset ? { container: await editor.loadAsset(asset), source: null } : null);
        } catch {
          loaded.set(ej.asset!, null);
        }
      }
      const entry = loaded.get(ej.asset!);
      if (!entry || !asset) {
        missing.add(json.assets.find((a) => a.id === ej.asset)?.name ?? ej.name);
        continue;
      }
      entity = editor.spawnModel(entry.container, ej.name, entry.source, asset, quiet);
      entry.source = entity.source!;
    } else if (ej.kind === 'primitive') {
      entity = editor.addPrimitive(ej.primitive!, quiet);
    } else if (ej.light) {
      const l = ej.light;
      entity = editor.addLight(l.type, { ...quiet, color: l.color, intensity: l.intensity, shadows: l.shadows, angle: l.angle });
      applyLight(editor, entity, l);
    }
    if (!entity) continue;
    byIndex[byIndex.length - 1] = entity;

    entity.name = entity.root.name = ej.name;
    entity.root.position.fromArray(ej.t.p);
    entity.root.rotationQuaternion!.fromArray(ej.t.q);
    entity.root.scaling.fromArray(ej.t.s);
    if (ej.materials) {
      const mats = editor.materialsOf(entity);
      ej.materials.forEach((mj, i) => mats[i] && applyMaterial(mats[i], mj));
    }
    if (ej.optimization) {
      const blob = files[ej.optimization.data];
      const bakes = [];
      for (const b of ej.optimization.bakes ?? []) if (files[b.path]) bakes.push({ mesh: b.mesh, size: b.size, png: new Uint8Array(await files[b.path].arrayBuffer()) });
      const ok = blob ? editor.optimizer.restore(entity, ej.optimization, new Uint8Array(await blob.arrayBuffer()), bakes) : false;
      if (!ok) missing.add(tr('Optimized version of {name}', { name: ej.name }));
    }
    if (ej.textureOptimization) {
      const list = [];
      for (const t of ej.textureOptimization.textures) {
        const blob = files[t.path];
        if (blob) list.push({ ...t, data: new Uint8Array(await blob.arrayBuffer()) });
      }
      if (list.length === ej.textureOptimization.textures.length) editor.textureOptimizer.restore(entity, ej.textureOptimization.settings, list);
      else missing.add(tr('Optimized textures of {name}', { name: ej.name }));
    }
    if (ej.rig) {
      try {
        const blob = ej.rig.weights ? files[ej.rig.weights] : undefined;
        editor.rigger.restore(entity, ej.rig, blob ? new Uint8Array(await blob.arrayBuffer()) : null);
      } catch {
        missing.add(tr('Rig of {name}', { name: ej.name }));
      }
    }
    if (ej.boneMap) {
      entity.boneMap = { ...ej.boneMap };
      forgetHumanoid(entity);
    }
    for (const c of ej.clips ?? []) {
      const asset = c.asset !== undefined ? assets.get(c.asset) : undefined;
      const ref = c.library ? { library: c.library } : asset ? { asset } : null;
      try {
        if (!ref) throw new Error('missing');
        await editor.clips.add(entity, ref, { clips: [c.clip], inPlace: c.inPlace, record: false });
      } catch {
        missing.add(tr('Animation {name}', { name: c.clip }));
      }
    }
    if (ej.animation && entity.animationGroups.length) {
      const a = ej.animation;
      editor.anim.apply(entity, { index: a.index, playing: a.playing, speed: a.speed, loop: a.loop ?? true, frame: a.frame ?? 0 });
    }
    if (ej.pose) {
      const joints = jointNodes(entity);
      editor.anim.hold(entity);
      ej.pose.forEach((v, i) => {
        const n = joints[i];
        if (!n || v.length < 7) return;
        (n.rotationQuaternion ??= new Quaternion()).set(v[0], v[1], v[2], v[3]);
        n.position.set(v[4], v[5], v[6]);
      });
      entity.posed = true;
    }
    if (ej.motion && ej.motion.type !== 'none') editor.motions.set(entity, { ...ej.motion }, false);
    editor.setCastShadows(entity, ej.castShadows);
    if (!ej.visible) editor.setVisible(entity, false);
  }

  editor.tools.load(json.tools, byIndex);

  const c = json.camera;
  editor.camera.setTarget(Vector3.FromArray(c.target));
  editor.camera.alpha = c.alpha;
  editor.camera.beta = c.beta;
  editor.camera.radius = c.radius;
  return [...missing];
}

// ---------- Browser project library (IndexedDB) ----------

const DB = 'babalon-js';
const STORE = 'projects';
const META = 'project-info';
export interface ProjectInfo {
  id: string;
  name: string;
  updatedAt: string;
  thumbnail?: Blob;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.objectStoreNames.contains(STORE) ? req.transaction!.objectStore(STORE) : db.createObjectStore(STORE);
      const meta = db.createObjectStore(META, { keyPath: 'id' });
      const legacy = store.get('autosave');
      legacy.onsuccess = () => {
        const snap = legacy.result as ProjectSnapshot | undefined;
        if (!snap) return;
        const id = crypto.randomUUID();
        store.put(snap, id);
        meta.put({ id, name: snap.json.name, updatedAt: snap.json.savedAt });
        store.delete('autosave');
      };
    };
    req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error(tr('Close other babalon tabs and try again.')));
  });
}

/** Resolve only after commit; a successful request can still fail with a quota error. */
async function transaction<T>(mode: IDBTransactionMode, run: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
  const db = await openDB();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction([STORE, META], mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error ?? new Error(tr('Could not save in this browser. Export your project to keep it.')));
      tx.onerror = () => reject(tx.error);
      run(tx, (v) => { value = v; });
    });
  } finally { db.close(); }
}

export function listProjects(): Promise<ProjectInfo[]> {
  return transaction('readonly', (tx, result) => {
    const req = tx.objectStore(META).getAll();
    req.onsuccess = () => result((req.result as ProjectInfo[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  });
}

export function saveProject(id: string, snap: ProjectSnapshot, thumbnail?: Blob): Promise<void> {
  return transaction('readwrite', (tx) => {
    tx.objectStore(STORE).put(snap, id);
    const meta = tx.objectStore(META);
    const req = meta.get(id);
    req.onsuccess = () => meta.put({ id, name: snap.json.name, updatedAt: snap.json.savedAt, thumbnail: thumbnail ?? req.result?.thumbnail });
  });
}

export function loadProject(id: string): Promise<ProjectSnapshot | null> {
  return transaction('readonly', (tx, result) => {
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => result(req.result ?? null);
  });
}

export function deleteProject(id: string): Promise<void> {
  return transaction('readwrite', (tx) => { tx.objectStore(STORE).delete(id); tx.objectStore(META).delete(id); });
}

export function renameProject(id: string, name: string): Promise<void> {
  return transaction('readwrite', (tx) => {
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => {
      if (!req.result) return;
      req.result.json.name = name;
      tx.objectStore(STORE).put(req.result, id);
      const meta = tx.objectStore(META).get(id);
      meta.onsuccess = () => { if (meta.result) tx.objectStore(META).put({ ...meta.result, name }); };
    };
  });
}

export async function duplicateProject(id: string): Promise<string> {
  const snap = await loadProject(id);
  if (!snap) throw new Error(tr('Project no longer exists.'));
  const copy = crypto.randomUUID();
  snap.json.name = tr('{name} copy', { name: snap.json.name });
  snap.json.savedAt = new Date().toISOString();
  const source = (await listProjects()).find((p) => p.id === id);
  await saveProject(copy, snap, source?.thumbnail);
  return copy;
}
