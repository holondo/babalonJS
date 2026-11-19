import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { anatomyPosePresets, axialPoseHandles, poseControls, type AxialPoseHandle, type AnatomyPoseKey } from '../../anatomy/pose';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { tissueHintLabels, type TissueHintName } from '../../anatomy/tissueFit';
import { JointOverlay } from '../jointOverlay';
import { BicepsFlexed, Bone, Droplet, PersonStanding, RotateCcw, Waypoints } from 'lucide';
import type { IconNode } from 'lucide';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { tr } from '../../core/i18n';
import { saveAndOfferShare, timestampedName } from '../../core/files';
import { defaults } from '../../anatomy/parameters';
import type { AnatomyKey, AnatomyParameters } from '../../anatomy/parameters';
import type { AnatomyBody } from '../../anatomy/body';
import { fittedNippleEditDefaults, type FittedNippleEdit } from '../../anatomy/surfaceFit';
import catalogue from '../../anatomy/catalogue';
import { button, chips, h, hint, iconButton, numberInput, row, section, segmented, select, slider, toggle, progressBar } from '../dom';
import { poseJointPicker, readyPoseSection } from '../poseControls';
import type { UI } from '../ui';
import { bodyIcon } from './anatomyPreview';
import { structures } from '../../anatomy/structures';
import { atlas, growthTarget } from '../../anatomy/atlas';
import type { AtlasEntry } from '../../anatomy/atlas';
import { muscleDefaults, boneDefaults, muscleRanges, boneRanges } from '../../anatomy/definition';
import { interactionDefaults } from '../../anatomy/definition';
import type { MuscleTemplate, MuscleId, BoneId, AnatomySide } from '../../anatomy/definition';
import { bodyLayout } from '../../anatomy/bodyLayout';
import type { BodyRegion, RegionPart, ControlGroup } from '../../anatomy/bodyLayout';

/** Anatomy uses the ordinary panel shell, controls and contextual taskbar. */
export class AnatomyPanel {
  private readonly ui: UI;
  private search = '';
  private mixFrom = 'reference';
  private mixTo = 'widehip';
  private mixAmount = .5;
  private components: Record<string, string> = { structure: 'balanced', muscle: 'balanced', adipose: 'balanced' };
  private variationSeed = 1781;
  private browsingAtlas = false;
  private atlasKind: 'muscles' | 'bones' | 'joints' = 'muscles';
  private atlasRegion = '';
  private atlasSearch = '';
  private atlasSelection = '';
  private individualMuscle: MuscleTemplate = 'rectus_abdominis';
  private individualSide: AnatomySide = 'L';
  private linkedIndividual = true;
  private fitHeightHint = false;
  private fitFatHint = false;
  private fitMuscleHint = false;
  private fitMode:'anatomy'|'skin'='anatomy';
  private fitRefineTissues=false;
  private fitProportions=false;
  private fitMeter:HTMLElement|null=null;
  private fitControls:HTMLFieldSetElement|null=null;
  private fitSurface: 'skin' | 'clothed' | 'unknown' = 'unknown';

  private poseHandle = '';
  private poseHandleGroup = 'limbs';

  constructor(ui: UI) { this.ui = ui; }
  private posePanel(body: AnatomyBody): Node[] {
    const reference = body.parameters.referencePose;
    const instructions = hint(tr('Tap a joint, then drag its rings to rotate it. Drag the point to move it.'));
    const handles = this.poseHandles(body);
    const active = handles.find(handle => handle.id === this.poseHandle);
    this.showPoseHandles(body, instructions, handles.filter(handle => handle.group === this.poseHandleGroup));
    const jointControl = (control: typeof poseControls[number]) => slider(tr(control.label), body.pose[control.key], {
      min: control.min, max: control.max, step: 1,
      format: value => 'unit' in control && control.unit === 'cm' ? `${value} cm` : `${value}°`,
      onCommit: () => this.ui.quiet(() => body.commit()),
    }, value => body.editPose(control.key, value));
    return [
      ...(reference ? [toggle(tr('Use reference pose'), reference.enabled, enabled => {
        body.patch({ referencePose: { ...reference, enabled } });
        this.refresh();
      })] : []),
      segmented([
        { id: 'limbs', label: tr('Arms and legs') },
        { id: 'axial', label: tr('Trunk and head') },
      ], this.poseHandleGroup, id => { this.poseHandleGroup = id; this.poseHandle = ''; this.refresh(); }),
      instructions,
      poseJointPicker(handles.filter(handle => handle.group === this.poseHandleGroup), active?.id ?? '',
        id => { this.poseHandle = id; this.refresh(); }),
      ...(active ? [section(active.label, ...poseControls.filter(control => active.matches(control.key)).map(jointControl),
        button(tr('Reset joint'), () => {
          body.setPose(Object.fromEntries(Object.entries(body.pose).filter(([key]) => !active.matches(key))));
          this.refresh();
        }))] : []),
      row(button(tr('Mirror pose'), () => { body.mirrorPose(); this.refresh(); }), button(tr('Reset pose'), () => { body.setPose({}); this.refresh(); })),
      row(button(tr('Center'), () => body.frame('body'))),
      readyPoseSection(anatomyPosePresets.map(preset => ({
        label: preset.label, apply: () => { body.setPose(preset.values); this.refresh(); },
      })), body.parameters.referencePose?.enabled ? hint(tr('Pose changes are relative to the fitted reference pose.')) : null)];
  }

  private poseHandles(body: AnatomyBody) {
    const labels = {
      arm: [['Left shoulder', 'Left elbow', 'Left wrist'], ['Right shoulder', 'Right elbow', 'Right wrist']],
      leg: [['Left hip', 'Left knee', 'Left ankle'], ['Right hip', 'Right knee', 'Right ankle']],
    };
    const axes = { arm: [['ArmFlexion', 'ArmTwist', 'ArmAbduction'], ['ElbowTilt', 'ElbowTurn', 'ElbowFlexion'], ['WristFlexion', 'WristTurn', 'WristTilt']],
      leg: [['HipFlexion', 'HipTurn', 'HipAbduction'], ['KneeFlexion', 'KneeTurn', 'KneeTilt'], ['AnkleFlexion', 'AnkleTurn', 'AnkleTilt']] };
    const parts = { arm: ['Arm', 'Elbow', 'Wrist'], leg: ['Hip', 'Knee', 'Ankle'] };
    const limbs = (['arm', 'leg'] as const).flatMap(limb => ([0, 1] as const).flatMap(side => ([0, 1, 2] as const).map(joint => {
      const prefix = side ? 'right' : 'left';
      return {
        id: `${limb}${side}-${joint}`, group: 'limbs',
        parent: joint > 0 ? `${limb}${side}-${joint - 1}` : undefined,
        label: tr(labels[limb][side][joint]),
        axes: axes[limb][joint].map(axis => prefix + axis) as AnatomyPoseKey[],
        directions: joint === 0 ? [-1, 1, side ? 1 : -1] : limb === 'arm' && joint === 1 ? [1, 1, side ? -1 : 1] : [1, 1, 1],
        matches: (key: string) => key.startsWith(prefix + parts[limb][joint])
          || (limb === 'arm' && joint === 0 && key.startsWith(prefix + 'Shoulder')),
        position: () => body.limbEndpointWorldPosition(limb, side, joint),
        move: (x: number, y: number, pose: AnatomyBody['pose']) => body.moveLimbEndpoint(limb, side, x, y, pose, joint),
      };
    })));
    const axialAxes = {
      pelvis: ['pelvisTilt', 'pelvisTurn', 'pelvisSideTilt'],
      lumbar: ['lumbarBend', 'lumbarTurn', 'lumbarSideBend'],
      thoracic: ['thoracicBend', 'thoracicTurn', 'thoracicSideBend'],
      trunk: ['trunkLean', 'trunkRotation', 'trunkSideBend'],
      neck: ['neckFlexion', 'neckTurn', 'neckTilt'],
      head: ['headFlexion', 'headTurn', 'headTilt'],
    } satisfies Record<AxialPoseHandle, AnatomyPoseKey[]>;
    return [...limbs, ...(Object.keys(axialPoseHandles) as AxialPoseHandle[]).map((handle, index, keys) => ({
      id: handle, group: 'axial', parent: keys[index - 1],
      label: tr(axialPoseHandles[handle].label),
      axes: axialAxes[handle],
      directions: [1, 1, handle === 'head' || handle === 'neck' ? 1 : -1],
      matches: (key: string) => key.startsWith(handle),
      position: () => body.axialHandleWorldPosition(handle),
      move: (x: number, y: number, pose: AnatomyBody['pose']) => body.moveAxialHandle(handle, x, y, pose),
    }))];
  }

