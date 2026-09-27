const txt=(v,max=200)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);
const arr=(v)=>Array.isArray(v)?v:[];
const copy=(v)=>JSON.parse(JSON.stringify(v));
const clamp01=(v)=>Math.max(0,Math.min(1,Number.isFinite(Number(v))?Number(v):0));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/;
const FORBIDDEN=/(?:^|_)(?:raw|frame|frames|image|images|video|videos|audio|recording|recordings|embedding|embeddings|blob|bytes|pixels|file_path|filesystem_path|camera_uri)(?:$|_)/i;

export const MOBILE_TRANSITION_PROTOCOL='physical_mobile_transition.v1';
export const MOBILE_TRANSITION_SCHEMA_VERSION=1;
export const MOBILE_TRANSITION_STATES=Object.freeze([
  'departing','in_transit','arriving','arrived','uncertain','offline','temporary_context','canceled'
]);
export const MOBILE_TRANSITION_EVIDENCE=Object.freeze([
  'source_departure_observed',
  'source_absence_confirmed',
  'mobile_motion',
  'mobile_online',
  'mobile_offline',
  'destination_candidate',
  'destination_arrival_observed',
  'user_confirmed_destination',
  'conflicting_site_observation',
  'temporary_context_observed',
  'transition_canceled'
]);

