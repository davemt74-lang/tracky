import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretWorldWatchCommand,parseWorldWatchCommand,resolveWorldWatchCommand} from '../src/world-watch-language-core.js';

const context=()=>({
 activeRoom:{id:'ROOM01',name:'Office'},
 rooms:[{id:'ROOM01',name:'Office'},{id:'ROOM02',name:'Kitchen'}],
 people:[{participantId:'p1',label:'Dave',roomId:'ROOM01'},{participantId:'p2',label:'Sarah',roomId:'ROOM02'}],
 objects:[{objectId:'O1',label:'keys',roomId:'ROOM01'},{objectId:'O2',label:'phone',roomId:'ROOM02'}],
 anomalies:[],priorities:[]
});

test('parses natural-language arrival watch',()=>{
 const p=parseWorldWatchCommand('Tell me when Dave gets to the kitchen');
 assert.equal(p.intent,'create'); assert.equal(p.watchType,'entity-enters-room');
 assert.equal(p.subjectText,'Dave'); assert.equal(p.roomText,'the kitchen');
});
test('resolves natural-language arrival watch to semantic IDs',()=>{
 const r=interpretWorldWatchCommand('Let me know when Dave enters the kitchen',context(),[],1000);
 assert.equal(r.status,'ready'); assert.equal(r.watch.subjectId,'p1'); assert.equal(r.watch.roomId,'ROOM02');
});
test('resolves here to active room',()=>{
 const r=interpretWorldWatchCommand('Tell me when Sarah enters here',context(),[],1000);
 assert.equal(r.status,'ready'); assert.equal(r.watch.roomId,'ROOM01');
});
test('supports unscoped someone-entered-room watches without matching objects',()=>{
 const r=interpretWorldWatchCommand('Tell me when someone enters the office',context(),[],1000);
 assert.equal(r.status,'ready'); assert.equal(r.watch.subjectId,null); assert.equal(r.watch.roomId,'ROOM01');
 assert.equal(r.watch.subjectKind,'person');
});
test('supports unscoped object language with object-only scope',()=>{
 const r=interpretWorldWatchCommand('Tell me when something moves',context(),[],1000);
 assert.equal(r.status,'ready'); assert.equal(r.watch.subjectId,null); assert.equal(r.watch.subjectKind,'object');
});
test('parses object movement watch',()=>{
 const r=interpretWorldWatchCommand('Tell me when the keys move',context(),[],1000);
 assert.equal(r.status,'ready'); assert.equal(r.watch.type,'entity-moved'); assert.equal(r.watch.subjectId,'O1');
});
test('parses anomaly clear and active watches',()=>{
 assert.equal(interpretWorldWatchCommand('Alert me when an anomaly clears',context(),[],1000).watch.type,'anomaly-cleared');
 assert.equal(interpretWorldWatchCommand('Notify me when an anomaly appears',context(),[],1000).watch.type,'anomaly-active');
});
test('parses priority threshold percent',()=>{
 const r=interpretWorldWatchCommand('Alert me when priority is above 85 percent',context(),[],1000);
 assert.equal(r.status,'ready'); assert.equal(r.watch.type,'priority-threshold'); assert.equal(r.watch.priorityThreshold,.85);
});
test('parses watch cooldown from natural language',()=>{
 const r=interpretWorldWatchCommand('Tell me when the keys move, no more than every 5 minutes',context(),[],1000);
 assert.equal(r.status,'ready'); assert.equal(r.watch.cooldownMs,300000);
});
test('preserves ambiguous entities instead of guessing',()=>{
 const c=context(); c.objects.push({objectId:'O3',label:'keys',roomId:'ROOM02'});
 const r=interpretWorldWatchCommand('Tell me when keys move',c,[],1000);
 assert.equal(r.status,'ambiguous'); assert.equal(r.field,'subject'); assert.equal(r.candidates.length,2);
});
test('returns room candidates instead of inventing a room',()=>{
 const r=interpretWorldWatchCommand('Tell me when Dave enters the garage',context(),[],1000);
 assert.equal(r.status,'not-found'); assert.equal(r.field,'room'); assert.ok(r.candidates.some(x=>x.label==='Office'));
});
test('supports conversational list/remove/pause/resume watch management',()=>{
 const watches=[{id:'W1',label:'Dave enters Kitchen',type:'entity-enters-room',enabled:true}];
 assert.equal(interpretWorldWatchCommand('What am I watching?',context(),watches).intent,'list');
 assert.equal(interpretWorldWatchCommand('Stop watching Dave enters Kitchen',context(),watches).watch.id,'W1');
 assert.equal(interpretWorldWatchCommand('Pause watch W1',context(),watches).intent,'pause');
 assert.equal(interpretWorldWatchCommand('Resume watch W1',context(),watches).intent,'resume');
});
test('does not coerce unsupported natural language into a watch',()=>{
 const r=interpretWorldWatchCommand('Please order me a pizza',context(),[],1000);
 assert.equal(r.status,'unsupported');
});
