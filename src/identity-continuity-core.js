const txt=(v,max=240)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);
const arr=(v)=>Array.isArray(v)?v:[];
const copy=(v)=>JSON.parse(JSON.stringify(v));
const clamp01=(v)=>Math.max(0,Math.min(1,Number.isFinite(Number(v))?Number(v):0));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SITE_REF=/^site:([0-9a-f-]{36})::(.+)$/;
const FORBIDDEN=/(?:^|_)(?:raw|frame|frames|image|images|video|videos|audio|recording|recordings|embedding|embeddings|blob|bytes|pixels|file_path|filesystem_path|camera_uri)(?:$|_)/i;

export const IDENTITY_CONTINUITY_PROTOCOL='physical_identity_continuity.v1';
export const IDENTITY_CONTINUITY_SCHEMA_VERSION=1;
export const IDENTITY_LINK_STATES=Object.freeze(['proposed','confirmed','rejected','revoked','split']);
export const IDENTITY_ENTITY_TYPES=Object.freeze(['person','device','object','animal']);
export const IDENTITY_EVIDENCE_TYPES=Object.freeze([
  'user_confirmed',
  'user_rejected',
  'stable_device_credential',
  'enrollment_match',
  'recognition_match',
  'voice_profile_match',
  'mobile_transition_continuity',
  'shared_alias',
  'behavioral_match',
  'conflicting_observation'
]);

