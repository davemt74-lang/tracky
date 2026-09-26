const arr=(v)=>Array.isArray(v)?v:[];
const txt=(v,max=160)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);

export const GROUND_TRUTH_CORRECTION_SCHEMA_VERSION=1;
export const GROUND_TRUTH_CORRECTION_TYPES=Object.freeze([
  'entity-label','entity-location','forget-entity','camera-moved','entity-merge','identity-rejection'
]);

export function normalizeGroundTruthCorrection(input={},now=Date.now()){
  const type=GROUND_TRUTH_CORRECTION_TYPES.includes(String(input.type))
    ?String(input.type):'entity-label';
  const subjectId=txt(input.subjectId||'',140)||null;
  const cameraId=txt(input.cameraId||'',120)||null;
  const id=txt(input.id||'',160)||(
    'GT-CORR-'+now+'-'+Math.random().toString(36).slice(2,7)
  );
  return {
    schemaVersion:GROUND_TRUTH_CORRECTION_SCHEMA_VERSION,
    id,
    type,
    status:['active','superseded'].includes(String(input.status))?String(input.status):'active',
    subjectId,
    entityType:['person','object'].includes(String(input.entityType))?String(input.entityType):null,
    label:txt(input.label||'',100)||null,
    roomId:txt(input.roomId||'',120)||null,
    cameraId,
    canonicalEntityId:txt(input.canonicalEntityId||'',140)||null,
    aliasEntityId:txt(input.aliasEntityId||'',140)||null,
    reason:txt(input.reason||'',240)||null,
    source:'user',
    authority:'user-confirmed',
    createdAt:Number(input.createdAt||now),
    updatedAt:Number(input.updatedAt||now),
    boundaries:['explicit-user-correction','semantic-only','no-autonomous-physical-control']
  };
}
export function appendGroundTruthCorrection(items=[],input={},now=Date.now(),limit=250){
  const correction=normalizeGroundTruthCorrection(input,now);
  const next=arr(items).map((item)=>({...item}));
  if(correction.subjectId){
    for(const item of next){
      if(
        item.status!=='superseded' &&
        item.subjectId===correction.subjectId &&
        item.type===correction.type
      ){
        item.status='superseded';
        item.updatedAt=now;
        item.supersededBy=correction.id;
      }
    }
  }
  if(correction.type==='camera-moved'&&correction.cameraId){
    for(const item of next){
      if(item.status!=='superseded'&&item.type==='camera-moved'&&item.cameraId===correction.cameraId){
        item.status='superseded';item.updatedAt=now;item.supersededBy=correction.id;
      }
    }
  }
  next.push(correction);
  if(next.length>limit) next.splice(0,next.length-limit);
  return {correction,corrections:next};
}
function matchByLabel(items=[],label){
  const q=txt(label,100).toLowerCase();
  return arr(items).filter((item)=>String(item.label||'').toLowerCase()===q);
}
export function interpretGroundTruthCorrection(text,context={},options={},now=Date.now()){
  const raw=txt(text,500).replace(/[.!?]+$/,'');
  const entities=arr(context.entities);

  if (/^forget (?:that|this) (?:object|person)$/i.test(raw) && options.subjectId) {
    return {status:'ready',intent:'correct',correction:normalizeGroundTruthCorrection({
      type:'forget-entity',subjectId:options.subjectId,entityType:options.entityType||null,
      label:options.label||null,reason:'deictic-user-forget'
    },now),raw};
  }

  let m=raw.match(/^forget (?:that |the )?(?:object |person )?(.+)$/i);
  if(m){
    const matches=matchByLabel(entities,m[1]);
    if(matches.length!==1) return {status:matches.length?'ambiguous':'not-found',intent:'forget-entity',candidates:matches,raw};
    return {status:'ready',intent:'correct',correction:normalizeGroundTruthCorrection({
      type:'forget-entity',subjectId:matches[0].subjectId,entityType:matches[0].entityType,
      label:matches[0].label,reason:'natural-language-forget'
    },now),raw};
  }

  m=raw.match(/^(.+?) (?:is|belongs) in (?:the )?(.+)$/i);
  if(m){
    const entityMatches=matchByLabel(entities,m[1]);
    const roomMatches=arr(context.rooms).filter((room)=>[
      room.id,room.name,room.label
    ].filter(Boolean).some((value)=>String(value).toLowerCase()===m[2].toLowerCase()));
    if(entityMatches.length!==1||roomMatches.length!==1){
      return {status:'ambiguous',intent:'entity-location',entities:entityMatches,rooms:roomMatches,raw};
    }
    return {status:'ready',intent:'correct',correction:normalizeGroundTruthCorrection({
      type:'entity-location',subjectId:entityMatches[0].subjectId,entityType:entityMatches[0].entityType,
      label:entityMatches[0].label,roomId:roomMatches[0].id,reason:'natural-language-location-correction'
    },now),raw};
  }

  m=raw.match(/^(?:that|this) is not (.+)$/i);
  if(m&&options.subjectId){
    return {status:'ready',intent:'correct',correction:normalizeGroundTruthCorrection({
      type:'identity-rejection',subjectId:options.subjectId,entityType:options.entityType||'person',
      label:m[1],reason:'natural-language-identity-rejection'
    },now),raw};
  }

  m=raw.match(/^(?:those|these|that|this) (?:are|is) (?:my )?(.+)$/i);
  if(m&&options.subjectId){
    return {status:'ready',intent:'correct',correction:normalizeGroundTruthCorrection({
      type:'entity-label',subjectId:options.subjectId,entityType:options.entityType||null,
      label:m[1],reason:'natural-language-label-correction'
    },now),raw};
  }

  if(/^this camera moved$/i.test(raw)){
    const cameraId=options.cameraId||context.primaryCameraId||null;
    if(!cameraId) return {status:'needs-context',intent:'camera-moved',raw};
    return {status:'ready',intent:'correct',correction:normalizeGroundTruthCorrection({
      type:'camera-moved',cameraId,reason:'user-reported-camera-move'
    },now),raw};
  }

  return {status:'unsupported',intent:'unknown',raw};
}
export function activeGroundTruthCorrections(items=[]){
  return arr(items).filter((item)=>item.status!=='superseded');
}
