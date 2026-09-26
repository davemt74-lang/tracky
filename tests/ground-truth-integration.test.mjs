import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../agent-eyes.js',import.meta.url),'utf8');

test('Agent Eyes imports V2.6.1 consolidated ground truth runtime modules',()=>{
 for(const path of [
  './src/ground-truth-core.js',
  './src/ground-truth-correction-core.js',
  './src/ground-truth-store.js',
  './src/operational-health-core.js',
  './src/governed-world-projection-core.js',
  './src/reliability-policy.js',
  './src/runtime-reconciliation-core.js',
  './src/ground-truth-runtime-core.js',
  './src/ground-truth-runtime-controller.js'
 ]) assert.ok(source.includes("from '"+path+"'"));
});
test('V2.6 runtime exposes ground truth health correction explanation APIs',()=>{
 for(const symbol of [
  'getGroundTruth','getOperationalHealth','getEntityTruth','explainGroundTruth',
  'applyGroundTruthCorrection','interpretGroundTruthCorrection','processGroundTruthCorrection',
  'getGroundTruthCorrections','revokeGroundTruthCorrection',
  'clearGroundTruthReliability','subscribeGroundTruth'
 ]) assert.match(source,new RegExp('\\b'+symbol+'\\b'));
});
test('ground truth and spatial memory share one governed semantic projection',()=>{
 const projection=fs.readFileSync(new URL('../src/governed-world-projection-core.js',import.meta.url),'utf8');
 const start=source.indexOf('function governedWorldProjection(');
 const end=source.indexOf('function privacyGovernedGroundTruthInput(',start);
 const block=source.slice(start,end);
 assert.match(block,/buildGovernedSemanticProjection/);
 assert.match(block,/multiRoomSnapshot/);
 assert.match(block,/sceneGraphSnapshot/);
 assert.match(projection,/observationDecision/);
 assert.match(projection,/spatialMemoryRetentionAllowed/);
 assert.doesNotMatch(block,/imageDataUrl|pixels|audioQueue|rawObjects/);
});
test('configured camera room is not asserted as live ground-truth room while runtime is stopped',()=>{
 const projection=fs.readFileSync(new URL('../src/governed-world-projection-core.js',import.meta.url),'utf8');
 assert.match(projection,/activeRoomId:input\.runtimeActive===true/);
});
test('persisted ground truth delegates retention filtering to extracted runtime core',()=>{
 const runtimeCore=fs.readFileSync(new URL('../src/ground-truth-runtime-core.js',import.meta.url),'utf8');
 assert.match(runtimeCore,/groundTruthPersistenceSnapshot/);
 assert.match(runtimeCore,/retentionAllowedForProjectedEntity/);
});
test('startup delegates recovery initialization to controller before Agent context',()=>{
 const controller=fs.readFileSync(new URL('../src/ground-truth-runtime-controller.js',import.meta.url),'utf8');
 const init=source.indexOf('await initializeGroundTruthReliability();');
 const agent=source.indexOf('runtime.agentContext = currentAgentContext({}, Date.now());');
 assert.ok(init>=0);assert.ok(agent>init);
 const start=source.indexOf('async function initializeGroundTruthReliability(');
 const end=source.indexOf('function markGroundTruthDirty(',start);
 assert.match(source.slice(start,end),/initializeGroundTruthRuntimeState/);
 assert.match(controller,/recoverGroundTruthSnapshot/);
 assert.match(controller,/createReconciliationState/);
});
test('ground truth refresh delegates dirty/boundary reconciliation to controller with a lightweight safety timer',()=>{
 const controller=fs.readFileSync(new URL('../src/ground-truth-runtime-controller.js',import.meta.url),'utf8');
 assert.match(source,/ground-truth-timer/);
 assert.match(source,/reconcileGroundTruthRuntimeState/);
 assert.match(source,/markGroundTruthDirty/);
 assert.match(source,/updateGroundTruthRuntime\(now, 'ground-truth-timer'\)/);
 assert.match(controller,/reconciliationDue/);
 assert.match(controller,/consumeReconciliation/);
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
test('V2.6.1 emits semantic ground truth browser events only on controller stable signature changes',()=>{
 const controller=fs.readFileSync(new URL('../src/ground-truth-runtime-controller.js',import.meta.url),'utf8');
 const runtimeCore=fs.readFileSync(new URL('../src/ground-truth-runtime-core.js',import.meta.url),'utf8');
 assert.match(source,/tracky:ground-truth/);
 assert.match(controller,/groundTruthSemanticSignature/);
 assert.match(controller,/groundTruthPersistenceSignature/);
 assert.match(controller,/persistenceNeeded/);
 assert.match(runtimeCore,/groundTruthInputSignature/);
});
test('V2.6 retains no autonomous physical or camera-control authority',()=>{
 assert.doesNotMatch(source,/unlockDoor|openGarage|armSecuritySystem|sendDeviceCommand/);
});

test('legacy participant/object location APIs prefer canonical ground truth before multi-room evidence',()=>{
 const start=source.indexOf('getParticipantLocation(participantId)');
 const end=source.indexOf('getWorldTopology()',start);
 const block=source.slice(start,end);
 assert.match(block,/runtime\.groundTruth\.entities/);
 assert.match(block,/runtime\.multiRoomWorld/);
});
test('entity merge corrections do not mutate lower-level multi-room aliases',()=>{
 const start=source.indexOf('async function applyGroundTruthCorrectionRuntime(');
 const end=source.indexOf('async function revokeGroundTruthCorrectionRuntime(',start);
 const block=source.slice(start,end);
 assert.doesNotMatch(block,/objectAliases/);
});
test('spatial memory consumes shared memory projection instead of duplicating privacy loops',()=>{
 const start=source.indexOf('function updateSpatialMemory(');
 const end=source.indexOf('function confirmedMemoryGraphEdge(',start);
 const block=source.slice(start,end);
 assert.match(block,/governedWorldProjection\('memory'\)/);
 assert.doesNotMatch(block,/spatialMemoryRetentionAllowed/);
});

test('browser runtime delegates reconciliation orchestration to extracted controller',()=>{
 const start=source.indexOf('function updateGroundTruthRuntime(');
 const end=source.indexOf('function purgeForgottenGroundTruthEntity',start);
 const block=source.slice(start,end);
 assert.match(block,/reconcileGroundTruthRuntimeState/);
 assert.match(block,/syncGroundTruthRuntimeState/);
 assert.doesNotMatch(block,/buildGroundTruth\(/);
 assert.doesNotMatch(block,/buildOperationalHealth\(/);
});
test('semantic input fingerprint prevents timestamp-only camera frames from forcing dirty reconciliation',()=>{
 const start=source.indexOf('function currentGroundTruthInputSignature(');
 const end=source.indexOf('function privacyGovernedGroundTruthInput(',start);
 assert.match(source.slice(start,end),/groundTruthInputSignature/);
 const updateStart=source.indexOf('function updateGroundTruthRuntime(');
 const updateEnd=source.indexOf('function purgeForgottenGroundTruthEntity',updateStart);
 assert.match(source.slice(updateStart,updateEnd),/inputSignature/);
});
test('global perception bus marks only camera environment and privacy events explicitly dirty',()=>{
 const start=source.indexOf("function groundTruthRelevantEvent");
 const end=source.indexOf("bus.subscribe('*'",start);
 const block=source.slice(start,end);
 assert.match(block,/camera/);
 assert.match(block,/environment/);
 assert.match(block,/privacy/);
 assert.doesNotMatch(block,/participant\\\.|object\\\./);
});
test('V2.6.1 correction undo is public and merge correction stays reversible',()=>{
 assert.match(source,/getGroundTruthCorrections/);
 assert.match(source,/revokeGroundTruthCorrection\(id/);
 const applyStart=source.indexOf('async function applyGroundTruthCorrectionRuntime(');
 const applyEnd=source.indexOf('async function revokeGroundTruthCorrectionRuntime(',applyStart);
 assert.doesNotMatch(source.slice(applyStart,applyEnd),/objectAliases/);
});
