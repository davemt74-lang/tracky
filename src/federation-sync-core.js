import {
  FEDERATED_WORLD_PROTOCOL,
  applySiteWorldFragment,
  createFederatedWorldState
} from './federated-world-core.js';

const txt=(v,max=200)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);
const arr=(v)=>Array.isArray(v)?v:[];
const copy=(v)=>JSON.parse(JSON.stringify(v));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const FEDERATION_SYNC_PROTOCOL='physical_federation_sync.v1';
export const FEDERATION_SYNC_SCHEMA_VERSION=1;
export const FEDERATION_QUARANTINE_REASONS=Object.freeze([
  'source_not_federated',
  'topology_ahead',
  'authority_mismatch',
  'revision_conflict',
  'invalid_fragment'
]);

function uuid(v,label){
  const out=txt(v,64).toLowerCase();
  if(!UUID.test(out))throw new Error(label+' must be a UUID.');
  return out;
}
function canonical(v){
  if(Array.isArray(v))return v.map(canonical);
  if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
  return v;
}
function stableHash(v){
  const input=JSON.stringify(canonical(v));
  let h1=0x811c9dc5,h2=0x9e3779b9;
  for(let i=0;i<input.length;i++){
    const c=input.charCodeAt(i);
    h1=Math.imul(h1^c,0x01000193);
    h2=Math.imul(h2+c+(h1>>>16),0x85ebca6b);
  }
  return ((h1>>>0).toString(16).padStart(8,'0')+(h2>>>0).toString(16).padStart(8,'0'));
}
function topologyRevision(topology){return Math.max(0,Number(topology?.revision??0)||0);}
function topologySites(topology){return arr(topology?.sites);}
function siteIdOf(site){return site?.id||site?.site_id||'';}
function authorityOf(topology,siteId){
  const site=topologySites(topology).find(row=>siteIdOf(row)===siteId);
  if(!site)return null;
  const device=site.authorityDeviceId||site.authority_device_id||'';
  const epoch=Number(site.authorityEpoch??site.authority_epoch??0);
  if(!device||epoch<1)return null;
  return {deviceId:uuid(device,'authority device id'),epoch,status:txt(site.status||'active',20).toLowerCase()};
}
function relationshipParts(row){
  return {
    subject:row?.subjectId||row?.subject_id||'',
    object:row?.objectId||row?.object_id||'',
    type:txt(row?.type||row?.relation_type||'',40).toLowerCase()
  };
}
function federatedPair(topology,a,b){
  if(a===b)return true;
  for(const row of arr(topology?.relationships)){
    const rel=relationshipParts(row);
    if(!['peers_with','bridges_to'].includes(rel.type))continue;
    if((rel.subject===a&&rel.object===b)||(rel.subject===b&&rel.object===a))return true;
  }
  return false;
}
function fragmentMaterial(fragment){
  const out=copy(fragment);
  delete out.fingerprint;
  return out;
}
function normalizeEnvelope(input={}){
  if(input.protocol!==FEDERATION_SYNC_PROTOCOL)throw new Error('Unsupported federation sync protocol.');
  const sourceSiteId=uuid(input.source_site_id??input.sourceSiteId,'source site id');
  const destinationSiteId=input.destination_site_id||input.destinationSiteId
    ?uuid(input.destination_site_id??input.destinationSiteId,'destination site id')
    :'';
  const authorityDeviceId=uuid(input.source_authority_device_id??input.sourceAuthorityDeviceId,'source authority device id');
  const authorityEpoch=Math.max(0,Number(input.source_authority_epoch??input.sourceAuthorityEpoch??0)||0);
  const sourceRevision=Math.max(0,Number(input.source_world_revision??input.sourceWorldRevision??0)||0);
  const topologyRev=Math.max(0,Number(input.topology_revision??input.topologyRevision??0)||0);
  if(authorityEpoch<1||sourceRevision<1)throw new Error('Federation envelope requires authority epoch and source world revision.');
  if(!input.fragment||input.fragment.protocol!==FEDERATED_WORLD_PROTOCOL)throw new Error('Federation envelope requires a federated world fragment.');
  const fragment=copy(input.fragment);
  if(fragment.site_id!==sourceSiteId)throw new Error('Federation envelope source site does not match fragment site.');
  if(fragment.authority_device_id!==authorityDeviceId||Number(fragment.authority_epoch)!==authorityEpoch){
    throw new Error('Federation envelope authority does not match fragment authority.');
  }
  if(Number(fragment.revision)!==sourceRevision)throw new Error('Federation envelope revision does not match fragment revision.');
  const sourceFingerprint=txt(input.source_fingerprint??input.sourceFingerprint??fragment.fingerprint,128);
  if(!sourceFingerprint)throw new Error('Federation envelope fingerprint is required.');
  if(fragment.fingerprint&&fragment.fingerprint!==sourceFingerprint)throw new Error('Federation envelope fingerprint does not match fragment.');
  return {
    protocol:FEDERATION_SYNC_PROTOCOL,
    schema_version:FEDERATION_SYNC_SCHEMA_VERSION,
    envelope_id:txt(input.envelope_id??input.envelopeId,180),
    source_site_id:sourceSiteId,
    destination_site_id:destinationSiteId,
    source_authority_device_id:authorityDeviceId,
    source_authority_epoch:authorityEpoch,
    source_world_revision:sourceRevision,
    source_fingerprint:sourceFingerprint,
    topology_revision:topologyRev,
    emitted_at:Number(input.emitted_at??input.emittedAt??Date.now()),
    fragment
  };
}
function envelopeId(material){
  return 'fed:'+material.source_site_id+':'+material.source_authority_epoch+':'+material.source_world_revision+':'+stableHash({
    source_site_id:material.source_site_id,
    source_authority_device_id:material.source_authority_device_id,
    source_authority_epoch:material.source_authority_epoch,
    source_world_revision:material.source_world_revision,
    source_fingerprint:material.source_fingerprint
  });
}
function peerState(state,siteId){
  if(!state.peers[siteId])state.peers[siteId]={
    site_id:siteId,status:'idle',
    last_received_revision:0,last_received_fingerprint:'',
    last_received_authority_epoch:0,last_received_at:0,
    last_acknowledged_by_destination:{},
    quarantined:0
  };
  return state.peers[siteId];
}
function audit(state,type,details,now){
  state.audit=[...state.audit,{type,details:copy(details||{}),at:Number(now)}].slice(-500);
}
function quarantine(state,envelope,reason,message,now){
  const item={
    envelope_id:envelope?.envelope_id||'',
    source_site_id:envelope?.source_site_id||'',
    source_world_revision:Number(envelope?.source_world_revision||0),
    source_authority_epoch:Number(envelope?.source_authority_epoch||0),
    reason,message:txt(message,300),at:Number(now)
  };
  state.quarantine=[...state.quarantine,item].slice(-250);
  if(item.source_site_id){
    const peer=peerState(state,item.source_site_id);
    peer.status='quarantined';peer.quarantined=(peer.quarantined||0)+1;
  }
  state.updatedAt=Number(now);audit(state,'envelope_quarantined',item,now);
  return item;
}