  private showPoseHandles(body: AnatomyBody, anchor: HTMLElement, handles: ReturnType<AnatomyPanel['poseHandles']>) {
    queueMicrotask(() => {
      if (!anchor.isConnected) return;
      const editor = this.ui.editor;
      const overlay = new JointOverlay(editor);
      document.body.append(overlay.el);
      let drag: { pose: AnatomyBody['pose']; dx: number; dy: number } | undefined;
      overlay.set(handles.map(handle => ({ ...handle, cls: handle.id === this.poseHandle ? 'ik active' : 'ik' })), {
        onPick: id => { this.poseHandle = id; this.refresh(); },
        onDragStart: (id, x, y) => {
          const handle = handles.find(handle => handle.id === id);
          if (!handle) return;
          const point = editor.toScreen(handle.position());
          drag = { pose: body.pose, dx: point.x - x, dy: point.y - y };
        },
        onDrag: (id, x, y) => {
          const handle = handles.find(handle => handle.id === id);
          if (drag && handle) handle.move(x + drag.dx, y + drag.dy, drag.pose);
        },
        onDragEnd: id => {
          drag = undefined;
          this.poseHandle = id;
          this.ui.quiet(() => body.commit());
          this.refresh();
        },
        onDragCancel: () => {
          if (!drag) return;
          const { pose } = drag;
          drag = undefined;
          this.ui.quiet(() => body.cancelPoseDrag(pose));
          this.refresh();
        },
      });
      const active = handles.find(handle => handle.id === this.poseHandle);
      const pivot = active ? new TransformNode('anatomy pose pivot', editor.scene) : null;
      let ringStart: AnatomyBody['pose'] | undefined;
      const placePivot = () => {
        if (!active || !pivot || ringStart) return;
        pivot.position.copyFrom(active.position());
        body.entity.root.computeWorldMatrix(true).decompose(undefined, pivot.rotationQuaternion!);
      };
      if (active && pivot) {
        pivot.rotationQuaternion = Quaternion.Identity();
        placePivot();
        editor.setAnatomyRotation({
          entity: body.entity, node: pivot,
          begin: () => { ringStart = body.pose; },
          turn: (axis, degrees) => {
            const key = active.axes[axis];
            if (ringStart) body.editPose(key, ringStart[key] + degrees * active.directions[axis]);
          },
          end: () => {
            ringStart = undefined;
            this.ui.quiet(() => body.commit());
            this.refresh();
          },
        });
      }
      const observer = editor.scene.onAfterRenderObservable.add(() => { overlay.update(); placePivot(); });
      const cleanup = new MutationObserver(() => {
        if (anchor.isConnected) return;
        if (drag) this.ui.quiet(() => body.cancelPoseDrag(drag!.pose));
        if (pivot) {
          if (ringStart) this.ui.quiet(() => body.cancelPoseDrag(ringStart!));
          editor.clearAnatomyRotation(pivot);
          pivot.dispose();
        }
        overlay.el.remove();
        editor.scene.onAfterRenderObservable.remove(observer);
        cleanup.disconnect();
      });
      cleanup.observe(document.body, { childList: true, subtree: true });
    });
  }

  private get body() { return this.ui.editor.selected?.anatomyBody; }
  private refresh() { this.ui.renderPanel(); this.ui.renderSelbar(); }

  panel(part: string): Node[] {
    const body = this.body;
    if (!body) return [hint(tr('Select an anatomical body.'))];
    if (part === 'anatomy-pose') return this.posePanel(body);
    if(part==='anatomy-fit')return this.fittingPanel(body);
    if (part === 'anatomy' && this.browsingAtlas) return this.atlasPanel(body);
    const input = h('input', { class: 'name anatomy-search', type: 'search', value: this.search, placeholder: tr('Search anatomy controls…'), 'aria-label': tr('Search anatomy controls…') });
    const content = h('div', { class: 'stack' });
    const populate = () => {
      const query = this.search.trim().toLocaleLowerCase();
      if (query) {
        const nodes = catalogue.controls.filter(c => tr(c.label).toLocaleLowerCase().includes(query)).map(c => this.control(body, c));
        content.replaceChildren(...(nodes.length ? nodes : [hint(tr('No matching controls.'))]));
      } else content.replaceChildren(...(part === 'anatomy-layers' ? [this.layers(body)] : this.regionPanel(body)));
    };
    input.addEventListener('input', () => { this.search = input.value; populate(); });
    populate();
    const out: Node[] = [input, content];
    if (body.error) out.push(hint(body.error), button(tr('Try again'), () => body.rebuild()));
    return out;
  }

  private regionPart: RegionPart = 'shape';
  private muscleGroups: Partial<Record<BodyRegion, string>> = {};
  /** Region chips, then one level: the region's shape, muscles or bones. */
  private regionPanel(body: AnatomyBody): Node[] {
    const region = (body.region in bodyLayout ? body.region : 'overview') as BodyRegion, layout = bodyLayout[region];
    const regions = h('div', { class: 'anatomy-regions' }, chips((Object.keys(bodyLayout) as BodyRegion[]).map(value => ({ value, label: tr(bodyLayout[value].label) })), region, value => { body.region = value; this.refresh(); }));
    // The active region may sit beyond the scrolled row, e.g. after tapping the body. Scroll only the row:
    // scrollIntoView would also scroll the panel back up on every re-render.
    requestAnimationFrame(() => {
      const row = regions.firstElementChild as HTMLElement | null, chip = row?.querySelector<HTMLElement>('.chip.active');
      if (row && chip && (chip.offsetLeft < row.scrollLeft || chip.offsetLeft + chip.offsetWidth > row.scrollLeft + row.clientWidth)) row.scrollLeft = chip.offsetLeft - 8;
    });
    if (region === 'overview') return [regions, ...this.overview(body)];
    const parts = ([['shape', 'Shape'], ['muscles', 'Muscles'], ['bones', 'Bones']] as const)
      .filter(([id]) => id === 'shape' ? layout.shape.length : id === 'muscles' ? layout.muscles.length : layout.bones.length || layout.hipBone)
      .map(([id, label]) => ({ id, label: tr(label) }));
    if (!parts.some(p => p.id === this.regionPart)) this.regionPart = parts[0].id;
    const nodes: Node[] = [regions];
    if (parts.length > 1) nodes.push(segmented(parts, this.regionPart, id => { this.regionPart = id as RegionPart; this.refresh(); }));
    if (this.regionPart === 'shape') {
      if (region === 'fat') nodes.push(section(tr('Fat brush'),
        select(tr('Fat brush mode'), [
          { value: '', label: tr('Off') }, { value: 'add', label: tr('Add fat') },
          { value: 'remove', label: tr('Remove fat') }, { value: 'smooth', label: tr('Smooth fat') },
        ], body.fatBrush, value => {
          body.fatBrush = value as typeof body.fatBrush;
          if (value) { body.editNavelDepth = false; body.editNippleProjection = false; }
        }),
        slider(tr('Fat brush radius'), body.fatBrushRadius, { min: 25, max: 90, step: 5, format: v => v + ' mm' }, v => { body.fatBrushRadius = v; }),
        slider(tr('Fat brush strength'), body.fatBrushStrength, { min: 1, max: 8, step: 1, format: v => v + ' mm' }, v => { body.fatBrushStrength = v; }),
        hint(tr('Paint on visible skin. Each stroke updates the body when released.'))));
      nodes.push(...this.groups(body, layout.shape));
    }
    else if (this.regionPart === 'bones') nodes.push(...(layout.hipBone ? [select(tr('Pelvis'), [{ value: '1', label: tr('Measured from the écorché') }, { value: '0', label: tr('Legacy primitives') }], String(body.parameters.pelvisModel), value => { body.edit('pelvisModel', +value); body.commit(); })] : []),
      ...this.groups(body, layout.bones), ...(layout.hipBone ? [this.individualPanel(body, null)] : []));
    else {
      const id = layout.muscles.some(m => m.id === this.muscleGroups[region]) ? this.muscleGroups[region]! : layout.muscles[0].id, muscle = layout.muscles.find(m => m.id === id)!;
      if (region === 'abdomen') nodes.push(select(tr('Abdominal wall'), [{ value: '2', label: tr('Original version') }, { value: '1', label: tr('Current version') }, { value: '0', label: tr('Legacy sheets') }], String(body.parameters.abdominalModel), value => { body.edit('abdominalModel', +value); body.commit(); }));
      if (layout.muscles.length > 1) nodes.push(chips(layout.muscles.map(m => ({ value: m.id, label: tr(m.label) })), id, value => { this.muscleGroups[region] = value; this.refresh(); }));
      if (muscle.keys.length) nodes.push(section(tr('Both sides'), ...muscle.keys.map(key => this.control(body, catalogue.controls.find(c => c.key === key)!))));
      // Hypertrophy: chronic growth of each part, both sides. Genetics: inherited shape, per side.
      if (muscle.growth) nodes.push(section(tr('Hypertrophy'), ...muscle.growth.map(part => slider(tr(part.label), body.parameters.individualGrowth?.[part.key] ?? 1,
        { min: .3, max: 3, step: .05, format: v => `${v.toFixed(2)}×`, onCommit: () => this.ui.quiet(() => body.commit()) }, next => body.setGrowth(part.key, next)))));
      if (muscle.individual) nodes.push(this.individualPanel(body, muscle.individual));
    }
    return nodes;
  }

  private groups(body: AnatomyBody, groups: ControlGroup[]): Node[] {
    return groups.map(group => {
      const controls: Node[] = group.keys.map(key => this.control(body, catalogue.controls.find(c => c.key === key)!));
      if (group.inguinalPresets) controls.unshift(hint(tr('Geometric opening {angle}° · current height {height} cm', { angle: body.inguinalMetrics.angle.toFixed(0), height: body.inguinalMetrics.height.toFixed(1) })),
        chips(Object.entries(catalogue.inguinalPresets).map(([value, p]) => ({ value, label: tr(p.label) })), '', value => {
          const preset = catalogue.inguinalPresets[value];
          body.patch(Object.fromEntries(catalogue.inguinalPresetFields.map(key => [key, preset[key] ?? defaults[key]])));
        }));
      return group.label ? section(tr(group.label), ...controls) : h('div', { class: 'stack' }, ...controls);
    });
  }

