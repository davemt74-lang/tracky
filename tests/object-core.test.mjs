import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignObjectTracks,
  bestObjectInteractions,
  carryLostObjectTracks,
  inferHolding,
  inferPointingAt,
  objectDetection,
  relationMotion
} from '../src/object-core.js';

function kp(part, x, y, score = 0.95) {
  return { part, x, y, score };
}

test('objectDetection normalizes Human boxRaw and preserves label', () => {
  const result = objectDetection({
    id:2,label:'cell phone',class:67,score:0.91,boxRaw:[0.2,0.3,0.1,0.2]
  }, 1000, 500);
  assert.equal(result.label,'cell phone');
  assert.equal(result.box.x,0.2);
  assert.equal(result.box.cy,0.4);
});

test('object tracker preserves id for nearby same-label observations', () => {
  const first = assignObjectTracks([], [{
    label:'cup',classId:1,detectorId:1,score:0.9,
    box:{x:0.2,y:0.2,width:0.1,height:0.1,cx:0.25,cy:0.25}
  }], 100, {nextId:()=> 'O001'});
  const second = assignObjectTracks(first, [{
    label:'cup',classId:1,detectorId:2,score:0.88,
    box:{x:0.22,y:0.21,width:0.1,height:0.1,cx:0.27,cy:0.26}
  }], 200, {nextId:()=> 'O002'});
  assert.equal(second[0].id,'O001');
  assert.equal(second[0].observations,2);
  assert.equal(second[0].stable,true);
});

test('different object labels do not share a track', () => {
  const first = assignObjectTracks([], [{
    label:'cup',score:0.9,classId:1,box:{x:0.2,y:0.2,width:0.1,height:0.1,cx:0.25,cy:0.25}
  }], 100, {nextId:()=> 'O001'});
  const second = assignObjectTracks(first, [{
    label:'book',score:0.9,classId:2,box:{x:0.2,y:0.2,width:0.1,height:0.1,cx:0.25,cy:0.25}
  }], 200, {nextId:()=> 'O002'});
  assert.equal(second[0].id,'O002');
});

test('lost object tracks are retained briefly for reacquisition', () => {
  const previous=[{
    id:'O001',label:'cup',lastSeenAt:1000,status:'tracked',
    box:{x:0.2,y:0.2,width:0.1,height:0.1,cx:0.25,cy:0.25}
  }];
  assert.equal(carryLostObjectTracks(previous,[],2000).length,1);
  assert.equal(carryLostObjectTracks(previous,[],5000).length,0);
});

test('holding requires object near a confident wrist', () => {
  const person={
    id:'T1',box:{x:0.2,y:0.1,width:0.4,height:0.8},
    keypoints:[kp('leftWrist',0.42,0.45),kp('rightWrist',0.72,0.45)]
  };
  const object={box:{x:0.39,y:0.42,width:0.08,height:0.08,cx:0.43,cy:0.46}};
  const result=inferHolding(person,object,[]);
  assert.equal(result.holding,true);
  assert.equal(result.handSide,'left');
});

test('pointing-at requires arm ray alignment toward object', () => {
  const person={
    id:'T1',
    keypoints:[
      kp('rightElbow',0.45,0.5),
      kp('rightWrist',0.55,0.5)
    ]
  };
  const object={box:{x:0.72,y:0.46,width:0.08,height:0.08,cx:0.76,cy:0.5}};
  const result=inferPointingAt(person,object);
  assert.equal(result.pointing,true);
  assert.equal(result.side,'right');
});

test('relation motion distinguishes approaching and moving away', () => {
  assert.equal(relationMotion(0.5,0.42),'approaching');
  assert.equal(relationMotion(0.3,0.39),'moving-away');
  assert.equal(relationMotion(0.3,0.31),'stable');
});

test('holding outranks pointing for the same object', () => {
  const person={
    id:'T1',participantId:'p1',participantName:'Dave',status:'matched',
    cx:0.4,cy:0.5,box:{x:0.2,y:0.1,width:0.4,height:0.8},
    keypoints:[
      kp('rightElbow',0.34,0.45),
      kp('rightWrist',0.43,0.45)
    ]
  };
  const object={
    id:'O1',label:'cup',status:'tracked',cx:0.46,cy:0.47,
    box:{x:0.42,y:0.43,width:0.08,height:0.08,cx:0.46,cy:0.47}
  };
  const interactions=bestObjectInteractions([person],[object],[],new Map());
  assert.equal(interactions.some((x)=>x.type==='holding'),true);
  assert.equal(interactions.some((x)=>x.type==='pointing-at'),false);
});
