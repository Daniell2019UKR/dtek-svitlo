import test from 'node:test';
import assert from 'node:assert/strict';
import {createTransportSelector} from './transport.js';

test('healthy transports alternate direct then VPN',async()=>{
 const selector=createTransportSelector({proxyUrl:'http://vpn',healthUrl:'http://health',fetchImpl:async()=>Response.json({healthy:true})});
 assert.deepEqual((await Promise.all([selector.take(),selector.take()])).map(route=>route.name),['direct','vpn']);
 assert.equal((await selector.take()).name,'direct');
 assert.equal((await selector.take()).name,'vpn');
});
test('VPN outage uses only direct requests, with cooldown before health probes and recovery',async()=>{
 let instant=0,healthy=false,probes=0;
 const selector=createTransportSelector({proxyUrl:'http://vpn',healthUrl:'http://health',now:()=>instant,fetchImpl:async()=>{probes++;return Response.json({healthy},{status:healthy?200:503});}});
 assert.equal((await selector.take()).name,'direct');
 assert.equal((await selector.take()).name,'direct');
 assert.equal(probes,1);
 instant=1000;
 assert.equal((await selector.take()).name,'direct');
 assert.equal(probes,1);
 healthy=true;instant=60001;
 const route=await selector.take();assert.equal(route.name,'vpn');
 selector.failed(route);
 assert.equal((await selector.take()).name,'direct');
 assert.equal(probes,2);
 instant+=60001;
 assert.equal((await selector.take()).name,'vpn');
});