export function createFederationSyncState(options={},now=Date.now()){
  return {
    protocol:FEDERATION_SYNC_PROTOCOL,
    schemaVersion:FEDERATION_SYNC_SCHEMA_VERSION,
    localSiteId:options.localSiteId?uuid(options.localSiteId,'local site id'):null,
    createdAt:Number(now),updatedAt:Number(now),
    peers:{},quarantine:[],audit:[],
    boundaries:[
      'authority-remains-at-origin-site',
      'cloud-relay-never-becomes-authority',
      'monotonic-per-site-world-revisions',
      'same-revision-conflicts-quarantine',
      'topology-ahead-holds-until-authority-verifiable',
      'site-local-identities-remain-site-local'
    ]
  };
}

export function buildFederationEnvelope(input={},now=Date.now()){
  const topology=input.topology||{};
  const fragment=copy(input.fragment||{});
  if(fragment.protocol!==FEDERATED_WORLD_PROTOCOL)throw new Error('Federation requires a federated world fragment.');
  const sourceSiteId=uuid(fragment.site_id,'source site id');
  const authority=authorityOf(topology,sourceSiteId);
  if(!authority)throw new Error('Source site has no active topology authority.');
  if(authority.status!=='active')throw new Error('Source site is not active.');
  if(fragment.authority_device_id!==authority.deviceId||Number(fragment.authority_epoch)!==authority.epoch){
    throw new Error('Source fragment does not match current topology authority.');
  }
  const destinationSiteId=input.destinationSiteId?uuid(input.destinationSiteId,'destination site id'):'';
  if(destinationSiteId&&!federatedPair(topology,sourceSiteId,destinationSiteId)){
    throw new Error('Source and destination sites are not federated peers.');
  }
  const material={
    protocol:FEDERATION_SYNC_PROTOCOL,
    schema_version:FEDERATION_SYNC_SCHEMA_VERSION,
    envelope_id:'',
    source_site_id:sourceSiteId,
    destination_site_id:destinationSiteId,
    source_authority_device_id:authority.deviceId,
    source_authority_epoch:authority.epoch,
    source_world_revision:Number(fragment.revision),
    source_fingerprint:fragment.fingerprint||stableHash(fragmentMaterial(fragment)),
    topology_revision:topologyRevision(topology),
    emitted_at:Number(now),
    fragment
  };
  material.envelope_id=envelopeId(material);
  return normalizeEnvelope(material);
}

