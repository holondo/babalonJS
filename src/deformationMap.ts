import { Color3, Mesh, ShaderMaterial, Vector3, VertexBuffer } from '@babylonjs/core';
import type { AbstractMesh, Material } from '@babylonjs/core';
import type { Editor, Entity } from './editor';
import { worldMatrix } from './humanoid';
import { tr } from './i18n';

const ATTRIBUTE = 'rigDifference';
export interface DifferenceSummary { entity: Entity; maximum: number; mean: number }

/** An explicit, temporary snapshot: no vertex evaluation in the render loop. */
export class DeformationMap {
  readonly summaries: DifferenceSummary[] = [];
  group: string | null = null;
  private materials = new Map<AbstractMesh, Material | null>();
  private shader: ShaderMaterial | null = null;
  private poseSnapshot: { entity: Entity; values: Float64Array }[] = [];
  private morphSnapshot: { mesh: AbstractMesh; influences: Float64Array }[] = [];
  private readonly editor: Editor;
  private readonly updateHelpers: () => void;
  constructor(editor: Editor, updateHelpers: () => void) { this.editor=editor;this.updateHelpers=updateHelpers; }

  materialOf(mesh: AbstractMesh) { return this.materials.has(mesh) ? this.materials.get(mesh)! : mesh.material; }

  clear() {
    for (const [mesh, material] of this.materials) if (!mesh.isDisposed()) {
      mesh.material = material;
      if (mesh instanceof Mesh) mesh.removeVerticesData(ATTRIBUTE);
    }
    this.materials.clear();this.shader?.dispose();this.shader=null;
    this.summaries.length=0;this.group=null;
    this.poseSnapshot.length=0;
    this.morphSnapshot.length=0;
  }

  /** Catch joint drags and running clips even before their final change notification. */
  checkPose() {
    for(const {mesh,influences} of this.morphSnapshot){
      const manager=mesh.morphTargetManager;
      if(!manager || manager.numTargets!==influences.length){this.clear();this.editor.invalidate();this.editor.notify('rig');return;}
      for(let i=0;i<influences.length;i++) if(Math.abs(manager.getTarget(i).influence-influences[i])>1e-7){this.clear();this.editor.invalidate();this.editor.notify('rig');return;}
    }
    for(const {entity,values} of this.poseSnapshot){
      let i=0;
      for(const node of entity.rig!.joints.values()){
        const q=node.rotationQuaternion;
        if(Math.abs(node.position.x-values[i])>1e-7 || Math.abs(node.position.y-values[i+1])>1e-7 || Math.abs(node.position.z-values[i+2])>1e-7 ||
          Math.abs((q?.x ?? 0)-values[i+3])>1e-7 || Math.abs((q?.y ?? 0)-values[i+4])>1e-7 || Math.abs((q?.z ?? 0)-values[i+5])>1e-7 || Math.abs((q?.w ?? 1)-values[i+6])>1e-7){
          this.clear();this.editor.invalidate();this.editor.notify('rig');return;
        }
        i+=7;
      }
    }
  }

  setScale(percent: number) { this.shader?.setFloat('differenceScale',percent); this.editor.invalidate(); }

