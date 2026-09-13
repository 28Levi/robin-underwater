import fs from 'node:fs';
import {LossLedger,stringify} from '../src/ledger.mjs';
const eth=10n**18n;
const ledger=new LossLedger();
const people=[['Alice','0x0000000000000000000000000000000000000001',2n],
 ['Bob','0x0000000000000000000000000000000000000002',6n],
 ['Charlie','0x0000000000000000000000000000000000000003',5n]];
for(const [name,account,cost] of people)ledger.apply({id:name,type:'buy',time:0,account,amount:4n*eth,costWei:cost*eth});
const plan=ledger.plan(eth*3n/10n,{priceWeiPerToken:eth,observedAt:7200,now:7200});
fs.mkdirSync('output',{recursive:true});fs.writeFileSync('output/demo-allocation.json',stringify(plan));
console.log('Illustration: each holds 4 tokens at 1 ETH/token. Alice paid 2 ETH, Bob 6, Charlie 5.');
for(const [name,account] of people)console.log(`${name}: reward ${Number(plan.allocations.find(a=>a.account===account)?.amount??0n)/1e18} ETH`);
console.log('Allocation audit:',plan.auditHash,'\nNo transactions sent.');
