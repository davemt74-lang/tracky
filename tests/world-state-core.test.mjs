import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decayConfidence,
  derivePhysicalWorldState,
  detectContradictions,
  evidenceQuorum,
  rankWorldAttention
} from '../src/world-state-core.js';

test('confidence decays with evidence age',()=>{
  assert.ok(decayConfidence(.9,60000,60000)<.9);
  assert.ok(Math.abs(decayConfidence(1,60000,60000)-.5)<.001);
});

test('evidence quorum requires independent sources',()=>{
  const one=evidenceQuorum([{source:'camera',confidence:.9},{source:'camera',confidence:.8}]);
  const two=evidenceQuorum([{source:'camera',confidence:.9},{source:'voice',confidence:.8}]);
  assert.equal(one.met,false);
  assert.equal(two.met,true);
});

test('contradiction engine detects simultaneous room claims',()=>{
  const contradictions=detectContradictions({edges:{
    a:{id:'a',subjectId:'PERSON:p1',predicate:'located-in',objectId:'ROOM01',state:'observed'},
    b:{id:'b',subjectId:'PERSON:p1',predicate:'located-in',objectId:'ROOM02',state:'observed'}
  }});
  assert.equal(contradictions.length,1);
});

test('physical world manager downgrades contradicted facts',()=>{
  const graph={nodes:[
    {id:'PERSON:p1',type:'person',label:'Dave',state:'observed',confidence:.9,lastObservedAt:1000,provenance:[]}
  ],edges:[
    {id:'a',subjectId:'PERSON:p1',predicate:'located-in',objectId:'ROOM01',state:'observed',confidence:.9,lastObservedAt:1000,provenance:[]},
    {id:'b',subjectId:'PERSON:p1',predicate:'located-in',objectId:'ROOM02',state:'observed',confidence:.9,lastObservedAt:1000,provenance:[]}
  ]};
  const state=derivePhysicalWorldState({roomId:'ROOM01',sceneGraph:graph},null,1000);
  assert.equal(state.contradictions.length,1);
  assert.equal(state.facts.filter((fact)=>fact.subjectId==='PERSON:p1').some((fact)=>fact.state==='contradicted'),true);
});

test('attention ranks unknown environment above ordinary scene change',()=>{
  const ranked=rankWorldAttention({
    environment:{classification:'unknown'},
    contradictions:[],
    changes:[{type:'object.moved',summary:'Phone moved'}]
  });
  assert.equal(ranked[0].type,'unknown-environment');
});
