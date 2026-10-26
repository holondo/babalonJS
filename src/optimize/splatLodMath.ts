/** Pure Gaussian moment aggregation and budgeted spatial traversal (worker and checks). */
export interface SplatLodTree {
  data: ArrayBuffer;
  positions: Float32Array;
  radii: Float32Array;
  children: Int32Array;
  root: number;
  sourceCount: number;
  leafCount: number;
}

const area = (x: number, y: number, z: number) => Math.max(1e-16, Math.sqrt(x*x*y*y + x*x*z*z + y*y*z*z));
const byte = (x: number) => Math.round(Math.max(0, Math.min(255, x)));

/** Linear scales and packed wxyz rotation -> symmetric covariance in render-local space. */
function covariance(f: Float32Array, b: Uint8Array, i: number, out: Float64Array) {
  const o = i * 32, p = i * 8;
  let w = b[o+28]-127.5, x = b[o+29]-127.5, y = b[o+30]-127.5, z = b[o+31]-127.5;
  const n = Math.hypot(w,x,y,z); w/=n; x/=n; y/=n; z/=n;
  const r = [1-2*(y*y+z*z), 2*(x*y-w*z), 2*(x*z+w*y),
    2*(x*y+w*z), 1-2*(x*x+z*z), 2*(y*z-w*x),
    2*(x*z-w*y), 2*(y*z+w*x), 1-2*(x*x+y*y)];
  for (let a=0;a<3;a++) for (let c=0;c<3;c++) {
    let sum=0; for (let k=0;k<3;k++) sum+=r[a*3+k]*r[c*3+k]*f[p+3+k]**2;
    out[a*3+c]=sum;
  }
}

/** Jacobi eigendecomposition: principal axes and scales, then a normalized quaternion. */
function encodeCovariance(a: Float64Array, vectors: Float64Array, f: Float32Array, b: Uint8Array, index: number) {
  vectors.fill(0); vectors[0]=vectors[4]=vectors[8]=1;
  for (let iteration=0;iteration<16;iteration++) {
    let p=0,q=1;
    if (Math.abs(a[2])>Math.abs(a[1])) {p=0;q=2;}
    if (Math.abs(a[5])>Math.abs(a[p*3+q])) {p=1;q=2;}
    const off=a[p*3+q];
    if (Math.abs(off)<1e-15) break;
    const tau=(a[q*3+q]-a[p*3+p])/(2*off);
    const t=(tau>=0?1:-1)/(Math.abs(tau)+Math.sqrt(1+tau*tau)), c=1/Math.sqrt(1+t*t), s=t*c;
    a[p*3+p]-=t*off; a[q*3+q]+=t*off; a[p*3+q]=a[q*3+p]=0;
    for (let k=0;k<3;k++) {
      if (k!==p&&k!==q) {
        const ap=a[k*3+p], aq=a[k*3+q];
        a[k*3+p]=a[p*3+k]=c*ap-s*aq; a[k*3+q]=a[q*3+k]=s*ap+c*aq;
      }
      const vp=vectors[k*3+p], vq=vectors[k*3+q];
      vectors[k*3+p]=c*vp-s*vq; vectors[k*3+q]=s*vp+c*vq;
    }
  }
  const p=index*8, o=index*32;
  for (let k=0;k<3;k++) f[p+3+k]=Math.sqrt(Math.max(1e-16,a[k*3+k]));
  const m=vectors, trace=m[0]+m[4]+m[8];
  let w:number,x:number,y:number,z:number;
  if (trace>0) {const s=2*Math.sqrt(trace+1);w=s/4;x=(m[7]-m[5])/s;y=(m[2]-m[6])/s;z=(m[3]-m[1])/s;}
  else if (m[0]>m[4]&&m[0]>m[8]) {const s=2*Math.sqrt(1+m[0]-m[4]-m[8]);w=(m[7]-m[5])/s;x=s/4;y=(m[1]+m[3])/s;z=(m[2]+m[6])/s;}
  else if (m[4]>m[8]) {const s=2*Math.sqrt(1+m[4]-m[0]-m[8]);w=(m[2]-m[6])/s;x=(m[1]+m[3])/s;y=s/4;z=(m[5]+m[7])/s;}
  else {const s=2*Math.sqrt(1+m[8]-m[0]-m[4]);w=(m[3]-m[1])/s;x=(m[2]+m[6])/s;y=(m[5]+m[7])/s;z=s/4;}
  const n=Math.hypot(w,x,y,z);
  b[o+28]=byte(w/n*127.5+127.5); b[o+29]=byte(x/n*127.5+127.5);
  b[o+30]=byte(y/n*127.5+127.5); b[o+31]=byte(z/n*127.5+127.5);
}

