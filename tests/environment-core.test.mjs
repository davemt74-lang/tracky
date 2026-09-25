import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENVIRONMENT_MATCH,
  baselineQuality,
  compareEnvironment,
  environmentDrift,
  fingerprintImageData,
  fingerprintSimilarity,
  landmarkSimilarity,
  matchEnvironment,
  suggestRoomMapping
} from '../src/environment-core.js';

function image(value, contrast = 0) {
  const width=24,height=16,data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i+=1){
    const v=Math.max(0,Math.min(255,value + ((i%2)*contrast)));
    data[i*4]=v;data[i*4+1]=v;data[i*4+2]=v;data[i*4+3]=255;
  }
  return {width,height,data};
}

test('environment fingerprint is stable for same image structure',()=>{
  const a=fingerprintImageData(image(110,20));
  const b=fingerprintImageData(image(115,20));
  assert.ok(fingerprintSimilarity(a,b)>.85);
});

test('baseline quality penalizes flat low-detail frames',()=>{
  const flat=fingerprintImageData(image(120,0));
  const textured=fingerprintImageData(image(120,80));
  assert.ok(baselineQuality(textured).score>baselineQuality(flat).score);
});

test('landmark matching ignores temporary clutter',()=>{
  const ref=[
    {id:'L1',label:'desk',position:{x:.3,y:.4},confidence:.9},
    {id:'L2',label:'monitor',position:{x:.35,y:.3},confidence:.9}
  ];
  const current=[
    ...ref,
    {id:'O9',label:'cup',position:{x:.7,y:.7},confidence:.9}
  ];
  assert.ok(landmarkSimilarity(current,ref).score>.8);
});

test('known environment view is selected with strong evidence and margin',()=>{
  const fp=fingerprintImageData(image(120,60));
  const current={cameraId:'CAM01',fingerprint:fp,landmarks:[{id:'A',label:'desk',position:{x:.3,y:.4},confidence:.9}]};
  const rooms=[
    {id:'ROOM01',name:'Office',views:[{id:'VIEW01',name:'Desk',cameraId:'CAM01',fingerprint:fp,landmarks:current.landmarks}]},
    {id:'ROOM02',name:'Kitchen',views:[{id:'VIEW02',name:'Sink',cameraId:'CAM02',fingerprint:fingerprintImageData(image(30,5)),landmarks:[{id:'B',label:'sink',position:{x:.8,y:.8},confidence:.9}]}]}
  ];
  const result=matchEnvironment(current,rooms);
  assert.equal(result.classification,ENVIRONMENT_MATCH.KNOWN_VIEW);
  assert.equal(result.best.roomId,'ROOM01');
});

test('environment drift separates structural landmark changes',()=>{
  const fp=fingerprintImageData(image(120,60));
  const view={fingerprint:fp,landmarks:[{id:'L1',label:'desk',position:{x:.3,y:.4},confidence:.9}]};
  const current={fingerprint:fp,landmarks:[]};
  const drift=environmentDrift(current,view);
  assert.ok(drift.structuralDrift>.5);
  assert.ok(drift.visualDrift<.1);
});

test('assisted mapping creates doorway portal and desk zone',()=>{
  const map=suggestRoomMapping([
    {id:'O1',label:'door',roomPosition:{x:.8,y:.4},confidence:.9},
    {id:'O2',label:'desk',roomPosition:{x:.3,y:.5},confidence:.9}
  ]);
  assert.equal(map.portals.length,1);
  assert.equal(map.zones.some((zone)=>zone.name==='Desk Area'),true);
  assert.equal(map.floor.requiresConfirmation,true);
});

test('compareEnvironment returns explainable evidence channels',()=>{
  const fp=fingerprintImageData(image(120,60));
  const result=compareEnvironment(
    {cameraId:'CAM01',fingerprint:fp,landmarks:[]},
    {cameraId:'CAM01',fingerprint:fp,landmarks:[]}
  );
  assert.ok(result.visual>.9);
  assert.equal(result.camera,1);
});