function uuid(v,label){
  const out=txt(v,64).toLowerCase();
  if(!UUID.test(out))throw new Error(label+' must be a UUID.');
  return out;
}
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
function stableHex(value){
  const input=JSON.stringify(canonical(value));
  let a=0x811c9dc5,b=0x9e3779b9,c=0x85ebca6b,d=0xc2b2ae35;
  for(let i=0;i<input.length;i++){
    const n=input.charCodeAt(i);
    a=Math.imul(a^n,0x01000193);
    b=Math.imul(b+n+(a>>>11),0x85ebca6b);
    c=Math.imul(c^(n+(b>>>13)),0xc2b2ae35);
    d=Math.imul(d+n+(c>>>15),0x27d4eb2f);
  }
  return [a,b,c,d].map(n=>(n>>>0).toString(16).padStart(8,'0')).join('');
}
function deterministicUuid(material){
  const h=stableHex(material).slice(0,32).split('');
  h[12]='5';
  h[16]=['8','9','a','b'][parseInt(h[16],16)%4];
  const s=h.join('');
  return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20,32);
}
function semantic(value,path='payload',depth=0){
  if(depth>8)throw new Error('Identity continuity semantic value is too deeply nested.');
  if(value==null||['string','number','boolean'].includes(typeof value)){
    return typeof value==='string'?txt(value,800):value;
  }
  if(Array.isArray(value)){
    if(value.length>128)throw new Error('Identity continuity semantic list is too large.');
    return value.map((item,index)=>semantic(item,path+'['+index+']',depth+1));
  }
  if(typeof value!=='object')return null;
  const out={};
  for(const [key,item] of Object.entries(value).slice(0,128)){
    if(FORBIDDEN.test(key))throw new Error('Identity continuity cannot retain raw perception payloads at '+path+'.'+key+'.');
    out[txt(key,80)]=semantic(item,path+'.'+key,depth+1);
  }
  return out;
}
function normalizeRef(value,label='entity ref'){
  const ref=txt(value,300);
  const m=SITE_REF.exec(ref);
  if(!m)throw new Error(label+' must be a site-qualified federated entity ref.');
  uuid(m[1],label+' site id');
  let local='';
  try{local=decodeURIComponent(m[2]);}catch{throw new Error(label+' contains invalid encoding.');}
  if(!local||local.length>160)throw new Error(label+' local id is invalid.');
  return ref;
}
function siteOfRef(ref){return SITE_REF.exec(ref)?.[1]||'';}
function normalizeType(value){
  const type=txt(value,40).toLowerCase();
  if(!IDENTITY_ENTITY_TYPES.includes(type))throw new Error('Identity entity type is unsupported.');
  return type;
}
function pairKey(a,b){
  const refs=[normalizeRef(a),normalizeRef(b)].sort();
  if(refs[0]===refs[1])throw new Error('Identity link requires two distinct entity refs.');
  if(siteOfRef(refs[0])===siteOfRef(refs[1]))throw new Error('Cross-site identity link requires refs from different sites.');
  return refs.join('|');
}
function normalizeEvidence(input={},now=Date.now()){
  const type=txt(input.type,80).toLowerCase();
  if(!IDENTITY_EVIDENCE_TYPES.includes(type))throw new Error('Identity evidence type is unsupported.');
  const source=txt(input.source||'tracky',100);
  const sourceClass=txt(input.sourceClass??input.source_class??'sensor',40).toLowerCase();
  if(!['user','credential','enrollment','biometric','sensor','transition','system'].includes(sourceClass)){
    throw new Error('Identity evidence source class is unsupported.');
  }
  const at=Number(input.at??input.observedAt??input.observed_at??now);
  return {
    evidence_id:txt(input.evidenceId??input.evidence_id??deterministicUuid({type,source,at,metadata:input.metadata||{}}),80),
    type,source,source_class:sourceClass,
    confidence:clamp01(input.confidence??1),
    at:Number.isFinite(at)?at:Number(now),
    consent_scope:semantic(input.consentScope??input.consent_scope??{},'evidence.consent_scope'),
    metadata:semantic(input.metadata||{},'evidence.metadata')
  };
}
function evidenceKey(e){return e.type+'|'+e.source_class+'|'+e.source;}
function policyDecision(link,policy={}){
  const ev=arr(link.evidence);
  if(ev.some(e=>e.type==='user_rejected'||(e.type==='conflicting_observation'&&e.confidence>=0.8))){
    return {eligible:false,reason:'explicit_or_strong_conflict'};
  }
  if(ev.some(e=>e.type==='user_confirmed')){
    return {eligible:true,reason:'user_confirmed'};
  }
  if(link.entity_type==='device'){
    const stable=ev.filter(e=>e.type==='stable_device_credential'&&e.confidence>=0.95);
    if(stable.length>=1)return {eligible:true,reason:'stable_device_credential'};
  }
  if(link.entity_type==='person'){
    if(policy.personAutoLink===false)return {eligible:false,reason:'person_auto_link_disabled'};
    const consent=ev.some(e=>e.consent_scope?.identity_linking_allowed===true);
    if(!consent)return {eligible:false,reason:'identity_linking_consent_required'};
    const strong=ev.filter(e=>['enrollment_match','recognition_match','voice_profile_match'].includes(e.type)&&e.confidence>=0.92);
    const classes=new Set(strong.map(e=>e.source_class+':'+e.source));
    if(strong.length>=2&&classes.size>=2)return {eligible:true,reason:'multi_source_high_confidence_person_match'};
    return {eligible:false,reason:'insufficient_independent_person_evidence'};
  }
  if(link.entity_type==='object'||link.entity_type==='animal'){
    const strong=ev.filter(e=>['enrollment_match','recognition_match','shared_alias'].includes(e.type)&&e.confidence>=0.95);
    const classes=new Set(strong.map(e=>e.source_class+':'+e.source));
    if(strong.length>=2&&classes.size>=2)return {eligible:true,reason:'multi_source_high_confidence_match'};
  }
  return {eligible:false,reason:'insufficient_evidence'};
}
function memberGroups(state,ref){
  const ids=[];
  for(const [id,identity] of Object.entries(state.identities||{})){
    if(identity.status==='active'&&arr(identity.members).includes(ref))ids.push(id);
  }
  return ids;
}
function assertNoActiveCollision(state,link){
  for(const ref of [link.left_ref,link.right_ref]){
    const ids=memberGroups(state,ref);
    if(ids.length>1)throw new Error('Entity ref is already present in multiple active canonical identities.');
    if(ids.length===1&&ids[0]!==link.canonical_identity_id){
      throw new Error('Entity ref is already assigned to a different active canonical identity.');
    }
  }
}
function confidenceFromEvidence(link){
  const positive=arr(link.evidence).filter(e=>!['user_rejected','conflicting_observation'].includes(e.type));
  const negative=arr(link.evidence).filter(e=>['user_rejected','conflicting_observation'].includes(e.type));
  if(!positive.length)return 0;
  const p=positive.reduce((s,e)=>s+e.confidence,0)/positive.length;
  const n=negative.reduce((s,e)=>s+e.confidence,0)/(negative.length||1);
  return clamp01(p-(negative.length?n*0.75:0));
}
function audit(state,type,details,now){
  state.audit=[...arr(state.audit),{type,details:semantic(details||{}),at:Number(now)}].slice(-1000);
}