  show(members: Entity[], scale: number, palette: [Color3, Color3, Color3]) {
    this.clear();
    this.updateHelpers();
    const reference=members.find(e=>e.rig && (e.rig.data.treatment ?? 'current')==='current');
    if(!reference?.rig || members.length<2) throw new Error(tr('A Direct weights reference is required.'));
    const localPositions=(e: Entity) => {
      for(const n of [...e.rig!.joints.values(),...e.rig!.helpers.map(h=>h.node)]) worldMatrix(n);
      e.rig!.skeleton.prepare(true);
      const inverse=worldMatrix(e.root).clone().invert();
      return e.meshes.map(m=>{
        const data=m.getPositionData(true,true);
        if(!data) throw new Error(tr('Missing comparison geometry.'));
        const positions=new Float32Array(data.length),transform=worldMatrix(m).multiply(inverse),p=new Vector3();
        for(let i=0;i<data.length;i+=3){Vector3.TransformCoordinatesFromFloatsToRef(data[i],data[i+1],data[i+2],transform,p);p.toArray(positions,i);}
        return positions;
      });
    };
    const base=localPositions(reference);
    // Use the rest height, so bending the knees does not change the color scale.
    let min=Infinity,max=-Infinity;
    const inverse=worldMatrix(reference.root).clone().invert(),p=new Vector3();
    for(const mesh of reference.meshes){
      const rest=mesh.getVerticesData(VertexBuffer.PositionKind)!,transform=worldMatrix(mesh).multiply(inverse);
      for(let i=0;i<rest.length;i+=3){Vector3.TransformCoordinatesFromFloatsToRef(rest[i],rest[i+1],rest[i+2],transform,p);min=Math.min(min,p.y);max=Math.max(max,p.y);}
    }
    const height=Math.max(max-min,1e-8);
    const buffers: { mesh: Mesh; differences: Float32Array }[]=[];
    for(const entity of members){
      const positions=entity===reference?base:localPositions(entity);
      if(positions.length!==base.length) throw new Error(tr('The comparison meshes do not match.'));
      let maximum=0,sum=0,count=0;
      positions.forEach((data,j)=>{
        if(data.length!==base[j].length || !(entity.meshes[j] instanceof Mesh)) throw new Error(tr('The comparison meshes do not match.'));
        const differences=new Float32Array(data.length/3);
        for(let i=0;i<data.length;i+=3){
          const d=Math.hypot(data[i]-base[j][i],data[i+1]-base[j][i+1],data[i+2]-base[j][i+2])/height*100;
          differences[i/3]=d;maximum=Math.max(maximum,d);sum+=d;count++;
        }
        buffers.push({mesh:entity.meshes[j] as Mesh,differences});
      });
      this.summaries.push({entity,maximum,mean:sum/Math.max(1,count)});
    }
    const shader=new ShaderMaterial('Rig differences',this.editor.scene,{
      vertexSource:`precision highp float;
        attribute vec3 position; attribute float rigDifference;
        uniform mat4 viewProjection; uniform float differenceScale;
        #include<bonesDeclaration>
        #include<morphTargetsVertexGlobalDeclaration>
        #include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
        #include<instancesDeclaration>
        varying float amount;
        void main(){vec3 positionUpdated=position;
          #include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
          #include<instancesVertex>
          #include<bonesVertex>
          amount=clamp(rigDifference/differenceScale,0.0,1.0);
          gl_Position=viewProjection*finalWorld*vec4(positionUpdated,1.0);
        }`,
      fragmentSource:`precision highp float;
        varying float amount; uniform vec3 lowColor; uniform vec3 midColor; uniform vec3 highColor;
        void main(){vec3 c=amount<0.5?mix(lowColor,midColor,amount*2.0):mix(midColor,highColor,(amount-0.5)*2.0);gl_FragColor=vec4(c,1.0);}`,
    },{attributes:['position',ATTRIBUTE,'matricesIndices','matricesWeights'],uniforms:['world','viewProjection','differenceScale','lowColor','midColor','highColor']});
    shader.backFaceCulling=false;shader.setFloat('differenceScale',scale);
    shader.setColor3('lowColor',palette[0]);shader.setColor3('midColor',palette[1]);shader.setColor3('highColor',palette[2]);
    this.shader=shader;
    for(const {mesh,differences} of buffers){this.materials.set(mesh,mesh.material);mesh.setVerticesData(ATTRIBUTE,differences,false,1);mesh.material=shader;}
    this.group=reference.rig.data.comparison ?? null;
    this.poseSnapshot=members.map(entity=>({entity,values:Float64Array.from([...entity.rig!.joints.values()].flatMap(n=>[n.position.x,n.position.y,n.position.z,n.rotationQuaternion?.x ?? 0,n.rotationQuaternion?.y ?? 0,n.rotationQuaternion?.z ?? 0,n.rotationQuaternion?.w ?? 1]))}));
    this.morphSnapshot=members.flatMap(e=>e.meshes.filter(m=>m.morphTargetManager).map(mesh=>({mesh,influences:Float64Array.from(Array.from({length:mesh.morphTargetManager!.numTargets},(_,i)=>mesh.morphTargetManager!.getTarget(i).influence))})));
    this.editor.invalidate();
  }
}
