import { normalizeFatDistribution } from './fatDistribution';
import { normalizeFatPaint, paintFat, type FatPaint, type FatBrushMode } from './fatPaint';
import type { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo.js';
import { fittedNavelFor, fittedNippleFor, rebuildSkinFeatures } from './skinFeatures';
import type { PoseObservation } from './inference/poseObservation';
import { normalizeTissueFit } from './tissueFit';
import { normalizeReferencePose,createReferencePose } from './referencePose';
import { normalizeFittedNippleEdit, normalizeNavelArcLift, normalizeNavelCavityOffset, normalizeSurfaceFit, type FittedNippleEdit } from './surfaceFit';
import { normalizeBoneLengths } from './segmentProportions';
import { AssetContainer } from '@babylonjs/core/assetContainer.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { CreateLines, CreateDashedLines } from '@babylonjs/core/Meshes/Builders/linesBuilder.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { materialToJSON, applyMaterial } from '../core/state';
import { structures } from './structures';
import { migrateParameters } from './migration';
import { AnatomyStudio } from './studio';
import type { AddOptions, Editor, Entity } from '../core/editor';
import { tr } from '../core/i18n';
import { defaults } from './parameters';
import type { AnatomyKey, AnatomyParameters, AnatomyState } from './parameters';
import type { AnatomyResult } from './contracts';
import catalogue from './catalogue';
import { anatomyMaterial, updateAnatomyMaterial } from './material';
import { normalizeGrowth } from './atlas';
import { normalizePose, posedPositions, poseJoints, mirrorAnatomyPose, posedLimbEndpoint, solveLimbTarget, posedAxialHandle, solveAxialTarget, type AxialPoseHandle } from './pose';
import type { AnatomyPose, AnatomyPoseKey, PoseLimb } from './pose';
import { orderedMeshes, previewDeltas, sameMeshTopology } from './dragPreview';
import { normalizeDefinition, muscleDefaults, boneDefaults, type MuscleId, type BoneId, type AnatomyDefinition } from './definition';
import { interactionDefaults, type TissueInteraction } from './definition';
import { applyOrderedAttachments, attachmentMetrics, type AttachmentMetric } from './attachmentPatches';
import { seatLumbarMuscles, solveTissueContact, type ContactMetric } from './tissueContact';
import { seatAxillaryMuscles } from './axillaryContact';
import { preserveFittedPoseVolumes } from './fittedPoseVolume';
import { applySurfaceFollowers } from './connective';
import type { ImportedAnatomyController, SkinDriveReport, SkinPreviewDelta } from './integration/importedAnatomyController';
import type { Mesh as BabylonMesh } from '@babylonjs/core/Meshes/mesh.js';
import type { BodyHints, BodyEvidence } from './inference/bodyEvidence';
import type { HumanoidMeshAnalysis } from './fitBody';


const links: Partial<Record<AnatomyKey, Partial<Record<AnatomyKey, number>>>> = {
  chestWidth: { shoulderWidth: .65, chestDepth: .25, waistWidth: .18 }, chestDepth: { chestWidth: .30 },
  shoulderWidth: { chestWidth: .40 }, pelvisWidth: { asisDistance: .60, pelvisDepth: .22, thighGirth: .45 },
  asisDistance: { pelvisWidth: .70 }, waistWidth: { waistDepth: .35 },
};

export function normalizeParameters(input: unknown, base: AnatomyParameters = defaults): AnatomyParameters {
  const result = { ...base };
  input = migrateParameters(input);
  if (!input || typeof input !== 'object') return result;
  for (const c of catalogue.controls) {
    const value = (input as Record<string, unknown>)[c.key];
    if (typeof value === 'number' && Number.isFinite(value)) result[c.key as AnatomyKey] = Math.max(c.min, Math.min(c.max, value));
  }
  result.skinModel = (input as Record<string, unknown>).skinModel === 1 ? 1 : 0;
  // Preserve existing IDs: 0 sheets, 1 current fans; 2 restores the original fans.
  result.abdominalModel = (input as Record<string, unknown>).abdominalModel === 0 ? 0 : (input as Record<string, unknown>).abdominalModel === 2 ? 2 : 1;
  result.pelvisModel = (input as Record<string, unknown>).pelvisModel === 0 ? 0 : 1;
  result.rectusSegmentCount = Math.max(4, Math.min(8, 2 * Math.round(result.rectusSegmentCount / 2)));
  result.referencePose = normalizeReferencePose((input as Record<string, unknown>).referencePose);
  result.fatPriorDistribution = normalizeFatDistribution((input as Record<string, unknown>).fatPriorDistribution);
  result.fatDistribution = normalizeFatDistribution((input as Record<string, unknown>).fatDistribution);
  result.fatPaint = normalizeFatPaint((input as Record<string, unknown>).fatPaint);
  result.skinFit = normalizeSurfaceFit((input as Record<string, unknown>).skinFit);
  result.tissueFit = normalizeTissueFit((input as Record<string, unknown>).tissueFit);
  result.surfaceFit = normalizeSurfaceFit((input as Record<string, unknown>).surfaceFit);
  result.boneLengthsCm = normalizeBoneLengths((input as Record<string, unknown>).boneLengthsCm);
  result.individualGrowth = normalizeGrowth((input as Record<string, unknown>).individualGrowth);
  try { result.definition = normalizeDefinition((input as Record<string, unknown>).definition); }
  catch { throw new Error(tr('Unsupported anatomy definition version.')); }
  return result;
}
function quantize(key: AnatomyKey, value: number) {
  const c = catalogue.controls.find(c => c.key === key);
  return c ? Number(Math.max(c.min, Math.min(c.max, c.min + Math.round((value - c.min) / c.step) * c.step)).toFixed(6)) : value;
}

/** Owns a parametric scene object. UI and project code only exchange serializable state. */
export class AnatomyBody {
  fatBrush: FatBrushMode | '' = '';
  fatBrushRadius = 45;
  fatBrushStrength = 3;
  private fatStroke?: { field: FatPaint; last?: number[] };
  editNavelDepth = false;
  editNippleProjection = false;
  linkNippleEdits = false;
  private skinFeatureCenters: (Vector3 | undefined)[] = [];

  private get canEditFittedSkin() {
    return !this.showingA && !this.skinDrive?.bound && this.parameters.skinOpacity > .001;
  }

  get canEditNavelDepth() {
    return this.canEditFittedSkin && !!fittedNavelFor(this.parameters);
  }

  editableNipple(side: 0 | 1) {
    return this.canEditFittedSkin ? fittedNippleFor(this.parameters, side) : undefined;
  }

  private hitSkinFeature(pick: PickingInfo, index: number) {
    const center = this.skinFeatureCenters[index];
    if (!center || !pick.pickedPoint || !pick.pickedMesh) return false;
    const local = Vector3.TransformCoordinates(pick.pickedPoint, Matrix.Invert(pick.pickedMesh.getWorldMatrix()));
    return Vector3.DistanceSquared(local, center) <= .032 ** 2;
  }

  hitNavel(pick: PickingInfo) {
    return this.canEditNavelDepth && this.hitSkinFeature(pick, 0);
  }

  hitNipple(pick: PickingInfo): 0 | 1 | undefined {
    if (this.editableNipple(0) && this.hitSkinFeature(pick, 1)) return 0;
    if (this.editableNipple(1) && this.hitSkinFeature(pick, 2)) return 1;
  }

  setFittedNippleEdit(side: 0 | 1, changes: Partial<FittedNippleEdit>) {
    const skinFit = this.parameters.skinFit, nipples = skinFit?.fittedNipples;
    if (!skinFit || !nipples || !this.editableNipple(side)) return;
    const update = (index: 0 | 1) => {
      const nipple = nipples[index];
      if (!nipple || (index !== side && (!this.linkNippleEdits || !this.editableNipple(index)))) return nipple;
      const edit = normalizeFittedNippleEdit({ ...nipple.edit, ...changes });
      return JSON.stringify(edit) === JSON.stringify(nipple.edit) ? nipple : { ...nipple, edit };
    };
    const left = update(0), right = update(1);
    if (left !== nipples[0] || right !== nipples[1]) this.patch({ skinFit: { ...skinFit, fittedNipples: [left, right] } });
  }

  setNavelCavityOffset(value: number) {
    const skinFit = this.parameters.skinFit;
    const fittedNavel = skinFit?.fittedNavel;
    if (!skinFit || !fittedNavel || !this.canEditNavelDepth) return;
    const cavityOffsetMm = normalizeNavelCavityOffset(value);
    if (cavityOffsetMm === (fittedNavel.cavityOffsetMm ?? 0)) return;
    this.patch({ skinFit: { ...skinFit, fittedNavel: { ...fittedNavel, cavityOffsetMm } } });
  }

  setNavelArcLift(value: number) {
    const skinFit = this.parameters.skinFit, fittedNavel = skinFit?.fittedNavel;
    if (!skinFit || !fittedNavel?.detail || !this.canEditNavelDepth) return;
    const arcLiftMm = normalizeNavelArcLift(value);
    if (arcLiftMm !== (fittedNavel.arcLiftMm ?? 0)) this.patch({ skinFit: { ...skinFit, fittedNavel: { ...fittedNavel, arcLiftMm } } });
  }

  sampleFatStroke(pick: PickingInfo, begin = false) {
    if (!this.fatBrush || !pick.hit || pick.faceId < 0) return false;
    const skin = this.result?.meshes.skin[0];
    const rest = skin?.materialPositions;
    const offset = pick.faceId * 3;
    if (!skin || !rest || offset + 2 >= skin.indices.length) return false;
    if (begin) this.fatStroke = { field: { ...this.parameters.fatPaint } };
    const stroke = this.fatStroke;
    if (!stroke) return false;
    const [a,b,c] = [0,1,2].map(k => skin.indices[offset+k]*3);
    const point = [0,1,2].map(k => rest[a+k]*pick.bu + rest[b+k]*pick.bv + rest[c+k]*(1-pick.bu-pick.bv));
    if (!stroke.last || Math.hypot(...point.map((v,k)=>v-stroke.last![k])) >= this.fatBrushRadius / 320) {
      paintFat(stroke.field, point, this.fatBrushRadius, this.fatBrushStrength, this.fatBrush);
      stroke.last = point;
    }
    return true;
  }

  finishFatStroke(cancel = false) {
    const stroke = this.fatStroke;
    this.fatStroke = undefined;
    if (stroke && !cancel) this.patch({ fatPaint: stroke.field });
  }
  readonly editor: Editor;
  readonly entity: Entity;
  private readonly materialCache = new Map<string, PBRMaterial>();
  private readonly referenceMaterialCache = new Map<string, PBRMaterial>();
  private studio: AnatomyStudio;
  private worker: Worker | null = null;
  fitting: {stage:string;fraction:number} | null = null;
  private driveInPose = false;
  private restoredFitSkinVersion?: number;
  private version = 0;
  private working = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  isEditing = false;
  private anchor: { key: AnatomyKey; parameters: AnatomyParameters } | null = null;
  private result: AnatomyResult | null = null;
  private drawn: AnatomyParameters = { ...defaults };
  private exactParameters: AnatomyParameters = { ...defaults };
  private drag: { key: string; from: number; value: number; base: AnatomyResult; parameters: AnatomyParameters; posed: AnatomyPose } | null = null;
  private finishingDrag: AnatomyBody['drag'] = null;
  private cachedDelta: { key: string; changes: NonNullable<ReturnType<typeof previewDeltas>>; span: number; external?: SkinPreviewDelta } | null = null;
  private previewFrame = 0;
  private previewBuffers = new Map<number, { base: Float32Array; positions: Float32Array; normals: Float32Array }>();
  previewMs = 0;
  skinPreviewMs = 0;
  skinPreviewBytes = 0;
  applyMs = 0;
  private lastSkinPreview = -Infinity;
  private markers: Mesh[] = [];
  private selectedPoint: Vector3 | null = null;
  private drive: ImportedAnatomyController | null = null;
  private driveReport: SkinDriveReport | null = null;
  private fitRevision = 0;
  private poseObservation?: { mesh: BabylonMesh; observation: PoseObservation };
  private cancelFitting: (()=>void) | null = null;
  private waiters: { resolve: () => void; reject: (error: Error) => void }[] = [];
  showingA = false;
  spinning = false;
  region = 'overview';
  framing = 'body';
  error = '';
  computeMs = 0;

  constructor(editor: Editor, entity: Entity, state?: Partial<AnatomyState>) {
    this.editor = editor;
    this.studio = new AnatomyStudio(editor.scene);
    this.entity = entity;
    entity.anatomy = {
      parameters: normalizeParameters(state?.parameters), anatomicalLinks: typeof state?.anatomicalLinks === 'boolean' ? state.anatomicalLinks : true,
      fitSetup: state?.fitSetup ? structuredClone(state.fitSetup) : undefined,
      fitEvidence: state?.fitEvidence ? structuredClone(state.fitEvidence) : undefined,
      materials: structuredClone(state?.materials ?? {}), referenceMaterials: structuredClone(state?.referenceMaterials ?? {}),
      studyLighting: state?.studyLighting ?? false, activeStructure: state?.activeStructure ?? 'skin', details: structuredClone(state?.details ?? {}),
      reference: state?.reference ? normalizeParameters(state.reference) : undefined, inspect: !!state?.inspect,
      poseBasis: state?.poseBasis === 'fitted' ? 'fitted' : undefined,
      referencePoseBasis: state?.referencePoseBasis === 'fitted' ? 'fitted' : undefined,
      pose: normalizePose(state?.pose), referencePose: state?.referencePose ? normalizePose(state.referencePose) : undefined,
    };
    entity.anatomyBody = this;
    const observer = editor.scene.onBeforeRenderObservable.add(() => {
      if (this.state.inspect) {
        const visible = !editor.cleanView && this.frontFacing;
        for (const marker of this.markers) marker.isVisible = visible;
      }
      if (this.spinning && entity.root.isEnabled() && !editor.cleanView) {
        editor.camera.alpha += editor.engine.getDeltaTime() * .00015;
        editor.invalidate();
      }
    });
    const materialObserver = editor.changed.add(kind => {
      if ((kind === 'transform' || kind === 'history') && !this.isEditing && !this.showingA) this.syncNativeMaterials();
    });
    entity.root.onDisposeObservable.addOnce(() => {
      this.fitRevision++; this.cancelFitting?.(); this.cancelFitting=null;
      editor.changed.remove(materialObserver);
      this.disposed = true;
      clearTimeout(this.timer);
      cancelAnimationFrame(this.previewFrame);
      this.cancelPose();
      this.worker?.terminate();
      this.worker = null;
      this.drive?.detach(true);
      this.drive = null;
      this.driveReport = null;
      this.studio.dispose();
      for (const material of [...this.materialCache.values(), ...this.referenceMaterialCache.values()]) material.dispose(false, false);
      for (const marker of this.markers) { editor.helpers.delete(marker); marker.dispose(false, true); }
      this.markers = [];
      editor.scene.onBeforeRenderObservable.remove(observer);
      this.waiters.splice(0).forEach(w => w.reject(new Error(tr('Anatomy body was removed.'))));
    });
  }


  materialFor(key: string, reference = false): PBRMaterial {
    if (!structures.some(s => s.id === key)) throw new Error(tr('Unknown anatomical structure.'));
    const cache = reference ? this.referenceMaterialCache : this.materialCache;
    let material = cache.get(key);
    if (!material) {
      const p = reference && this.state.reference ? this.state.reference : this.parameters;
      material = anatomyMaterial(this.editor.scene, key, p);
      const saved = (reference ? this.state.referenceMaterials : this.state.materials)?.[key];
      if (saved) applyMaterial(material, saved);
      cache.set(key, material);
    }
    return material;
  }
  materialsForEditing() { return structures.map(s => this.materialFor(s.id)); }
  structureOptions() { return structures.map(s => ({ id: s.id, label: s.label, group: s.group })); }
  get activeStructure() { const key = this.state.activeStructure; return structures.some(s => s.id === key) ? key! : 'skin'; }
  selectStructure(key: string) {
    if (!structures.some(s => s.id === key)) return;
    this.state.activeStructure = key;
    this.editor.notify('selection');
  }
  captureState(): AnatomyState {
    this.state.materials ??= {};
    for (const [key, material] of this.materialCache) {
      this.state.materials[key] = materialToJSON(material);
      const structure = structures.find(s => s.id === key)!;
      this.parameters[structure.opacity] = material.alpha;
      if (key === 'skin' && material.roughness !== null) this.parameters.roughness = material.roughness;
    }
    return structuredClone(this.state);
  }

  get state() { return this.entity.anatomy!; }
  get parameters() { return this.state.parameters; }
  get busy() { return this.working || !!this.timer || !!this.drag; }
  /** Status of the imported skin driven by this anatomy, when one is fitted. */
  get skinDrive(): SkinDriveReport | null { return this.drive ? this.driveReport : null; }
  /** The imported model bound as this body's outer skin, if any. */
  get skinModelMesh(): Mesh | null { return this.drive?.targetMesh ?? null; }
  projectSkinBinding() {
    const binding = this.drive?.projectBinding();
    if (binding) return { ...binding, posed: this.driveInPose, enabled: !!this.skinDrive?.enabled };
  }

  async restoreSkinBinding(mesh: Mesh, name: string, saved: Omit<NonNullable<ReturnType<AnatomyBody['projectSkinBinding']>>, 'blob'>, blob: Blob) {
    const { lengths, frame, height, posed, enabled } = saved;
    const position = mesh.getVerticesData('position'), indices = mesh.getIndices(), normals = mesh.getVerticesData('normal');
    if (!position || !indices?.length || !Array.isArray(lengths) || lengths.length !== 5 ||
      !lengths.every(length => Number.isSafeInteger(length) && length >= 0) ||
      lengths.reduce((sum, length) => sum + length, 0) * 4 !== blob.size ||
      !lengths[0] || lengths[0] % 3 || !lengths[1] || lengths[1] % 3 ||
      !Number.isFinite(height) || height <= 0 ||
      (lengths[2] && lengths[2] !== position.length) ||
      (lengths[4] && lengths[4] !== position.length * 3)) return false;
    const data = await blob.arrayBuffer();
    const [vertices, triangles, analysis, rotations, skinning] = lengths;
    const baseline = new Float32Array(data, 0, vertices);
    const topology = new Uint32Array(data, vertices * 4, triangles);
    if (topology.some(index => index >= vertices / 3)) return false;
    let offset = (vertices + triangles) * 4;
    const read = (length: number) => {
      const array = length ? new Float32Array(data, offset, length) : undefined;
      offset += length * 4;
      return array;
    };
    const { ImportedAnatomyController } = await import('./integration/importedAnatomyController');
    const drive = new ImportedAnatomyController(this.editor);
    const report = drive.bind({ mesh, name, positions: Float32Array.from(position), indices: Uint32Array.from(indices),
      normals: normals ? Float32Array.from(normals) : undefined,
      analysisPositions: read(analysis), inversePoseRotations: read(rotations), inverseSkinning: read(skinning),
    }, frame, { positions: baseline, indices: topology, normals: new Float32Array() }, height);
    if (!report.bound) return false;
    this.drive = drive;
    this.driveReport = report;
    this.driveInPose = posed;
    this.setSkinDrive(enabled);
    return true;
  }
  get fitEvidence(): BodyEvidence | undefined { return this.state.fitEvidence; }
  setSkinDrive(enabled: boolean) {
    if (!this.drive) return;
    this.drive.setEnabled(enabled);
    if (enabled && this.result) {
      // Re-enabling must bring back the deformation of the current parameters, not wait for an edit.
      const skin=this.result.meshes.skin[0];
      this.driveReport = this.drive.apply({...skin,positions:this.driveInPose?posedPositions(skin,this.drawn,this.pose):skin.positions}, this.drawn.height);
    }
    this.driveReport = this.drive.report;
    this.directPublish();
  }
  /** Reverts the imported skin to the fitted baseline, keeping the binding. */
  resetSkinDrive() {
    this.drive?.revert();
    this.driveReport = this.drive?.report ?? null;
    this.directPublish();
  }
  detachSkinDrive() {
    this.drive?.detach(true);
    this.drive = null;
    this.driveReport = null;
    this.directPublish();
  }
  private directPublish() { this.editor.notify('transform'); this.editor.invalidate(); }
  get inguinalMetrics() { return { angle: this.result?.inguinalAngle ?? 0, height: this.result?.inguinalHeight ?? 0 }; }
  get triangles() { return this.entity.meshes.reduce((sum, m) => sum + m.getTotalIndices() / 3, 0); }
  get anatomyMetrics() { return this.result?.anatomyMetrics ?? []; }
  private posedAttachments: AttachmentMetric[] = [];
  get attachmentMetrics() { return this.posedAttachments; }
  private posedContacts: ContactMetric[] = [];
  get contactMetrics() { return this.isEditing ? [] : this.posedContacts; }
  setTissueInteraction(values: Partial<TissueInteraction>, commit = true) {
    const definition: AnatomyDefinition = structuredClone(this.parameters.definition ?? { version: 1, muscles: {}, bones: {} });
    definition.interaction = { ...interactionDefaults, ...definition.interaction, ...values };
    const normalized = normalizeDefinition(definition);
    if (commit) this.change(() => { this.state.parameters.definition = normalized; });
    else {
      this.editor.beginEdit(this, () => this.captureState(), state => this.restore(state));
      this.isEditing = true; this.state.parameters.definition = normalized; this.showingA = false; this.rebuild();
    }
  }
  editIndividual(id: MuscleId | BoneId, key: string, value: unknown, linked = false) {
    const bone = id.startsWith('hip_bone.');
    const previousShape = bone ? this.parameters.definition?.bones[id as BoneId] : this.parameters.definition?.muscles[id as MuscleId];
    const previous = (previousShape ?? (bone ? boneDefaults : muscleDefaults)) as unknown as Record<string, unknown>;
    const wasA = this.showingA;
    const definition: AnatomyDefinition = structuredClone(this.parameters.definition ?? { version: 1, muscles: {}, bones: {} });
    const ids = linked ? [id, id.slice(0, -1) + (id.endsWith('L') ? 'R' : 'L')] : [id];
    for (const target of ids) {
      if (target.startsWith('hip_bone.')) definition.bones[target as BoneId] = { ...boneDefaults, ...definition.bones[target as BoneId], [key]: value };
      else definition.muscles[target as MuscleId] = { ...muscleDefaults, ...definition.muscles[target as MuscleId], [key]: value };
    }
    const normalized = normalizeDefinition(definition);
    this.editor.beginEdit(this, () => this.captureState(), state => this.restore(state));
    this.isEditing = true; this.state.parameters.definition = normalized; this.showingA = false;
    const next = (bone ? normalized?.bones[id as BoneId] : normalized?.muscles[id as MuscleId]) as unknown as Record<string, unknown> | undefined;
    const control = 'individual:' + id + ':' + key + ':' + linked;
    if (!wasA && typeof previous[key] === 'number' && typeof next?.[key] === 'number') {
      this.previewGeometry(control, previous[key], next[key]);
    } else if (!wasA && (key === 'depthProfile' || key === 'widthProfile' || key === 'fittedWidthProfile') && Array.isArray(next?.[key])) {
      const after = next[key];
      const before = Array.isArray(previous[key]) ? previous[key] : Array<number>(after.length).fill(1);
      const changes = after.map((number, i) => number === before[i] ? -1 : i).filter(i => i >= 0);
      if (changes.length === 1) {
        const i = changes[0];
        this.previewGeometry(control + ':' + i, before[i], after[i]);
      } else if (changes.length) this.rebuild();
    } else this.rebuild();
  }
  resetIndividual(id: MuscleId | BoneId, linked = false) {
    this.change(() => {
      const definition = structuredClone(this.parameters.definition); if (!definition) return;
      const ids = linked ? [id, id.slice(0, -1) + (id.endsWith('L') ? 'R' : 'L')] : [id];
      for (const target of ids) { delete definition.muscles[target as MuscleId]; delete definition.bones[target as BoneId]; }
      this.state.parameters.definition = Object.keys(definition.muscles).length || Object.keys(definition.bones).length || definition.interaction ? definition : undefined;
    });
  }
  private visibleParameters() { return this.showingA && this.state.reference ? this.state.reference : this.parameters; }
  get pose() {
    const basis = this.showingA ? this.state.referencePoseBasis : this.state.poseBasis;
    return normalizePose(this.visibleParameters().referencePose?.enabled && basis !== 'fitted' ? undefined
      : this.showingA ? this.state.referencePose : this.state.pose);
  }

  editPose(key: AnatomyPoseKey, value: number) {
    if (!Number.isFinite(value)) return;
    this.previewPose(normalizePose({ ...this.pose, [key]: value }));
  }

  private handleJointCache?: { parameters: AnatomyParameters; joints: ReturnType<typeof poseJoints> };

  private handleJoints() {
    if (this.handleJointCache?.parameters !== this.drawn) {
      this.handleJointCache = { parameters: this.drawn, joints: poseJoints(this.drawn) };
    }
    return this.handleJointCache.joints;
  }

  limbEndpointWorldPosition(limb: PoseLimb, side: 0 | 1, joint: 0 | 1 | 2 = 2) {
    return this.posePointWorld(posedLimbEndpoint(this.drawn, this.pose, limb, side, this.handleJoints(), joint));
  }

  axialHandleWorldPosition(handle: AxialPoseHandle) {
    return this.posePointWorld(posedAxialHandle(this.drawn, this.pose, handle, this.handleJoints()));
  }

  private posePointWorld([x, y, z]: Float32Array) {
    return Vector3.TransformCoordinates(new Vector3(x * .1, y * this.drawn.height / 1750, z * .1),
      this.entity.root.computeWorldMatrix(true));
  }

  moveLimbEndpoint(limb: PoseLimb, side: 0 | 1, x: number, y: number, start: AnatomyPose, joint: 0 | 1 | 2 = 2) {
    this.movePoseHandle(x, y, start,
      () => posedLimbEndpoint(this.drawn, start, limb, side, undefined, joint),
      score => solveLimbTarget(this.drawn, start, limb, side, score, joint));
  }

  moveAxialHandle(handle: AxialPoseHandle, x: number, y: number, start: AnatomyPose) {
    this.movePoseHandle(x, y, start,
      () => posedAxialHandle(this.drawn, start, handle),
      score => solveAxialTarget(this.drawn, start, handle, score));
  }

  private movePoseHandle(x: number, y: number, start: AnatomyPose, getOrigin: () => Float32Array,
    solve: (score: (position: Float32Array) => number) => AnatomyPose) {
    const world = this.entity.root.computeWorldMatrix(true);
    const heightScale = this.drawn.height / 1750;
    // Solved once per frame for the latest pointer position.
    this.previewPose(() => {
      const toWorld = ([px, py, pz]: Float32Array) => Vector3.TransformCoordinates(new Vector3(px * .1, py * heightScale, pz * .1), world);
      const origin = toWorld(getOrigin());
      const screen = this.editor.toScreen(origin);
      if ((screen.x - x) ** 2 + (screen.y - y) ** 2 <= .25) return start;
      const depthAxis = this.editor.camera.getForwardRay().direction;
      const pixelSize = this.editor.worldPerPixel(origin);
      const score = (position: Float32Array) => {
        const point = toWorld(position);
        const projected = this.editor.toScreen(point);
        // Prefer the depth at pointer-down when several joint poses reach the same pixel.
        const depth = Vector3.Dot(point.subtract(origin), depthAxis) / pixelSize;
        return (projected.x - x) ** 2 + (projected.y - y) ** 2 + .16 * depth * depth;
      };
      return solve(score);
    });
  }

  private pendingPose: (() => AnatomyPose) | null = null;
  private poseFrame = 0;
  /** Pose previews re-pose every mesh: input events between two frames are merged into one update. */
  private previewPose(pose: AnatomyPose | (() => AnatomyPose)) {
    this.cachedDelta = null;
    this.editor.beginEdit(this, () => this.captureState(), state => this.restore(state));
    this.isEditing = true;
    if (this.showingA) { this.showingA = false; this.rebuild(); }
    if (this.parameters.referencePose?.enabled) this.state.poseBasis = 'fitted';
    if (typeof pose === 'function') this.pendingPose = pose;
    else { this.state.pose = pose; this.pendingPose = () => pose; }
    this.poseFrame ||= requestAnimationFrame(() => this.flushPose());
  }
  private flushPose(apply = true) {
    cancelAnimationFrame(this.poseFrame);
    this.poseFrame = 0;
    const pending = this.pendingPose;
    this.pendingPose = null;
    if (!pending) return;
    this.state.pose = pending();
    if (apply && this.result) this.apply(this.result, this.drawn, true);
  }
  private cancelPose() { cancelAnimationFrame(this.poseFrame); this.poseFrame = 0; this.pendingPose = null; }
  setPose(values: unknown) {
    this.cancelPose();
    this.cachedDelta = null;
    this.change(() => {
      this.state.poseBasis = this.parameters.referencePose?.enabled ? 'fitted' : undefined;
      this.state.pose = normalizePose(values);
    });
    if (this.result) this.apply(this.result, this.drawn, true);
  }
  cancelPoseDrag(pose: AnatomyPose) {
    this.cancelPose();
    this.pendingPose = () => pose;
    this.commit();
  }
  mirrorPose() { this.setPose(mirrorAnatomyPose(this.pose)); }
  resetAnatomy() {
    this.change(() => { this.state.parameters = normalizeParameters(defaults); this.state.pose = normalizePose({}); this.state.poseBasis = undefined; });
    this.rebuild();
  }
  setGrowth(key: string, value: number, commit = false) {
    this.editor.beginEdit(this, () => this.captureState(), state => this.restore(state));
    this.isEditing = true;
    const previous = this.parameters.individualGrowth?.[key] ?? 1;
    this.state.parameters.individualGrowth = normalizeGrowth({ ...this.parameters.individualGrowth, [key]: value });
    const wasA = this.showingA;
    this.showingA = false;
    if (wasA || commit) this.rebuild();
    else this.previewGeometry('growth:' + key, previous, this.parameters.individualGrowth?.[key] ?? 1);
    if (commit) this.commit();
  }

  ready(): Promise<void> {
    if (this.error) return Promise.reject(new Error(this.error));
    if (!this.busy && this.result) return Promise.resolve();
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  rebuild() {
    if (this.disposed) return;
    this.clearPreview();
    this.finishingDrag = null;
    this.cachedDelta = null;
    this.error = '';
    ++this.version;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; this.start(); }, 95);
    this.editor.notify('activity');
  }

  private clearPreview() {
    cancelAnimationFrame(this.previewFrame);
    this.previewFrame = 0;
    this.drag = null;
    this.previewBuffers.clear();
    this.lastSkinPreview = -Infinity;
  }

  private previewGeometry(key: string, from: number, value: number) {
    if (!this.drag) {
      if (!this.result || this.busy) { this.rebuild(); return; }
      this.drag = { key, from, value, base: this.result, parameters: this.exactParameters, posed: this.pose };
      if (this.cachedDelta?.key !== key) {
        this.cachedDelta = null;
        // A cold control needs one exact sample to learn its local response.
        this.start();
      }
    } else if (this.drag.key !== key) { this.rebuild(); return; }
    this.drag.value = value;
    this.queuePreview();
  }

  private queuePreview() {
    if (this.previewFrame || !this.cachedDelta || !this.drag) return;
    this.previewFrame = requestAnimationFrame(() => {
      this.previewFrame = 0;
      const drag = this.drag, cached = this.cachedDelta;
      if (!drag || !cached || drag.key !== cached.key) return;
      const start = performance.now(), limit = Math.abs(cached.span) * 8;
      const amount = Math.max(-limit, Math.min(limit, drag.value - drag.from));
      const raw = orderedMeshes(drag.base);
      for (const { index, delta } of cached.changes) {
        const mesh = this.entity.meshes[index] as Mesh;
        if (!mesh?.isEnabled()) continue;
        let buffers = this.previewBuffers.get(index);
        if (!buffers) {
          const base = mesh.getVerticesData('position');
          if (!base || base.length !== delta.length) continue;
          buffers = { base: new Float32Array(base), positions: new Float32Array(base.length), normals: new Float32Array(base.length) };
          this.previewBuffers.set(index, buffers);
        }
        for (let i = 0; i < delta.length; i++) buffers.positions[i] = buffers.base[i] + delta[i] * amount;
        VertexData.ComputeNormals(buffers.positions, raw[index].indices, buffers.normals, { useRightHandedSystem: true });
        mesh.updateVerticesData('position', buffers.positions, false);
        mesh.updateVerticesData('normal', buffers.normals);
      }
      this.previewMs = performance.now() - start;
      if (cached.external && start - this.lastSkinPreview >= 50) {
        const skinStart = performance.now();
        this.skinPreviewBytes = this.drive?.preview(cached.external, amount / cached.span) ?? 0;
        this.skinPreviewMs = performance.now() - skinStart;
        this.lastSkinPreview = start;
      }
      this.editor.invalidate();
    });
  }

  private start() {
    if (this.working || this.disposed) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.worker ??= new Worker(new URL('./anatomy.worker.ts', import.meta.url), { type: 'module' });
    const parameters = { ...this.visibleParameters() };
    const probe = this.drag, sample = probe?.value;
    this.worker.onmessage = ({ data }: MessageEvent<AnatomyResult>) => {
      this.working = false;
      if (this.disposed) return;
      const finalSample = probe && probe === this.finishingDrag && sample === probe.value;
      if (data.id !== this.version && !finalSample) { this.start(); return; }
      if (probe && probe === this.drag) {
        if (!data.error) this.learnPreview(probe, data, parameters, sample!);
        this.queuePreview();
        return;
      }
      if (data.error) { this.fail(data.error); return; }
      try {
        // No preview learning on release: it re-poses every mesh and the bound model skin twice on the
        // main thread. The next drag of this control learns from its own first sample.
        this.finishingDrag = null;
        this.apply(data, this.visibleParameters());
        this.waiters.splice(0).forEach(w => w.resolve());
      } catch (error) { this.fail(error instanceof Error ? error.message : String(error)); }
    };
    this.worker.onerror = event => { this.working = false; this.worker?.terminate(); this.worker = null; this.fail(event.message); };
    this.working = true;
    const layers = structures.filter(s => s.id !== 'skin' && parameters[s.opacity] > .001).map(s => s.id);
    this.worker.postMessage({ id: this.version, parameters, layers });
  }

  private learnPreview(drag: NonNullable<AnatomyBody['drag']>, result: AnatomyResult, parameters: AnatomyParameters, value: number) {
    const span = value - drag.from;
    const cached = this.cachedDelta;
    if (cached?.key === drag.key && Math.abs(span) <= Math.abs(cached.span) * 2) return;
    const changes = previewDeltas(drag.base, result, drag.parameters, parameters, drag.posed, span);
    if (!changes?.length) return;
    const before = drag.base.meshes.skin[0], after = result.meshes.skin[0];
    const posedSkin = (skin: typeof before, p: AnatomyParameters) => this.driveInPose ? { ...skin, positions: posedPositions(skin, p, drag.posed) } : skin;
    const external = this.drive?.buildPreviewDelta(posedSkin(before, drag.parameters), posedSkin(after, parameters), drag.parameters.height, parameters.height);
    this.cachedDelta = { key: drag.key, changes, span, external };
  }

  private fail(message: string) {
    this.error = message;
    this.waiters.splice(0).forEach(w => w.reject(new Error(message)));
    this.editor.notify('activity');
  }

  private apply(result: AnatomyResult, parameters: AnatomyParameters, poseOnly = false) {
    const start = performance.now();
    const posePreview = poseOnly && this.isEditing;
    const reuse = poseOnly || !!this.result && this.entity.meshes.length === orderedMeshes(result).length &&
      sameMeshTopology(orderedMeshes(this.result), orderedMeshes(result));
    const next: Mesh[] = [];
    try {
      const rawMeshes = [...new Set([...Object.values(result.meshes).flat(), ...(result.contactLean ? [result.contactLean] : []), ...(result.lumbarFascia ?? [])])];
      const pose = this.pose, referencePose = parameters.referencePose?.enabled;
      const isPosed = referencePose || Object.values(pose).some(value => value !== 0);
      const fittedPectoral = Object.values(parameters.definition?.muscles ?? {}).some(shape =>
        shape?.pectoralContour?.covering || shape?.pectoralContour?.transitionCovering);
      const joints = poseJoints(parameters), posed = new Map(rawMeshes.map(mesh => [mesh, posedPositions(mesh, parameters, pose, joints)]));
      const surfaces = new Map(rawMeshes.filter(mesh => mesh.anatomicalName).map(mesh => [mesh.anatomicalName!, mesh]));
      applyOrderedAttachments(rawMeshes, surfaces, posed);
      if (parameters.referencePose?.enabled && result.lumbarFascia?.length)
        seatLumbarMuscles([...(result.meshes.otherMuscles ?? []), ...(result.meshes.externalOblique ?? [])],result.lumbarFascia,posed);
      const fittedPosePreview = posePreview && this.state.poseBasis === 'fitted';
      const posedContact = (!this.isEditing || fittedPosePreview) && parameters.definition?.interaction?.contact && isPosed;
      const coveredBefore = posedContact && result.meshes.adipose?.length ? posed.get(result.meshes.skin[0])!.slice() : undefined;
      const leanBefore = coveredBefore && result.contactLean ? posed.get(result.contactLean)!.slice() : undefined;
      this.posedContacts = posedContact
        ? solveTissueContact(result.meshes, result.meshes.skin[0], result.contactLean, parameters.definition!.interaction!.clearanceMm, posed, parameters.abdominalModel === 1) : result.contacts ?? [];
      if (coveredBefore && leanBefore && result.contactLean) for (const fat of result.meshes.adipose ?? []) {
        const covered = posed.get(result.meshes.skin[0])!, lean = posed.get(result.contactLean)!, positions = posed.get(fat)!;
        for (let i = 0; i < covered.length; i++) positions[i] += covered[i] - coveredBefore[i];
        for (let i = 0; i < lean.length; i++) positions[covered.length + i] += lean[i] - leanBefore[i];
      }
      // These debounced growth previews already use exact geometry. Seat them
      // too, so the muscle does not jump through the skin until release.
      const seatedGrowthPreview = this.anchor?.key === 'deltoid' || this.anchor?.key === 'back';
      if ((!this.isEditing || seatedGrowthPreview || fittedPosePreview) && parameters.referencePose?.enabled && parameters.skinFit && result.meshes.otherMuscles?.length)
        seatAxillaryMuscles(result.meshes.otherMuscles, result.meshes.skin[0], posed, rawMeshes, parameters);
      if (this.state.poseBasis === 'fitted' && referencePose && parameters.skinFit && Object.values(pose).some(value => value !== 0))
        preserveFittedPoseVolumes(result, parameters, rawMeshes, posed);
      applySurfaceFollowers(rawMeshes, posed);
      this.posedAttachments = attachmentMetrics(rawMeshes, posed);
      for (const [key, list] of Object.entries(result.meshes)) for (const raw of list) {
        const mesh = reuse ? this.entity.meshes[next.length] as Mesh : new Mesh(raw.anatomicalName ?? `Anatomy ${key}`, this.editor.scene);
        if (!mesh) throw new Error(tr('Anatomy geometry is not ready.'));
        next.push(mesh);
        const positions = posed.get(raw)!, sy = parameters.height / 175;
        const skinFeatures = raw.skinFeatures ? rebuildSkinFeatures(raw, positions, parameters) : undefined;
        const material = this.materialFor(key, this.showingA);
        const current = posePreview && !raw.skinFeatures && mesh.material === material ? mesh.getVerticesData('position') : null;
        const samePosition = current?.length === positions.length && positions.every((value, index) =>
          current[index] === Math.fround(value * (index % 3 === 1 ? sy * .1 : .1)));
        if (samePosition) continue;
        const data = new VertexData();
        const recomputeNormals = skinFeatures || isPosed || raw.fitSurface && fittedPectoral;
        const normals = recomputeNormals ? new Float32Array(raw.normals.length) : raw.normals.slice();
        if (key === 'skin') this.skinFeatureCenters = skinFeatures?.map(feature => {
          const center = feature?.center;
          return center ? new Vector3(center[0]*.1, center[1]*sy*.1, center[2]*.1) : undefined;
        }) ?? [];
        const uvs = poseOnly ? undefined : new Float32Array(positions.length / 3 * 2);
        for (let i = 0; i < positions.length; i += 3) {
          if (uvs) {
            uvs[i / 3 * 2] = .5 + Math.atan2(raw.positions[i], raw.positions[i + 2]) / (2 * Math.PI);
            uvs[i / 3 * 2 + 1] = raw.positions[i + 1] / 17.5;
          }
          positions[i] *= .1; positions[i + 1] *= sy * .1; positions[i + 2] *= .1;
          if (!recomputeNormals) {
            const length = Math.hypot(normals[i], normals[i + 1] / sy, normals[i + 2]) || 1;
            normals[i] /= length; normals[i + 1] /= sy * length; normals[i + 2] /= length;
          }
        }
        // The generator uses (b - a) × (c - a). Match its winding after posing.
        if (recomputeNormals) {
          VertexData.ComputeNormals(positions, raw.indices, normals, { useRightHandedSystem: true });
        }
        data.positions = positions; data.normals = normals; data.indices = raw.indices; data.uvs = uvs ?? null;
        if (reuse) {
          mesh.updateVerticesData('position', positions, true); mesh.updateVerticesData('normal', normals);
          if (uvs) mesh.updateVerticesData('uv', uvs);
        } else data.applyToMesh(mesh, true);
        if (!poseOnly) {
          const updateAttribute = (kind: string, values: Float32Array, size: number) => {
            if (mesh.getVertexBuffer(kind)?.isUpdatable()) mesh.updateVerticesData(kind, values);
            else mesh.setVerticesData(kind, values, true, size);
          };
          updateAttribute('anatomyRest', raw.materialPositions ?? raw.positions, 3);
          updateAttribute('fiber', raw.fibers ?? new Float32Array(positions.length / 3), 1);
          updateAttribute('tissue', raw.tissue ?? new Float32Array(positions.length / 3).fill(1), 1);
        }
        if (posePreview && !raw.skinFeatures && mesh.material === material) continue;
        updateAnatomyMaterial(material, parameters, key, result.navel, parameters, !!raw.fibers, !!this.state.studyLighting, this.state.details?.[key] !== false, this.state.details?.striations !== false, skinFeatures);
        mesh.material = material;
        mesh.metadata = { anatomyLayer: key, anatomyId: raw.anatomyId, anatomicalName: raw.anatomicalName, hasAnatomicalFibers: !!raw.fibers };
        mesh.parent = this.entity.root;
        mesh.receiveShadows = true;
        mesh.setEnabled(material.alpha > .001);
      }
    } catch (error) { if (!reuse) next.forEach(m => m.dispose(false, false)); throw error; }
    if (!reuse) this.entity.meshes.forEach(m => m.dispose(false, false));
    this.entity.meshes = next;
    this.result = result;
    // New meshes or layers compile shaders, which can take longer than the editor keeps
    // drawing after a change: draw once more when they are ready.
    if (!posePreview) this.editor.scene.executeWhenReady(() => this.editor.invalidate());
    this.drawn = { ...parameters };
    if (!poseOnly) this.exactParameters = { ...parameters };
    this.applyMs = performance.now() - start;
    const displayRestored = !poseOnly && this.restoredFitSkinVersion === this.version;
    this.restoredFitSkinVersion = undefined;
    if (this.drive && !displayRestored) {
      const skin = result.meshes.skin[0];
      this.driveReport = this.drive.apply({ ...skin, positions: this.driveInPose ? posedPositions(skin, parameters, this.pose) : skin.positions }, parameters.height);
    }
    this.computeMs = result.computeMs;
    this.studio.update(!!this.state.studyLighting, parameters, this.entity.meshes);
    this.updateInspection();
    if (!posePreview) this.editor.refreshShadows();
    this.editor.invalidate();
    this.editor.notify('entities');
  }

  private materials() {
    const p = this.visibleParameters(), cache = this.showingA ? this.referenceMaterialCache : this.materialCache;
    for (const [key, material] of cache) {
      const fibers = this.entity.meshes.some(m => m.metadata?.anatomyLayer === key && m.metadata?.hasAnatomicalFibers);
      updateAnatomyMaterial(material, p, key, this.result?.navel ?? [0, 10.25, 1], this.drawn, fibers, !!this.state.studyLighting, this.state.details?.[key] !== false, this.state.details?.striations !== false);
    }
    for (const mesh of this.entity.meshes) mesh.setEnabled((mesh.material?.alpha ?? 0) > .001);
    this.drawn = { ...p };
    this.studio.update(!!this.state.studyLighting, p, this.entity.meshes);
    this.editor.refreshShadows();
    this.editor.invalidate();
  }

  private syncNativeMaterials() {
    let missing = false;
    for (const [key, material] of this.materialCache) {
      const structure = structures.find(s => s.id === key)!;
      this.parameters[structure.opacity] = material.alpha;
      const meshes = this.entity.meshes.filter(m => m.metadata?.anatomyLayer === key);
      for (const mesh of meshes) mesh.setEnabled(material.alpha > .001);
      if (!meshes.length && material.alpha > .001 && !(key === 'adipose' && this.parameters.fat <= 0 && this.parameters.lowerAbdominalFat <= 0 && this.parameters.flankFullness <= 0 && this.parameters.suprapubicFat <= 0)) missing = true;
    }
    if (missing && !this.busy) this.rebuild();
    this.editor.refreshShadows();
  }

  restore(state: AnatomyState) {
    if(JSON.stringify(state.parameters.surfaceFit)!==JSON.stringify(this.parameters.surfaceFit)||JSON.stringify(state.parameters.skinFit)!==JSON.stringify(this.parameters.skinFit)||JSON.stringify(state.parameters.tissueFit)!==JSON.stringify(this.parameters.tissueFit)){this.drive?.detach(true);this.drive=null;this.driveReport=null;}
    const parameters = normalizeParameters(state.parameters);
    if (state.reference) normalizeParameters(state.reference);
    this.cancelPose();
    this.isEditing = false;
    this.entity.anatomy = structuredClone(state);
    this.state.parameters = parameters;
    this.state.pose = normalizePose(state.pose);
    for (const [key, material] of this.materialCache) if (state.materials?.[key]) applyMaterial(material, state.materials[key]);
    this.showingA = false;
    this.anchor = null;
    this.drawn = { ...this.parameters };
    this.rebuild();
  }

  private captureFitHistory(state: AnatomyState) {
    const binding = this.drive?.captureBinding(), posed = this.driveInPose;
    return () => {
      this.drive?.detach(true);
      this.drive = null;
      this.restore(state);
      this.drive = binding?.() ?? null;
      this.driveInPose = posed;
      this.driveReport = this.drive?.report ?? null;
      if (this.drive) this.restoredFitSkinVersion = this.version;
    };
  }

  edit(key: AnatomyKey, value: number) {
    if (!Number.isFinite(value)) return;
    this.editor.beginEdit(this, () => this.captureState(), state => this.restore(state));
    this.isEditing = true;
    if (!this.anchor || this.anchor.key !== key) {
      this.anchor = { key, parameters: { ...this.parameters } };
      this.drawn = { ...this.parameters };
    }
    const base = this.anchor.parameters;
    value = quantize(key, value);
    if (this.state.anatomicalLinks) for (const [otherMuscles, ratio] of Object.entries(links[key] ?? {})) {
      this.parameters[otherMuscles as AnatomyKey] = quantize(otherMuscles as AnatomyKey, base[otherMuscles as AnatomyKey] + (value - base[key]) * ratio);
    }
    this.parameters[key] = value;
    const structure = structures.find(s => s.opacity === key);
    if (structure) this.materialFor(structure.id).alpha = value;
    const wasA = this.showingA;
    if (wasA) this.drawn = { ...this.parameters, [key]: base[key] };
    this.showingA = false;
    const c = catalogue.controls.find(c => c.key === key);
    if (c?.kind === 'light') this.state.studyLighting = true;
    this.materials();
    // Fitted shoulder and torso shells change shape nonlinearly at large gains.
    // Use the debounced exact rebuild instead of extrapolating a small drag sample.
    const exactGrowth = this.parameters.referencePose?.enabled && this.parameters.skinFit &&
      (key === 'pectoral' || key === 'pectoralClavicular' || key === 'pectoralSternal' || key === 'pectoralCostal' || key === 'deltoid' || key === 'back');
    if (wasA || exactGrowth || key === 'skinModel' || key === 'abdominalModel' || key === 'pelvisModel' || key.endsWith('Opacity') && !this.entity.meshes.some(m => m.metadata?.anatomyLayer === key.replace('Opacity', ''))) this.rebuild();
    else if (c?.kind === 'geometry') this.previewGeometry('parameter:' + key + ':' + this.state.anatomicalLinks, base[key], value);
  }
  commit() {
    const pendingPose = !!this.pendingPose;
    this.flushPose(false);
    const referencePose = this.parameters.referencePose?.enabled;
    const updateContact = this.isEditing && this.result && (referencePose && this.parameters.skinFit ||
      this.parameters.definition?.interaction?.contact && (referencePose || Object.values(this.pose).some(value => value !== 0)));
    const drag = this.drag;
    this.anchor = null; this.isEditing = false;
    if (drag) {
      this.clearPreview();
      this.finishingDrag = drag;
      ++this.version;
      this.start();
      this.editor.notify('activity');
    } else if ((updateContact || pendingPose) && this.result) this.apply(this.result, this.drawn, true);
    this.editor.endEdit(this); this.editor.notify('transform');
  }

  change(fn: () => void) {
    const wasA = this.showingA;
    this.editor.beginEdit(this, () => this.captureState(), state => this.restore(state));
    const editingBefore = { ...this.parameters };
    const before = { ...this.visibleParameters() };
    this.drawn = { ...editingBefore };
    fn();
    for (const structure of structures) if (editingBefore[structure.opacity] !== this.parameters[structure.opacity]) this.materialFor(structure.id).alpha = this.parameters[structure.opacity];
    this.showingA = false;
    const geometryChanged = JSON.stringify(before.fatPaint)!==JSON.stringify(this.parameters.fatPaint) || JSON.stringify(before.fatDistribution)!==JSON.stringify(this.parameters.fatDistribution) || JSON.stringify(before.skinFit)!==JSON.stringify(this.parameters.skinFit) || JSON.stringify(before.tissueFit)!==JSON.stringify(this.parameters.tissueFit) || JSON.stringify(before.referencePose)!==JSON.stringify(this.parameters.referencePose) || JSON.stringify(before.surfaceFit) !== JSON.stringify(this.parameters.surfaceFit) || JSON.stringify(before.boneLengthsCm) !== JSON.stringify(this.parameters.boneLengthsCm) || before.skinModel !== this.parameters.skinModel || before.abdominalModel !== this.parameters.abdominalModel || before.pelvisModel !== this.parameters.pelvisModel || JSON.stringify(before.individualGrowth) !== JSON.stringify(this.parameters.individualGrowth) || JSON.stringify(before.definition) !== JSON.stringify(this.parameters.definition) || catalogue.controls.some(c => c.kind === 'geometry' && before[c.key] !== this.parameters[c.key]);
    const missingLayer = structures.some(s => this.parameters[s.opacity] > .001 && !this.entity.meshes.some(m => m.metadata?.anatomyLayer === s.id));
    if (wasA) this.drawn = editingBefore;
    this.materials();
    if (wasA || geometryChanged || missingLayer) this.rebuild();
    this.commit();
  }
  patch(values: Partial<AnatomyParameters>) { this.change(() => { this.state.parameters = normalizeParameters({ ...this.parameters, ...values }); }); }
  profile(values: Partial<AnatomyParameters>, commit = true) {
    if (!this.isEditing) this.captureState();
    const keep: Partial<AnatomyParameters> = {};
    for (const c of catalogue.controls) if (c.kind !== 'geometry' || catalogue.inguinalPresetFields.includes(c.key) && c.key !== 'pubicFat') keep[c.key as AnatomyKey] = this.parameters[c.key as AnatomyKey];
    this.editor.beginEdit(this, () => this.captureState(), state => this.restore(state));
    this.isEditing = true;
    this.state.parameters = normalizeParameters({ ...defaults, ...keep, individualGrowth: this.parameters.individualGrowth, definition: this.parameters.definition,surfaceFit:this.parameters.surfaceFit,fatPaint:this.parameters.fatPaint,skinFit:this.parameters.skinFit,fatDistribution:this.parameters.fatDistribution,fatPriorDistribution:this.parameters.fatPriorDistribution,tissueFit:this.parameters.tissueFit,referencePose:this.parameters.referencePose,boneLengthsCm:this.parameters.boneLengthsCm, ...values });
    this.showingA = false;
    this.rebuild();
    if (commit) this.commit();
  }
  saveReference() { this.change(() => { this.state.reference = structuredClone(this.parameters); this.state.referencePose = this.pose; this.state.referencePoseBasis = this.state.poseBasis; this.state.referenceMaterials = this.captureState().materials; }); }
  compare(show: boolean) { if (show && !this.state.reference) return; if (!this.showingA) this.captureState(); if (show) for (const [key, material] of this.referenceMaterialCache) if (this.state.referenceMaterials?.[key]) applyMaterial(material, this.state.referenceMaterials[key]); this.showingA = show; this.rebuild(); }
  inspect(value: boolean) { this.state.inspect = value; this.updateInspection(); this.editor.notify('transform'); }

  importParameters(data: unknown) {
    if (!data || typeof data !== 'object') throw new Error(tr('Invalid anatomy parameters.'));
    const document = data as { parameters?: unknown; pose?: unknown; poseBasis?: unknown; settings?: { anatomicalLinks?: unknown } };
    const parameters = migrateParameters(document.parameters ?? data);
    if (!parameters || typeof parameters !== 'object' || !Object.keys(defaults).some(key => Number.isFinite((parameters as Record<string, unknown>)[key]))) throw new Error(tr('Invalid anatomy parameters.'));
    const normalized = normalizeParameters(parameters);
    this.change(() => {
      this.state.parameters = normalized;
      this.state.pose = normalizePose(document.pose);
      this.state.poseBasis = document.poseBasis === 'fitted' ? 'fitted' : undefined;
      if (typeof document.settings?.anatomicalLinks === 'boolean') this.state.anatomicalLinks = document.settings.anatomicalLinks;
    });
    this.rebuild();
  }

  /**
   * Estimates anatomical proportions from a humanoid mesh and, when the mesh is provided,
   * binds that same mesh as the visible skin driven by the fitted anatomy.
   */
  stopFitting() { this.fitRevision++; this.cancelFitting?.(); }

  async adaptToTargetMesh(target: {
    positions: Float32Array;
    mesh?: BabylonMesh;
    name?: string;
    hints?: BodyHints;
    bindSkin?: boolean;
    matchPose?: boolean;
    refineTissues?: boolean;
    softOnly?: boolean;
    autoRefine?: boolean;
    fitSetup?: AnatomyState['fitSetup'];
    onProgress?: (stage:string,fraction:number)=>void;
  }): Promise<{ confidence: number; yawCorrection: number; scaleCorrection: number; skinDrive: SkinDriveReport | null }> {
    if (this.fitting) throw Error(tr('Anatomy fitting is already running.'));
    const revision = ++this.fitRevision;
    const previousDrive = this.drive;
    const sourceMesh = target.mesh;
    const sameSource = sourceMesh && previousDrive?.targetMesh === sourceMesh;
    const checkCurrent = () => {
      if (revision !== this.fitRevision || this.disposed) throw Error(tr('Anatomy fitting cancelled.'));
    };
    const progress = (stage: string, fraction: number) => {
      this.fitting = { stage, fraction };
      target.onProgress?.(stage, fraction);
      this.editor.notify('activity');
    };
    const useWorker = async <T>(worker: Worker, start: () => void): Promise<T> => {
      try {
        checkCurrent();
        return await new Promise<T>((resolve, reject) => {
          this.cancelFitting = () => reject(Error(tr('Anatomy fitting cancelled.')));
          worker.onmessage = ({ data }) => {
            if (data.progress) progress(data.progress.stage, data.progress.fraction);
            else if (data.error) reject(Error(tr(data.error)));
            else resolve(data);
          };
          worker.onerror = event => reject(Error(event.message));
          start();
        });
      } finally {
        worker.terminate();
        this.cancelFitting = null;
      }
    };

    try {
      progress('Preparing body hints', 0);
      const source = sourceMesh && this.editor.entities.find(entity => entity.meshes.includes(sourceMesh));
      const hintModule = source ? await import('./integration/bodyHints') : undefined;
      checkCurrent();
      const restoreSource = sameSource ? previousDrive.prepareForFitting() : undefined;
      type FitResult = { analysis: HumanoidMeshAnalysis; parameters: AnatomyParameters; observation?: PoseObservation };
      let observation: Promise<FitResult>;
      try {
        if (sameSource) {
          const original = sourceMesh.getVerticesData('position');
          if (original) target = { ...target, positions: Float32Array.from(original) };
        }
        if (source && sourceMesh && hintModule) {
          const { collectBodyHints } = hintModule;
          let automatic = collectBodyHints(this.editor, source, sourceMesh);
          if (!Object.keys(automatic.landmarks ?? {}).length && !Object.keys(target.hints?.landmarks ?? {}).length && this.editor.rigger.canRig(source)) {
            this.editor.rigger.start(source);
            try {
              this.editor.rigger.findPose();
              automatic = collectBodyHints(this.editor, source, sourceMesh);
            } finally { this.editor.rigger.cancel(); }
          }
          target = { ...target, hints: { ...automatic, ...target.hints, forward: target.hints?.forward ?? automatic.forward,
            landmarks: { ...automatic.landmarks, ...target.hints?.landmarks } } };
        }
        const fittingWorker = new Worker(new URL('./inference/fitting.worker.ts', import.meta.url), { type: 'module' });
        observation = useWorker<FitResult>(fittingWorker, () => {
          const positions=new Float32Array(sourceMesh?.skeleton ? sourceMesh.getPositionData(true,true) ?? target.positions : target.positions);
          const sourceIndices=target.mesh?.getIndices(),indices=sourceIndices?new Uint32Array(sourceIndices):undefined;
          const cache=this.poseObservation;
          fittingWorker.postMessage({positions,indices,observation:target.softOnly&&cache?.mesh===target.mesh?cache?.observation:undefined,hints:{...target.hints,priorParameters:target.softOnly?structuredClone(this.parameters):{...structuredClone(this.parameters),surfaceFit:undefined,skinFit:undefined,tissueFit:undefined,referencePose:undefined}},softOnly:!!target.softOnly,autoRefine:!!target.autoRefine,refineTissues:!!target.refineTissues,matchPose:!!target.matchPose},indices?[positions.buffer,indices.buffer]:[positions.buffer]);
        });
        // The worker has its own source buffers. Keep the old deformed mesh visible
        // while it runs, including when the job is cancelled.
      } finally { restoreSource?.(); }
      const fit = await observation;
      checkCurrent();
      const { analysis, parameters } = fit;
      const wantsBinding = !!sourceMesh && target.bindSkin !== false;
      if (target.matchPose && !target.softOnly)
        parameters.referencePose ??= createReferencePose(parameters, { yaw: analysis.yawCorrection, scale: analysis.scaleCorrection,
          offset: analysis.offsetCorrection, forwardSign: analysis.forwardSign, zUp: analysis.zUp }, target.hints ?? {});
      const nextPose = normalizePose(target.matchPose && !target.softOnly ? {} : this.state.pose);
      const nextParameters = normalizeParameters({ ...this.parameters, ...parameters,
        skinOpacity: target.matchPose ? 1 : parameters.skinOpacity,
      });

      progress('Generating fitted anatomy', .87);
      checkCurrent();
      const geometryWorker = new Worker(new URL('./anatomy.worker.ts', import.meta.url), { type: 'module' });
      const layers = structures.filter(s => s.id !== 'skin' && nextParameters[s.opacity] > .001).map(s => s.id);
      const generated = await useWorker<AnatomyResult>(geometryWorker, () =>
        geometryWorker.postMessage({ id: 0, parameters: nextParameters, layers }));
      await this.ready();
      checkCurrent();

      let nextDrive: ImportedAnatomyController | null = null;
      let report: SkinDriveReport | null = null;
      let bindingError = '';
      if (wantsBinding) {
        progress('Binding external skin', .93);
        const { ImportedAnatomyController } = await import('./integration/importedAnatomyController');
        const { sourceFrameFromAnalysis, sourcePointToCanonical } = await import('./binding/anatomySkinDrive');
        checkCurrent();
        const restoreDisplay = sameSource ? previousDrive.prepareForFitting() : undefined;
        try {
          const skin = generated.meshes.skin[0];
          const frame = sourceFrameFromAnalysis({ yaw: analysis.yawCorrection, scale: analysis.scaleCorrection,
            offset: analysis.offsetCorrection, forwardSign: analysis.forwardSign, zUp: analysis.zUp });
          let posedAnalysis: Float32Array | undefined;
          if (target.matchPose) {
            const positions = sourceMesh.skeleton ? sourceMesh.getPositionData(true, true) ?? target.positions : target.positions;
            posedAnalysis = new Float32Array(positions.length);
            for (let i = 0; i < positions.length; i += 3)
              posedAnalysis.set(sourcePointToCanonical(frame, positions[i], positions[i + 1], positions[i + 2]), i);
          }
          const indices = sourceMesh.getIndices(), normals = sourceMesh.getVerticesData('normal');
          const candidate = new ImportedAnatomyController(this.editor);
          report = candidate.bind({
            mesh: sourceMesh, name: target.name ?? sourceMesh.name, positions: target.positions,
            analysisPositions: target.matchPose ? posedAnalysis : analysis.neutralPositions,
            inversePoseRotations: target.matchPose ? undefined : analysis.inversePoseRotations,
            indices: indices ? Uint32Array.from(indices) : undefined,
            normals: normals ? Float32Array.from(normals) : undefined,
          }, frame, { ...skin, positions: target.matchPose ? posedPositions(skin, nextParameters, nextPose) : skin.positions }, nextParameters.height);
          if (report.bound) nextDrive = candidate;
          else bindingError = report.reason;
        } catch (error) {
          bindingError = error instanceof Error ? error.message : String(error);
        } finally {
          restoreDisplay?.();
        }
        if (!nextDrive) {
          const reason = bindingError || tr('The imported skin could not be linked.');
          if (previousDrive) throw Error(tr('Skin binding failed. The previous fit was kept. {reason}', { reason }));
          report = { targetName: target.name ?? sourceMesh.name, bound: false, enabled: false, reason:
            tr('Skin binding failed. The fitted anatomy uses procedural skin. {reason}', { reason }),
            status: null, movedVertices: 0, maxDisplacementMm: 0, lastUpdateMs: 0 };
          nextParameters.skinOpacity = 1;
        } else if (target.matchPose) nextParameters.skinOpacity = 0;
      }
      checkCurrent();
      progress('Applying fitted anatomy', .99);
      checkCurrent();
      this.editor.commitEdits();
      const before = this.captureState(), beforeResult = this.result, wasA = this.showingA;
      const undoFit = this.captureFitHistory(before);
      this.editor.group(() => {
        this.drive = null;
        this.showingA = false;
        this.state.parameters = nextParameters;
        this.state.pose = nextPose;
        if (target.matchPose && !target.softOnly) this.state.poseBasis = undefined;
        this.state.fitEvidence = target.softOnly ? { ...this.state.fitEvidence, ...analysis.evidence } : analysis.evidence;
        if (target.fitSetup) this.state.fitSetup = target.fitSetup;
        if (this.state.fitSetup && target.hints)
          this.state.fitSetup.hints = { ...this.state.fitSetup.hints, landmarks: target.hints.landmarks,
            forward: target.hints.forward, tissues: target.hints.tissues, jointSource: target.hints.jointSource };
        try {
          for (const structure of structures) {
            if (before.parameters[structure.opacity] !== nextParameters[structure.opacity])
              this.materialFor(structure.id).alpha = nextParameters[structure.opacity];
          }
          this.apply(generated, nextParameters);
        } catch (error) {
          this.entity.anatomy = before;
          this.showingA = wasA;
          for (const [key, material] of this.materialCache) if (before.materials?.[key]) applyMaterial(material, before.materials[key]);
          try {
            if (beforeResult) this.apply(beforeResult, this.visibleParameters());
          } finally {
            this.drive = previousDrive;
          }
          throw error;
        }
        previousDrive?.detach(true);
        this.drive = nextDrive;
        this.driveInPose = !!target.matchPose;
        this.driveReport = nextDrive ? report : null;
        this.editor.record({ undo: undoFit, redo: this.captureFitHistory(this.captureState()) });
        if (target.matchPose && sourceMesh && (!target.softOnly || nextDrive)) {
          const inverseScale = 180 / nextParameters.height / analysis.scaleCorrection;
          const rotation = Matrix.RotationY(-analysis.yawCorrection);
          const [x, y, z] = analysis.offsetCorrection;
          const offset = Vector3.TransformCoordinates(
            new Vector3(x, y, z * analysis.forwardSign).scale(-1 / analysis.scaleCorrection), rotation);
          const matrix = Matrix.Scaling(inverseScale, inverseScale, inverseScale * analysis.forwardSign)
            .multiply(rotation).multiply(Matrix.Translation(offset.x, offset.y, offset.z))
            .multiply(analysis.zUp ? Matrix.RotationX(Math.PI / 2) : Matrix.IdentityReadOnly)
            .multiply(sourceMesh.computeWorldMatrix(true));
          this.editor.transformMany([this.entity], entity => {
            const position = entity.root.position.clone();
            matrix.decompose(entity.root.scaling, entity.root.rotationQuaternion ??= Quaternion.Identity(), entity.root.position);
            if (nextDrive) return;
            const reference = sourceMesh.getBoundingInfo().boundingBox;
            const lateral = Vector3.TransformNormal(Vector3.Right(), matrix).normalize();
            const extent = reference.maximumWorld.subtract(reference.minimumWorld);
            const separation = Math.max(.75, (Math.abs(lateral.x) * extent.x + Math.abs(lateral.z) * extent.z) * 1.1);
            if (Math.abs(Vector3.Dot(position.subtract(entity.root.position), lateral)) < separation * .85)
              entity.root.position.addInPlace(lateral.scale(separation));
            else entity.root.position.copyFrom(position);
          });
        }
      });
      if(fit.observation && sourceMesh) this.poseObservation = { mesh: sourceMesh, observation: fit.observation };
      progress('Fitting complete', 1);
      this.directPublish();
      return { confidence: analysis.confidence, yawCorrection: analysis.yawCorrection,
        scaleCorrection: analysis.scaleCorrection, skinDrive: report };
    } finally {
      this.fitting = null;
      this.editor.notify('activity');
    }
  }
  exportParameters() {
    const inverse = Matrix.Invert(this.entity.root.computeWorldMatrix(true));
    const eye = Vector3.TransformCoordinates(this.editor.camera.position, inverse);
    const target = Vector3.TransformCoordinates(this.editor.camera.target, inverse);
    const direction = eye.subtract(target);
    return { version: 7, parameters: structuredClone(this.parameters), pose: normalizePose(this.state.pose), poseBasis: this.state.poseBasis, settings: { anatomicalLinks: this.state.anatomicalLinks }, camera: {
      yaw: Math.atan2(direction.x, direction.z), pitch: Math.atan2(direction.y, Math.hypot(direction.x, direction.z)),
      distance: direction.length() * 10, target: target.scale(10).asArray(), frame: this.framing,
    } };
  }

  get inspectionLabels() {
    const annotations = !this.state.inspect || !this.result || !this.frontFacing ? [] : [
      { text: 'ASIS', point: this.result.inspection[0]?.at(-1) },
      { text: 'ASIS', point: this.result.inspection[2]?.at(-1) },
      { text: 'Pubic origin', point: this.result.inspection[4]?.[0] },
    ].filter((p): p is { text: string; point: number[] } => !!p.point).map(p => ({
      text: p.text,
      point: Vector3.TransformCoordinates(this.inspectionPoint(p.point), this.entity.root.getWorldMatrix()),
    }));
    if (this.selectedPoint && this.editor.selected === this.entity) annotations.push({ text: '', point: Vector3.TransformCoordinates(this.selectedPoint, this.entity.root.getWorldMatrix()) });
    return annotations;
  }

  private get frontFacing() {
    const direction = this.editor.camera.position.subtract(this.editor.camera.target);
    return Vector3.TransformNormal(direction, Matrix.Invert(this.entity.root.getWorldMatrix())).normalize().z > .1;
  }

  private inspectionPoint(point: number[]) {
    const positions = posedPositions({ positions: new Float32Array(point), normals: new Float32Array(3), indices: new Uint32Array() }, this.drawn, this.pose);
    return new Vector3(positions[0] * .1, positions[1] * this.drawn.height / 1750, positions[2] * .1);
  }

  private updateInspection() {
    for (const m of this.markers) { this.editor.helpers.delete(m); m.dispose(false, true); }
    this.markers = [];
    if (this.state.inspect && this.result) for (const [i, path] of this.result.inspection.entries()) {
      if (path.length < 2) continue;
      const points = path.map(p => this.inspectionPoint(p));
      const line = i % 2 ? CreateDashedLines('Anatomy inspection', { points, dashSize: 1, gapSize: 1, dashNb: 100 }, this.editor.scene) : CreateLines('Anatomy inspection', { points }, this.editor.scene);
      line.color = Color3.FromHexString(i % 2 ? '#b9a0d8' : '#e6be87');
      line.parent = this.entity.root; line.isPickable = false;
      line.renderingGroupId = 2;
      line.isVisible = !this.editor.cleanView;
      // The source shows projected insertion lines over opaque skin.
      if (line.material) { line.material.depthFunction = Constants.ALWAYS; line.material.disableDepthWrite = true; }
      this.editor.helpers.add(line); this.markers.push(line);
    }
    this.editor.invalidate();
  }

  view(view: string) {
    const yaw = { front: 0, side: Math.PI / 2, back: Math.PI, three: Math.PI / 5 }[view] ?? 0;
    const direction = Vector3.TransformNormal(new Vector3(Math.sin(yaw), .025, Math.cos(yaw)), this.entity.root.computeWorldMatrix(true)).normalize();
    this.editor.camera.setPosition(this.editor.camera.target.add(direction.scale(this.editor.camera.radius)));
    this.editor.invalidate();
  }
  frame(frame: string) {
    this.framing = frame;
    const portrait = this.editor.camera.getEngine().getAspectRatio(this.editor.camera) < 1;
    if (frame === 'body' && (portrait || Object.values(this.pose).some(value => value !== 0))) {
      this.editor.focus(this.entity);
      return;
    }
    const scale = this.parameters.height / 175;
    const y = frame === 'torso' ? 1.145 : frame === 'lower' ? .625 : .87;
    this.editor.camera.setTarget(Vector3.TransformCoordinates(new Vector3(0, y * scale, 0), this.entity.root.computeWorldMatrix(true)));
    this.editor.camera.radius = (frame === 'torso' ? 1.34 : frame === 'lower' ? 1.82 : 2.9) * scale * Math.max(...this.entity.root.scaling.asArray().map(Math.abs));
    this.editor.invalidate();
  }
  pick(point: Vector3, fat: boolean) {
    this.selectedPoint = Vector3.TransformCoordinates(point, Matrix.Invert(this.entity.root.getWorldMatrix()));
    const local = this.selectedPoint.scale(10);
    const y = local.y * 175 / this.drawn.height, x = Math.abs(local.x);
    this.region = fat ? 'fat' : x > 2.1 && y > 8 ? 'arms' : y < 9.3 ? x < .5 && y > 8.5 ? 'pelvis' : 'legs' : y < 10.45 ? 'pelvis' : y < 12.6 ? (local.z < -.2 ? 'back' : 'abdomen') : local.z < -.2 ? 'back' : 'chest';
    this.editor.notify('selection');
  }
  duplicate() {
    const copy = createShell(this.editor, this.captureState());
    copy.anatomyBody!.showingA = this.showingA;
    if (this.result) copy.anatomyBody!.apply(structuredClone(this.result), this.drawn);
    return copy;
  }
}