export function createIdentityContinuityState(now=Date.now()){
  return {
    protocol:IDENTITY_CONTINUITY_PROTOCOL,
    schemaVersion:IDENTITY_CONTINUITY_SCHEMA_VERSION,
    createdAt:Number(now),updatedAt:Number(now),
    links:{},identities:{},blockedPairs:{},audit:[],
    boundaries:[
      'site-local-entity-refs-never-mutated',
      'links-before-canonicalization',
      'reversible-and-splittable',
      'no-silent-person-merge',
      'independent-evidence-required',
      'raw-perception-never-retained',
      'cloud-read-only'
    ]
  };
}

export function proposeIdentityLink(stateInput,input={},now=Date.now()){
  const state=stateInput?.protocol===IDENTITY_CONTINUITY_PROTOCOL?copy(stateInput):createIdentityContinuityState(now);
  const left=normalizeRef(input.leftRef??input.left_ref,'left ref');
  const right=normalizeRef(input.rightRef??input.right_ref,'right ref');
  const key=pairKey(left,right);
  if(state.blockedPairs[key])throw new Error('Identity pair is blocked by a prior rejection or split.');
  const entityType=normalizeType(input.entityType??input.entity_type);
  const canonicalId=input.canonicalIdentityId??input.canonical_identity_id
    ?uuid(input.canonicalIdentityId??input.canonical_identity_id,'canonical identity id')
    :deterministicUuid({entityType,pair:key});
  if(state.links[key]){
    const prior=state.links[key];
    if(prior.entity_type!==entityType)throw new Error('Identity link entity type conflicts with existing proposal.');
    return {state,link:copy(prior),idempotent:true};
  }
  const link={
    link_id:deterministicUuid({pair:key,entityType}),
    canonical_identity_id:canonicalId,
    entity_type:entityType,
    left_ref:left,right_ref:right,
    status:'proposed',reason:'candidate_link',
    evidence:[],confidence:0,
    revision:1,created_at:Number(now),updated_at:Number(now),
    confirmed_at:null,rejected_at:null,revoked_at:null,split_at:null,
    auto_confirmed:false
  };
  state.links[key]=link;
  state.updatedAt=Number(now);
  audit(state,'identity_link_proposed',{linkId:link.link_id,left,right,entityType},now);
  return {state,link:copy(link),idempotent:false};
}

export function addIdentityEvidence(stateInput,input={},now=Date.now()){
  const state=stateInput?.protocol===IDENTITY_CONTINUITY_PROTOCOL?copy(stateInput):createIdentityContinuityState(now);
  const key=pairKey(input.leftRef??input.left_ref,input.rightRef??input.right_ref);
  const link=state.links[key];
  if(!link)throw new Error('Identity link proposal does not exist.');
  if(['rejected','revoked','split'].includes(link.status))throw new Error('Closed identity link cannot accept new evidence.');
  const evidence=normalizeEvidence(input.evidence||input,now);
  const ek=evidenceKey(evidence);
  const existing=link.evidence.find(e=>evidenceKey(e)===ek&&e.evidence_id===evidence.evidence_id);
  if(existing)return {state,link:copy(link),idempotent:true};
  link.evidence=[...link.evidence,evidence].slice(-128);
  link.confidence=confidenceFromEvidence(link);
  link.revision++;
  link.updated_at=Number(now);
  state.updatedAt=Number(now);
  audit(state,'identity_evidence_added',{linkId:link.link_id,evidenceType:evidence.type},now);
  return {state,link:copy(link),idempotent:false};
}