function spread(value: number) {
  value=(value|(value<<16))&0x030000ff; value=(value|(value<<8))&0x0300f00f;
  value=(value|(value<<4))&0x030c30c3; return (value|(value<<2))&0x09249249;
}

/** A bounded atlas: full data stays in the editor; AR gets up to 131072 fine representatives. */
export function buildSplatLod(input: ArrayBuffer, flipY = false, maxLeaves = 131072): SplatLodTree {
  const sourceCount=input.byteLength/32;
  if (!Number.isInteger(sourceCount)||!sourceCount) throw new Error('Invalid Gaussian source');
  const sf=new Float32Array(input), sb=new Uint8Array(input), order=new Uint32Array(sourceCount), codes=new Uint32Array(sourceCount);
  const min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
  for (let i=0;i<sourceCount;i++) for (let c=0;c<3;c++) {
    const v=sf[i*8+c]; if (!Number.isFinite(v)) throw new Error('Non-finite Gaussian center');
    if(!Number.isFinite(sf[i*8+c+3]))throw new Error('Non-finite Gaussian scale');
    min[c]=Math.min(min[c],v);max[c]=Math.max(max[c],v);
  }
  for (let i=0;i<sourceCount;i++) {
    order[i]=i;
    codes[i]=spread(Math.min(1023,Math.floor((sf[i*8]-min[0])/(max[0]-min[0]||1)*1023))) |
      spread(Math.min(1023,Math.floor((sf[i*8+1]-min[1])/(max[1]-min[1]||1)*1023)))<<1 |
      spread(Math.min(1023,Math.floor((sf[i*8+2]-min[2])/(max[2]-min[2]||1)*1023)))<<2;
  }
  order.sort((a,b)=>codes[a]-codes[b]||a-b);
  const leafCount=Math.min(sourceCount,Math.max(1,Math.floor(maxLeaves)));
  let nodeCount=0; for (let n=leafCount;;n=Math.ceil(n/2)) {nodeCount+=n;if(n===1)break;}
  const data=new ArrayBuffer(nodeCount*32), f=new Float32Array(data), b=new Uint8Array(data);
  const children=new Int32Array(nodeCount*2).fill(-1), radii=new Float32Array(nodeCount), weights=new Float64Array(nodeCount);
  const a=new Float64Array(9), c=new Float64Array(9), merged=new Float64Array(9), vectors=new Float64Array(9);
  const mass=(f:Float32Array,b:Uint8Array,i:number)=>b[i*32+27]/255*area(f[i*8+3],f[i*8+4],f[i*8+5]);
  const merge=(af:Float32Array,ab:Uint8Array,ai:number,ar:number,aw:number,bf:Float32Array,bb:Uint8Array,bi:number,br:number,bw:number,dst:number,yFlip=false)=>{
    covariance(af,ab,ai,a);covariance(bf,bb,bi,c);
    const total=aw+bw, wa=total>1e-20?aw/total:.5, wb=1-wa;
    const ap=ai*8,bp=bi*8,dp=dst*8,ao=ai*32,bo=bi*32,doo=dst*32;
    const ax=af[ap],ay=af[ap+1],az=af[ap+2], bx=bf[bp],by=bf[bp+1]*(yFlip?-1:1),bz=bf[bp+2];
    const x=wa*ax+wb*bx,y=wa*ay+wb*by,z=wa*az+wb*bz;
    const da=[ax-x,ay-y,az-z],db=[bx-x,by-y,bz-z];
    for(let i=0;i<3;i++)for(let j=0;j<3;j++)merged[i*3+j]=wa*(a[i*3+j]+da[i]*da[j])+wb*(c[i*3+j]+db[i]*db[j]);
    const color=[0,1,2].map(k=>wa*ab[ao+24+k]+wb*bb[bo+24+k]);
    f[dp]=x;f[dp+1]=y;f[dp+2]=z;encodeCovariance(merged,vectors,f,b,dst);
    for(let k=0;k<3;k++)b[doo+24+k]=byte(color[k]);
    b[doo+27]=byte(total/area(f[dp+3],f[dp+4],f[dp+5])*255);
    radii[dst]=Math.max(Math.hypot(ax-x,ay-y,az-z)+ar,Math.hypot(bx-x,by-y,bz-z)+br);
    weights[dst]=total;
  };
  for(let i=0;i<leafCount;i++) {
    const start=Math.floor(i*sourceCount/leafCount),end=Math.floor((i+1)*sourceCount/leafCount),first=order[start];
    b.set(sb.subarray(first*32,first*32+32),i*32); if(flipY)f[i*8+1]*=-1;
    radii[i]=4*Math.max(Math.abs(f[i*8+3]),Math.abs(f[i*8+4]),Math.abs(f[i*8+5]));weights[i]=mass(sf,sb,first);
    for(let j=start+1;j<end;j++) {
      const next=order[j],r=4*Math.max(Math.abs(sf[next*8+3]),Math.abs(sf[next*8+4]),Math.abs(sf[next*8+5]));
      merge(f,b,i,radii[i],weights[i],sf,sb,next,r,mass(sf,sb,next),i,flipY);
    }
  }
  let offset=0,count=leafCount,nextOffset=leafCount;
  while(count>1) {
    const nextCount=Math.ceil(count/2);
    for(let j=0;j<nextCount;j++) {
      const left=offset+j*2,right=left+1<offset+count?left+1:-1,dst=nextOffset+j;
      children[dst*2]=left;children[dst*2+1]=right;
      if(right<0) {b.set(b.subarray(left*32,left*32+32),dst*32);radii[dst]=radii[left];weights[dst]=weights[left];}
      else merge(f,b,left,radii[left],weights[left],f,b,right,radii[right],weights[right],dst);
    }
    offset=nextOffset;count=nextCount;nextOffset+=nextCount;
  }
  const positions=new Float32Array(nodeCount*3);
  for(let i=0;i<nodeCount;i++)positions.set(f.subarray(i*8,i*8+3),i*3);
  return {data,positions,radii,children,root:nodeCount-1,sourceCount,leafCount};
}