function uuid(v,label){
  const out=txt(v,64).toLowerCase();
  if(!UUID.test(out))throw new Error(label+' must be a UUID.');
  return out;
}
function id(v,label){
  const out=txt(v,160);
  if(!ID.test(out))throw new Error(label+' is invalid.');
  return out;
}
function semantic(value,path='payload',depth=0){
  if(depth>8)throw new Error('Mobile transition semantic value is too deeply nested.');
  if(value==null||['string','number','boolean'].includes(typeof value)){
    return typeof value==='string'?txt(value,500):value;
  }
  if(Array.isArray(value)){
    if(value.length>128)throw new Error('Mobile transition semantic list is too large.');
    return value.map((item,index)=>semantic(item,path+'['+index+']',depth+1));
  }
  if(typeof value!=='object')return null;
  const out={};
  for(const [key,item] of Object.entries(value).slice(0,128)){
    if(FORBIDDEN.test(key))throw new Error('Mobile transition cannot retain raw perception payloads at '+path+'.'+key+'.');
    out[txt(key,80)]=semantic(item,path+'.'+key,depth+1);
  }
  return out;
}
function subject(input={}){
  const kind=txt(input.subjectKind??input.subject_kind??'mobile_device',40).toLowerCase();
  if(!['mobile_device','explicit_continuity_subject'].includes(kind)){
    throw new Error('Mobile transition subject kind is unsupported.');
  }
  const raw=input.subjectId??input.subject_id;
  const subjectId=kind==='mobile_device'?uuid(raw,'mobile device id'):id(raw,'continuity subject id');
  return {kind,id:subjectId,scope:kind==='mobile_device'?'stable_mobile_device':'explicit_continuity_subject'};
}
function transitionKey(subjectInfo,transitionId){
  return subjectInfo.kind+':'+subjectInfo.id+':'+transitionId;
}
function nextTransitionId(subjectInfo,sourceSiteId,now){
  return 'transition:'+subjectInfo.id+':'+sourceSiteId+':'+Number(now);
}
function normalizeEvidence(input={},now=Date.now()){
  const type=txt(input.type,80).toLowerCase();
  if(!MOBILE_TRANSITION_EVIDENCE.includes(type))throw new Error('Mobile transition evidence type is unsupported.');
  const confidence=clamp01(input.confidence??1);
  const siteId=input.siteId??input.site_id?uuid(input.siteId??input.site_id,'evidence site id'):'';
  const contextId=input.contextId??input.context_id?id(input.contextId??input.context_id,'temporary context id'):'';
  const at=Number(input.at??input.observedAt??input.observed_at??now);
  return {
    type,
    confidence,
    site_id:siteId,
    context_id:contextId,
    context_label:txt(input.contextLabel??input.context_label??'',160),
    source:txt(input.source||'tracky',80),
    at:Number.isFinite(at)?at:Number(now),
    metadata:semantic(input.metadata||{},'evidence.metadata')
  };
}
function activeTransitionFor(state,subjectInfo){
  const key=state.activeBySubject?.[subjectInfo.kind+':'+subjectInfo.id];
  return key?state.transitions?.[key]||null:null;
}
function setActive(state,subjectInfo,key){
  state.activeBySubject=state.activeBySubject||{};
  state.activeBySubject[subjectInfo.kind+':'+subjectInfo.id]=key;
}
function clearActive(state,transition){
  const key=transition.subject_kind+':'+transition.subject_id;
  if(state.activeBySubject?.[key]===transition.key)delete state.activeBySubject[key];
}
function audit(state,type,details,now){
  state.audit=[...arr(state.audit),{type,details:semantic(details||{}),at:Number(now)}].slice(-500);
}
function setState(transition,next,reason,now){
  if(!MOBILE_TRANSITION_STATES.includes(next))throw new Error('Mobile transition state is invalid.');
  if(transition.state!==next){
    transition.previous_state=transition.state;
    transition.state=next;
    transition.state_reason=txt(reason,200);
    transition.state_changed_at=Number(now);
  }
}
function candidateDestination(transition,evidence){
  if(evidence.site_id&&evidence.site_id!==transition.source_site_id){
    transition.destination_site_id=evidence.site_id;
    transition.destination_confidence=Math.max(Number(transition.destination_confidence||0),evidence.confidence);
  }
}
function recalcConfidence(transition){
  const evidence=arr(transition.evidence);
  if(!evidence.length){transition.confidence=0;return;}
  const weighted=evidence.reduce((sum,item)=>{
    const weight=item.type==='user_confirmed_destination'?1.5:item.type==='destination_arrival_observed'?1.25:item.type==='conflicting_site_observation'?-1.0:1;
    return sum+(item.confidence*weight);
  },0);
  const denom=evidence.reduce((sum,item)=>sum+(item.type==='user_confirmed_destination'?1.5:item.type==='destination_arrival_observed'?1.25:item.type==='conflicting_site_observation'?1:1),0);
  transition.confidence=clamp01(denom?weighted/denom:0);
}
function applyEvidenceState(transition,evidence,now){
  if(transition.state==='canceled')return;
  switch(evidence.type){
    case 'source_departure_observed':
      if(['arrived','temporary_context'].includes(transition.state))setState(transition,'departing','new_departure_observed',now);
      else if(transition.state==='uncertain')setState(transition,'departing','departure_reobserved',now);
      break;
    case 'source_absence_confirmed':
    case 'mobile_motion':
      if(['departing','uncertain','offline'].includes(transition.state))setState(transition,'in_transit',evidence.type,now);
      break;
    case 'destination_candidate':
      candidateDestination(transition,evidence);
      if(['departing','in_transit','uncertain','offline','temporary_context'].includes(transition.state)){
        setState(transition,'arriving','destination_candidate',now);
      }
      break;
    case 'destination_arrival_observed':
      candidateDestination(transition,evidence);
      if(!transition.destination_site_id||transition.destination_site_id===transition.source_site_id){
        setState(transition,'uncertain','arrival_without_valid_destination',now);
      }else if(evidence.confidence>=0.7){
        setState(transition,'arrived','destination_arrival_observed',now);
        transition.arrived_at=Number(now);
      }else{
        setState(transition,'arriving','low_confidence_arrival',now);
      }
      break;
    case 'user_confirmed_destination':
      candidateDestination(transition,{...evidence,confidence:1});
      if(!transition.destination_site_id||transition.destination_site_id===transition.source_site_id){
        setState(transition,'uncertain','invalid_confirmed_destination',now);
      }else{
        setState(transition,'arrived','user_confirmed_destination',now);
        transition.arrived_at=Number(now);
        transition.destination_confidence=1;
      }
      break;
    case 'conflicting_site_observation':
      setState(transition,'uncertain','conflicting_site_observation',now);
      break;
    case 'mobile_offline':
      if(transition.state!=='arrived'){
        transition.resume_state=['departing','in_transit','arriving','temporary_context','uncertain'].includes(transition.state)
          ?transition.state:'uncertain';
        setState(transition,'offline','mobile_offline',now);
        transition.offline_since=Number(now);
      }
      break;
    case 'mobile_online':
      if(transition.state==='offline'){
        setState(transition,transition.resume_state||'uncertain','mobile_online',now);
        transition.offline_since=null;
      }
      break;
    case 'temporary_context_observed':
      transition.temporary_context={
        id:evidence.context_id||('temporary:'+transition.transition_id),
        label:evidence.context_label||'Temporary context',
        observed_at:evidence.at,
        confidence:evidence.confidence,
        durable_site:false,
        site_authority:false
      };
      setState(transition,'temporary_context','temporary_context_observed',now);
      break;
    case 'transition_canceled':
      setState(transition,'canceled','transition_canceled',now);
      transition.canceled_at=Number(now);
      break;
  }
}
function normalizeTransition(raw={}){
  const out=copy(raw);
  out.evidence=arr(out.evidence).slice(-256);
  return out;
}

