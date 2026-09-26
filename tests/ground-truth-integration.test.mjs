import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../agent-eyes.js',import.meta.url),'utf8');

test('Agent Eyes imports all V2.6 ground truth reliability modules',()=>{
 for(const path of [
  './src/ground-truth-core.js',
  './src/ground-truth-correction-core.js',
  './src/ground-truth-store.js',
  './src/operational-health-core.js'
 ]) assert.ok(source.includes("from '"+path+"'"));
});
test('V2.6 runtime exposes ground truth health correction explanation APIs',()=>{
 for(const symbol of [
  'getGroundTruth','getOperationalHealth','getEntityTruth','explainGroundTruth',
  'applyGroundTruthCorrection','interpretGroundTruthCorrection','processGroundTruthCorrection',
  'clearGroundTruthReliability','subscribeGroundTruth'
 ]) assert.match(source,new RegExp('\\b'+symbol+'\\b'));
});
test('ground truth is built from privacy-governed semantic world not raw sensors',()=>{
 const start=source.indexOf('function privacyGovernedGroundTruthInput(');
 const end=source.indexOf('function groundTruthPersistenceSnapshot(',start);
 const block=source.slice(start,end);
 assert.match(block,/multiRoomSnapshot/);
 assert.match(block,/sceneGraphSnapshot/);
 assert.match(block,/allowVisualObservation === false/);
 assert.match(block,/allowParticipantIdentity === false/);
 assert.match(block,/allowObjectObservation === false/);
 assert.doesNotMatch(block,/imageDataUrl|pixels|audioQueue|rawObjects/);
});
test('configured camera room is not asserted as live ground-truth room while runtime is stopped',()=>{
 const start=source.indexOf('function privacyGovernedGroundTruthInput(');
 const end=source.indexOf('function groundTruthPersistenceSnapshot(',start);
 const block=source.slice(start,end);
 assert.match(block,/activeRoomId: runtime\.running/);
});

test('persisted ground truth obeys spatial-memory retention policy',()=>{
 const start=source.indexOf('function groundTruthPersistenceSnapshot(');
 const end=source.indexOf('async function persistGroundTruthState(',start);
 const block=source.slice(start,end);
 assert.match(block,/spatialMemoryRetentionAllowed/);
});
test('startup recovers persisted truth before Agent context and never marks it fresh',()=>{
 const init=source.indexOf('await initializeGroundTruthReliability();');
 const agent=source.indexOf('runtime.agentContext = currentAgentContext({}, Date.now());');
 assert.ok(init>=0);assert.ok(agent>init);
 const start=source.indexOf('async function initializeGroundTruthReliability(');
 const end=source.indexOf('function groundTruthSemanticSignature(',start);
 assert.match(source.slice(start,end),/recoverGroundTruthSnapshot/);
});
test('ground truth refresh has independent confidence decay timer',()=>{
 assert.match(source,/ground-truth-timer/);
 assert.match(source,/updateGroundTruthRuntime\(now, 'ground-truth-timer'\)/);
});
test('camera moved correction remains diagnostic until recalibration resolves it',()=>{
 assert.match(source,/resolveCameraMovedCorrection\(updated\.id/);
 const start=source.indexOf('function resolveCameraMovedCorrection(');
 const end=source.indexOf('async function applyGroundTruthCorrectionRuntime(',start);
 assert.match(source.slice(start,end),/camera-recalibrated/);
});
test('forget entity correction purges retained semantic memory but remains governed',()=>{
 const start=source.indexOf('function purgeForgottenGroundTruthEntity(');
 const end=source.indexOf('function resolveCameraMovedCorrection(',start);
 const block=source.slice(start,end);
 assert.match(block,/runtime\.spatialMemory\.entities/);
 assert.match(block,/runtime\.spatialMemory\.proposals/);
 assert.match(block,/objectAliases/);
});
test('Agent context source includes V2.6 truth and operational health',()=>{
 const start=source.indexOf('function agentContextSource(');
 const end=source.indexOf('function currentAgentContext(',start);
 const block=source.slice(start,end);
 assert.match(block,/groundTruthSnapshot/);
 assert.match(block,/operationalHealthSnapshot/);
});
test('V2.6 emits semantic ground truth browser event only on semantic change',()=>{
 assert.match(source,/tracky:ground-truth/);
 assert.match(source,/groundTruthSemanticSignature/);
});
test('V2.6 retains no autonomous physical or camera-control authority',()=>{
 assert.doesNotMatch(source,/unlockDoor|openGarage|armSecuritySystem|sendDeviceCommand/);
});
