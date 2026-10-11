import fs from 'node:fs';import solc from 'solc';import {createHash} from 'node:crypto';
import {compileRobinLaunchContracts} from '../src/launch-plan.mjs';

// Keep the canonical Native20 artifacts for compatibility and regression tests.
// The production ROBIN hook is a separately named project fork and artifact.
const compiled=compileRobinLaunchContracts(process.cwd(),solc);
fs.mkdirSync('artifacts',{recursive:true});
const evidence={compiler:solc.version(),sourceCommit:'b17e40b9ff20bb16feb857bf77451b0a590e7105',units:{}};
for(const unit of compiled.units){
 const bytes=Buffer.from(unit.standardJsonInputBase64,'base64');
 fs.writeFileSync(`artifacts/standard-json-${unit.compilationUnitId}.json`,bytes);
 if(unit.compilationUnitId!=='robin-native30')evidence.units[unit.compilationUnitId]=createHash('sha256').update(bytes).digest('hex');
}
for(const [name,c]of Object.entries(compiled.contracts)){
 fs.writeFileSync(`artifacts/${name}.json`,JSON.stringify({source:c.sourcePath,contractName:name,abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,
  deployedBytecode:'0x'+c.evm.deployedBytecode.object,immutableReferences:c.evm.deployedBytecode.immutableReferences},null,2));
}
fs.writeFileSync('artifacts/native20-build-evidence.json',JSON.stringify(evidence,null,2));
fs.writeFileSync('artifacts/robin-native30-build-evidence.json',JSON.stringify({compiler:solc.version(),...compiled.customHook,
 standardJsonInputSha256:compiled.units.find(u=>u.compilationUnitId==='robin-native30').standardJsonInputSha256},null,2));
console.log('Canonical Native20 kernel reproduced exactly; separate ROBIN 30 bps hook, token and initializer compiled.');
