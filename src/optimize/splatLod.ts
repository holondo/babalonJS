import type { Editor } from '../core/editor';
import { EditorSplatMesh } from '../core/splatMesh';
import { isSplat } from '../core/splats';
import { materialToJSON, applyMaterial } from '../core/state';
import { Frustum } from '@babylonjs/core/Maths/math.frustum.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Observer } from '@babylonjs/core/Misc/observable.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { LodInstance, LodView } from './splatLodMath';

interface BuildResult { tree:number;data:ArrayBuffer;root:number;sourceCount:number;leafCount:number; }
interface Part { original:EditorSplatMesh;proxy:EditorSplatMesh;tree:number;root:number;visible:boolean;signature:string;loading:boolean; }

/** Disposable AR-only Gaussian atlas; originals and project assets are never rewritten. */
export class SplatLodController {
  readonly stats={source:0,pool:0,active:0,ready:false};
  budget=30000;
  enabled=false;
  private worker:Worker;
  private pending=new Map<number,{resolve:(result:any)=>void;reject:(error:Error)=>void}>();
  private requestId=0;
  private parts:Part[]=[];
  private disposed=false;
  private selecting=false;
  private lastSelection=-Infinity;
  private epoch=0;
  private observer:Observer<Scene>;
  private editor:Editor;
  private failed:(error:Error)=>void;

  constructor(editor:Editor,failed:(error:Error)=>void) {
    this.editor=editor;this.failed=failed;
    this.worker=new Worker(new URL('./splatLod.worker.ts',import.meta.url),{type:'module'});
    this.worker.onmessage=event=>{
      const job=this.pending.get(event.data.id);if(!job)return;
      this.pending.delete(event.data.id);
      if(event.data.error)job.reject(new Error(event.data.error));else job.resolve(event.data);
    };
    this.worker.onerror=event=>{
      const error=new Error(event.message||'Gaussian LOD worker failed');
      for(const job of this.pending.values())job.reject(error);this.pending.clear();
      if(!this.disposed)this.failed(error);
    };
    this.observer=editor.scene.onBeforeRenderObservable.add(()=>this.update());
  }

