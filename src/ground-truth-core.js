import { decayConfidence, entityHalfLife } from './world-state-core.js';

const arr=(v)=>Array.isArray(v)?v:(v&&typeof v==='object'?Object.values(v):[]);
const txt=(v,max=180)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);
const clamp01=(v)=>Math.max(0,Math.min(1,Number.isFinite(Number(v))?Number(v):0));

export const GROUND_TRUTH_SCHEMA_VERSION=1;
export const FACT_AUTHORITY=Object.freeze({
  'user-confirmed':5,
  'direct-observation':4,
  'reconciled-observation':3.5,
  'semantic-inference':2,
  'remembered':1,
  'recovered-history':0.5
});
export const TRUTH_FRESHNESS=Object.freeze(['current','recent','stale','unknown']);
export const TRUTH_STATES=Object.freeze(['confirmed','uncertain','conflicted','last-known','unknown','forgotten']);

function entityId(item={}){
  return String(item.participantId?('PERSON:'+item.participantId):(item.objectId||item.id||''));
}
function entityType(item={}){
  if(item.entityType==='person'||item.entityType==='object') return item.entityType;
  if(
    item.participantId ||
    item.identityAuthority==='enrolled-participant' ||
    item.identityAuthority==='anonymous' ||
    item.localRoomEntityId ||
    String(item.id||'').startsWith('PERSON:') ||
    String(item.id||'').startsWith('ANON:')
  ) return 'person';
  return 'object';
}
function observedAuthority(item={}){
  if(item.identityAuthority==='enrolled-participant') return 'reconciled-observation';
  return 'direct-observation';
}
function halfLifeForTruth(item={}){
  return entityHalfLife({
    type:entityType(item),
    label:item.label||item.participantName||item.objectLabel||''
  });
}
export function truthFreshness(item={},now=Date.now()){
  const at=Number(item.observedAt||item.lastObservedAt||item.updatedAt||0);
  if(!at) return {state:'unknown',ageMs:null,confidence:0};
  const ageMs=Math.max(0,now-at);
  const halfLife=halfLifeForTruth(item);
  const confidence=decayConfidence(Number(item.baseConfidence??item.confidence??0),ageMs,halfLife);
  const state=ageMs<=Math.min(15000,halfLife*.15)
    ?'current'
    :ageMs<=halfLife?'recent'
      :ageMs<=halfLife*4?'stale':'unknown';
  return {state,ageMs,confidence:clamp01(confidence),halfLifeMs:halfLife};
}
function correctionAuthority(correction={}){
  return correction.source==='user'||correction.authority==='user-confirmed'
    ?'user-confirmed'
    :'semantic-inference';
}
function correctionEvidence(correction){
  return {
    source:'ground-truth-correction',
    correctionId:correction.id||null,
    authority:correctionAuthority(correction),
    timestamp:Number(correction.createdAt||correction.updatedAt||Date.now())
  };
}
function factKey(fact){
  return [fact.subjectId,fact.predicate||'exists',fact.objectId||''].join('::');
}
function candidateFromEntity(item,source,now){
  const id=entityId(item);
  if(!id) return null;
  const presence=String(item.presence||item.status||(item.roomId?'confirmed':'last-known'));
  const authority=source==='multi-room'?observedAuthority(item):'direct-observation';
  const observedAt=Number(item.lastObservedAt||item.updatedAt||now);
  const fresh=truthFreshness({
    ...item,
    observedAt,
    baseConfidence:Number(item.confidence??0.5)
  },now);
  return {
    id:'truth:'+id,
    subjectId:id,
    entityType:entityType(item),
    label:txt(item.participantName||item.label||item.objectLabel||id,100),
    roomId:item.roomId||null,
    lastKnownRoomId:item.lastKnownRoomId||item.roomId||null,
    candidateRoomIds:arr(item.candidateRoomIds).map(String),
    presence,
    state:['confirmed','transitioning'].includes(presence)?'confirmed':presence==='uncertain'?'uncertain':'last-known',
    authority,
    authorityRank:FACT_AUTHORITY[authority],
    baseConfidence:clamp01(item.confidence??0.5),
    confidence:fresh.confidence,
    freshness:fresh.state,
    ageMs:fresh.ageMs,
    observedAt,
    cameraIds:arr(item.cameraIds).map(String),
    holderParticipantId:item.holderParticipantId||null,
    evidence:[{
      source,
      authority,
      timestamp:observedAt,
      cameraIds:arr(item.cameraIds).map(String)
    }]
  };
}
function correctionForEntity(corrections,id){
  return arr(corrections)
    .filter((item)=>item.subjectId===id&&item.status!=='superseded')
    .sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
}
function applyCorrections(entity,corrections,now){
  let result={...entity,evidence:[...(entity.evidence||[])]};
  for(const correction of correctionForEntity(corrections,entity.subjectId)){
    if(correction.type==='forget-entity'){
      const forgottenAt=Number(correction.createdAt||now);
      const observedAfterForget=Number(entity.observedAt||0)>forgottenAt;
      if(!observedAfterForget){
        return {
          ...result,
          state:'forgotten',
          freshness:'unknown',
          confidence:0,
          roomId:null,
          forgottenAt,
          evidence:[...result.evidence,correctionEvidence(correction)]
        };
      }
      result.evidence.push({
        ...correctionEvidence(correction),
        supersededByFreshObservation:true
      });
    }
    if(correction.type==='identity-rejection'){
      if(
        !correction.label ||
        String(result.label||'').toLowerCase()===String(correction.label).toLowerCase()
      ){
        result.rejectedIdentityLabel=correction.label||result.label||null;
        result.label='Unresolved participant';
        result.state='uncertain';
        result.confidence=Math.min(.49,result.confidence);
        result.authority='user-confirmed';
        result.authorityRank=FACT_AUTHORITY['user-confirmed'];
      }
      result.evidence.push(correctionEvidence(correction));
    }
    if(correction.type==='entity-label'){
      result.label=txt(correction.label||result.label,100);
      result.authority='user-confirmed';
      result.authorityRank=FACT_AUTHORITY['user-confirmed'];
      result.evidence.push(correctionEvidence(correction));
    }
    if(correction.type==='entity-location'){
      const correctionAt=Number(correction.createdAt||now);
      const observedAfterCorrection=Number(entity.observedAt||0)>correctionAt;
      if(!observedAfterCorrection){
        result.roomId=correction.roomId||null;
        result.lastKnownRoomId=correction.roomId||result.lastKnownRoomId||null;
        result.state='confirmed';
        result.freshness='current';
        result.confidence=Math.max(.98,result.confidence);
        result.authority='user-confirmed';
        result.authorityRank=FACT_AUTHORITY['user-confirmed'];
      }else if(result.roomId!==correction.roomId){
        result.correctionConflict={
          type:'observation-after-user-location-correction',
          correctionId:correction.id,
          correctionRoomId:correction.roomId,
          observedRoomId:result.roomId
        };
      }
      result.evidence.push(correctionEvidence(correction));
    }
  }
  return result;
}
function comparableAuthority(a,b){
  return Math.abs(Number(a.authorityRank||0)-Number(b.authorityRank||0))<=0.6;
}
function conflictRecord(subjectId,candidates,kind='simultaneous-location'){
  return {
    id:'CONFLICT:'+kind+':'+subjectId,
    type:kind,
    subjectId,
    roomIds:[...new Set(candidates.map((item)=>item.roomId).filter(Boolean))],
    candidateIds:candidates.map((item)=>item.id),
    authorities:[...new Set(candidates.map((item)=>item.authority))],
    confidence:clamp01(Math.max(...candidates.map((item)=>Number(item.confidence||0)),0)),
    unresolved:true,
    summary:'Conflicting current physical-world evidence was preserved instead of silently choosing a winner.'
  };
}
export function reconcileGroundTruthEntities(input={},now=Date.now()){
  const mergeMap=new Map(
    arr(input.corrections)
      .filter((item)=>item.type==='entity-merge'&&item.status!=='superseded'&&item.aliasEntityId&&item.canonicalEntityId)
      .map((item)=>[String(item.aliasEntityId),String(item.canonicalEntityId)])
  );
  const canonicalize=(candidate)=>{
    if(!candidate) return null;
    const canonical=mergeMap.get(candidate.subjectId);
    return canonical?{
      ...candidate,
      originalSubjectId:candidate.subjectId,
      subjectId:canonical,
      id:candidate.id.replace(candidate.subjectId,canonical),
      evidence:[...(candidate.evidence||[]),{
        source:'ground-truth-correction',
        authority:'user-confirmed',
        kind:'entity-merge',
        aliasEntityId:candidate.subjectId,
        canonicalEntityId:canonical,
        timestamp:now
      }]
    }:candidate;
  };
  const candidates=[];
  for(const item of arr(input.multiRoom?.participants)){
    const candidate=canonicalize(candidateFromEntity(item,'multi-room',now));
    if(candidate) candidates.push(candidate);
  }
  for(const item of arr(input.multiRoom?.objects)){
    const candidate=canonicalize(candidateFromEntity(item,'multi-room',now));
    if(candidate) candidates.push(candidate);
  }

  const sceneNodes=arr(input.sceneGraph?.nodes).filter((node)=>['person','object'].includes(node.type));
  for(const node of sceneNodes){
    const roomEdge=arr(input.sceneGraph?.edges).find((edge)=>(
      edge.subjectId===node.id&&edge.predicate==='located-in'&&edge.state!=='expired'
    ));
    const candidate=candidateFromEntity({
      id:node.id,
      participantId:node.type==='person'?(node.properties?.participantId||String(node.id).replace(/^PERSON:/,'')):null,
      label:node.label,
      roomId:roomEdge?.objectId||input.sceneGraph?.roomId||null,
      presence:node.state==='observed'?'confirmed':node.state==='last-known'?'last-known':'uncertain',
      confidence:node.confidence,
      lastObservedAt:node.lastObservedAt,
      cameraIds:node.properties?.cameraIds||[]
    },'scene-graph',now);
    if(candidate){
      const canonical=canonicalize(candidate);
      Object.assign(candidate,canonical);
      candidate.id='scene:'+candidate.subjectId+':'+(candidate.roomId||'none');
      candidate.authority=node.state==='user-confirmed'?'user-confirmed':node.state==='inferred'?'semantic-inference':'direct-observation';
      candidate.authorityRank=FACT_AUTHORITY[candidate.authority];
      candidates.push(candidate);
    }
  }

  const bySubject=new Map();
  for(const candidate of candidates){
    if(!bySubject.has(candidate.subjectId)) bySubject.set(candidate.subjectId,[]);
    bySubject.get(candidate.subjectId).push(candidate);
  }

  const entities=[];
  const conflicts=[];
  for(const [subjectId,items] of bySubject){
    const explicitUncertain=items.find((item)=>(
      item.state==='uncertain' &&
      item.freshness==='current' &&
      arr(item.candidateRoomIds).length>1
    ));
    const current=items.filter((item)=>item.freshness==='current'&&item.roomId&&item.state!=='last-known');
    const distinctRooms=[...new Set(current.map((item)=>item.roomId))];
    let selected=null;
    if(explicitUncertain){
      const roomIds=[...new Set(explicitUncertain.candidateRoomIds)];
      conflicts.push({
        id:'CONFLICT:multi-room:'+subjectId,
        type:'simultaneous-location',
        subjectId,
        roomIds,
        candidateIds:[explicitUncertain.id],
        authorities:[explicitUncertain.authority],
        confidence:explicitUncertain.confidence,
        unresolved:true,
        summary:'Multi-room reconciliation reports incompatible current locations; active-room evidence cannot silently override it.'
      });
      selected={...explicitUncertain,state:'conflicted',roomId:null,candidateRoomIds:roomIds,confidence:Math.min(.49,explicitUncertain.confidence)};
    }
    if(!selected&&distinctRooms.length>1){
      const bestRank=Math.max(...current.map((item)=>item.authorityRank));
      const top=current.filter((item)=>bestRank-Number(item.authorityRank||0)<=0.6);
      const topRooms=[...new Set(top.map((item)=>item.roomId))];
      if(topRooms.length>1&&top.some((item,index)=>top.slice(index+1).some((other)=>comparableAuthority(item,other)))){
        conflicts.push(conflictRecord(subjectId,top));
        selected=[...top].sort((a,b)=>b.confidence-a.confidence)[0];
        selected={...selected,state:'conflicted',roomId:null,candidateRoomIds:topRooms,confidence:Math.min(.49,selected.confidence)};
      }
    }
    if(!selected){
      selected=[...items].sort((a,b)=>(
        Number(b.authorityRank||0)-Number(a.authorityRank||0)||
        Number(b.freshness==='current')-Number(a.freshness==='current')||
        Number(b.confidence||0)-Number(a.confidence||0)||
        Number(b.observedAt||0)-Number(a.observedAt||0)
      ))[0];
    }
    const mergedEvidence=items.flatMap((item)=>item.evidence||[]).slice(-12);
    selected={...selected,evidence:mergedEvidence};
    selected=applyCorrections(selected,input.corrections||[],now);
    if(selected.correctionConflict){
      conflicts.push({
        id:'CONFLICT:correction:'+subjectId,
        type:'user-correction-conflict',
        subjectId,
        unresolved:true,
        confidence:selected.confidence,
        summary:'A newer observation conflicts with a user-confirmed correction.',
        data:selected.correctionConflict
      });
      selected.state='conflicted';
    }
    entities.push(selected);
  }

  for(const correction of arr(input.corrections)){
    if(correction.status==='superseded'||!correction.subjectId) continue;
    if(entities.some((item)=>item.subjectId===correction.subjectId)) continue;
    if(correction.type==='forget-entity') continue;
    entities.push(applyCorrections({
      id:'truth:'+correction.subjectId,
      subjectId:correction.subjectId,
      entityType:correction.entityType||'object',
      label:txt(correction.label||correction.subjectId,100),
      roomId:null,lastKnownRoomId:null,presence:'unknown',state:'unknown',
      authority:'remembered',authorityRank:FACT_AUTHORITY.remembered,
      baseConfidence:.2,confidence:.2,freshness:'unknown',ageMs:null,observedAt:null,evidence:[]
    },input.corrections,now));
  }

  return {entities,conflicts,candidates};
}