export function createMobileTransitionState(now=Date.now()){
  return {
    protocol:MOBILE_TRANSITION_PROTOCOL,
    schemaVersion:MOBILE_TRANSITION_SCHEMA_VERSION,
    createdAt:Number(now),updatedAt:Number(now),
    transitions:{},activeBySubject:{},audit:[],
    boundaries:[
      'mobile-device-continuity-is-stable',
      'person-object-cross-site-identity-linking-deferred',
      'temporary-context-is-not-a-durable-site',
      'mobile-context-never-grants-site-authority',
      'semantic-only-no-raw-perception',
      'cloud-read-only'
    ]
  };
}

export function beginMobileTransition(stateInput,input={},now=Date.now()){
  const state=stateInput?.protocol===MOBILE_TRANSITION_PROTOCOL?copy(stateInput):createMobileTransitionState(now);
  const sub=subject(input);
  const sourceSiteId=uuid(input.sourceSiteId??input.source_site_id,'source site id');
  const destinationSiteId=input.destinationSiteId??input.destination_site_id
    ?uuid(input.destinationSiteId??input.destination_site_id,'destination site id'):'';
  if(destinationSiteId&&destinationSiteId===sourceSiteId)throw new Error('Transition destination must differ from source site.');
  const transitionId=id(input.transitionId??input.transition_id??nextTransitionId(sub,sourceSiteId,now),'transition id');
  const key=transitionKey(sub,transitionId);
  if(state.transitions[key])return {state,transition:copy(state.transitions[key]),idempotent:true};
  const active=activeTransitionFor(state,sub);
  if(active&&!['arrived','canceled'].includes(active.state)){
    throw new Error('Subject already has an active mobile transition.');
  }
  const transition={
    key,transition_id:transitionId,
    subject_kind:sub.kind,subject_id:sub.id,subject_scope:sub.scope,
    source_site_id:sourceSiteId,destination_site_id:destinationSiteId,
    destination_confidence:destinationSiteId?clamp01(input.destinationConfidence??input.destination_confidence??0.5):0,
    state:'departing',previous_state:null,resume_state:null,state_reason:'transition_started',
    confidence:clamp01(input.confidence??0.5),
    started_at:Number(now),state_changed_at:Number(now),updated_at:Number(now),
    arrived_at:null,canceled_at:null,offline_since:null,
    temporary_context:null,evidence:[],revision:1,
    identity_linking:false
  };
  state.transitions[key]=transition;
  setActive(state,sub,key);
  state.updatedAt=Number(now);
  audit(state,'transition_started',{transitionId,subjectId:sub.id,sourceSiteId},now);
  return {state,transition:copy(transition),idempotent:false};
}

