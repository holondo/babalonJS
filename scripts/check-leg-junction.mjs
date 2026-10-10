import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=ts.transpileModule(fs.readFileSync(new URL('../src/bodyLandmarks.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText;
const {findLegJunction}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function body(scale=1){
  const u=[],v=[],w=[];
  const ring=(x,y,rx,rz)=>{for(let j=0;j<48;j++){const a=j/48*Math.PI*2;u.push((x+rx*Math.cos(a))*scale);v.push(y*scale);w.push(rz*Math.sin(a)*scale);}};
  for(let y=.05;y<.8;y+=.005){
    if(y<.44){ring(-.06,y,.035,.045);ring(.06,y,.035,.045);}
    else {const rx=y<.51?.1+(y-.44)*.43:y<.6?.13-(y-.51)*.5:.085;ring(0,y,rx,.07);}
  }
  // Sparse surface details on the center line below the real leg merge.
  for(const y of [.32,.36,.38]){u.push(0);v.push(y*scale);w.push(0);}
  return {u,v,w};
}
const p=body(),estimate=findLegJunction(p.u,p.v,p.w,1);
assert.ok(estimate.split>.42 && estimate.split<.47,'Sparse central vertices must not lower the detected leg split');
assert.ok(estimate.hips.v>estimate.left.v+.02,'The skeleton root must sit above the hip pivots');
assert.ok(estimate.hips.v>.52 && estimate.hips.v<.6,'The trunk profile must place the root above the leg split, not at it');
assert.ok(Math.abs(estimate.left.u+.06)<.008 && Math.abs(estimate.right.u-.06)<.008,'Several thigh sections must recover both leg axes');
const larger=body(3),scaled=findLegJunction(larger.u,larger.v,larger.w,3);
assert.ok(Math.abs(scaled.hips.v/3-estimate.hips.v)<1e-8,'Detection must scale with the model');
const hands=body();
for(let y=.32;y<.42;y+=.005) for(const side of [-1,1]) for(let j=0;j<48;j++) {
  const a=j/48*Math.PI*2;hands.u.push(side*.15+.02*Math.cos(a));hands.v.push(y);hands.w.push(.035*Math.sin(a));
}
const withHands=findLegJunction(hands.u,hands.v,hands.w,1);
assert.ok(Math.abs(withHands.left.u-estimate.left.u)<.005 && Math.abs(withHands.right.u-estimate.right.u)<.005,'Separate lowered hands must not move the thigh axes');
console.log('Leg junction: stable leg split, skeleton root, both thigh axes and scale invariance pass');