export function detectContinuityIssues(entities=[],candidates=[],now=Date.now()){
  const issues=[];
  const objects=arr(entities).filter((item)=>item.entityType==='object'&&item.state!=='forgotten');
  const byLabel=new Map();
  for(const item of objects){
    const label=String(item.label||'').toLowerCase();
    if(!label) continue;
    if(!byLabel.has(label)) byLabel.set(label,[]);
    byLabel.get(label).push(item);
  }
  for(const [label,items] of byLabel){
    if(items.length<2) continue;
    const current=items.filter((item)=>['current','recent'].includes(item.freshness));
    if(current.length<2) continue;
    issues.push({
      id:'CONTINUITY:object-label:'+label,
      type:'object-identity-ambiguity',
      label,
      subjectIds:current.map((item)=>item.subjectId),
      roomIds:[...new Set(current.map((item)=>item.roomId||item.lastKnownRoomId).filter(Boolean))],
      confidence:Math.max(...current.map((item)=>Number(item.confidence||0))),
      requiresConfirmation:true,
      suggestedCorrection:'entity-merge',
      summary:'Multiple recent object identities share the same label. Tracky will not merge them without explicit evidence or correction.'
    });
  }

  for(const candidate of arr(candidates)){
    if(candidate.entityType!=='person'||candidate.authority!=='reconciled-observation') continue;
    const same=arr(candidates).filter((other)=>(
      other!==candidate &&
      other.subjectId===candidate.subjectId &&
      other.roomId &&
      candidate.roomId &&
      other.roomId!==candidate.roomId &&
      other.freshness==='current' &&
      candidate.freshness==='current'
    ));
    if(same.length){
      const id='CONTINUITY:person:'+candidate.subjectId;
      if(!issues.some((item)=>item.id===id)){
        issues.push({
          id,
          type:'person-location-continuity-conflict',
          subjectIds:[candidate.subjectId],
          roomIds:[...new Set([candidate.roomId,...same.map((item)=>item.roomId)])],
          confidence:Math.max(candidate.confidence,...same.map((item)=>item.confidence)),
          requiresConfirmation:true,
          summary:'The same enrolled participant has incompatible current room evidence.'
        });
      }
    }
  }
  return issues;
}

