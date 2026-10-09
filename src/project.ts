import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import { Color3, PBRMaterial, StandardMaterial, Vector3 } from '@babylonjs/core';
import type { AssetContainer, Material, PointLight, SpotLight } from '@babylonjs/core';
import { tr } from './i18n';
import type { AssetRef, Editor, Entity, EnvSettings, LightType, ModelSource, PhotoSettings, PrimitiveType } from './editor';

/** Project file: a .zip with project.json + the original model files in assets/. */
export const PROJECT_EXT = '.babalon';
const APP = 'babalon-js';
const VERSION = 1;

interface TransformJSON {
  p: number[];
  q: number[];
  s: number[];
}

interface MaterialJSON {
  type: 'pbr' | 'standard' | 'other';
  alpha: number;
  backFaceCulling: boolean;
  wireframe: boolean;
  albedo?: string;
  metallic?: number;
  roughness?: number;
  clearCoat?: boolean;
  clearCoatIntensity?: number;
  unlit?: boolean;
  emissive?: string;
  emissiveIntensity?: number;
  textureHidden?: boolean;
  diffuse?: string;
  specular?: string;
  specularPower?: number;
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
  animation?: { index: number; playing: boolean; speed: number };
  light?: { type: LightType; color: string; intensity: number; shadows: boolean; angle?: number; exponent?: number; range?: number };
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

  for (const e of editor.entities) {
    const asset = e.source?.asset;
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
      entities: editor.entities.map((e) => entityToJSON(editor, e)),
    },
  };
}

function entityToJSON(editor: Editor, e: Entity): EntityJSON {
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
  if (e.kind !== 'light') json.materials = editor.materialsOf(e).map(materialToJSON);
  if (e.animationGroups.length) {
    const playing = e.animationGroups.find((a) => a.isPlaying);
    const current = playing ?? e.animationGroups[0];
    json.animation = { index: e.animationGroups.indexOf(current), playing: !!playing, speed: current.speedRatio };
  }
  if (e.light) {
    const l = e.light;
    json.light = { type: e.lightType!, color: l.diffuse.toHexString(), intensity: l.intensity, shadows: !!e.shadowGen };
    if (e.lightType === 'spot') {
      json.light.angle = (l as SpotLight).angle;
      json.light.exponent = (l as SpotLight).exponent;
    }
    if (e.lightType !== 'directional') json.light.range = (l as PointLight).range;
  }
  return json;
}

function materialToJSON(m: Material): MaterialJSON {
  const base = { alpha: m.alpha, backFaceCulling: m.backFaceCulling, wireframe: m.wireframe };
  if (m instanceof PBRMaterial) {
    return {
      ...base,
      type: 'pbr',
      albedo: m.albedoColor.toHexString(),
      metallic: m.metallic ?? undefined,
      roughness: m.roughness ?? undefined,
      clearCoat: m.clearCoat.isEnabled,
      clearCoatIntensity: m.clearCoat.intensity,
      unlit: m.unlit,
      emissive: m.emissiveColor.toHexString(),
      emissiveIntensity: m.emissiveIntensity,
      textureHidden: !!m.metadata?.stashedAlbedo,
    };
  }
  if (m instanceof StandardMaterial) {
    return {
      ...base,
      type: 'standard',
      diffuse: m.diffuseColor.toHexString(),
      specular: m.specularColor.toHexString(),
      specularPower: m.specularPower,
      emissive: m.emissiveColor.toHexString(),
    };
  }
  return { ...base, type: 'other' };
}

export async function toZip(snap: ProjectSnapshot): Promise<Blob> {
  const entries: Zippable = { 'project.json': [strToU8(JSON.stringify(snap.json, null, 2)), { level: 6 }] };
  for (const [path, blob] of Object.entries(snap.files)) {
    // Models and textures are usually compressed already: storing without recompressing is much faster
    entries[path] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
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

  for (const ej of json.entities) {
    let entity: Entity | null = null;
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
      if (l.exponent !== undefined) (entity.light as SpotLight).exponent = l.exponent;
      if (l.range !== undefined) (entity.light as PointLight).range = l.range;
    }
    if (!entity) continue;

    entity.name = entity.root.name = ej.name;
    entity.root.position.fromArray(ej.t.p);
    entity.root.rotationQuaternion!.fromArray(ej.t.q);
    entity.root.scaling.fromArray(ej.t.s);
    if (ej.materials) {
      const mats = editor.materialsOf(entity);
      ej.materials.forEach((mj, i) => mats[i] && applyMaterial(mats[i], mj));
    }
    if (ej.animation && entity.animationGroups.length) {
      entity.animationGroups.forEach((a) => a.stop());
      const anim = entity.animationGroups[ej.animation.index] ?? entity.animationGroups[0];
      anim.speedRatio = ej.animation.speed;
      if (ej.animation.playing) anim.start(true, ej.animation.speed);
    }
    editor.setCastShadows(entity, ej.castShadows);
    if (!ej.visible) editor.setVisible(entity, false);
  }

  const c = json.camera;
  editor.camera.setTarget(Vector3.FromArray(c.target));
  editor.camera.alpha = c.alpha;
  editor.camera.beta = c.beta;
  editor.camera.radius = c.radius;
  return [...missing];
}

function applyMaterial(m: Material, j: MaterialJSON) {
  m.alpha = j.alpha;
  if (j.alpha < 1) m.transparencyMode = 2; // MATERIAL_ALPHABLEND
  m.backFaceCulling = j.backFaceCulling;
  m.wireframe = j.wireframe;
  if (m instanceof PBRMaterial && j.type === 'pbr') {
    m.albedoColor = Color3.FromHexString(j.albedo!);
    if (j.metallic !== undefined) m.metallic = j.metallic;
    if (j.roughness !== undefined) m.roughness = j.roughness;
    m.clearCoat.isEnabled = !!j.clearCoat;
    m.clearCoat.intensity = j.clearCoatIntensity ?? 1;
    m.unlit = !!j.unlit;
    m.emissiveColor = Color3.FromHexString(j.emissive!);
    m.emissiveIntensity = j.emissiveIntensity ?? 1;
    if (j.textureHidden && m.albedoTexture) {
      (m.metadata ??= {}).stashedAlbedo = m.albedoTexture;
      m.albedoTexture = null;
    }
  } else if (m instanceof StandardMaterial && j.type === 'standard') {
    m.diffuseColor = Color3.FromHexString(j.diffuse!);
    m.specularColor = Color3.FromHexString(j.specular!);
    m.specularPower = j.specularPower ?? 64;
    m.emissiveColor = Color3.FromHexString(j.emissive!);
  }
}

// ---------- Autosave (IndexedDB) ----------

const DB = 'babalon-js';
const STORE = 'projects';
const AUTOSAVE_KEY = 'autosave';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveAutosave(snap: ProjectSnapshot) {
  await tx('readwrite', (s) => s.put(snap, AUTOSAVE_KEY));
}

export async function loadAutosave(): Promise<ProjectSnapshot | null> {
  try {
    return ((await tx('readonly', (s) => s.get(AUTOSAVE_KEY))) as ProjectSnapshot | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function clearAutosave() {
  await tx('readwrite', (s) => s.delete(AUTOSAVE_KEY));
}