export function applyMobileTransitionEvidence(stateInput,input={},now=Date.now()){
  const state=stateInput?.protocol===MOBILE_TRANSITION_PROTOCOL?copy(stateInput):createMobileTransitionState(now);
  const sub=subject(input);
  const transition=activeTransitionFor(state,sub);
  if(!transition)throw new Error('No active mobile transition exists for the subject.');
  const evidence=normalizeEvidence(input.evidence||input,now);
  const fingerprint=JSON.stringify(evidence);
  if(transition.evidence.some(item=>JSON.stringify(item)===fingerprint)){
    return {state,transition:copy(transition),idempotent:true};
  }
  transition.evidence=[...transition.evidence,evidence].slice(-256);
  candidateDestination(transition,evidence);
  applyEvidenceState(transition,evidence,now);
  transition.revision=Math.max(1,Number(transition.revision)||1)+1;
  transition.updated_at=Number(now);
  recalcConfidence(transition);
  if(['arrived','canceled'].includes(transition.state))clearActive(state,transition);
  state.updatedAt=Number(now);
  audit(state,'transition_evidence_applied',{
    transitionId:transition.transition_id,type:evidence.type,state:transition.state,revision:transition.revision
  },now);
  return {state,transition:copy(transition),idempotent:false};
}

export function advanceMobileTransitionTimers(stateInput,options={},now=Date.now()){
  const state=stateInput?.protocol===MOBILE_TRANSITION_PROTOCOL?copy(stateInput):createMobileTransitionState(now);
  const departingTimeout=Math.max(1000,Number(options.departingTimeoutMs||5*60*1000));
  const arrivingTimeout=Math.max(1000,Number(options.arrivingTimeoutMs||10*60*1000));
  const transitTimeout=Math.max(1000,Number(options.transitTimeoutMs||24*60*60*1000));
  let changed=0;
  for(const transition of Object.values(state.transitions||{})){
    if(['arrived','canceled','offline','temporary_context'].includes(transition.state))continue;
    const age=Number(now)-Number(transition.state_changed_at||transition.updated_at||transition.started_at||now);
    const timeout=transition.state==='departing'?departingTimeout:transition.state==='arriving'?arrivingTimeout:transition.state==='in_transit'?transitTimeout:null;
    if(timeout!==null&&age>timeout){
      setState(transition,'uncertain',transition.state+'_timeout',now);
      transition.revision=Math.max(1,Number(transition.revision)||1)+1;
      transition.updated_at=Number(now);
      changed++;
      audit(state,'transition_timeout',{transitionId:transition.transition_id,previousState:transition.previous_state},now);
    }
  }
  if(changed)state.updatedAt=Number(now);
  return {state,changed};
}

export function mobileTransitionSnapshot(stateInput){
  const state=stateInput?.protocol===MOBILE_TRANSITION_PROTOCOL?stateInput:createMobileTransitionState();
  return {
    protocol:MOBILE_TRANSITION_PROTOCOL,
    schema_version:MOBILE_TRANSITION_SCHEMA_VERSION,
    generated_at:state.updatedAt,
    transitions:Object.values(state.transitions||{}).map(normalizeTransition).sort((a,b)=>a.started_at-b.started_at),
    active_subjects:Object.entries(state.activeBySubject||{}).map(([subject,key])=>({subject,transition_key:key})),
    boundaries:[...state.boundaries],
    identity_linking:false,
    semantic_only:true
  };
}

export function mobileTransitionAgentContext(stateInput,now=Date.now()){
  const snapshot=mobileTransitionSnapshot(stateInput);
  const active=snapshot.transitions.filter(t=>!['arrived','canceled'].includes(t.state));
  return {
    protocol:MOBILE_TRANSITION_PROTOCOL,
    active_count:active.length,
    transitions:active.slice(-12).map(t=>({
      transition_id:t.transition_id,
      subject_kind:t.subject_kind,
      subject_id:t.subject_id,
      source_site_id:t.source_site_id,
      destination_site_id:t.destination_site_id,
      state:t.state,
      confidence:t.confidence,
      temporary_context:t.temporary_context,
      offline_since:t.offline_since,
      age_ms:Math.max(0,Number(now)-Number(t.started_at||now)),
      identity_linking:false
    }))
  };
}

export function cloudMobileTransitionProjection(stateInput){
  const snapshot=mobileTransitionSnapshot(stateInput);
  return {
    ...snapshot,
    summary_only:true,
    cloud_read_only:true,
    authority_assignment:'local_only',
    person_object_identity_linking:false,
    temporary_context_site_authority:false
  };
}