  /** Whole-body choices, tissue connections and tools live here instead of in every region. */
  private overview(body: AnatomyBody): Node[] {
    const collapse = (node: HTMLElement, label: string) => h('details', { class: 'sec' }, h('summary', {}, label), ...Array.from(node.childNodes).slice(1));
    // Skin source and fitting live on the Skin page; quick layer switches live in the context bubble.
    return [...this.groups(body, bodyLayout.overview.shape),
      ...this.profiles(body).map(node => node instanceof HTMLElement && node.tagName === 'SECTION' ? collapse(node, node.firstElementChild?.textContent ?? tr('Body profiles')) : node),
      this.connections(body),
      h('details', { class: 'sec' }, h('summary', {}, tr('Layers')), this.layers(body)),
      collapse(this.views(body), tr('Inspection and views')),
      collapse(this.actions(body), tr('Parameters and comparison')),
      button(tr('Anatomical atlas'), () => { this.browsingAtlas = true; this.refresh(); })];
  }

  private connections(body: AnatomyBody): HTMLElement {
    const interaction = body.parameters.definition?.interaction ?? interactionDefaults;
    return h('details', { class: 'sec', 'data-anatomy-connections': '' }, h('summary', {}, tr('Tissue connections')),
      toggle(tr('Skin follows muscles'), !!interaction.skinFollows, value => { body.setTissueInteraction({ skinFollows: value }); this.refresh(); }),
      hint(tr('On: muscles keep their full volume and push the fat and skin outward. Off: the base skin shape limits the muscles beneath it.')),
      toggle(tr('Anatomical attachments'), interaction.attachments, value => { body.setTissueInteraction({ attachments: value }); this.refresh(); }),
      hint(tr('Attachments use areas of the generated bones. Their locations are procedural references, not measured anatomy.')),
      toggle(tr('Tissue contact'), interaction.contact, value => { body.setTissueInteraction({ contact: value, ...(value ? { attachments: true } : {}) }); this.refresh(); }),
      ...(interaction.attachments ? [select(tr('Attachment surface detail'), [{ value: '1', label: tr('Standard') }, { value: '2', label: tr('Fine') }], String(interaction.supportDetail), next => { body.setTissueInteraction({ supportDetail: +next as 1 | 2 }); this.refresh(); })] : []),
      ...(interaction.contact ? [slider(tr('Tissue clearance'), interaction.clearanceMm, { min: 0, max: 3, step: .25, format: value => `${value.toFixed(2)} mm`, onCommit: () => this.ui.quiet(() => body.commit()) }, value => body.setTissueInteraction({ clearanceMm: value }, false)), hint(tr('Contact separates sampled torso surfaces and preserves attachment ends. It is not a full-body physics simulation.')), hint(tr('Tissue contact updates after releasing a pose slider.'))] : []),
      ...(body.attachmentMetrics.length ? [hint(tr('Attachment areas: {count} · maximum error: {error} mm', { count: body.attachmentMetrics.length, error: Math.max(...body.attachmentMetrics.map(metric => metric.errorMm)).toFixed(2) }))] : []),
      ...(body.contactMetrics.length ? [hint(tr('Contact samples: {count} · clearance shortfall: {error} mm', { count: body.contactMetrics.reduce((sum, metric) => sum + metric.samples, 0), error: Math.max(...body.contactMetrics.map(metric => metric.afterMm)).toFixed(2) }))] : []));
  }

  private selectedIntersection = 0;
  /** Per-side controls for one structure; `templates` null edits the hip bone. */
  private individualPanel(body: AnatomyBody, templates: readonly { template: MuscleTemplate; label: string }[] | null): HTMLElement {
    const bones = !templates;
    if (templates && !templates.some(o => o.template === this.individualMuscle)) this.individualMuscle = templates[0].template;
    const id = `${bones ? 'hip_bone' : this.individualMuscle}.${this.individualSide}` as BoneId | MuscleId;
    const values = bones ? body.parameters.definition?.bones[id as BoneId] ?? boneDefaults : body.parameters.definition?.muscles[id as MuscleId] ?? muscleDefaults;
    const ranges = bones ? boneRanges : muscleRanges;
    const labels: Record<string, string> = { width: 'Individual width', depth: 'Individual depth', volume: 'Individual muscle volume', fullness: 'Fullness position', profile: 'Reference profile influence', activation: 'Muscle activation', balance: 'Sternal and costal balance', height: 'Individual height', flare: 'Iliac wing flare', acetabularAngle: 'Acetabular orientation', centerlineBend: 'Belly curvature (cm)', peakOffset: 'Belly peak offset' };
    const metric = body.anatomyMetrics.find(item => item.id === id);
    const fields = Object.keys(ranges).filter(key => (key !== 'balance' || this.individualMuscle === 'pectoralis_major_sternocostal') && (key !== 'centerlineBend' || this.individualMuscle !== 'rectus_abdominis'));
    const layer = bones ? 'bonesOpacity' : ({ rectus_abdominis: 'rectusAbdominisOpacity', external_oblique: 'externalObliqueOpacity', internal_oblique: 'internalObliqueOpacity', transversus_abdominis: 'transversusAbdominisOpacity' } as Record<string, AnatomyKey>)[this.individualMuscle] ?? 'otherMusclesOpacity';
    return h('details', { class: 'sec', open: true, 'data-individual-anatomy': id }, h('summary', {}, tr(bones ? 'Hip bone, per side' : 'Genetics, per side')),
      ...(templates && templates.length > 1 ? [segmented(templates.map(o => ({ id: o.template, label: tr(o.label) })), this.individualMuscle, value => { this.individualMuscle = value as MuscleTemplate; this.refresh(); })] : []),
      segmented([{ id: 'L', label: tr('Left') }, { id: 'R', label: tr('Right') }], this.individualSide, value => { this.individualSide = value as AnatomySide; this.refresh(); }),
      toggle(tr('Link both sides'), this.linkedIndividual, value => { this.linkedIndividual = value; }),
      ...fields.map(key => {
        const range = ranges[key as keyof typeof ranges] as readonly [number, number];
        const value = (values as unknown as Record<string, number>)[key];
        return slider(tr(labels[key]), value, { min: range[0], max: range[1], step: key === 'acetabularAngle' ? 1 : .05, onCommit: () => this.ui.quiet(() => body.commit()) }, next => body.editIndividual(id, key, next, this.linkedIndividual));
      }),
      ...(metric ? [hint(tr('Model volume: {actual} cm³ · target: {target} cm³', { actual: metric.actualCm3.toFixed(1), target: metric.targetCm3.toFixed(1) }))] : []),
      ...(!bones?[this.envelopeControls(body,id as MuscleId)]:[]),
      ...(id.startsWith('rectus_abdominis.') ? this.intersectionControls(body, id as MuscleId) : []),
      hint(tr('Individual ratios build on the current body. Reference profiles are illustrative, not measured section shapes.')),
      row(button(tr('Show internal structure'), () => { body.patch({ skinOpacity: .15, [layer]: 1 }); this.refresh(); }),
        button(tr('Reset this structure'), () => { body.resetIndividual(id, this.linkedIndividual); this.refresh(); })),
    );
  }

  private envelopeControls(body:AnatomyBody,id:MuscleId){
    const content=h('div'),details=h('details',{class:'sec'},h('summary',{},tr('Local muscle profile')),content);
    details.addEventListener('toggle',()=>{if(!details.open)return;content.replaceChildren(
      hint(tr('Edit width and depth in five sections from origin to insertion. The attachment borders stay fixed.')),
      ...(body.parameters.abdominalModel === 1 && id.startsWith('rectus_abdominis.')
        ? Array.from({length:5}, (_, i) => slider(tr('Abdominal height station {section}', {section:i+1}),
          body.parameters.definition?.muscles[id]?.fittedWidthProfile?.[i] ?? 1,
          {min:.75,max:2,step:.01,format:value=>value.toFixed(2)+'×',onCommit:()=>body.commit()}, value=>{
            const profile = body.parameters.definition?.muscles[id]?.fittedWidthProfile?.slice() ?? new Array(5).fill(1);
            profile[i] = value;
            body.editIndividual(id,'fittedWidthProfile',profile,this.linkedIndividual);
          })) : []),
      ...Array.from({length:5},(_,i)=>slider(tr('Section {section} width',{section:i+1}),body.parameters.definition?.muscles[id]?.widthProfile?.[i]??1,{min:.65,max:1.8,step:.05,format:v=>v.toFixed(2)+'×',onCommit:()=>body.commit()},value=>{
        const profile=body.parameters.definition?.muscles[id]?.widthProfile?.slice()??new Array(5).fill(1);
        profile[i]=value;body.editIndividual(id,'widthProfile',profile,this.linkedIndividual);
      })),
      ...Array.from({length:15},(_,i)=>slider(tr('Section {section}, column {column}',{section:Math.floor(i/3)+1,column:i%3+1}),body.parameters.definition?.muscles[id]?.depthProfile?.[i]??1,{min:.35,max:20,step:.05,format:v=>v.toFixed(2)+'×',onCommit:()=>body.commit()},value=>{const profile=body.parameters.definition?.muscles[id]?.depthProfile?.slice()??new Array(15).fill(1);profile[i]=value;body.editIndividual(id,'depthProfile',profile,this.linkedIndividual);})),
      button(tr('Reset local profile'),()=>{body.editIndividual(id,'depthProfile',undefined,this.linkedIndividual);body.editIndividual(id,'widthProfile',undefined,this.linkedIndividual);if(id.startsWith('rectus_abdominis.'))body.editIndividual(id,'fittedWidthProfile',undefined,this.linkedIndividual);body.commit();details.open=false;})
    );});return details;
  }