  private request<T>(payload:object,transfer:Transferable[]=[]):Promise<T> {
    if(this.disposed)return Promise.reject(new Error('Gaussian LOD cancelled'));
    const id=++this.requestId;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{resolve,reject});
      try{this.worker.postMessage({...payload,id},transfer);}catch(error){this.pending.delete(id);reject(error);}
    });
  }

  async prepare() {
    const cache=new Map<ArrayBuffer,Map<boolean,BuildResult>>();
    const originals=[...new Set(this.editor.entities.filter(e=>e.visible).flatMap(e=>e.meshes.filter(isSplat)))];
    try {
      for(const source of originals) {
        if(!source.splatsData)throw new Error('Gaussian source bytes are unavailable');
        const flipY=!!Reflect.get(source,'_flipY');
        let result=cache.get(source.splatsData)?.get(flipY);
        if(!result) {
          const copy=source.splatsData.slice(0);
          result=await this.request<BuildResult>({type:'build',data:copy,flipY},[copy]);
          if(this.disposed)return;
          if(!cache.has(source.splatsData))cache.set(source.splatsData,new Map());
          cache.get(source.splatsData)!.set(flipY,result);
        }
        if(this.disposed||source.isDisposed())return;
        const proxy=new EditorSplatMesh(`${source.name} AR LOD`,this.editor.scene);
        proxy.setEnabled(false);proxy.doNotSerialize=true;proxy.isPickable=false;
        // An invisible source mesh still carries transforms. Parenting the identity
        // proxy to it follows animations/affine edits without copying transforms each frame.
        proxy.parent=source;proxy.layerMask=source.layerMask;proxy.renderingGroupId=source.renderingGroupId;
        proxy.reservedDataStore={_gaussianSplattingSourceMesh:source};
        proxy.onSortReady=()=>this.editor.invalidate(33);
        const part:Part={original:source as EditorSplatMesh,proxy,tree:result.tree,root:result.root,visible:source.isVisible,signature:'',loading:true};
        this.parts.push(part); // Own the half-loaded proxy so cancellation can dispose it.
        try { await proxy.updateDataAsync(result.data,undefined,undefined,0); }
        finally {part.loading=false;if(this.disposed){proxy.material?.dispose();proxy.dispose();}}
        if(this.disposed)return;
        if(source.material&&proxy.material)applyMaterial(proxy.material,materialToJSON(source.material));
        proxy.shDegree=0;
        proxy.setSplatIndexRanges([{offset:result.root,count:1}]);
        this.stats.source+=result.sourceCount;this.stats.pool+=result.data.byteLength/32;
      }
      this.stats.ready=true;
    }catch(error){if(!this.disposed)throw error;}
  }

  replacement(mesh:AbstractMesh):AbstractMesh {
    const part=this.parts.find(p=>p.original===mesh||p.proxy===mesh);
    return part?(this.enabled?part.proxy:part.original):mesh;
  }

  setBudget(value:number) {
    if(!Number.isFinite(value))return;
    this.budget=Math.max(1000,Math.min(200000,Math.round(value)));this.epoch++;
    if(this.enabled)this.coarse();
    this.lastSelection=-Infinity;
  }

  private coarse() {
    this.parts.forEach((part,i)=>{
      const ranges=i<this.budget?[{offset:part.root,count:1}]:[];
      part.proxy.setSplatIndexRanges(ranges);part.signature='';
    });
    this.stats.active=Math.min(this.parts.length,this.budget);
  }

  setEnabled(on:boolean) {
    if(this.disposed)return;
    this.enabled=on&&this.stats.ready;this.epoch++;
    for(const part of this.parts) {
      part.original.isVisible=this.enabled?false:part.visible;
      part.proxy.isVisible=part.visible;
      part.proxy.setEnabled(this.enabled&&part.original.isEnabled(false));
    }
    if(this.enabled)this.coarse();else this.stats.active=this.stats.source;
    this.lastSelection=-Infinity;this.editor.invalidate();
  }

  update(force=false) {
    const now=performance.now();
    if(this.disposed||!this.enabled||this.selecting||!this.parts.length||!force&&now-this.lastSelection<150)return;
    const scene=this.editor.scene,camera=scene.activeCamera;
    if(!camera)return;
    camera.getViewMatrix();
    const planes=Frustum.GetPlanes(camera.getTransformationMatrix()).flatMap(p=>[p.normal.x,p.normal.y,p.normal.z,p.d]);
    const instances:LodInstance[]=this.parts.map(p=>({tree:p.tree,matrix:Array.from(p.proxy.computeWorldMatrix(true).m),visible:p.proxy.isEnabled()&&p.proxy.isVisible}));
    const view:LodView={position:camera.globalPosition.asArray(),planes,focal:Math.abs(camera.getProjectionMatrix().m[5])*this.editor.engine.getRenderHeight()/2};
    this.selecting=true;this.lastSelection=now;
    const epoch=this.epoch;
    void this.request<{ranges:{offset:number;count:number}[][]}>({type:'select',instances,view,budget:this.budget}).then(result=>{
      if(this.disposed||!this.enabled||epoch!==this.epoch)return;
      let active=0;
      result.ranges.forEach((ranges,i)=>{
        const signature=JSON.stringify(ranges),part=this.parts[i];
        if(signature!==part.signature){part.proxy.setSplatIndexRanges(ranges);part.signature=signature;}
        for(const range of ranges)active+=range.count;
      });
      this.stats.active=active;this.editor.invalidate(33);
    }).catch(error=>{if(!this.disposed)this.failed(error);}).finally(()=>{this.selecting=false;});
  }

  dispose() {
    if(this.disposed)return;
    this.setEnabled(false);this.disposed=true;
    this.editor.scene.onBeforeRenderObservable.remove(this.observer);this.worker.terminate();
    for(const job of this.pending.values())job.reject(new Error('Gaussian LOD cancelled'));this.pending.clear();
    for(const part of this.parts){part.original.isVisible=part.visible;if(!part.loading){part.proxy.material?.dispose();part.proxy.dispose();}}
    this.parts=[];
  }
}
