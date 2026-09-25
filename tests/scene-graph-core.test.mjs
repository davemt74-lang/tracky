import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRoomSceneGraph,
  createSceneGraph,
  markGraphFactsStale,
  sceneGraphSnapshot,
  spatialRelation,
  upsertGraphEdge,
  upsertGraphNode
} from '../src/scene-graph-core.js';

test('scene graph records room landmarks people and objects with provenance',()=>{
  const graph=buildRoomSceneGraph({
    roomId:'ROOM01',
    roomName:'Office',
    landmarks:[{id:'L1',label:'desk',name:'Desk',position:{x:.3,y:.4},confidence:.9}],
    participants:[{id:'P:p1',participantId:'p1',participantName:'Dave',confidence:.9,roomPosition:{x:.4,y:.4},cameraIds:['CAM01'],observations:[{cameraId:'CAM01'}]}],
    objects:[{id:'WO1',label:'phone',confidence:.8,roomPosition:{x:.42,y:.42},cameraIds:['CAM01'],observations:[{cameraId:'CAM01'}]}]
  },null,1000);
  const snapshot=sceneGraphSnapshot(graph);
  assert.ok(snapshot.nodes.some((node)=>node.id==='ROOM01'));
  assert.ok(snapshot.nodes.some((node)=>node.id==='PERSON:p1'));
  assert.ok(snapshot.edges.some((edge)=>edge.predicate==='located-in'));
});

test('user confirmed node is preserved from staleness',()=>{
  const graph=createSceneGraph('ROOM01');
  upsertGraphNode(graph,{id:'L1',type:'landmark',label:'Desk',state:'user-confirmed',confidence:1,lastObservedAt:0});
  markGraphFactsStale(graph,100000,{lastKnownMs:10,expireMs:20});
  assert.equal(graph.nodes.L1.state,'user-confirmed');
});

test('observed facts decay to last-known then expired',()=>{
  const graph=createSceneGraph('ROOM01');
  upsertGraphNode(graph,{id:'O1',type:'object',label:'Phone',state:'observed',confidence:.8,lastObservedAt:100});
  markGraphFactsStale(graph,200,{lastKnownMs:50,expireMs:500});
  assert.equal(graph.nodes.O1.state,'last-known');
  markGraphFactsStale(graph,1000,{lastKnownMs:50,expireMs:500});
  assert.equal(graph.nodes.O1.state,'expired');
});

test('spatial relation expresses nearby layout direction',()=>{
  assert.equal(spatialRelation({position:{x:.2,y:.5}},{position:{x:.7,y:.5}}),'right-of');
  assert.equal(spatialRelation({position:{x:.2,y:.2}},{position:{x:.24,y:.23}}),'near');
});

test('graph edges have deterministic IDs',()=>{
  const graph=createSceneGraph('ROOM01');
  upsertGraphEdge(graph,{subjectId:'A',predicate:'on',objectId:'B',confidence:.8});
  upsertGraphEdge(graph,{subjectId:'A',predicate:'on',objectId:'B',confidence:.9});
  assert.equal(Object.keys(graph.edges).length,1);
  assert.equal(Object.values(graph.edges)[0].confidence,.9);
});