  private intersectionControls(body: AnatomyBody, id: MuscleId): Node[] {
    const shape = body.parameters.definition?.muscles[id];
    const items = shape?.intersections ?? (body.parameters.abdominalModel === 1 ? shape?.fittedIntersections : undefined);
    const commit = (next: unknown) => { body.editIndividual(id, 'intersections', next, this.linkedIndividual); body.commit(); this.refresh(); };
    if (!items) return [button(tr('Customize tendon intersections'), () => commit([.75, .6, .45].map(position => ({ position, angle: 0, curvature: 0, width: 1, depth: .55, extent: 1 }))))];
    this.selectedIntersection = Math.min(this.selectedIntersection, Math.max(0, items.length - 1));
    const index = this.selectedIntersection, item = items[index];
    const fields = [{ key: 'position', label: 'Intersection height', min: .08, max: .92, step: .01 }, { key: 'angle', label: 'Intersection angle', min: -20, max: 20, step: 1 }, { key: 'curvature', label: 'Intersection curvature', min: -.1, max: .1, step: .01 }, { key: 'width', label: 'Intersection width', min: .4, max: 1.6, step: .05 }, { key: 'depth', label: 'Intersection depth', min: 0, max: 1, step: .05 }, { key: 'extent', label: 'Intersection extent', min: .3, max: 1, step: .05 }] as const;
    return [hint(tr('Tendon intersections')),
      ...(items.length ? [select(tr('Intersection'), items.map((_, i) => ({ value: String(i), label: tr('Intersection {index}', { index: i + 1 }) })), String(index), next => { this.selectedIntersection = +next; this.refresh(); })] : []),
      ...fields.flatMap(field => item ? [slider(tr(field.label), item[field.key], { min: field.min, max: field.max, step: field.step, onCommit: () => { body.commit(); this.refresh(); } }, next => { const updated = structuredClone(items); updated[index][field.key] = next; body.editIndividual(id, 'intersections', updated, this.linkedIndividual); })] : []),
      row(...(items.length < 5 ? [button(tr('Add intersection'), () => commit([...items, { position: .15, angle: 0, curvature: 0, width: 1, depth: .55, extent: 1 }]))] : []), ...(item ? [button(tr('Remove intersection'), () => commit(items.filter((_, i) => i !== index)))] : [])),
      button(tr('Use global segmentation'), () => {
        body.editIndividual(id, 'fittedIntersections', undefined, this.linkedIndividual);
        commit(undefined);
      })];
  }

