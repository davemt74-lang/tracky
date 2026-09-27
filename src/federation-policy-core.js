const txt=(v,max=240)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);
const arr=(v)=>Array.isArray(v)?v:[];
const copy=(v)=>JSON.parse(JSON.stringify(v));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SITE_REF=/^site:([0-9a-f-]{36})::(.+)$/;
const RAW=/(?:^|_)(?:raw|frame|frames|image|images|video|videos|audio|recording|recordings|embedding|embeddings|blob|bytes|pixels|file_path|filesystem_path|camera_uri)(?:$|_)/i;

export const FEDERATION_POLICY_PROTOCOL='physical_federation_policy.v1';
export const FEDERATION_POLICY_SCHEMA_VERSION=1;
export const FEDERATION_PERMISSION_SCOPES=Object.freeze([
  'semantic_world_read',
  'agent_context_read',
  'history_query',
  'identity_continuity_read',
  'identity_linking',
  'person_recognition',
  'voice_matching',
  'remote_observation'
]);
export const RECOGNITION_CONSENT_SCOPES=Object.freeze([
  'person_recognition',
  'voice_matching',
  'identity_linking'
]);
export const CONSENT_STATES=Object.freeze(['pending','granted','denied','revoked']);

function uuid(v,label){
  const out=txt(v,64).toLowerCase();
  if(!UUID.test(out))throw new Error(label+' must be a UUID.');
  return out;
}
function scope(v){
  const out=txt(v,80).toLowerCase();
  if(!FEDERATION_PERMISSION_SCOPES.includes(out))throw new Error('Federation permission scope is unsupported.');
  return out;
}
function consentScope(v){
  const out=txt(v,80).toLowerCase();
  if(!RECOGNITION_CONSENT_SCOPES.includes(out))throw new Error('Recognition consent scope is unsupported.');
  return out;
}
function pairKey(a,b){
  const left=uuid(a,'source site id'),right=uuid(b,'destination site id');
  if(left===right)throw new Error('Federation permission requires distinct sites.');
  return left+'|'+right;
}
function consentKey(site,identity,permission){
  return uuid(site,'consent site id')+'|'+uuid(identity,'canonical identity id')+'|'+consentScope(permission);
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
function semantic(value,path='payload',depth=0){
  if(depth>8)throw new Error('Federation policy value is too deeply nested.');
  if(value==null||['string','number','boolean'].includes(typeof value)){
    return typeof value==='string'?txt(value,800):value;
  }
  if(Array.isArray(value)){
    if(value.length>256)throw new Error('Federation policy list is too large.');
    return value.map((item,index)=>semantic(item,path+'['+index+']',depth+1));
  }
  if(typeof value!=='object')return null;
  const out={};
  for(const [key,item] of Object.entries(value).slice(0,128)){
    if(RAW.test(key))throw new Error('Federation policy cannot contain raw perception data at '+path+'.'+key+'.');
    out[txt(key,80)]=semantic(item,path+'.'+key,depth+1);
  }
  return out;
}
function audit(state,type,details,now){
  state.audit=[...arr(state.audit),{type,details:semantic(details||{}),at:Number(now)}].slice(-1000);
}
function sitePolicy(state,siteId){
  return state.sites?.[uuid(siteId,'site id')]||null;
}
function grantRecord(state,sourceSite,destinationSite,permission){
  return state.grants?.[pairKey(sourceSite,destinationSite)]?.[scope(permission)]||null;
}
function consentRecord(state,site,identity,permission){
  return state.consents?.[consentKey(site,identity,permission)]||null;
}
function activeGrant(record){
  return !!record&&record.status==='granted'&&Number(record.revision)>0;
}
function activeConsent(record){
  return !!record&&record.status==='granted'&&Number(record.revision)>0;
}
function siteRefSite(ref){return SITE_REF.exec(String(ref||''))?.[1]||'';}

export function createFederationPolicyState(now=Date.now()){
  return {
    protocol:FEDERATION_POLICY_PROTOCOL,
    schemaVersion:FEDERATION_POLICY_SCHEMA_VERSION,
    revision:0,revocationEpoch:0,createdAt:Number(now),updatedAt:Number(now),
    sites:{},grants:{},consents:{},revocations:{},audit:[],
    boundaries:[
      'deny-by-default',
      'site-local-policy-authority',
      'destination-scoped-sharing',
      'deny-overrides-grant',
      'recognition-consent-required',
      'revocation-monotonic',
      'raw-perception-never-federated',
      'temporary-context-never-site-authority',
      'cloud-mirror-only'
    ]
  };
}

export function setFederatedSitePolicy(stateInput,input={},now=Date.now()){
  const state=stateInput?.protocol===FEDERATION_POLICY_PROTOCOL?copy(stateInput):createFederationPolicyState(now);
  const siteId=uuid(input.siteId??input.site_id,'site id');
  const prior=state.sites[siteId]||null;
  const revision=Math.max(1,Number(input.revision??((prior?.revision||0)+1))||1);
  if(prior&&revision<Number(prior.revision||0))return {state,policy:copy(prior),stale:true};
  const policy={
    site_id:siteId,
    revision,
    mode:['private','household','team','shared'].includes(input.mode)?input.mode:'private',
    allow_federation:input.allowFederation??input.allow_federation??false,
    allow_remote_observation:input.allowRemoteObservation??input.allow_remote_observation??false,
    default_identity_visibility:['none','anonymous','consented'].includes(input.defaultIdentityVisibility??input.default_identity_visibility)
      ?(input.defaultIdentityVisibility??input.default_identity_visibility):'none',
    allowed_peer_sites:[...new Set(arr(input.allowedPeerSites??input.allowed_peer_sites).map(v=>uuid(v,'allowed peer site id')).filter(v=>v!==siteId))].sort(),
    updated_at:Number(now)
  };
  state.sites[siteId]=policy;
  state.revision=Math.max(Number(state.revision||0)+1,revision);
  state.updatedAt=Number(now);
  audit(state,'site_policy_updated',{siteId,revision,mode:policy.mode},now);
  return {state,policy:copy(policy),stale:false};
}

export function grantFederationPermission(stateInput,input={},now=Date.now()){
  const state=stateInput?.protocol===FEDERATION_POLICY_PROTOCOL?copy(stateInput):createFederationPolicyState(now);
  const source=uuid(input.sourceSiteId??input.source_site_id,'source site id');
  const destination=uuid(input.destinationSiteId??input.destination_site_id,'destination site id');
  const permission=scope(input.scope);
  const key=pairKey(source,destination);
  const site=sitePolicy(state,source);
  if(!site||site.allow_federation!==true)throw new Error('Source site does not permit federation.');
  if(!site.allowed_peer_sites.includes(destination))throw new Error('Destination site is not an allowed federation peer.');
  if(permission==='remote_observation'&&site.allow_remote_observation!==true){
    throw new Error('Source site does not permit remote observation.');
  }
  state.grants[key]??={};
  const prior=state.grants[key][permission]||null;
  const revision=Math.max(1,Number(input.revision??((prior?.revision||0)+1))||1);
  if(prior&&revision<Number(prior.revision||0))return {state,grant:copy(prior),stale:true};
  const revoked=state.revocations['grant:'+key+'|'+permission];
  if(revoked&&revision<=Number(revoked.revision||0)){
    throw new Error('Federation permission revision is blocked by a newer revocation.');
  }
  const grant={
    source_site_id:source,destination_site_id:destination,scope:permission,
    status:'granted',revision,reason:txt(input.reason||'explicit_grant',200),
    granted_at:Number(now),revoked_at:null
  };
  state.grants[key][permission]=grant;
  state.revision++;
  state.updatedAt=Number(now);
  audit(state,'federation_permission_granted',{source,destination,scope:permission,revision},now);
  return {state,grant:copy(grant),stale:false};
}

export function revokeFederationPermission(stateInput,input={},now=Date.now()){
  const state=stateInput?.protocol===FEDERATION_POLICY_PROTOCOL?copy(stateInput):createFederationPolicyState(now);
  const source=uuid(input.sourceSiteId??input.source_site_id,'source site id');
  const destination=uuid(input.destinationSiteId??input.destination_site_id,'destination site id');
  const permission=scope(input.scope);
  const key=pairKey(source,destination);
  state.grants[key]??={};
  const prior=state.grants[key][permission]||null;
  const revision=Math.max(1,Number(input.revision??((prior?.revision||0)+1))||1);
  if(prior&&revision<Number(prior.revision||0))return {state,grant:copy(prior),stale:true};
  const revoked={
    source_site_id:source,destination_site_id:destination,scope:permission,
    status:'revoked',revision,reason:txt(input.reason||'explicit_revocation',200),
    granted_at:prior?.granted_at??null,revoked_at:Number(now)
  };
  state.grants[key][permission]=revoked;
  state.revocationEpoch=Math.max(Number(state.revocationEpoch||0)+1,Number(input.revocationEpoch??input.revocation_epoch??0)||0);
  state.revocations['grant:'+key+'|'+permission]={
    revision,revocation_epoch:state.revocationEpoch,at:Number(now),reason:revoked.reason
  };
  state.revision++;
  state.updatedAt=Number(now);
  audit(state,'federation_permission_revoked',{source,destination,scope:permission,revision,revocationEpoch:state.revocationEpoch},now);
  return {state,grant:copy(revoked),stale:false};
}

export function setRecognitionConsent(stateInput,input={},now=Date.now()){
  const state=stateInput?.protocol===FEDERATION_POLICY_PROTOCOL?copy(stateInput):createFederationPolicyState(now);
  const site=uuid(input.siteId??input.site_id,'consent site id');
  const identity=uuid(input.canonicalIdentityId??input.canonical_identity_id,'canonical identity id');
  const permission=consentScope(input.scope);
  const status=CONSENT_STATES.includes(input.status)?input.status:'pending';
  const key=consentKey(site,identity,permission);
  const prior=state.consents[key]||null;
  const revision=Math.max(1,Number(input.revision??((prior?.revision||0)+1))||1);
  if(prior&&revision<Number(prior.revision||0))return {state,consent:copy(prior),stale:true};
  const tombstone=state.revocations['consent:'+key];
  if(tombstone&&status==='granted'&&revision<=Number(tombstone.revision||0)){
    throw new Error('Recognition consent revision is blocked by a newer revocation.');
  }
  const record={
    site_id:site,canonical_identity_id:identity,scope:permission,status,revision,
    source:txt(input.source||'user',80),
    reason:txt(input.reason||'',200),
    decided_at:Number(now)
  };
  state.consents[key]=record;
  if(status==='revoked'||status==='denied'){
    state.revocationEpoch=Math.max(Number(state.revocationEpoch||0)+1,Number(input.revocationEpoch??input.revocation_epoch??0)||0);
    state.revocations['consent:'+key]={
      revision,revocation_epoch:state.revocationEpoch,at:Number(now),reason:record.reason||status
    };
  }
  state.revision++;
  state.updatedAt=Number(now);
  audit(state,'recognition_consent_'+status,{site,identity,scope:permission,revision,revocationEpoch:state.revocationEpoch},now);
  return {state,consent:copy(record),stale:false};
}

export function federationPermissionDecision(stateInput,input={}){
  const state=stateInput?.protocol===FEDERATION_POLICY_PROTOCOL?stateInput:createFederationPolicyState();
  const source=uuid(input.sourceSiteId??input.source_site_id,'source site id');
  const destination=uuid(input.destinationSiteId??input.destination_site_id,'destination site id');
  const permission=scope(input.scope);
  const site=sitePolicy(state,source);
  if(!site)return {allowed:false,reason:'source_site_policy_missing'};
  if(site.allow_federation!==true)return {allowed:false,reason:'source_site_federation_disabled'};
  if(!site.allowed_peer_sites.includes(destination))return {allowed:false,reason:'destination_not_allowed_peer'};
  if(permission==='remote_observation'&&site.allow_remote_observation!==true){
    return {allowed:false,reason:'remote_observation_disabled'};
  }
  const grant=grantRecord(state,source,destination,permission);
  if(!activeGrant(grant))return {allowed:false,reason:grant?.status==='revoked'?'permission_revoked':'permission_not_granted'};
  if(input.canonicalIdentityId??input.canonical_identity_id){
    const identity=uuid(input.canonicalIdentityId??input.canonical_identity_id,'canonical identity id');
    if(RECOGNITION_CONSENT_SCOPES.includes(permission)){
      const consent=consentRecord(state,source,identity,permission);
      if(!activeConsent(consent))return {allowed:false,reason:consent?.status==='revoked'?'consent_revoked':consent?.status==='denied'?'consent_denied':'consent_required'};
    }
  }
  return {
    allowed:true,reason:'explicit_site_grant',
    grant_revision:Number(grant.revision||0),
    policy_revision:Number(site.revision||0),
    revocation_epoch:Number(state.revocationEpoch||0)
  };
}

export function recognitionDecision(stateInput,input={}){
  const state=stateInput?.protocol===FEDERATION_POLICY_PROTOCOL?stateInput:createFederationPolicyState();
  const site=uuid(input.siteId??input.site_id,'site id');
  const identity=uuid(input.canonicalIdentityId??input.canonical_identity_id,'canonical identity id');
  const permission=consentScope(input.scope??'person_recognition');
  const consent=consentRecord(state,site,identity,permission);
  if(!activeConsent(consent)){
    return {allowed:false,reason:consent?.status==='revoked'?'consent_revoked':consent?.status==='denied'?'consent_denied':'consent_required'};
  }
  return {allowed:true,reason:'site_scoped_consent',revision:Number(consent.revision||0),revocation_epoch:Number(state.revocationEpoch||0)};
}

function filterIdentity(input,state,source,destination){
  const identities=arr(input?.identities);
  const links=arr(input?.links);
  const allowedIdentities=[];
  const allowedIds=new Set();
  for(const identity of identities){
    if(!identity||identity.status!=='active')continue;
    const id=String(identity.canonical_identity_id||'');
    if(!UUID.test(id))continue;
    const sites=new Set(arr(identity.members).map(siteRefSite).filter(Boolean));
    if(!sites.has(source)||!sites.has(destination))continue;
    const read=federationPermissionDecision(state,{sourceSiteId:source,destinationSiteId:destination,scope:'identity_continuity_read'});
    if(!read.allowed)continue;
    if(identity.entity_type==='person'){
      const consent=recognitionDecision(state,{siteId:source,canonicalIdentityId:id,scope:'identity_linking'});
      if(!consent.allowed)continue;
    }
    allowedIdentities.push(copy(identity));
    allowedIds.add(id);
  }
  const allowedLinks=links.filter(link=>allowedIds.has(String(link?.canonical_identity_id||'')));
  return {...copy(input),identities:allowedIdentities,links:copy(allowedLinks)};
}

export function filterFederatedPayloadForDestination(stateInput,input={}){
  const state=stateInput?.protocol===FEDERATION_POLICY_PROTOCOL?stateInput:createFederationPolicyState();
  const source=uuid(input.sourceSiteId??input.source_site_id,'source site id');
  const destination=uuid(input.destinationSiteId??input.destination_site_id,'destination site id');
  const payload=semantic(input.payload||{},'payload');
  const worldDecision=federationPermissionDecision(state,{sourceSiteId:source,destinationSiteId:destination,scope:'semantic_world_read'});
  const agentDecision=federationPermissionDecision(state,{sourceSiteId:source,destinationSiteId:destination,scope:'agent_context_read'});
  const identityDecision=federationPermissionDecision(state,{sourceSiteId:source,destinationSiteId:destination,scope:'identity_continuity_read'});
  const remoteDecision=federationPermissionDecision(state,{sourceSiteId:source,destinationSiteId:destination,scope:'remote_observation'});
  const out={
    source_site_id:source,destination_site_id:destination,
    revocation_epoch:Number(state.revocationEpoch||0),
    policy_revision:Number(state.revision||0),
    semantic_only:true,raw_perception:false,
    federated_world:worldDecision.allowed?copy(payload.federated_world??null):null,
    federated_agent_context:agentDecision.allowed?copy(payload.federated_agent_context??null):null,
    identity_continuity:identityDecision.allowed&&payload.identity_continuity
      ?filterIdentity(payload.identity_continuity,state,source,destination):null,
    remote_observation_allowed:remoteDecision.allowed,
    denied_scopes:[
      !worldDecision.allowed?'semantic_world_read':null,
      !agentDecision.allowed?'agent_context_read':null,
      !identityDecision.allowed?'identity_continuity_read':null,
      !remoteDecision.allowed?'remote_observation':null
    ].filter(Boolean)
  };
  return out;
}

export function cloudFederationPolicyProjection(stateInput={}){
  const state=stateInput?.protocol===FEDERATION_POLICY_PROTOCOL?stateInput:createFederationPolicyState();
  return {
    protocol:FEDERATION_POLICY_PROTOCOL,
    schema_version:1,
    revision:Number(state.revision||0),
    revocation_epoch:Number(state.revocationEpoch||0),
    sites:Object.values(state.sites||{}).map(copy),
    grants:Object.values(state.grants||{}).flatMap(group=>Object.values(group||{})).map(copy),
    consents:Object.values(state.consents||{}).map(copy),
    revocations:Object.entries(state.revocations||{}).map(([key,value])=>({key,...copy(value)})),
    semantic_only:true,summary_only:true,
    authority_assignment:'local_site_policy',
    cloud_role:'mirror_relay_enforcer',
    cloud_can_grant:false,cloud_can_revoke:false,cloud_can_change_consent:false,
    raw_perception:false
  };
}
