import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const root=process.cwd(),destination=path.resolve(process.argv[2]??'output/source-release');
if(fs.existsSync(destination)&&fs.readdirSync(destination).length)throw Error('Release destination must be empty; preserve prior releases');
fs.mkdirSync(destination,{recursive:true});
const roots=['src','contracts','test','vendor','assets','docs','package.json','package-lock.json','README.md','.gitignore','.dockerignore','Dockerfile',
 'config.example.json','execution.example.json','production.execution.example.json','hardhat.config.cjs','hardhat.native20.config.cjs','launch-intent.json',
 'scripts/compile.mjs','scripts/compile-native20.mjs','scripts/demo.mjs','scripts/check-platform.mjs','scripts/snapshot.mjs','scripts/prepare-payout.mjs',
 'scripts/operator.mjs','scripts/executor.mjs','scripts/production-operator.mjs','scripts/estimate-launch-gas.mjs','scripts/refresh-platform.mjs','scripts/build-release.mjs',
 'research/coverage.json','research/capabilities.json','research/readiness.json','research/router-test-provenance.json','research/permit2-sourcify.json','research/current'];
const files=[];
function copy(relative){const source=path.join(root,relative),stat=fs.lstatSync(source);if(stat.isSymbolicLink())throw Error('Symlinks are not release inputs');
 if(stat.isDirectory()){for(const item of fs.readdirSync(source).sort())copy(path.posix.join(relative,item));return;}
 const bytes=fs.readFileSync(source),text=bytes.toString('utf8');
 if(/pm_live_[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))throw Error(`Secret-like content in ${relative}; release stopped`);
 const target=path.join(destination,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
 files.push({path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
roots.forEach(copy);
fs.writeFileSync(path.join(destination,'release-manifest.json'),JSON.stringify({schemaVersion:'robin.source-release.v1',createdAt:new Date().toISOString(),
 status:'source-for-review; no production deployment or platform acceptance',files},null,2));
console.log(JSON.stringify({directory:destination,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0)}));