export function applyFederationEnvelope(syncStateInput,worldStateInput,envelopeInput,topology={},options={},now=Date.now()){
  const state=syncStateInput?.protocol===FEDERATION_SYNC_PROTOCOL?copy(syncStateInput):createFederationSyncState(options,now);
  const worldState=worldStateInput?.protocol===FEDERATED_WORLD_PROTOCOL?copy(worldStateInput):createFederatedWorldState(now);
  let envelope;
  try{envelope=normalizeEnvelope(envelopeInput);}catch(error){
    const fallback={envelope_id:txt(envelopeInput?.envelope_id,180),source_site_id:txt(envelopeInput?.source_site_id,64)};
    return {state,worldState,status:'quarantined',quarantine:quarantine(state,fallback,'invalid_fragment',error.message,now)};
  }
  const localSiteId=options.localSiteId||state.localSiteId||'';
  if(localSiteId&&envelope.destination_site_id&&envelope.destination_site_id!==localSiteId){
    return {state,worldState,status:'ignored_wrong_destination'};
  }
  if(localSiteId&&!federatedPair(topology,envelope.source_site_id,localSiteId)){
    return {state,worldState,status:'quarantined',quarantine:quarantine(state,envelope,'source_not_federated','Source site is not an approved federation peer.',now)};
  }
  if(envelope.topology_revision>topologyRevision(topology)){
    return {state,worldState,status:'held_topology_ahead',quarantine:quarantine(state,envelope,'topology_ahead','Envelope requires a newer topology revision before authority can be verified.',now)};
  }
  const authority=authorityOf(topology,envelope.source_site_id);
  if(!authority||authority.deviceId!==envelope.source_authority_device_id||authority.epoch!==envelope.source_authority_epoch){
    return {state,worldState,status:'quarantined',quarantine:quarantine(state,envelope,'authority_mismatch','Envelope authority does not match current topology authority.',now)};
  }
  const peer=peerState(state,envelope.source_site_id);
  if(envelope.source_world_revision<Number(peer.last_received_revision||0)){
    peer.status='current';state.updatedAt=Number(now);
    audit(state,'envelope_stale_ignored',{siteId:envelope.source_site_id,revision:envelope.source_world_revision},now);
    return {state,worldState,status:'stale',changed:false};
  }
  if(envelope.source_world_revision===Number(peer.last_received_revision||0)&&peer.last_received_fingerprint){
    if(peer.last_received_fingerprint!==envelope.source_fingerprint){
      return {state,worldState,status:'quarantined',quarantine:quarantine(state,envelope,'revision_conflict','Same site revision arrived with a different fingerprint.',now)};
    }
    peer.status='current';peer.last_received_at=Number(now);state.updatedAt=Number(now);
    return {state,worldState,status:'idempotent',changed:false};
  }

  let applied;
  try{
    applied=applySiteWorldFragment(worldState,envelope.fragment,topology,now);
  }catch(error){
    const reason=/revision conflicts/i.test(error.message)?'revision_conflict':/authority/i.test(error.message)?'authority_mismatch':'invalid_fragment';
    return {state,worldState,status:'quarantined',quarantine:quarantine(state,envelope,reason,error.message,now)};
  }

  peer.status='current';
  peer.last_received_revision=envelope.source_world_revision;
  peer.last_received_fingerprint=envelope.source_fingerprint;
  peer.last_received_authority_epoch=envelope.source_authority_epoch;
  peer.last_received_at=Number(now);
  state.updatedAt=Number(now);
  audit(state,'envelope_applied',{
    siteId:envelope.source_site_id,revision:envelope.source_world_revision,
    authorityEpoch:envelope.source_authority_epoch
  },now);
  return {state,worldState:applied.state,status:applied.changed?'applied':'idempotent',changed:!!applied.changed};
}

