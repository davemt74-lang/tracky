import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {autoEnrollmentDecision,autoEnrollmentReceipt,AUTO_ENROLLMENT_TARGET} from '../src/auto-enrollment-core.js';
const f=(cx=.5,cy=.5,yaw=0)=>({quality:.83,embedding:[.3,.4,.5],rotation:{yaw},box:{cx,cy}});
test('no opt-in, active session, or single face means no automatic biometric capture',()=>{
  const state={consent:false,active:true,samples:[]};
  assert.equal(autoEnrollmentDecision(state,{faceCount:1,face:f(),now:1500}).capture,false);
  state.consent=true;state.active=false;
  assert.equal(autoEnrollmentDecision(state,{faceCount:1,face:f(),now:1500}).capture,false);
  state.active=true;
  assert.equal(autoEnrollmentDecision(state,{faceCount:2,face:f(),now:1500}).reason,'exactly-one-face-required');
  assert.equal(autoEnrollmentDecision(state,{faceCount:1,face:{...f(),quality:.3},now:1500}).capture,false);
});
test('automatic enrollment captures only spaced distinct pose samples',()=>{
  const state={consent:true,active:true,samples:[],lastCaptureAt:0};
  const one=autoEnrollmentDecision(state,{faceCount:1,face:f(),now:1500});
  assert.equal(one.capture,true);
  state.samples.push({pose:one.pose});state.lastCaptureAt=1500;
  assert.equal(autoEnrollmentDecision(state,{faceCount:1,face:f(.5,.5,11),now:1600}).reason,'hold-for-next-angle');
  assert.equal(autoEnrollmentDecision(state,{faceCount:1,face:f(),now:3000}).reason,'turn-slightly-for-distinct-angle');
  const two=autoEnrollmentDecision(state,{faceCount:1,face:f(.5,.5,11),now:3000});
  assert.equal(two.capture,true);state.samples.push({pose:two.pose});state.lastCaptureAt=3000;
  const three=autoEnrollmentDecision(state,{faceCount:1,face:f(.5,.5,22),now:4500});
  assert.equal(three.capture,true);state.samples.push({pose:three.pose});
  assert.equal(state.samples.length,AUTO_ENROLLMENT_TARGET);
  assert.equal(autoEnrollmentDecision(state,{faceCount:1,face:f(.4,.5,35),now:6000}).reason,'ready');
});
test('receipt excludes biometrics and cannot claim third-party or incomplete enrollment',()=>{
  const participant={id:'local-owner',visualEnrollment:{scope:'owner-self',consentedAt:'2026-10-01T17:00:00Z'},recognitionEnabled:true,embeddings:[[1],[2],[3]],primaryPhoto:'private'};
  const receipt=autoEnrollmentReceipt(participant);
  assert.deepEqual(Object.keys(receipt),['participantId','state','samples','scope','tracking','cloudSync','contactCreation']);
  assert.equal(receipt.contactCreation,'requires_owner_approval');
  assert.equal(receipt.cloudSync,'not_enabled');
  assert.equal(autoEnrollmentReceipt({...participant,embeddings:[[1],[2]]}),null);
  assert.equal(autoEnrollmentReceipt({...participant,visualEnrollment:{scope:'other-person',consentedAt:'x'}}),null);
});
test('camera, face collection and contact permissions are explicitly gated',()=>{
  const script=fs.readFileSync('participants.js','utf8');
  const html=fs.readFileSync('participants.html','utf8');
  assert.match(script,/if\(!ui\.autoConsent\?\.checked\)/);
  assert.match(script,/ui\.autoStart\.addEventListener\('click',startSelfEnrollment\)/);
  assert.match(script,/await startCamera\(\)/);
  assert.doesNotMatch(script,/window\.addEventListener\('load',\s*startSelfEnrollment\)/);
  assert.match(script,/const receipt=autoEnrollmentReceipt\(record\)/);
  assert.match(html,/id="selfVisualConsent"/);
  assert.match(html,/No Cloud upload, background tracking or contact creation is enabled here/);
});
