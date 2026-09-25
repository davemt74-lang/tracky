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
test('different room evidence does not coalesce',()=>{
 const first=enqueueBriefing([],b('B1'),{agentConnected:true},1000);
 const second=enqueueBriefing(first.queue,b('B2',{evidence:{subjectId:'O1',roomId:'ROOM02'}}),{agentConnected:true},2000);
 assert.equal(second.coalesced,false);assert.equal(second.queue.length,2);
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