export function buildFederationBatch(input={},now=Date.now()){
  const syncState=input.syncState?.protocol===FEDERATION_SYNC_PROTOCOL?input.syncState:createFederationSyncState({localSiteId:input.localSiteId},now);
  const worldState=input.worldState?.protocol===FEDERATED_WORLD_PROTOCOL?input.worldState:createFederatedWorldState(now);
  const topology=input.topology||{};
  const destinationSiteId=uuid(input.destinationSiteId,'destination site id');
  const localSiteId=input.localSiteId||syncState.localSiteId||'';
  if(localSiteId&&!federatedPair(topology,localSiteId,destinationSiteId))throw new Error('Destination site is not an approved federation peer.');
  const maxFragments=Math.max(1,Math.min(64,Number(input.maxFragments||32)));
  const candidates=Object.values(worldState.sites||{}).sort((a,b)=>a.site_id.localeCompare(b.site_id));
  const envelopes=[];
  for(const fragment of candidates){
    if(envelopes.length>=maxFragments)break;
    if(fragment.site_id===destinationSiteId)continue;
    const peer=peerState(syncState,fragment.site_id);
    const sent=Number(peer.last_acknowledged_by_destination?.[destinationSiteId]||0);
    if(Number(fragment.revision)<=sent)continue;
    envelopes.push(buildFederationEnvelope({fragment,topology,destinationSiteId},now));
  }
  const batch={
    protocol:FEDERATION_SYNC_PROTOCOL,
    schema_version:FEDERATION_SYNC_SCHEMA_VERSION,
    batch_id:'batch:'+destinationSiteId+':'+stableHash(envelopes.map(e=>e.envelope_id)),
    destination_site_id:destinationSiteId,
    topology_revision:topologyRevision(topology),
    emitted_at:Number(now),
    envelopes
  };
  return {syncState,batch};
}

export function acknowledgeFederationBatch(syncStateInput,input={},now=Date.now()){
  const state=syncStateInput?.protocol===FEDERATION_SYNC_PROTOCOL?copy(syncStateInput):createFederationSyncState({},now);
  const destinationSiteId=uuid(input.destinationSiteId??input.destination_site_id,'destination site id');
  for(const ack of arr(input.acknowledgements)){
    const siteId=uuid(ack.siteId??ack.site_id,'acknowledged site id');
    const revision=Math.max(0,Number(ack.revision||0)||0);
    if(revision<1)continue;
    const peer=peerState(state,siteId);
    const prior=Number(peer.last_acknowledged_by_destination?.[destinationSiteId]||0);
    peer.last_acknowledged_by_destination=peer.last_acknowledged_by_destination||{};
    peer.last_acknowledged_by_destination[destinationSiteId]=Math.max(prior,revision);
  }
  state.updatedAt=Number(now);
  audit(state,'batch_acknowledged',{destinationSiteId,count:arr(input.acknowledgements).length},now);
  return state;
}

export function federationSyncStatus(stateInput){
  const state=stateInput?.protocol===FEDERATION_SYNC_PROTOCOL?stateInput:createFederationSyncState();
  return {
    protocol:FEDERATION_SYNC_PROTOCOL,
    schema_version:FEDERATION_SYNC_SCHEMA_VERSION,
    local_site_id:state.localSiteId||'',
    peer_count:Object.keys(state.peers||{}).length,
    quarantine_count:arr(state.quarantine).length,
    peers:Object.values(state.peers||{}).sort((a,b)=>a.site_id.localeCompare(b.site_id)),
    boundaries:[...state.boundaries]
  };
}