  private atlasPanel(body: AnatomyBody): Node[] {
    const content = h('div'), detail = h('div');
    const search = h('input', { class: 'name anatomy-search', type: 'search', value: this.atlasSearch, placeholder: tr('Search anatomical structures…'), 'aria-label': tr('Search anatomical structures…') });
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
    const populate = () => {
      const query = normalize(this.atlasSearch);
      const entries = atlas[this.atlasKind].filter(entry => (!this.atlasRegion || entry.region === this.atlasRegion) && normalize(`${tr(entry.name)} ${entry.name} ${entry.id}`).includes(query));
      if (!entries.some(entry => entry.id === this.atlasSelection)) this.atlasSelection = entries[0]?.id ?? '';
      const choose = (entry: AtlasEntry) => { this.atlasSelection = entry.id; populate(); };
      content.replaceChildren(hint(tr('{count} anatomical records', { count: entries.length })),
        select(tr('Structure'), entries.map(entry => ({ value: entry.id, label: tr(entry.name) })), this.atlasSelection, value => { const entry = entries.find(entry => entry.id === value); if (entry) choose(entry); }));
      const entry = entries.find(entry => entry.id === this.atlasSelection);
      if (!entry) { detail.replaceChildren(hint(tr('No matching controls.'))); return; }
      const target = this.atlasKind === 'muscles' ? growthTarget(entry) : null;
      const nodes: Node[] = [section(tr(entry.name), hint(entry.id),
        ...(entry.architecture ? [hint(tr('Architecture: {value}', { value: tr(entry.architecture) }))] : []),
        ...(entry.origin?.length ? [section(tr('Origin'), hint(entry.origin.join(' · ')))] : []),
        ...(entry.insertion?.length ? [section(tr('Insertion'), hint(entry.insertion.join(' · ')))] : []),
        ...(entry.landmarks?.length ? [section(tr('Landmarks'), hint(entry.landmarks.join(' · ')))] : []))];
      if (entry.joints?.length) nodes.push(section(tr('Joints'), hint(entry.joints.join(' · '))));
      if (entry.profile?.length) {
        const samples = entry.profile.filter(Number.isFinite);
        if (samples.length > 1) {
          const plot = h('div', { role: 'img', 'aria-label': tr('Normalized muscle section profile') });
          const points = samples.map((value, i) => `${12 + i / (samples.length - 1) * 256},${58 - Math.max(0, Math.min(1, value)) * 46}`).join(' ');
          plot.innerHTML = `<svg viewBox="0 0 280 70" width="100%" height="70" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
          nodes.push(section(tr('Normalized section profile'), plot));
        }
      }
      if (typeof entry.volume_cm3 === 'number' && Number.isFinite(entry.volume_cm3)) nodes.push(hint(tr('Reference volume (unverified): {value} cm³', { value: entry.volume_cm3.toFixed(1) })));
      else if (typeof entry.seed_cm3 === 'number' && Number.isFinite(entry.seed_cm3)) nodes.push(hint(tr('Illustrative volume: {value} cm³', { value: entry.seed_cm3.toFixed(1) })));
      if (target) {
        const value = body.parameters.individualGrowth?.[target.key] ?? 1;
        nodes.push(hint(target.aggregate ? tr('This control affects a shared procedural muscle group, not each listed muscle independently.') : tr('Local growth affects the represented procedural muscle on both sides.')),
          slider(tr('Local muscle growth'), value, { min: .3, max: 3, step: .05, format: v => `${v.toFixed(2)}×`, onCommit: () => this.ui.quiet(() => body.commit()) }, next => body.setGrowth(target.key, next)),
          button(tr('Reset local growth'), () => { body.setGrowth(target.key, 1, true); this.refresh(); }),
          button(tr('Show muscles'), () => { body.patch({ skinOpacity: 0, otherMusclesOpacity: 1, rectusAbdominisOpacity: 1 }); }));
      } else {
        nodes.push(hint(tr('Reference record only: this structure has no individual geometry control in this version.')));
        if (this.atlasKind === 'bones') nodes.push(button(tr('Bones'), () => body.patch({ skinOpacity: 0, bonesOpacity: 1 })));
        if (this.atlasKind === 'joints') nodes.push(button(tr('Pose'), () => this.ui.openPart('objects', 'anatomy-pose')));
      }
      nodes.push(hint(tr('Atlas profiles and volumes are prototype references. They are not validated measurements for this body.')));
      detail.replaceChildren(...nodes);
    };
    search.addEventListener('input', () => { this.atlasSearch = search.value; populate(); });
    const regions = [...new Set(atlas[this.atlasKind].map(entry => entry.region).filter((value): value is string => !!value))];
    populate();
    return [button(tr('Back to body controls'), () => { this.browsingAtlas = false; this.refresh(); }),
      chips([{ value: 'muscles', label: tr('Muscles') }, { value: 'bones', label: tr('Bones') }, { value: 'joints', label: tr('Joints') }], this.atlasKind, value => { this.atlasKind = value as typeof this.atlasKind; this.atlasRegion = ''; this.refresh(); }), search,
      select(tr('Region'), [{ value: '', label: tr('All regions') }, ...regions.map(value => ({ value, label: tr(value.replace(/_/g, ' ')) }))], this.atlasRegion, value => { this.atlasRegion = value; populate(); }), content, detail];
  }

  private control(body: AnatomyBody, c: typeof catalogue.controls[number]) {
    const key = c.key as AnatomyKey, factor = c.unitLabel === '%' ? 100 : 1;
    const unit = c.unitLabel;
    const format = (v: number) => `${Number((v * factor).toFixed(c.step < .01 ? 3 : 2))}${unit === '%' || unit === '°' ? unit : unit ? ` ${unit}` : ''}`;
    const value = body.parameters[key];
    const wrap = h('div', { class: 'anatomy-control', 'data-anatomy-key': key },
      slider(tr(c.label), value, { min: c.min, max: c.max, step: c.step, format, onCommit: () => this.ui.quiet(() => body.commit()) }, v => body.edit(key, v)),
      row(numberInput(tr(c.label), value * factor, { step: c.step * factor, suffix: unit }, v => { body.edit(key, v / factor); body.commit(); }),
        iconButton(RotateCcw, tr('Reset'), () => { body.edit(key, defaults[key]); body.commit(); }, { cls: 'mini' })),
    );
    return wrap;
  }

  private profiles(body: AnatomyBody): Node[] {
    const presets = Object.entries(catalogue.bodyPresets).map(([value, p]) => ({ value, label: tr(p.label) }));
    const gallery = h('div', { class: 'grid anatomy-gallery' }, ...Object.entries(catalogue.bodyPresets).map(([, preset]) => {
      const preview = h('span', { class: 'anatomy-preview', 'aria-label': tr('Front and side silhouettes'), role: 'img' });
      preview.innerHTML = bodyIcon(preset.values);
      const keys = catalogue.controls.filter(c => c.kind === 'geometry' && (!catalogue.inguinalPresetFields.includes(c.key) || c.key === 'pubicFat')).map(c => c.key);
      const active = keys.every(key => Math.abs(body.parameters[key] - (preset.values[key] ?? defaults[key])) < .000001);
      return h('button', { class: `card anatomy-profile ${active ? 'active' : ''}`, 'aria-pressed': active, onClick: () => body.profile(preset.values) }, preview, h('span', {}, tr(preset.label)));
    }));
    const componentControls = Object.entries(catalogue.profileComponents).map(([group, items]) => select(tr(({ structure: 'Structure', muscle: 'Muscles', adipose: 'Fat distribution' }[group] ?? group)), Object.entries(items).map(([value, p]) => ({ value, label: tr(p.label) })), this.components[group], value => { this.components[group] = value; }));
    const compose = () => body.profile(Object.assign({}, ...Object.entries(this.components).map(([group, name]) => catalogue.profileComponents[group][name].values)));
    const mix = (commit = true) => {
      const a = { ...defaults, ...catalogue.bodyPresets[this.mixFrom].values }, b = { ...defaults, ...catalogue.bodyPresets[this.mixTo].values };
      const values: Partial<AnatomyParameters> = {};
      for (const c of catalogue.controls) if (c.kind === 'geometry' && (!catalogue.inguinalPresetFields.includes(c.key) || c.key === 'pubicFat')) values[c.key as AnatomyKey] = a[c.key] + (b[c.key] - a[c.key]) * this.mixAmount;
      body.profile(values, commit);
    };
    return [
      section(tr('Body profiles'), gallery,
        toggle(tr('Linked anatomical adjustments'), body.state.anatomicalLinks, value => body.change(() => { body.state.anatomicalLinks = value; })),
        button(tr('Nearby variation'), () => this.vary(body))),
      section(tr('Compose a body'), ...componentControls, button(tr('Apply combination'), compose)),
      section(tr('Mix profiles'), select(tr('Profile A'), presets, this.mixFrom, value => { this.mixFrom = value; }),
        select(tr('Profile B'), presets, this.mixTo, value => { this.mixTo = value; }),
        slider(tr('Mix'), this.mixAmount, { min: 0, max: 1, step: .01, format: v => `${Math.round(v * 100)}%`, onCommit: () => body.commit() }, value => { this.mixAmount = value; mix(false); }),
        button(tr('Apply mix'), () => mix())),
      hint(tr('Chest: {width} / {depth} cm · pelvis: {hipWidth} / {hipDepth} cm', { width: body.parameters.chestWidth, depth: body.parameters.chestDepth, hipWidth: body.parameters.pelvisWidth, hipDepth: body.parameters.pelvisDepth })),
    ];
  }

  private vary(body: AnatomyBody) {
    let seed = ++this.variationSeed;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 - .5; };
    const p = { ...body.parameters }, upper = random() * .05, lower = random() * .05;
    for (const key of ['chestWidth','chestDepth','shoulderWidth'] as AnatomyKey[]) p[key] *= 1 + upper;
    for (const key of ['pelvisWidth','pelvisDepth','asisDistance','thighGirth'] as AnatomyKey[]) p[key] *= 1 + lower;
    p.height += random() * 4;
    for (const key of Object.keys(catalogue.shapeRegions) as AnatomyKey[]) p[key] = Math.max(-1, Math.min(1, p[key] + random() * .18));
    for (const key of ['pectoral','deltoid','biceps','triceps','quadriceps','gluteMax','hamstrings','calves'] as AnatomyKey[]) p[key] *= 1 + random() * .08;
    body.profile(p);
  }

  private layers(body: AnatomyBody) {
    const preset = (value: string) => body.patch(Object.fromEntries(structures.map(s => [s.opacity,
      value === 'surface' ? Number(s.id === 'skin') : value === 'overlay' ? s.id === 'skin' ? .16 : s.id === 'adipose' ? .15 : .8 : Number(s.group === value)
    ])));
    const groups = [...new Set(structures.map(s => s.group))];
    return h('div', {},
      section(tr('Show anatomical structures'), chips([{ value: 'surface', label: tr('Surface') }, { value: 'overlay', label: tr('Overlay') }, { value: 'Muscles', label: tr('Muscles') }, { value: 'Bones', label: tr('Bones') }, { value: 'Fat', label: tr('Fat') }], '', preset)),
      ...groups.map(group => h('details', { class: 'sec', open: group === (structures.find(s => s.id === body.activeStructure)?.group ?? 'Skin') }, h('summary', {}, tr(group)),
        ...structures.filter(s => s.group === group).map(s => section(tr(s.label),
          toggle(tr('Visible'), body.parameters[s.opacity] > .001, value => body.patch({ [s.opacity]: value ? 1 : 0 })),
          row(button(tr('Isolate'), () => body.patch(Object.fromEntries(structures.map(other => [other.opacity, Number(other.id === s.id)]))), { cls: 'small' }),
            button(tr('Material'), () => { body.selectStructure(s.id); this.ui.openPart('objects', 'material'); }, { cls: 'small' })),
          this.control(body, catalogue.controls.find(c => c.key === s.opacity)!),
        )),
      )),
      hint(tr('Fat is an approximate subcutaneous envelope. It is separate from skin and muscles.')),
    );
  }

  lighting(body: AnatomyBody) {
    const apply = (value: string) => {
      const values = ({ studio: [-40,40,1.15,.55,.28,1], raking: [-78,25,1.5,.2,.2,1], soft: [-25,50,.85,.9,.15,1.1] }[value] ?? [-40,40,1.15,.55,.28,1]);
      body.patch(Object.fromEntries(['azimuth','elevation','intensity','fill','rim','exposure'].map((key, i) => [key, values[i]])));
    };
    return section(tr('Body study illumination'),
      hint(tr('Materials use the scene lighting. Optional study lights illuminate only the selected body.')),
      toggle(tr('Add study illumination'), !!body.state.studyLighting, value => body.change(() => { body.state.studyLighting = value; })),
      ...(body.state.studyLighting ? [chips([{ value: 'studio', label: tr('Studio') }, { value: 'raking', label: tr('Raking light') }, { value: 'soft', label: tr('Soft') }], '', apply),
        ...catalogue.controls.filter(c => c.kind === 'light').map(c => this.control(body, c)), button(tr('Reset lighting'), () => apply('studio'))] : []),
    );
  }

  materialDetails(body: AnatomyBody) {
    const key = body.activeStructure;
    const keys = key === 'skin' ? ['skinTone', 'shine', 'texture'] : structures.find(s => s.id === key)?.group === 'Muscles' ? ['fiberAngle'] : [];
    return h('details', { class: 'sec' }, h('summary', {}, tr('Anatomical surface details')),
      toggle(tr('Procedural anatomical detail'), body.state.details?.[key] !== false, enabled => body.change(() => { (body.state.details ??= {})[key] = enabled; })),
      ...(structures.find(s => s.id === key)?.group === 'Muscles' ? [toggle(tr('Fiber striations'), body.state.details?.striations !== false, enabled => body.change(() => { (body.state.details ??= {}).striations = enabled; }))] : []),
      ...keys.map(key => this.control(body, catalogue.controls.find(c => c.key === key)!)),
    );
  }

  private views(body: AnatomyBody) {
    return section(tr('Inspection and views'),
      toggle(tr('Inspect insertions and borders'), !!body.state.inspect, value => body.inspect(value)),
      toggle(tr('Automatic rotation'), body.spinning, value => { body.spinning = value; this.ui.editor.invalidate(); }),
      toggle(tr('Reference grid'), this.ui.editor.env.grid, value => this.ui.editor.applyEnv({ grid: value })),
      chips([{value:'front',label:tr('Front')},{value:'side',label:tr('Side')},{value:'back',label:tr('Back')},{value:'three',label:'¾'}], '', value => body.view(value)),
      chips([{value:'body',label:tr('Whole body')},{value:'torso',label:tr('Torso')},{value:'lower',label:tr('Pelvis and legs')}], '', value => body.frame(value)),
      button(tr('Center'), () => body.frame('body')),
      hint(tr('Tap the body to select a region. Alt + tap selects fat controls.')),
    );
  }

  /** The tissue groups of `structures`, in the order they lie from the surface inwards. */
  private static readonly layerGroups: { group: string; label: string; icon: IconNode }[] = [
    { group: 'Skin', label: 'Skin', icon: PersonStanding },
    { group: 'Fat', label: 'Fat', icon: Droplet },
    { group: 'Muscles', label: 'Muscles', icon: BicepsFlexed },
    { group: 'Bones', label: 'Bones', icon: Bone },
    { group: 'Connective tissue', label: 'Tissue', icon: Waypoints },
  ];
  /** Opacities a group had before it was hidden from the bubble, so showing it again restores them. */
  private hiddenLayers = new Map<string, Partial<AnatomyParameters>>();

  /**
   * One switch per tissue group for the context bubble. The skin cycles visible → see-through →
   * hidden so the layers below can be seen through it; the others show or hide. With a model bound
   * as the skin, the skin switch shows or hides that model.
   */
  private layerToggles(body: AnatomyBody): Node[] {
    const ed = this.ui.editor, model = body.skinModelMesh ? ed.entities.find(e => e.meshes.includes(body.skinModelMesh!)) : undefined;
    return AnatomyPanel.layerGroups.map(({ group, label, icon }) => {
      const members = structures.filter(s => s.group === group);
      const opacity = Math.max(...members.map(s => body.parameters[s.opacity]));
      let state: 'visible' | 'see-through' | 'hidden', next: () => void;
      if (group === 'Skin' && model) {
        state = model.visible === false ? 'hidden' : 'visible';
        next = () => ed.setVisible(model, state === 'hidden');
      } else {
        state = opacity > .9 || group !== 'Skin' && opacity > .001 ? 'visible' : opacity > .001 ? 'see-through' : 'hidden';
        next = () => {
          if (group === 'Skin') { body.patch({ skinOpacity: state === 'visible' ? .18 : state === 'see-through' ? 0 : 1 }); return; }
          if (state === 'visible') {
            this.hiddenLayers.set(group, Object.fromEntries(members.map(s => [s.opacity, body.parameters[s.opacity]])));
            body.patch(Object.fromEntries(members.map(s => [s.opacity, 0])));
          } else body.patch(this.hiddenLayers.get(group) ?? Object.fromEntries(members.map(s => [s.opacity, 1])));
        };
      }
      const status = tr(state === 'visible' ? 'Visible' : state === 'see-through' ? 'See-through' : 'Hidden');
      const node = iconButton(icon, tr('{layer}: {state}', { layer: tr(label), state: status }), () => { next(); this.refresh(); },
        { active: state !== 'hidden', label: tr(label), cls: `tool ${state === 'see-through' ? 'see-through' : ''}` });
      node.setAttribute('aria-pressed', String(state !== 'hidden'));
      return node;
    });
  }

  context() {
    const body = this.body;
    if (!body) return [];
    // A / B comparison stays in the panel (Parameters and comparison): the bubble is for the layers.
    return [h('div', { class: 'sel-name always' }, tr('Anatomy')),
      h('div', { class: 'sel-tools anatomy-layers' }, ...this.layerToggles(body))];
  }

  /**
   * The Skin page. First the skin source (procedural or a model); a model is fitted and then either
   * becomes the outer skin or stays beside the body for comparison. Assumptions and landmarks only
   * help ambiguous models, so they are collapsed under Advanced fitting.
   */
  private skinSources = new WeakMap<AnatomyBody, 'procedural' | 'model'>();
  private navelDepthControls(body: AnatomyBody): Node[] {
    if (!body.canEditNavelDepth) return [];
    const fitted = body.parameters.skinFit?.fittedNavel;
    const depth = fitted?.cavityOffsetMm ?? 0;
    return [section(tr('Fitted navel'),
      toggle(tr('Edit navel on model'), body.editNavelDepth, enabled => {
        body.editNavelDepth = enabled;
        if (enabled) { body.fatBrush = ''; body.editNippleProjection = false; }
        this.refresh();
      }),
      ...(body.editNavelDepth ? [hint(tr('Drag the navel up to deepen it or down to make it shallower. Release to apply.'))] : []),
      row(button(tr('Shallower'), () => body.setNavelCavityOffset(depth - 1)),
        button(tr('Deeper'), () => body.setNavelCavityOffset(depth + 1))),
      ...(fitted?.detail ? [numberInput(tr('Upper arch lift'), fitted.arcLiftMm ?? 0, { step: 1, suffix: 'mm' },
        value => body.setNavelArcLift(value))] : []),
      ...(depth ? [hint(tr('Cavity adjustment: {depth} mm', { depth: depth > 0 ? '+' + depth : String(depth) })),
        button(tr('Reset navel depth'), () => body.setNavelCavityOffset(0))] : []))];
  }

  private nippleSide: 0 | 1 = 0;
  private fittedNippleControls(body: AnatomyBody): Node[] {
    const sides = ([0, 1] as const).filter(side => body.editableNipple(side));
    if (!sides.length) return [];
    const side = sides.includes(this.nippleSide) ? this.nippleSide : sides[0];
    const nipple = body.editableNipple(side)!;
    const field = (key: keyof FittedNippleEdit, label: string, step: number, suffix: string) =>
      numberInput(tr(label), nipple.edit?.[key] ?? fittedNippleEditDefaults[key], { step, suffix },
        value => body.setFittedNippleEdit(side, { [key]: value }));
    return [section(tr('Fitted nipples'),
      chips(sides.map(value => ({ value: String(value), label: tr(value === 0 ? 'Left nipple' : 'Right nipple') })), String(side),
        value => { this.nippleSide = value === '0' ? 0 : 1; this.refresh(); }),
      ...(sides.length === 2 ? [toggle(tr('Edit both sides together'), body.linkNippleEdits, enabled => { body.linkNippleEdits = enabled; })] : []),
      toggle(tr('Edit nipple projection on model'), body.editNippleProjection, enabled => {
        body.editNippleProjection = enabled;
        if (enabled) { body.fatBrush = ''; body.editNavelDepth = false; }
        this.refresh();
      }),
      ...(body.editNippleProjection ? [hint(tr('Drag either nipple up to increase projection or down to reduce it. Release to apply.'))] : []),
      field('outwardMm', 'Move outward', 1, 'mm'), field('upMm', 'Move up', 1, 'mm'),
      field('projectionMm', 'Projection adjustment', 1, 'mm'), field('baseScale', 'Nipple base size', .05, '×'),
      field('areolaScale', 'Areola size', .05, '×'), field('pigmentation', 'Areola pigmentation', .05, '×'),
      field('edgeSoftness', 'Areola edge softness', .05, '×'),
      button(tr('Reset nipple edits'), () => body.setFittedNippleEdit(side, fittedNippleEditDefaults)))];
  }

  private fitCandidates() {
    return this.ui.editor.entities.filter(e => e.kind === 'model' && !e.anatomy && !e.groupMembers &&
      e.meshes.some(mesh => mesh.getTotalVertices() > 0));
  }

  private fitTarget(body: AnatomyBody, candidates = this.fitCandidates()) {
    const setup = body.state.fitSetup;
    return setup ? candidates.find(entity => entity.id === setup.targetId) : candidates[0];
  }

  private fittingPanel(body: AnatomyBody): Node[] {
    const options=body.state.fitOptions;
    this.fitSurface=options?.surface??'unknown';this.fitHeightHint=options?.height??false;this.fitFatHint=options?.fat??false;this.fitMuscleHint=options?.muscles??false;this.fitProportions=options?.proportions??false;this.fitRefineTissues=options?.refine??false;
    const saveOptions=()=>body.change(()=>{body.state.fitOptions={surface:this.fitSurface,height:this.fitHeightHint,fat:this.fitFatHint,muscles:this.fitMuscleHint,proportions:this.fitProportions,refine:this.fitRefineTissues};});
    const ed=this.ui.editor,candidates=this.fitCandidates();
    const saved=body.state.fitSetup,bound=!!body.skinDrive?.bound;
    const target=this.fitTarget(body,candidates);
    const missingReference=!!saved&&!target;
    const mode=saved?.mode??this.fitMode;
    // A chosen reference model means the user is working from that model.
    const source=this.skinSources.get(body)??(bound||saved?'model':'procedural');
    const sourceSwitch=segmented([{id:'procedural',label:tr('Procedural')},{id:'model',label:tr('From a model')}],source,value=>{this.skinSources.set(body,value as 'procedural'|'model');this.refresh();});
    const baseSurface=select(tr('Base surface'), [{ value: '0', label: tr('Authored human mesh') }, { value: '1', label: tr('Procedural surface') }], String(body.parameters.skinModel), value => { body.edit('skinModel', +value); body.commit(); });
    const detach=()=>{body.detachSkinDrive();body.patch({skinOpacity:1});this.skinSources.set(body,'procedural');this.refresh();};
    if(source==='procedural') return [sourceSwitch,section(tr('Procedural skin'),baseSurface,
      ...(bound?[hint(tr('A model is bound as the skin. Use the procedural skin to release it.')),button(tr('Use the procedural skin'),detach)]:[])), ...this.navelDepthControls(body), ...this.fittedNippleControls(body)];

    const choose=(id:string)=>{const e=candidates.find(e=>String(e.id)===id);if(!e)return;body.change(()=>{body.state.fitSetup={targetId:e.id,targetName:e.name,mode,hints:body.state.fitSetup?.targetId===e.id?body.state.fitSetup.hints:undefined};});this.refresh();};
    const file=h('input',{type:'file',accept:'.glb',hidden:true}) as HTMLInputElement;
    file.addEventListener('change',()=>{void this.ui.run(async()=>{const files=Array.from(file.files??[]);if(!files.length)return;const before=new Set(ed.entities.map(e=>e.id));await this.ui.openFiles(files);const imported=this.fitCandidates().find(e=>!before.has(e.id));if(imported)body.change(()=>{body.state.fitSetup={targetId:imported.id,targetName:imported.name,mode};});ed.select(body.entity);this.ui.openPart('objects','anatomy-fit');});});
    this.fitMeter=h('div',{'aria-live':'polite'},...(body.fitting?[progressBar(body.fitting.fraction,tr(body.fitting.stage))]:[]));
    const fitOnly=button(tr('Fit only'),()=>this.adaptToModel(body,false,'anatomy'),{cls:'primary'}),fitSkin=button(tr('Fit and use as skin'),()=>this.adaptToModel(body,false,'skin'));
    fitSkin.disabled=fitOnly.disabled=!target||!!body.fitting;
    const control=(key:AnatomyKey)=>this.control(body,catalogue.controls.find(c=>c.key===key)!);
    const advanced=h('details',{class:'sec'},h('summary',{},tr('Advanced fitting')),
        hint(tr('Review joints to check the pose and facing. Optional assumptions below help when the surface is ambiguous.')),
        select(tr('What covers the body?'),['unknown','skin','clothed'].map(value=>({value,label:tr(value==='skin'?'Visible skin':value==='clothed'?'Clothed body':'Unknown surface')})),this.fitSurface,value=>{this.fitSurface=value as typeof this.fitSurface;saveOptions();}),
        hint(tr('Clothing disables muscle and fat estimation and lowers confidence. The silhouette still includes clothing.')),
        toggle(tr('Specify real height'),this.fitHeightHint,value=>{this.fitHeightHint=value;saveOptions();this.refresh();}),...(this.fitHeightHint?[control('height')]:[]),
        toggle(tr('Specify fat thickness'),this.fitFatHint,value=>{this.fitFatHint=value;saveOptions();this.refresh();}),...(this.fitFatHint?[control('fat')]:[]),
        toggle(tr('Prefer current torso proportions'),this.fitProportions,value=>{this.fitProportions=value;saveOptions();this.refresh();}),...(this.fitProportions?(['chestWidth','chestDepth','waistWidth','waistDepth','pelvisWidth','pelvisDepth'] as const).map(control):[]),
        toggle(tr('Preserve current muscle settings'),this.fitMuscleHint,value=>{this.fitMuscleHint=value;saveOptions();}),
        toggle(tr('Refine individual muscle shape (slower)'),this.fitRefineTissues,value=>{this.fitRefineTissues=value;saveOptions();}),
        hint(tr(saved?.hints?.landmarks&&Object.keys(saved.hints.landmarks).length?'Joint hints saved. You can return here without losing them.':'Joint hints are estimated automatically. Review them for bent or unusual poses.')),
        ...(target&&ed.rigger.canRig(target)?[button(tr('Review joint hints'),()=>{
          const candidate=target,mesh=[...candidate.meshes].sort((a,b)=>b.getTotalVertices()-a.getTotalVertices())[0] as Mesh;
          void this.ui.run(async()=>{const {collectBodyHints,restoreBodyHints}=await import('../../anatomy/integration/bodyHints');ed.select(candidate);ed.rigger.start(candidate);ed.rigger.findPose();if(saved?.targetId===candidate.id&&saved.hints)restoreBodyHints(ed,candidate,mesh,saved.hints);
            ed.rigger.fittingSession={save:()=>{const hints=collectBodyHints(ed,candidate,mesh);body.change(()=>{body.state.fitSetup={targetId:candidate.id,targetName:candidate.name,mode,hints:{landmarks:hints.landmarks,forward:hints.forward,tissues:body.state.fitSetup?.hints?.tissues,jointSource:'manual'}};});},returnToAnatomy:()=>{ed.select(body.entity);this.ui.openPart('objects','anatomy-fit');}};
            this.ui.openPart('objects','rig');});
        })]:[]),
        ...this.tissueHintControls(body,target),
        ...(body.parameters.referencePose?[h('details',{class:'sec'},h('summary',{},tr('Regional fat reserve')),
          hint(tr('Subcutaneous priors in millimetres. Refinement may adjust each region by up to 6 mm. Specify fat thickness above to lock it. Refit after changing these priors.')),
          ...(['chest','shoulders','abdomen','inguinal'] as const).map(key=>numberInput(tr({chest:'Chest fat reserve',shoulders:'Shoulder fat reserve',abdomen:'Abdominal fat reserve',inguinal:'Inguinal fat reserve'}[key]),body.parameters.fatPriorDistribution?.[key]??body.parameters.fatDistribution?.[key]??body.parameters.fat,{step:1,suffix:'mm'},value=>{const initial={chest:body.parameters.fat,shoulders:body.parameters.fat,abdomen:body.parameters.fat,inguinal:body.parameters.fat};const distribution={...initial,...body.parameters.fatPriorDistribution,...body.parameters.fatDistribution,[key]:Math.max(2,Math.min(35,value))};body.patch({fatDistribution:distribution,fatPriorDistribution:distribution});})))]:[]),
        ...(body.parameters.referencePose?[toggle(tr('Use reference pose'),body.parameters.referencePose.enabled,value=>{body.patch({referencePose:{...body.parameters.referencePose!,enabled:value}});this.refresh();})]:[]));
    const evidence=body.fitEvidence;
    const references = candidates.map((entity, index) => ({
      value: String(entity.id),
      label: candidates.some(other => other !== entity && other.name === entity.name)
        ? tr('{name} (model {number})', { name: entity.name, number: String(index + 1) }) : entity.name,
    }));
    if (!target) references.unshift({ value: '', label: tr('Choose a reference model') });
    const refine = button(tr('Refine muscles and fat'),()=>this.adaptToModel(body,true));
    refine.disabled = !target || !!body.fitting;
    const content=[sourceSwitch,
      section(tr('Model'),file,
        ...(missingReference ? [hint(tr('The saved reference, {name}, is unavailable. Choose another model or import a GLB.', { name: saved.targetName }))] : []),
        ...(candidates.length ? [select(tr('Reference model'), references, target ? String(target.id) : '', choose)]
          : missingReference ? [] : [hint(tr('Choose a humanoid GLB to start.'))]),
        button(tr('Choose humanoid GLB…'),()=>file.click()),
        row(fitOnly,fitSkin),
        hint(tr('Fit and use as skin makes the model the outer skin: it follows muscle, fat and pose changes. Fit only keeps it beside the body for comparison.')),
        this.fitMeter,
        ...(bound?[hint(tr('The skin comes from {name}.',{name:saved?.targetName??target?.name??''})),...this.skinDriveControls(body),button(tr('Use the procedural skin'),detach)]:[]),
        ...(!bound && evidence?.poseFit ? [toggle(tr('Show procedural skin'), body.parameters.skinOpacity > .001, visible => {
          const p = body.parameters;
          const showMuscles = !visible && Math.max(p.otherMusclesOpacity, p.rectusAbdominisOpacity, p.externalObliqueOpacity) <= .001;
          body.patch({skinOpacity:visible?1:0, ...(showMuscles ? {otherMusclesOpacity:1,rectusAbdominisOpacity:1,externalObliqueOpacity:1} : {})});
        })] : []),
        ...(evidence?.poseFit ? [button(tr('Pose'), () => this.ui.openPart('objects', 'anatomy-pose'))] : []),
        ...(body.parameters.referencePose?[refine,hint(tr('Keeps the fitted bones and joints fixed. Fits muscle belly profiles below the reference surface and reserves the specified fat thickness.'))]:[]),
        ...(evidence?.volumeFit?[hint(tr('Posed skin distance: {before} → {after} mm',{before:evidence.volumeFit.skin.beforeMm.toFixed(1),after:evidence.volumeFit.skin.afterMm.toFixed(1)}))]:[]),
        ...(evidence?.poseFit?[hint(tr('Reference-pose distance: {distance} mm',{distance:evidence.poseFit.meanMm.toFixed(1)}))]:[]),
        ...(evidence?.surfaceRegistration?[hint(tr('Surface distance: {before} → {after} mm',{before:evidence.surfaceRegistration.beforeMm.toFixed(1),after:evidence.surfaceRegistration.afterMm.toFixed(1)}))]:[])),
      ...this.navelDepthControls(body), ...this.fittedNippleControls(body), advanced,
    ];
    this.fitControls=h('fieldset',{class:'stack',style:'border:0;padding:0;margin:0;min-width:0',disabled:!!body.fitting},...content) as HTMLFieldSetElement;
    return [this.fitControls];
  }

  private tissueHintControls(body:AnatomyBody,target:import('../../core/editor').Entity|undefined):Node[]{
    if(!target)return [];
    const saved=body.state.fitSetup,points=saved?.hints?.tissues??{};
    const panel=section(tr('Surface landmarks (optional)'),
      hint(tr('Mark points on the GLB, not on the procedural body. Left and right refer to the person. These points adjust muscles, fat and skin; they do not move bones.')),
      hint(tr('For each inguinal fold, mark its inner end near the pubis, its middle, then its outer end near the hip. Mark the visible fold, not the underwear edge.')),
      ...Object.entries(tissueHintLabels).map(([key,label])=>row(
        button(tr(label)+(points[key as TissueHintName]?' ✓':''),()=>this.pickTissueHint(body,target,key as TissueHintName)),
        ...(points[key as TissueHintName]?[button(tr('Clear'),()=>{body.change(()=>{delete body.state.fitSetup?.hints?.tissues?.[key as TissueHintName];});this.refresh();},{cls:'small',name:tr('Clear')+' '+tr(label)})]:[]))),
      hint(tr('Choose a landmark, then tap its position on the reference. Escape cancels. Refit after changing landmarks.')),
      ...(body.fitEvidence?.tissueFit?[hint(tr('Surface landmarks fitted: {count}. Maximum residual: {distance} mm',{count:body.fitEvidence.tissueFit.count,distance:Math.max(0,...body.fitEvidence.tissueFit.afterMm).toFixed(1)}))]:[]));
    queueMicrotask(()=>{
      if(!panel.isConnected)return;
      const mesh=[...target.meshes].sort((a,b)=>b.getTotalVertices()-a.getTotalVertices())[0],overlay=new JointOverlay(this.ui.editor);
      document.body.append(overlay.el);
      overlay.set(Object.entries(points).map(([key,p])=>({id:key,label:tr(tissueHintLabels[key as TissueHintName]),position:()=>Vector3.TransformCoordinates(new Vector3(...p!),mesh.computeWorldMatrix(true))})),{onPick:id=>this.pickTissueHint(body,target,id as TissueHintName)});
      const observer=this.ui.editor.scene.onAfterRenderObservable.add(()=>overlay.update());
      const cleanup=new MutationObserver(()=>{if(!panel.isConnected){overlay.clear();overlay.el.remove();this.ui.editor.scene.onAfterRenderObservable.remove(observer);cleanup.disconnect();this.cancelTissuePick?.();}});
      cleanup.observe(document.body,{childList:true,subtree:true});
    });
    return [panel];
  }

  private pickTissueHint(body:AnatomyBody,target:import('../../core/editor').Entity,key:TissueHintName){
    const ed=this.ui.editor,canvas=ed.scene.getEngine().getRenderingCanvas();if(!canvas)return;
    this.cancelTissuePick?.();
    this.ui.toast(tr('Tap the reference: {landmark}',{landmark:tr(tissueHintLabels[key])}));
    const host=this.ui.panel,children=Array.from(host.children).filter((e):e is HTMLElement=>e instanceof HTMLElement),display=children.map(e=>e.style.display),maxHeight=host.style.maxHeight;
    const overlays=Array.from(document.querySelectorAll<HTMLElement>('.joint-layer')),overlayDisplay=overlays.map(e=>e.style.display);
    overlays.forEach(e=>e.style.display='none');
    children.forEach(e=>e.style.display='none');host.style.maxHeight='140px';
    const banner=section(tr(tissueHintLabels[key]),hint(tr('Tap a visible point on the reference model.')),button(tr('Cancel'),()=>stop()));host.prepend(banner);
    const stop=()=>{canvas.removeEventListener('pointerdown',pick,true);window.removeEventListener('keydown',escape,true);banner.remove();children.forEach((e,i)=>e.style.display=display[i]);overlays.forEach((e,i)=>e.style.display=overlayDisplay[i]);host.style.maxHeight=maxHeight;this.cancelTissuePick=null;};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopImmediatePropagation();stop();}};
    const pick=(event:PointerEvent)=>{
      event.preventDefault();event.stopImmediatePropagation();
      const rect=canvas.getBoundingClientRect(),hit=ed.scene.pick(event.clientX-rect.left,event.clientY-rect.top,m=>target.meshes.includes(m as Mesh));
      if(!hit?.pickedPoint||!hit.pickedMesh){this.ui.toast(tr('Tap a visible point on the reference model.'));return;}
      const mesh=[...target.meshes].sort((a,b)=>b.getTotalVertices()-a.getTotalVertices())[0];
      const p=Vector3.TransformCoordinates(hit.pickedPoint,Matrix.Invert(mesh.computeWorldMatrix(true)));
      body.change(()=>{body.state.fitSetup??={targetId:target.id,targetName:target.name,mode:this.fitMode};const hints=body.state.fitSetup.hints??={};(hints.tissues??={})[key]=[p.x,p.y,p.z];});
      stop();this.refresh();
    };
    this.cancelTissuePick=stop;canvas.addEventListener('pointerdown',pick,true);window.addEventListener('keydown',escape,true);
  }
  private cancelTissuePick:(()=>void)|null=null;

  private adaptToModel(body: AnatomyBody,softOnly=false,goal?:'anatomy'|'skin') {
    if(softOnly&&!body.parameters.referencePose?.enabled){this.ui.toast(tr('Enable the reference pose before refining tissues.'));return;}
    const candidate = this.fitTarget(body);
    if (!candidate) return;
    const mesh = [...candidate.meshes].filter(m=>m.getTotalVertices()>0).sort((a,b)=>b.getTotalVertices()-a.getTotalVertices())[0] as Mesh | undefined;
    const pos = mesh?.getVerticesData('position');
    if (!mesh || !pos || pos.length < 150) {
      this.ui.toast(tr('No valid mesh vertices found on {name}.', { name: candidate.name }));
      return;
    }
    void this.ui.run(async () => {
      const {collectBodyHints}=await import('../../anatomy/integration/bodyHints');
      const collected=collectBodyHints(this.ui.editor,candidate,mesh),saved=body.state.fitSetup?.targetId===candidate.id?body.state.fitSetup.hints:undefined;
      const hints={...collected,...saved,forward:saved?.forward??collected.forward,landmarks:{...collected.landmarks,...saved?.landmarks}};
      hints.tissues=saved?.tissues;
      hints.surface=this.fitSurface;
      if(this.fitHeightHint) hints.heightCm=body.parameters.height;
      hints.parameters={};
      hints.lockMuscleShape=this.fitMuscleHint;
      if(this.fitFatHint) for(const key of ['fat','lowerFat','flankFat','armFat','gluteFat','thighFat'] as const) hints.parameters[key]=body.parameters[key];
      if(this.fitMuscleHint) for(const key of ['pectoral','rectus','oblique','gluteMax','quadriceps','hamstrings','biceps','triceps','forearm','back','calves'] as const) hints.parameters[key]=body.parameters[key];
      if(this.fitProportions)for(const key of ['chestWidth','chestDepth','waistWidth','waistDepth','pelvisWidth','pelvisDepth','shoulderWidth'] as const)hints.parameters[key]=body.parameters[key];
      const mode=goal??body.state.fitSetup?.mode??this.fitMode;this.skinSources.set(body,'model');
      const activity=this.ui.beginActivity(tr('Fitting anatomy…'),undefined,()=>body.stopFitting());
      let res;
      try {
        res = await body.adaptToTargetMesh({ positions: new Float32Array(pos), mesh, name: candidate.name, hints,
          bindSkin:mode==='skin',matchPose:true,softOnly,autoRefine:!softOnly,refineTissues:this.fitRefineTissues,
          fitSetup:{targetId:candidate.id,targetName:candidate.name,mode},
          onProgress:(stage,fraction)=>{if(fraction>=.99)activity.setCancel(undefined);if(this.fitControls)this.fitControls.disabled=true;activity.update(fraction,tr(stage));this.fitMeter?.replaceChildren(progressBar(fraction,tr(stage)));},
        });
      }finally{if(this.fitControls)this.fitControls.disabled=false;activity.finish();this.refresh();}
      const drive = res.skinDrive;
      this.ui.toast(drive?.bound
        ? tr('{name} follows the fitted anatomy. Move a muscle, fat or pelvis slider to edit its skin.', { name: candidate.name })
        : drive?.reason || tr('Body shape fitted to {name}. Review the silhouette and joints.',{name:candidate.name}));
      this.ui.editor.frameAll();body.view('front');
      this.refresh();
    });
  }

  private actions(body: AnatomyBody) {
    const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    input.addEventListener('change', () => { void this.ui.run(async () => {
      const file = input.files?.[0]; if (!file) return;
      body.importParameters(JSON.parse(await file.text()));
      input.value = '';
    }); });
    return section(tr('Anatomy actions'), input,
      row(button(tr('Save A'), () => body.saveReference()), button(tr('View A'), () => body.compare(true)), button(tr('View B'), () => body.compare(false))),
      row(button(tr('Import parameters'), () => input.click()), button(tr('Export parameters'), () => { void this.ui.run(() => saveAndOfferShare(new Blob([JSON.stringify(body.exportParameters(), null, 2)], { type: 'application/json' }), timestampedName('anatomy', 'json'))); })),
      button(tr('Save image'), () => { void this.ui.run(async () => { await body.ready(); await saveAndOfferShare(await this.ui.editor.capture(), timestampedName('anatomy', 'png')); }); }),
      button(tr('Reset anatomy'), () => { body.spinning = false; body.resetAnatomy(); body.view('front'); body.frame('body'); }),
    );
  }

  /** Keeps the operation of the imported-skin binding visible: state, reach and a way back. */
  private skinDriveControls(body: AnatomyBody): Node[] {
    const drive = body.skinDrive;
    if (!drive) return [];
    const status = drive.status;
    const detail = !drive.bound ? '' : status && status.unmatchedVertices
      ? tr('{count} vertices stayed outside the body surface.', { count: status.unmatchedVertices })
      : tr('Skin moved {moved} vertices, up to {mm} mm.', { moved: drive.movedVertices, mm: drive.maxDisplacementMm.toFixed(1) });
    return [
      toggle(tr('Model skin follows anatomy'), drive.enabled, value => body.setSkinDrive(value)),
      detail ? hint(detail) : h('span'),
      drive.enabled ? button(tr('Reset model skin'), () => { body.resetSkinDrive(); this.refresh(); }) : h('span'),
    ];
  }
}
