import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import solc from 'solc';
import {ContractFactory,keccak256} from 'ethers';
import {native20Fixture,E} from '../test/helpers/native20-fixture.mjs';
import {buildSnapshot} from '../src/replay.mjs';
import {LossLedger,stringify} from '../src/ledger.mjs';
process.env.HARDHAT_CONFIG=path.resolve('hardhat.native20.config.cjs');
const {default:hre}=await import('hardhat');
const source=`pragma solidity 0.8.26;
interface T {function balanceOf(address) external view returns(uint256); function transfer(address,uint256) external returns(bool);}
contract MoveOnReward {T immutable token; address immutable destination;
constructor(address t,address d){token=T(t);destination=d;}
receive() external payable {require(token.transfer(destination,token.balanceOf(address(this))));}}
`;
const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Probe.sol':{content:source}},settings:{optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
assert.equal((compiled.errors??[]).filter(e=>e.severity==='error').length,0);
const a=compiled.contracts['Probe.sol'].MoveOnReward;
test('reward callback transfer carries credited relief through canonical HOOD replay', async()=>{
const f=await native20Fixture(hre,{operatorIndex:3,name:'HOOD',symbol:'HOOD',firstBuyWei:E/100n});
try{
 const {provider,alice,bob,keeper,token,reward,feeVault,swap,c}=f;
 const destination=await(await provider.getSigner(6)).getAddress();
 const receiver=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,alice).deploy(await token.getAddress(),destination);await receiver.waitForDeployment();
 const receiverAddress=await receiver.getAddress();
 await swap(bob,true,E);await swap(alice,true,E/10n);await swap(bob,false,await token.balanceOf(await bob.getAddress()));
 await(await token.connect(alice).transfer(receiverAddress,await token.balanceOf(await alice.getAddress()))).wait();
 await hre.network.provider.send('evm_increaseTime',[3700]);await hre.network.provider.send('evm_mine');
 await(await feeVault.connect(keeper).claimCreator()).wait();
 const before=await buildSnapshot(provider,c),ledger=LossLedger.restore(before.ledger);
 const loss=ledger.shortfalls({...before.oracle,now:before.checkpoint.timestamp}).find(x=>x.account===receiverAddress.toLowerCase()).loss;
 const available=await reward.available();const paid=loss/2n<available?loss/2n:available;assert.ok(paid>0n);
 const receipt=await(await reward.connect(keeper).distributeEligible(keccak256('0xaabb'),keccak256('0xccdd'),c.token,before.checkpoint.timestamp+300,[receiverAddress],[paid],[ledger.get(receiverAddress).balance])).wait();
 const events=receipt.logs.map(l=>{try{return reward.interface.parseLog(l);}catch{return null;}});
 assert.ok(events.some(p=>p?.name==='RewardPaid'&&p.args.recipient===receiverAddress));
 assert.equal(await token.balanceOf(receiverAddress),0n);assert.ok(await token.balanceOf(destination)>0n);
 const full=await buildSnapshot(provider,c),incremental=await buildSnapshot(provider,c,before);
 assert.equal(incremental.ledger,full.ledger);
 const after=LossLedger.restore(full.ledger);
 assert.equal(after.get(destination).cost,ledger.get(receiverAddress).cost);
 const reproduced=after.get(destination).relief===0n&&after.get(receiverAddress).relief===paid;
 assert.equal(reproduced,false);assert.equal(after.get(destination).relief,paid);assert.equal(after.get(receiverAddress).relief,0n);
 await hre.network.provider.send('evm_increaseTime',[3700]);await hre.network.provider.send('evm_mine');
 const later=await buildSnapshot(provider,c),laterLedger=LossLedger.restore(later.ledger);
 const actualLoss=laterLedger.shortfalls({...later.oracle,now:later.checkpoint.timestamp}).find(x=>x.account===destination.toLowerCase()).loss;
 assert.equal(actualLoss,loss-paid);
 assert.equal(await token.name(),'HOOD');assert.equal(await token.symbol(),'HOOD');
}finally{f.provider.destroy();}
});
