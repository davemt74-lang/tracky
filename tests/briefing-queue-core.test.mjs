import test from 'node:test';
import assert from 'node:assert/strict';
import {acknowledgeQueuedBriefing,buildBriefingDigest,deferBriefing,enqueueBriefing,markBriefingSurfaced,readyBriefings,reevaluateBriefingQueue} from '../src/briefing-queue-core.js';

const b=(id='B1',overrides={})=>({id,status:'pending',type:'physical-world-watch',urgency:'medium',generatedAt:1000,watchId:'W1',summary:'Keys moved.',confidence:.9,evidence:{subjectId:'O1',roomId:'ROOM01'},...overrides});

test('enqueue plans delivery from context',()=>{
 const r=enqueueBriefing([],b(),{agentConnected:true,activeRoomId:'ROOM01'},1000);
 assert.equal(r.entry.deliveryState,'ready');assert.equal(r.entry.deliveryReady,true);
});
test('related duplicate briefing coalesces inside time window',()=>{
 const first=enqueueBriefing([],b('B1'),{agentConnected:true,activeRoomId:'ROOM01'},1000);
 const second=enqueueBriefing(first.queue,b('B2',{generatedAt:2000}),{agentConnected:true,activeRoomId:'ROOM01'},2000);
 assert.equal(second.coalesced,true);assert.equal(second.queue.length,1);assert.equal(second.entry.id,'B1');assert.equal(second.entry.occurrenceCount,2);
});
test('different physical goals never coalesce even with identical evidence',()=>{
 const one=b('B1',{type:'physical-world-goal',goalId:'G1'});
 const two=b('B2',{type:'physical-world-goal',goalId:'G2',generatedAt:2000});
 const first=enqueueBriefing([],one,{agentConnected:true,activeRoomId:'ROOM01'},1000);
 const second=enqueueBriefing(first.queue,two,{agentConnected:true,activeRoomId:'ROOM01'},2000);
 assert.equal(second.coalesced,false);assert.equal(second.queue.length,2);
});

test('different room evidence does not coalesce',()=>{
 const first=enqueueBriefing([],b('B1'),{agentConnected:true},1000);
 const second=enqueueBriefing(first.queue,b('B2',{evidence:{subjectId:'O1',roomId:'ROOM02'}}),{agentConnected:true},2000);
 assert.equal(second.coalesced,false);assert.equal(second.queue.length,2);
});
test('V2.2 pending briefing is migrated into the V2.3 queue on re-evaluation',()=>{
 const legacy={...b('B-legacy'),deliveryState:undefined,semanticKey:undefined,expiresAt:undefined};
 const q=reevaluateBriefingQueue([legacy],{agentConnected:false},2000);
 assert.ok(q[0].semanticKey);
 assert.equal(q[0].occurrenceCount,1);
 assert.equal(q[0].deliveryState,'deferred');
 assert.ok(q[0].expiresAt>2000);
});

test('reconnect re-evaluation promotes deferred high briefing to ready',()=>{
 const first=enqueueBriefing([],b('B1',{urgency:'high'}),{agentConnected:false},1000);
 assert.equal(first.entry.deliveryState,'deferred');
 const q=reevaluateBriefingQueue(first.queue,{agentConnected:true},2000);
 assert.equal(q[0].deliveryState,'ready');
});
test('active conversation re-evaluation defers medium briefing',()=>{
 const first=enqueueBriefing([],b(),{agentConnected:true,activeRoomId:'ROOM01'},1000);
 const q=reevaluateBriefingQueue(first.queue,{agentConnected:true,conversationActive:true},2000);
 assert.equal(q[0].deliveryState,'deferred');
});
test('surfaced, deferred and acknowledged lifecycle are explicit',()=>{
 let q=enqueueBriefing([],b(),{agentConnected:true,activeRoomId:'ROOM01'},1000).queue;
 q=markBriefingSurfaced(q,'B1',2000);assert.equal(q[0].deliveryState,'surfaced');
 q=[b('B2')];q=deferBriefing(q,'B2',60000,'user-deferred',2000);assert.equal(q[0].deliveryState,'deferred');
 q=acknowledgeQueuedBriefing(q,'B2',3000);assert.equal(q[0].deliveryState,'acknowledged');
});
test('user-deferred briefing stays deferred until retry time',()=>{
 let q=enqueueBriefing([],b(),{agentConnected:true,activeRoomId:'ROOM01'},1000).queue;
 q=deferBriefing(q,'B1',60000,'user-deferred',2000);
 q=reevaluateBriefingQueue(q,{agentConnected:true,activeRoomId:'ROOM01'},3000);
 assert.equal(q[0].deliveryState,'deferred');
 q=reevaluateBriefingQueue(q,{agentConnected:true,activeRoomId:'ROOM01'},62001);
 assert.equal(q[0].deliveryState,'ready');
});

test('delivery lifecycle records a bounded transition history',()=>{
 let q=enqueueBriefing([],b(),{agentConnected:false},1000).queue;
 assert.equal(q[0].deliveryHistory.at(-1).state,'deferred');
 q=reevaluateBriefingQueue(q,{agentConnected:true,activeRoomId:'ROOM01'},2000);
 assert.equal(q[0].deliveryHistory.at(-1).state,'ready');
 q=markBriefingSurfaced(q,'B1',3000);
 assert.equal(q[0].deliveryHistory.at(-1).state,'surfaced');
 q=acknowledgeQueuedBriefing(q,'B1',4000);
 assert.equal(q[0].deliveryHistory.at(-1).state,'acknowledged');
 assert.ok(q[0].deliveryHistory.length<=40);
});

test('ready selector only returns ready records',()=>{
 const q=[
  {...b('B1'),deliveryState:'ready',deliveryReady:true},
  {...b('B2'),deliveryState:'digest',deliveryReady:false}
 ];
 assert.deepEqual(readyBriefings(q).map(x=>x.id),['B1']);
});
test('digest combines low urgency updates into bounded semantic output',()=>{
 const q=[
  {...b('B1',{urgency:'info',summary:'A'}),deliveryState:'digest'},
  {...b('B2',{urgency:'low',summary:'B'}),deliveryState:'digest'}
 ];
 const d=buildBriefingDigest(q,8,3000);
 assert.equal(d.count,2);assert.deepEqual(d.briefingIds.sort(),['B1','B2']);
 assert.ok(d.boundaries.includes('no-direct-tts'));
});
test('expired queued briefing cannot remain ready',()=>{
 const q=reevaluateBriefingQueue([{...b('B1'),deliveryState:'queued',deliveryReady:false,expiresAt:1500}],{agentConnected:true},2000);
 assert.equal(q[0].deliveryState,'expired');assert.equal(q[0].deliveryReady,false);
});
