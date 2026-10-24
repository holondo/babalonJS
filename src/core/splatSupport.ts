import '@babylonjs/core/Materials/GaussianSplatting/gaussianSplattingMaterial.js';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';

// Babylon 9.30's GLSL splat depth shader calls this worldPosGS, but its
// ShadowDepthWrapper injects point-light distance code referencing worldPos.
// Match the wrapper (and Babylon's WGSL shader) until upstream fixes the name.
const key = 'gaussianSplattingDepthVertexShader';
ShaderStore.ShadersStore[key] = ShaderStore.ShadersStore[key].replace(/\bworldPosGS\b/g, 'worldPos');