function createShell(editor: Editor, state?: Partial<AnatomyState>, opts: AddOptions = {}) {
  const container = new AssetContainer(editor.scene);
  const asset = { id: editor.nextAssetId++, name: tr('Anatomical body') };
  const entity = editor.spawnModel(container, asset.name, { container, asset, fitScale: 1, fitOffset: Vector3.Zero() }, asset, opts);
  new AnatomyBody(editor, entity, state);
  return entity;
}

export async function addAnatomyBody(editor: Editor, state?: Partial<AnatomyState>, opts: AddOptions = {}) {
  if (state?.parameters) normalizeParameters(state.parameters);
  if (state?.reference) normalizeParameters(state.reference);
  // Prepare privately so a failed worker cannot leave an empty object or undo entry.
  const entity = createShell(editor, state, { ...opts, publish: false });
  editor.pendingAnatomy.add(entity);
  entity.anatomyBody!.rebuild();
  try { await entity.anatomyBody!.ready(); }
  catch (error) { entity.root.dispose(false, true); entity.source?.container.dispose(); throw error; }
  finally { editor.pendingAnatomy.delete(entity); }
  if (opts.publish !== false) {
    editor.publishAnatomy(entity, opts);
    if (opts.record !== false) entity.anatomyBody!.view('front');
  }
  return entity;
}