export function createGroundTruthState(now=Date.now()){
  return {
    schemaVersion:GROUND_TRUTH_SCHEMA_VERSION,
    generatedAt:now,
    recoveryMode:false,
    activeRoomId:null,
    entities:[],
    conflicts:[],
    continuityIssues:[],
    facts:[],
    health:null,
    provenance:['multi-room-world','scene-graph','user-corrections'],
    boundaries:['semantic-ground-truth-only','conflicts-preserved','persisted-state-is-not-fresh-observation','no-autonomous-physical-control']
  };
}
export function buildGroundTruth(input={},previous=null,now=Date.now()){
  const reconciled=reconcileGroundTruthEntities(input,now);
  const state=createGroundTruthState(now);
  const currentEntities=reconciled.entities.filter((item)=>item.state!=='forgotten');
  const currentIds=new Set(currentEntities.map((item)=>item.subjectId));
  const recoveredCarry=arr(previous?.entities)
    .filter((item)=>(
      item.state!=='forgotten' &&
      item.authority==='recovered-history' &&
      !currentIds.has(item.subjectId)
    ))
    .map((item)=>({
      ...item,
      state:'last-known',
      freshness:'unknown',
      roomId:null,
      confidence:Math.min(.35,Number(item.confidence||0)),
      authority:'recovered-history',
      authorityRank:FACT_AUTHORITY['recovered-history']
    }));
  const hasFreshEvidence=currentEntities.some((item)=>(
    item.freshness==='current' &&
    item.authority!=='recovered-history'
  ));
  state.activeRoomId=hasFreshEvidence?(input.activeRoomId||null):null;
  state.lastKnownActiveRoomId=state.activeRoomId||previous?.lastKnownActiveRoomId||previous?.activeRoomId||null;
  state.entities=[...currentEntities,...recoveredCarry];
  state.conflicts=reconciled.conflicts;
  state.continuityIssues=detectContinuityIssues(state.entities,reconciled.candidates,now);
  state.recoveryMode=previous?.recoveryMode===true&&!hasFreshEvidence;
  state.facts=state.entities.flatMap((entity)=>{
    const facts=[{
      id:'FACT:'+entity.subjectId+':presence',
      subjectId:entity.subjectId,
      predicate:'presence',
      objectId:entity.state,
      state:entity.state,
      authority:entity.authority,
      confidence:entity.confidence,
      freshness:entity.freshness,
      observedAt:entity.observedAt,
      evidence:entity.evidence
    }];
    if(entity.roomId){
      facts.push({
        id:'FACT:'+entity.subjectId+':located-in:'+entity.roomId,
        subjectId:entity.subjectId,
        predicate:'located-in',
        objectId:entity.roomId,
        state:entity.state,
        authority:entity.authority,
        confidence:entity.confidence,
        freshness:entity.freshness,
        observedAt:entity.observedAt,
        evidence:entity.evidence
      });
    }
    return facts;
  });
  return state;
}
export function recoverGroundTruthSnapshot(saved={},now=Date.now()){
  const recovered=createGroundTruthState(now);
  recovered.recoveryMode=true;
  recovered.activeRoomId=null;
  recovered.lastKnownActiveRoomId=saved.activeRoomId||saved.lastKnownActiveRoomId||null;
  recovered.entities=arr(saved.entities).map((entity)=>({
    ...entity,
    state:entity.state==='forgotten'?'forgotten':'last-known',
    freshness:'unknown',
    confidence:Math.min(.35,Number(entity.confidence||0)),
    authority:'recovered-history',
    authorityRank:FACT_AUTHORITY['recovered-history'],
    recoveredAt:now,
    roomId:null,
    lastKnownRoomId:entity.roomId||entity.lastKnownRoomId||null
  })).filter((item)=>item.state!=='forgotten');
  recovered.conflicts=[];
  recovered.continuityIssues=[];
  recovered.facts=[];
  return recovered;
}
export function explainGroundTruth(state={},subjectId){
  const entity=arr(state.entities).find((item)=>item.subjectId===subjectId)||null;
  if(!entity){
    return {
      status:'not-found',subjectId,
      summary:'Tracky has no current ground-truth record for this entity.',
      observed:false,evidence:[],conflicts:[]
    };
  }
  const conflicts=arr(state.conflicts).filter((item)=>item.subjectId===subjectId);
  const observed=entity.freshness==='current'&&['direct-observation','reconciled-observation','user-confirmed'].includes(entity.authority);
  const location=entity.roomId
    ?'in '+entity.roomId
    :entity.candidateRoomIds?.length
      ?'with conflicting room candidates '+entity.candidateRoomIds.join(', ')
      :entity.lastKnownRoomId
        ?'last known in '+entity.lastKnownRoomId
        :'at an unknown location';
  return {
    status:conflicts.length?'conflicted':entity.state,
    subjectId,
    label:entity.label,
    summary:(entity.label||subjectId)+' is '+location+'. '+(
      observed?'This is based on current governed evidence.':
      entity.authority==='user-confirmed'?'This is based on a user-confirmed correction.':
      'This is historical or insufficiently fresh evidence, not a current observation.'
    ),
    observed,
    authority:entity.authority,
    confidence:entity.confidence,
    freshness:entity.freshness,
    observedAt:entity.observedAt,
    roomId:entity.roomId,
    lastKnownRoomId:entity.lastKnownRoomId,
    evidence:arr(entity.evidence).slice(-12),
    conflicts
  };
}
export function groundTruthSnapshot(state){
  return JSON.parse(JSON.stringify(state||createGroundTruthState()));
}