export function evaluateIdentityLink(stateInput,input={},now=Date.now()){
  const state=stateInput?.protocol===IDENTITY_CONTINUITY_PROTOCOL?copy(stateInput):createIdentityContinuityState(now);
  const key=pairKey(input.leftRef??input.left_ref,input.rightRef??input.right_ref);
  const link=state.links[key];
  if(!link)throw new Error('Identity link proposal does not exist.');
  if(link.status==='confirmed')return {state,link:copy(link),eligible:true,idempotent:true};
  if(['rejected','revoked','split'].includes(link.status))return {state,link:copy(link),eligible:false,idempotent:true};
  const decision=policyDecision(link,input.policy||{});
  if(!decision.eligible){
    link.reason=decision.reason;
    link.updated_at=Number(now);
    state.updatedAt=Number(now);
    return {state,link:copy(link),eligible:false,reason:decision.reason,idempotent:false};
  }
  assertNoActiveCollision(state,link);
  const id=link.canonical_identity_id;
  const existing=state.identities[id]||{
    canonical_identity_id:id,entity_type:link.entity_type,status:'active',
    members:[],aliases:[],created_at:Number(now),updated_at:Number(now),revision:0
  };
  if(existing.entity_type!==link.entity_type)throw new Error('Canonical identity type conflicts with proposed link.');
  const members=[...new Set([...arr(existing.members),link.left_ref,link.right_ref])].sort();
  existing.members=members;
  existing.status='active';
  existing.updated_at=Number(now);
  existing.revision=Math.max(0,Number(existing.revision)||0)+1;
  state.identities[id]=existing;
  link.status='confirmed';
  link.reason=decision.reason;
  link.confirmed_at=Number(now);
  link.auto_confirmed=decision.reason!=='user_confirmed';
  link.confidence=confidenceFromEvidence(link);
  link.revision++;
  link.updated_at=Number(now);
  state.updatedAt=Number(now);
  audit(state,'identity_link_confirmed',{linkId:link.link_id,canonicalIdentityId:id,reason:decision.reason},now);
  return {state,link:copy(link),identity:copy(existing),eligible:true,reason:decision.reason,idempotent:false};
}

export function rejectIdentityLink(stateInput,input={},now=Date.now()){
  const state=stateInput?.protocol===IDENTITY_CONTINUITY_PROTOCOL?copy(stateInput):createIdentityContinuityState(now);
  const key=pairKey(input.leftRef??input.left_ref,input.rightRef??input.right_ref);
  const link=state.links[key];
  if(!link)throw new Error('Identity link proposal does not exist.');
  if(link.status==='confirmed')throw new Error('Confirmed identity link must be split or revoked, not rejected.');
  if(link.status==='rejected')return {state,link:copy(link),idempotent:true};
  link.status='rejected';link.reason=txt(input.reason||'user_rejected',200);
  link.rejected_at=Number(now);link.updated_at=Number(now);link.revision++;
  state.blockedPairs[key]={reason:link.reason,at:Number(now)};
  state.updatedAt=Number(now);
  audit(state,'identity_link_rejected',{linkId:link.link_id,reason:link.reason},now);
  return {state,link:copy(link),idempotent:false};
}

export function splitIdentityLink(stateInput,input={},now=Date.now()){
  const state=stateInput?.protocol===IDENTITY_CONTINUITY_PROTOCOL?copy(stateInput):createIdentityContinuityState(now);
  const key=pairKey(input.leftRef??input.left_ref,input.rightRef??input.right_ref);
  const link=state.links[key];
  if(!link||link.status!=='confirmed')throw new Error('Only a confirmed identity link can be split.');
  const identity=state.identities[link.canonical_identity_id];
  if(identity){
    const remove=new Set([link.left_ref,link.right_ref]);
    const linkedElsewhere=new Set();
    for(const other of Object.values(state.links)){
      if(other.link_id===link.link_id||other.status!=='confirmed'||other.canonical_identity_id!==identity.canonical_identity_id)continue;
      linkedElsewhere.add(other.left_ref);linkedElsewhere.add(other.right_ref);
    }
    identity.members=arr(identity.members).filter(ref=>!remove.has(ref)||linkedElsewhere.has(ref));
    identity.updated_at=Number(now);identity.revision++;
    if(identity.members.length<2)identity.status='split';
  }
  link.status='split';link.reason=txt(input.reason||'identity_split',200);
  link.split_at=Number(now);link.updated_at=Number(now);link.revision++;
  state.blockedPairs[key]={reason:link.reason,at:Number(now)};
  state.updatedAt=Number(now);
  audit(state,'identity_link_split',{linkId:link.link_id,canonicalIdentityId:link.canonical_identity_id},now);
  return {state,link:copy(link),identity:identity?copy(identity):null};
}

