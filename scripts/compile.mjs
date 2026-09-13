import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';

export function compile() {
  const sources = {};
  function collect(dir) { for (const item of fs.readdirSync(dir, {withFileTypes:true})) {
    const p = path.posix.join(dir, item.name);
    if (item.isDirectory()) collect(p); else if (p.endsWith('.sol')) sources[p] = {content:fs.readFileSync(p,'utf8')};
  }}
  collect('contracts');
  const input = {language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,
    evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
  function findImports(name) {
    const candidates = [name, path.join('node_modules',name),
      path.join('node_modules/@uniswap/v4-core/lib',name),
      path.join('node_modules/@uniswap/v4-core',name)];
    for (const p of candidates) if (fs.existsSync(p)) return {contents:fs.readFileSync(p,'utf8')};
    return {error:`Missing ${name}`};
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input), {import:findImports}));
  const errors = (output.errors??[]).filter(e=>e.severity==='error');
  if(errors.length) throw new Error(errors.map(e=>e.formattedMessage).join('\n'));
  fs.mkdirSync('artifacts',{recursive:true});
  for (const [source,contracts] of Object.entries(output.contracts)) for (const [name,c] of Object.entries(contracts)) {
    if(c.evm.bytecode.object) fs.writeFileSync(`artifacts/${name}.json`,JSON.stringify({source,contractName:name,
      abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,deployedBytecode:'0x'+c.evm.deployedBytecode.object},null,2));
  }
  fs.writeFileSync('artifacts/compiler-input.json',JSON.stringify(input));
  console.log(`Compiled with ${solc.version()} (Cancun, optimizer 200, viaIR).`);
  return output;
}
if(process.argv[1]?.endsWith('compile.mjs')) compile();