export interface LodView { position: number[]; planes: number[]; focal: number; }
export interface LodInstance { tree: number; matrix: number[]; visible?: boolean; }
interface Candidate { instance: number; node: number; score: number; }

/** One global max-heap refines the largest projected bounds across all visible objects. */
export function selectSplatLod(trees: readonly SplatLodTree[], instances: readonly LodInstance[], view: LodView, budget: number, pixelError=6) {
  budget=Math.max(1,Math.floor(budget));
  const heap:Candidate[]=[], done:Candidate[]=[];
  const push=(x:Candidate)=>{let i=heap.length;heap.push(x);while(i){const p=(i-1)>>1;if(heap[p].score>=x.score)break;heap[i]=heap[p];i=p;}heap[i]=x;};
  const pop=()=>{const result=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let k=i*2+1;if(k+1<heap.length&&heap[k+1].score>heap[k].score)k++;if(heap[k].score<=last.score)break;heap[i]=heap[k];i=k;}heap[i]=last;}return result;};
  const scales=instances.map(({matrix:m})=>Math.sqrt(m[0]**2+m[1]**2+m[2]**2+m[4]**2+m[5]**2+m[6]**2+m[8]**2+m[9]**2+m[10]**2));
  const candidate=(instance:number,node:number):Candidate|null=>{
    if(instances[instance].visible===false)return null;
    const tree=trees[instances[instance].tree],m=instances[instance].matrix,p=node*3;
    const lx=tree.positions[p],ly=tree.positions[p+1],lz=tree.positions[p+2];
    const x=m[0]*lx+m[4]*ly+m[8]*lz+m[12],y=m[1]*lx+m[5]*ly+m[9]*lz+m[13],z=m[2]*lx+m[6]*ly+m[10]*lz+m[14];
    const r=tree.radii[node]*scales[instance], distance=Math.hypot(x-view.position[0],y-view.position[1],z-view.position[2]);
    const margin=r+distance*.15; // Conservative margin for asynchronous pose updates.
    for(let k=0;k<view.planes.length;k+=4)if(view.planes[k]*x+view.planes[k+1]*y+view.planes[k+2]*z+view.planes[k+3]<-margin)return null;
    return {instance,node,score:view.focal*r/Math.max(.01,distance-r)};
  };
  instances.forEach((instance,i)=>{const c=candidate(i,trees[instance.tree].root);if(c)push(c);});
  // In pathological scenes with more visible objects than the budget, keep the largest.
  if(heap.length>budget){heap.sort((a,b)=>a.score-b.score);heap.splice(0,heap.length-budget);const initial=heap.splice(0);initial.forEach(push);}
  let selected=heap.length;
  while(heap.length&&heap[0].score>pixelError) {
    const parent=pop(),tree=trees[instances[parent.instance].tree],left=tree.children[parent.node*2],right=tree.children[parent.node*2+1];
    if(left<0){done.push(parent);continue;}
    const a=candidate(parent.instance,left),b=right>=0?candidate(parent.instance,right):null,extra=(a?1:0)+(b?1:0)-1;
    if(selected+extra>budget){push(parent);break;}
    selected+=extra;if(a)push(a);if(b)push(b);
  }
  const indices=instances.map(()=>[] as number[]);
  for(const c of [...done,...heap])indices[c.instance].push(c.node);
  return indices.map(nodes=>{
    nodes.sort((a,b)=>a-b);const ranges:{offset:number;count:number}[]=[];
    for(const node of nodes){const last=ranges[ranges.length-1];if(last&&last.offset+last.count===node)last.count++;else ranges.push({offset:node,count:1});}
    return ranges;
  });
}