export function revokeCanonicalIdentity(stateInput,input={},now=Date.now()){
  const state=stateInput?.protocol===IDENTITY_CONTINUITY_PROTOCOL?copy(stateInput):createIdentityContinuityState(now);
  const id=uuid(input.canonicalIdentityId??input.canonical_identity_id,'canonical identity id');
  const identity=state.identities[id];
  if(!identity)throw new Error('Canonical identity does not exist.');
  if(identity.status==='revoked')return {state,identity:copy(identity),idempotent:true};
  identity.status='revoked';identity.updated_at=Number(now);identity.revision++;
  for(const [key,link] of Object.entries(state.links)){
    if(link.canonical_identity_id!==id||link.status!=='confirmed')continue;
    link.status='revoked';link.reason=txt(input.reason||'canonical_identity_revoked',200);
    link.revoked_at=Number(now);link.updated_at=Number(now);link.revision++;
    state.blockedPairs[key]={reason:link.reason,at:Number(now)};
  }
  state.updatedAt=Number(now);
  audit(state,'canonical_identity_revoked',{canonicalIdentityId:id},now);
  return {state,identity:copy(identity),idempotent:false};
}

export function addIdentityAlias(stateInput,input={},now=Date.now()){
  const state=stateInput?.protocol===IDENTITY_CONTINUITY_PROTOCOL?copy(stateInput):createIdentityContinuityState(now);
  const id=uuid(input.canonicalIdentityId??input.canonical_identity_id,'canonical identity id');
  const identity=state.identities[id];
  if(!identity||identity.status!=='active')throw new Error('Active canonical identity does not exist.');
  const alias=txt(input.alias,160);
  if(!alias)throw new Error('Identity alias is required.');
  identity.aliases=[...new Set([...arr(identity.aliases),alias])].sort();
  identity.updated_at=Number(now);identity.revision++;
  state.updatedAt=Number(now);
  audit(state,'identity_alias_added',{canonicalIdentityId:id,alias},now);
  return {state,identity:copy(identity)};
}

export function resolveCanonicalIdentity(stateInput,entityRef){
  const state=stateInput?.protocol===IDENTITY_CONTINUITY_PROTOCOL?stateInput:createIdentityContinuityState();
  const ref=normalizeRef(entityRef);
  const matches=Object.values(state.identities||{}).filter(i=>i.status==='active'&&arr(i.members).includes(ref));
  if(matches.length>1)throw new Error('Entity ref resolves to multiple active canonical identities.');
  return matches.length?copy(matches[0]):null;
}

export function identityContinuitySnapshot(stateInput){
  const state=stateInput?.protocol===IDENTITY_CONTINUITY_PROTOCOL?stateInput:createIdentityContinuityState();
  return {
    protocol:IDENTITY_CONTINUITY_PROTOCOL,
    schema_version:IDENTITY_CONTINUITY_SCHEMA_VERSION,
    generated_at:state.updatedAt,
    identities:Object.values(state.identities||{}).sort((a,b)=>a.canonical_identity_id.localeCompare(b.canonical_identity_id)),
    links:Object.values(state.links||{}).sort((a,b)=>a.link_id.localeCompare(b.link_id)),
    blocked_pairs:Object.entries(state.blockedPairs||{}).map(([pair,value])=>({pair,...copy(value)})),
    semantic_only:true,cloud_read_only:true,
    site_local_entities_immutable:true,reversible:true
  };
}

export function cloudIdentityContinuityProjection(stateInput){
  const snapshot=identityContinuitySnapshot(stateInput);
  return {
    ...snapshot,
    summary_only:true,
    cloud_read_only:true,
    authority_assignment:'homeserver_governed',
    cloud_can_confirm_links:false,
    cloud_can_merge_identities:false,
    cloud_can_split_identities:false
  };
}
