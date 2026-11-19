import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage.js';
import { tr } from '../core/i18n';
import type { AnatomyParameters } from './parameters';
import type { SkinFeatureFrame } from './skinFeatures';
import { structures } from './structures';

/** Procedural color/fiber detail augments native PBR; scene lights and standard controls stay authoritative. */
class AnatomicalDetail extends MaterialPluginBase {
  detail = [0, 1, 1, 0];
  tissue = [0, 0, 10.25, 1];
  skinFeatures: (SkinFeatureFrame | undefined)[] = [];
  exposure = 1;
  /** Fiber striation contrast on muscles (0 hides them). */
  striation = 1;
  constructor(material: PBRMaterial) {
    super(material, 'AnatomicalDetail', 200, {}, true, true);
    this.doNotSerialize = true;
  }
  override isCompatible(language: ShaderLanguage) { return language === ShaderLanguage.GLSL; }
  override getAttributes(attributes: string[]) { attributes.push('fiber', 'tissue', 'anatomyRest'); }
  override getUniforms() {
    return { externalUniforms: ['anatomyDetail', 'anatomyTissue', 'anatomyExposure', 'anatomyStriation',
      'featureAnchor0','featureAnchor1','featureAnchor2','featureNormal0','featureNormal1','featureNormal2','areolaStyle','areolaEdge'] };
  }
  override bindForSubMesh(_buffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, subMesh: SubMesh) {
    const effect = subMesh.effect;
    effect?.setFloat4('anatomyDetail', this.detail[0], this.detail[1], this.detail[2], this.detail[3]);
    effect?.setFloat4('anatomyTissue', this.tissue[0], this.tissue[1], this.tissue[2], this.tissue[3]);
    effect?.setFloat('anatomyExposure', this.exposure);
    effect?.setFloat('anatomyStriation', this.striation);
    for (let i=0;i<3;i++){
      const f=this.skinFeatures[i];
      effect?.setFloat4('featureAnchor'+i, f?.center[0]??0,f?.center[1]??0,f?.center[2]??0,f?.radius??0);
      effect?.setFloat4('featureNormal'+i, f?.normal[0]??0,f?.normal[1]??0,f?.normal[2]??1,f?.aspect??1);
    }
    const left = this.skinFeatures[1]?.areola, right = this.skinFeatures[2]?.areola;
    effect?.setFloat4('areolaStyle', left?.areolaScale ?? 1, left?.pigmentation ?? 1, right?.areolaScale ?? 1, right?.pigmentation ?? 1);
    effect?.setFloat2('areolaEdge', left?.edgeSoftness ?? 1, right?.edgeSoftness ?? 1);
  }
  override getCustomCode(shader: string): Record<string, string> {
    if (shader === 'vertex') return {
      CUSTOM_VERTEX_DEFINITIONS: 'attribute float fiber; attribute float tissue; attribute vec3 anatomyRest; varying vec3 anatomyPosition; varying vec3 anatomyCurrent; varying float anatomyFiber; varying float anatomyCoverage;',
      CUSTOM_VERTEX_MAIN_END: 'anatomyPosition=anatomyRest; anatomyCurrent=positionUpdated; anatomyFiber=fiber; anatomyCoverage=tissue;',
    };
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `uniform vec4 anatomyDetail; uniform vec4 anatomyTissue; uniform float anatomyExposure; uniform float anatomyStriation;
uniform vec4 featureAnchor0,featureAnchor1,featureAnchor2,featureNormal0,featureNormal1,featureNormal2;
uniform vec4 areolaStyle; uniform vec2 areolaEdge;
varying vec3 anatomyPosition; varying vec3 anatomyCurrent; varying float anatomyFiber; varying float anatomyCoverage;
float anatomyFeature(vec3 p,vec4 anchor,vec4 frame,float power){
 if(anchor.w<=0.)return 0.;
 vec3 t=normalize(cross(vec3(0.,1.,0.),frame.xyz)),v=cross(frame.xyz,t),d=p-anchor.xyz;
 float r=length(vec2(dot(d,t),dot(d,v)/frame.w))/anchor.w;
 return exp(-pow(r,power)*2.)*(1.-smoothstep(.12,.30,abs(dot(d,frame.xyz))));
}
float anatomyHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float anatomyNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(anatomyHash(i),anatomyHash(i+vec3(1,0,0)),f.x),mix(anatomyHash(i+vec3(0,1,0)),anatomyHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(anatomyHash(i+vec3(0,0,1)),anatomyHash(i+vec3(1,0,1)),f.x),mix(anatomyHash(i+vec3(0,1,1)),anatomyHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float anatomyRelief(vec3 p){return anatomyNoise(p*54.)*.7+anatomyNoise(p*130.)*.3;}`,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: `
vec3 anatomyP=anatomyPosition;
if(anatomyTissue.x<.5){
 float footprint=max(max(fwidth(anatomyP.x),fwidth(anatomyP.y)),fwidth(anatomyP.z));
 float fine=1.-smoothstep(.6,1.7,footprint*100.);
 float micro=anatomyRelief(anatomyP);
 float mottling=(anatomyNoise(anatomyP*3.5)-.5)*.065*anatomyDetail.x;
 float pores=(micro-.5)*.055*anatomyDetail.x*fine;
 surfaceAlbedo+=vec3(mottling+pores,mottling*.65+pores*.7,mottling*.45+pores*.55);
 vec3 dpdx=dFdx(vPositionW),dpdy=dFdy(vPositionW),r1=cross(dpdy,normalW),r2=cross(normalW,dpdx);
 float det=dot(dpdx,r1);
 if(abs(det)>.0000001)normalW=normalize(normalW-sign(det)*(dFdx(micro)*r1+dFdy(micro)*r2)*.00008*anatomyDetail.x*fine/abs(det));
 vec3 detailPosition=anatomyCurrent*vec3(10.,10./anatomyDetail.z,10.);
 float front=smoothstep(.15,.45,anatomyP.z);
 surfaceAlbedo*=1.-anatomyFeature(detailPosition,featureAnchor0,featureNormal0,2.)*front*.48;
 float leftAreola=anatomyFeature(detailPosition,vec4(featureAnchor1.xyz,featureAnchor1.w*areolaStyle.x),featureNormal1,4./areolaEdge.x)*areolaStyle.y;
 float rightAreola=anatomyFeature(detailPosition,vec4(featureAnchor2.xyz,featureAnchor2.w*areolaStyle.z),featureNormal2,4./areolaEdge.y)*areolaStyle.w;
 float areola=clamp(max(leftAreola,rightAreola)*front*.75,0.,1.);
 surfaceAlbedo=mix(surfaceAlbedo,surfaceAlbedo*vec3(.73,.64,.60),areola);
}else if(anatomyTissue.x<5.){
 float flank=smoothstep(1.3,2.25,abs(atan(anatomyP.x,anatomyP.z)));
 float f=anatomyTissue.x<1.5?mix(anatomyP.y*95.-abs(anatomyP.x)*100.*anatomyDetail.y,abs(anatomyP.x)*115.,flank):anatomyTissue.x<2.5?anatomyP.y*95.+abs(anatomyP.x)*90.*anatomyDetail.y:anatomyTissue.x<3.5?anatomyP.y*110.:abs(anatomyP.x)*130.;
 if(anatomyDetail.w>.5)f=anatomyFiber;
 float grain=anatomyNoise(anatomyP*24.);surfaceAlbedo*=.96+.030*anatomyStriation*sin(f+grain*.65)+.022*grain;
 if(anatomyTissue.x<1.5||(anatomyTissue.x>3.5&&anatomyTissue.x<4.5))surfaceAlbedo=mix(surfaceAlbedo*vec3(1.2,1.4,1.5),surfaceAlbedo,smoothstep(.02,.94,anatomyCoverage));
}
surfaceAlbedo=max(surfaceAlbedo,vec3(0.));`,
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: 'finalColor.rgb*=anatomyExposure;',
    };
  }
}

