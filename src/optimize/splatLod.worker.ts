/// <reference lib="webworker" />
import { buildSplatLod, selectSplatLod } from './splatLodMath';
import type { SplatLodTree, LodInstance, LodView } from './splatLodMath';
const trees:SplatLodTree[]=[];
self.onmessage=(event:MessageEvent<{id:number;type:'build';data:ArrayBuffer;flipY:boolean}|{id:number;type:'select';instances:LodInstance[];view:LodView;budget:number}>)=>{
  const request=event.data;
  try {
    if(request.type==='build') {
      const tree=buildSplatLod(request.data,request.flipY),index=trees.push(tree)-1;
      const data=tree.data;tree.data=new ArrayBuffer(0); // Worker keeps only traversal data.
      self.postMessage({id:request.id,tree:index,data,root:tree.root,sourceCount:tree.sourceCount,leafCount:tree.leafCount},[data]);
    } else self.postMessage({id:request.id,ranges:selectSplatLod(trees,request.instances,request.view,request.budget)});
  }catch(error){self.postMessage({id:request.id,error:error instanceof Error?error.message:String(error)});}
};
