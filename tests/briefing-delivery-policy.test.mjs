import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryHandoff,normalizeDeliveryContext,planBriefingDelivery} from '../src/briefing-delivery-policy.js';

const briefing=(overrides={})=>({id:'B1',status:'pending',urgency:'medium',confidence:.9,summary:'Keys moved.',evidence:{roomId:'ROOM01'},...overrides});

test('delivery context defaults to disconnected and no voice authority',()=>{
 const c=normalizeDeliveryContext({},1000);
 assert.equal(c.agentConnected,false);
 assert.equal(c.voiceEnabled,false);
});
test('disconnected Agent defers all nonterminal briefings',()=>{
 const p=planBriefingDelivery(briefing({urgency:'high'}),{agentConnected:false},1000);
 assert.equal(p.state,'deferred');assert.equal(p.reason,'agent-disconnected');assert.equal(p.ready,false);
});
test('high urgency breaks through an active conversation when connected',()=>{
 const p=planBriefingDelivery(briefing({urgency:'high'}),{agentConnected:true,conversationActive:true,voiceEnabled:true},1000);
 assert.equal(p.state,'ready');assert.equal(p.interrupt,true);assert.equal(p.voiceEligible,true);
});
test('medium urgency defers during active conversation',()=>{
 const p=planBriefingDelivery(briefing(),{agentConnected:true,conversationActive:true},1000);
 assert.equal(p.state,'deferred');assert.equal(p.reason,'active-conversation');
});
test('low urgency becomes digest instead of interrupting',()=>{
 const p=planBriefingDelivery(briefing({urgency:'info'}),{agentConnected:true},1000);
 assert.equal(p.state,'digest');
});
test('medium room-relevant briefing is ready when Agent is free',()=>{
 const p=planBriefingDelivery(briefing(),{agentConnected:true,activeRoomId:'ROOM01'},1000);
 assert.equal(p.state,'ready');assert.equal(p.reason,'active-room-relevant');
});
test('medium off-room briefing waits for an attention window',()=>{
 const p=planBriefingDelivery(briefing(),{agentConnected:true,activeRoomId:'ROOM02',agentIdleMs:0},1000);
 assert.equal(p.state,'queued');
});
test('DND defers non-high briefings but does not block high urgency',()=>{
 assert.equal(planBriefingDelivery(briefing(),{agentConnected:true,doNotDisturb:true},1000).state,'deferred');
 assert.equal(planBriefingDelivery(briefing({urgency:'high'}),{agentConnected:true,doNotDisturb:true},1000).state,'ready');
});
test('low confidence non-high briefing is deferred',()=>{
 const p=planBriefingDelivery(briefing({confidence:.4}),{agentConnected:true,activeRoomId:'ROOM01'},1000);
 assert.equal(p.reason,'low-confidence');
});
test('handoff exposes voice eligibility but explicitly forbids direct TTS',()=>{
 const p=planBriefingDelivery(briefing({urgency:'high'}),{agentConnected:true,voiceEnabled:true},1000);
 const h=deliveryHandoff(briefing({urgency:'high'}),p,{agentConnected:true,voiceEnabled:true},1000);
 assert.equal(h.voice.eligible,true);assert.equal(h.voice.mode,'handoff-only');
 assert.ok(h.boundaries.includes('no-direct-tts'));
});
