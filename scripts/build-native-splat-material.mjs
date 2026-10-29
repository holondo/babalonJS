import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
const matc=process.env.FILAMENT_MATC??'matc';
const version=execFileSync(matc,['--version'],{encoding:'utf8'}).trim();
if(version!=='52')throw new Error(`Expected Filament 1.52.0 material ABI 52; got ${version}`);
mkdirSync('android/app/src/main/assets/materials',{recursive:true});
execFileSync(matc,['-a','opengl','-p','mobile','-o','android/app/src/main/assets/materials/gaussian.filamat','android/app/src/main/materials/gaussian.mat'],{stdio:'inherit'});
console.log('Compiled native Gaussian material for Filament 1.52.0 (OpenGL mobile).');
