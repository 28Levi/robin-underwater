import test from 'node:test';import assert from 'node:assert/strict';import {Interface} from 'ethers';
import {decodeReceipt,hookInterface} from '../src/receipt-adapter.mjs';
const a=n=>'0x'+n.toString(16).padStart(40,'0');
const c={token:a(1),hook:a(2),poolManager:a(3),poolId:'0x'+'1'.repeat(64),time:100};
const erc20=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
function transfer(from,to,amount=100n,index=1){return {address:c.token,index,...erc20.encodeEventLog(erc20.getEvent('Transfer'),[from,to,amount])};}
function trade(buy=true){return {address:c.hook,index:0,...hookInterface.encodeEventLog(hookInterface.getEvent('TradeObserved'),[c.poolId,a(8),buy,100n,20n,1n,1n<<96n,0])};}
const receipt=logs=>({hash:'0x'+'2'.repeat(64),status:1,logs});
test('buy forwarded through router goes to final recipient, not router or transaction sender',()=>{
 const d=decodeReceipt(receipt([trade(),transfer(a(3),a(8)),transfer(a(8),a(9),100n,2)]),c);
 assert.equal(d.supported,true);assert.equal(d.events[0].account,a(9));assert.equal(d.events[0].costWei,20n);
});
test('sell funded through router removes basis from original token sender',()=>{
 const d=decodeReceipt(receipt([transfer(a(9),a(8)),trade(false),transfer(a(8),a(3),100n,2)]),c);
 assert.equal(d.supported,true);assert.equal(d.events[0].account,a(9));assert.equal(d.events[0].type,'sell');
});
test('multi-swap, split delivery and cycles are excluded instead of invented attribution',()=>{
 for(const logs of [[trade(),trade(false),transfer(a(3),a(9))],
 [trade(),transfer(a(3),a(9),50n),transfer(a(3),a(8),50n,2)],
 [trade(),transfer(a(3),a(8)),transfer(a(8),a(3),100n,2)]])assert.equal(decodeReceipt(receipt(logs),c).supported,false);
});
test('plain gifts preserve transfer events; unrecognized pool flows are excluded',()=>{
 const d=decodeReceipt(receipt([transfer(a(9),a(10))]),c);assert.equal(d.events[0].type,'transfer');
 assert.equal(decodeReceipt(receipt([transfer(a(3),a(9))]),c).supported,false);
});
