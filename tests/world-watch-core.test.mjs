import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateWorldWatch,evaluateWorldWatches,normalizeWorldWatch,WORLD_WATCH_TYPES} from '../src/world-watch-core.js';

const base=()=>({
 people:[{participantId:'p1',label:'Dave',roomId:'ROOM01',room:'Office',presence:'confirmed',confidence:.9}],
 objects:[{objectId:'O1',label:'keys',roomId:'ROOM01',room:'Office',presence:'confirmed',confidence:.88}],
 anomalies:[],priorities:[]
});

test('normalizes only supported compact watch fields',()=>{
 const watch=normalizeWorldWatch({type:'entity-enters-room',subjectId:'p1',roomId:'ROOM02',rawPayload:{secret:true}},1000);
 assert.ok(WORLD_WATCH_TYPES.includes(watch.type));
 assert.equal('rawPayload' in watch,false);
});
test('triggers when an entity enters a watched room',()=>{
 const before=base(),after=base(); after.people[0]={...after.people[0],roomId:'ROOM02',room:'Kitchen'};
 const e=evaluateWorldWatch({id:'W1',type:'entity-enters-room',subjectId:'p1',roomId:'ROOM02',cooldownMs:0},before,after,{changed:true},2000);
 assert.equal(e.type,'entity-enters-room'); assert.equal(e.evidence.roomId,'ROOM02');
});
test('triggers when a watched entity leaves a room',()=>{
 const before=base(),after=base(); after.people[0]={...after.people[0],roomId:'ROOM02',room:'Kitchen'};
 const e=evaluateWorldWatch({id:'W1',type:'entity-leaves-room',subjectId:'p1',roomId:'ROOM01',cooldownMs:0},before,after,{changed:true},2000);
 assert.equal(e.type,'entity-leaves-room');
});
test('triggers on object room or presence changes',()=>{
 const before=base(),after=base(); after.objects[0]={...after.objects[0],roomId:'ROOM02',room:'Kitchen'};
 const e=evaluateWorldWatch({id:'W1',type:'entity-moved',subjectId:'O1',cooldownMs:0},before,after,{changed:true},2000);
 assert.equal(e.evidence.subjectId,'O1');
});
test('triggers when watched anomaly becomes active',()=>{
 const before=base(),after=base(); after.anomalies=[{signature:'A1',type:'expected-object-missing',summary:'Keys missing',confidence:.9,roomId:'ROOM01'}];
 const e=evaluateWorldWatch({id:'W1',type:'anomaly-active',anomalyType:'expected-object-missing',cooldownMs:0},before,after,{changed:true},2000);
 assert.equal(e.evidence.anomalySignature,'A1');
});
test('triggers when watched anomaly clears',()=>{
 const before=base(),after=base(); before.anomalies=[{signature:'A1',type:'expected-object-missing',summary:'Keys missing',confidence:.9,roomId:'ROOM01'}];
 const e=evaluateWorldWatch({id:'W1',type:'anomaly-cleared',anomalySignature:'A1',cooldownMs:0},before,after,{changed:true},2000);
 assert.equal(e.type,'anomaly-cleared');
});
test('priority watch fires only on an upward threshold crossing',()=>{
 const before=base(),after=base(); before.priorities=[{priority:.7}]; after.priorities=[{priority:.9,summary:'Check office',confidence:.9}];
 assert.ok(evaluateWorldWatch({id:'W1',type:'priority-threshold',priorityThreshold:.8,cooldownMs:0},before,after,{changed:true},2000));
 assert.equal(evaluateWorldWatch({id:'W1',type:'priority-threshold',priorityThreshold:.6,cooldownMs:0},before,after,{changed:true},2000),null);
});
test('cooldown prevents duplicate trigger storms',()=>{
 const before=base(),after=base(); after.objects[0]={...after.objects[0],roomId:'ROOM02'};
 assert.equal(evaluateWorldWatch({id:'W1',type:'entity-moved',subjectId:'O1',lastTriggeredAt:1900,cooldownMs:5000},before,after,{changed:true},2000),null);
});
test('disabled watches and unchanged contexts do not trigger',()=>{
 const before=base(),after=base(); after.objects[0]={...after.objects[0],roomId:'ROOM02'};
 assert.equal(evaluateWorldWatch({id:'W1',type:'entity-moved',subjectId:'O1',enabled:false},before,after,{changed:true},2000),null);
 assert.deepEqual(evaluateWorldWatches([{id:'W1',type:'entity-moved',subjectId:'O1'}],before,after,{changed:false},2000),[]);
});
test('trigger payload declares semantic/privacy/no-control boundaries',()=>{
 const before=base(),after=base(); after.objects[0]={...after.objects[0],roomId:'ROOM02'};
 const e=evaluateWorldWatch({id:'W1',type:'entity-moved',subjectId:'O1',cooldownMs:0},before,after,{changed:true},2000);
 assert.ok(e.boundaries.includes('privacy-governed-context'));
 assert.ok(e.boundaries.includes('no-autonomous-physical-control'));
 assert.doesNotMatch(JSON.stringify(e),/imageDataUrl|embedding|descriptor|rawPayload/);
});