const detailPlugins = new WeakMap<PBRMaterial, AnatomicalDetail>();
export function anatomyMaterial(scene: Scene, key: string, parameters: AnatomyParameters) {
  const structure = structures.find(s => s.id === key)!;
  const material = new PBRMaterial(tr(structure.label), scene);
  material.metallic = 0;
  material.roughness = key === 'skin' ? parameters.roughness : .8;
  material.albedoColor = Color3.FromArray(structure.color);
  material.backFaceCulling = false;
  material.separateCullingPass = true;
  material.alpha = parameters[structure.opacity];
  material.metadata = { anatomyStructure: key };
  if (key === 'skin') material.albedoColor = new Color3(.36+.30*parameters.skinTone,.21+.23*parameters.skinTone,.15+.17*parameters.skinTone);
  detailPlugins.set(material, new AnatomicalDetail(material));
  return material;
}

export function updateAnatomyMaterial(material: PBRMaterial, p: AnatomyParameters, key: string, navel: number[], previous?: AnatomyParameters, hasFibers = false, studyLighting = false, enabled = true, striations = true, skinFeatures?: (SkinFeatureFrame | undefined)[]) {
  const structure = structures.find(s => s.id === key)!;
  if (previous && previous[structure.opacity] !== p[structure.opacity]) material.alpha = p[structure.opacity];
  material.transparencyMode = material.alpha < 1 ? PBRMaterial.PBRMATERIAL_ALPHABLEND : PBRMaterial.PBRMATERIAL_OPAQUE;
  if (key === 'skin' && previous?.roughness !== p.roughness) material.roughness = p.roughness;
  if (key === 'skin' && previous?.skinTone !== p.skinTone) material.albedoColor = new Color3(.36+.30*p.skinTone,.21+.23*p.skinTone,.15+.17*p.skinTone);
  if (key === 'skin') material.metallicF0Factor = p.shine / .28;
  const plugin = detailPlugins.get(material)!;
  plugin.detail = [p.texture, p.fiberAngle, p.height / 175, Number(hasFibers)];
  plugin.tissue = [enabled ? structure.tissueType : 99, navel[0], navel[1], p.navelSize];
  if (skinFeatures) plugin.skinFeatures = skinFeatures;
  plugin.exposure = studyLighting ? p.exposure : 1;
  plugin.striation = striations ? 1 : 0;
  material.markAsDirty(PBRMaterial.MiscDirtyFlag);
}
