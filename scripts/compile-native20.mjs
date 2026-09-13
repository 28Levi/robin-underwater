import fs from 'node:fs';import solc from 'solc';import {createHash} from 'node:crypto';
const root='vendor/programmable-native20',reviewed=JSON.parse(fs.readFileSync(`${root}/artifact.json`));
if(solc.version()!==reviewed.compilerVersion)throw Error('Canonical compiler mismatch');
const dependencies=JSON.parse(fs.readFileSync(`${root}/native20-dependencies.json`));
const kernel=structuredClone(reviewed.standardJsonInput),native=structuredClone(kernel);
native.sources={...native.sources,...dependencies.sources};
for(const name of ['RobinhoodNative20Token','RobinhoodNative20Initializer'])native.sources[`src/${name}.sol`]={content:fs.readFileSync(`${root}/src/${name}.sol`,'utf8')};
fs.mkdirSync('artifacts',{recursive:true});
const evidence={compiler:solc.version(),sourceCommit:'b17e40b9ff20bb16feb857bf77451b0a590e7105',units:{}};
for(const [unit,input] of [['kernel',kernel],['native20',native]]){
 const output=JSON.parse(solc.compile(JSON.stringify(input)));
 const errors=(output.errors??[]).filter(e=>e.severity==='error');if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
 evidence.units[unit]=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 fs.writeFileSync(`artifacts/standard-json-${unit}.json`,JSON.stringify(input));
 const names=unit==='kernel'?['RobinhoodNativeFeeHookV1','RobinhoodNativeFeeVaultV1']:['RobinhoodNative20Token','RobinhoodNative20Initializer'];
 for(const [source,contracts] of Object.entries(output.contracts))for(const [name,c] of Object.entries(contracts))if(names.includes(name)){
  if(name==='RobinhoodNativeFeeHookV1'&&'0x'+c.evm.bytecode.object!==reviewed.kernel.creationBytecode)throw Error('Reviewed kernel bytecode mismatch');
  fs.writeFileSync(`artifacts/${name}.json`,JSON.stringify({source,contractName:name,abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,
   deployedBytecode:'0x'+c.evm.deployedBytecode.object,immutableReferences:c.evm.deployedBytecode.immutableReferences},null,2));
 }
}
fs.writeFileSync('artifacts/native20-build-evidence.json',JSON.stringify(evidence,null,2));
console.log('Canonical Native20 kernel bytecode reproduced exactly; token and initializer compiled together.');
