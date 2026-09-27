const txt=(v,max=200)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);
const copy=(v)=>JSON.parse(JSON.stringify(v));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const FEDERATION_SYNC_PROTOCOL='physical_federation_sync.v1';
export const FEDERATION_SYNC_SCHEMA_VERSION=1;

function uuid(v,label){
  const out=txt(v,64).toLowerCase();
  if(!UUID.test(out))throw new Error(label+' must be a UUID.');
  return out;
}
function int(v){return Math.max(0,Number(v)||0);}
function compareAuthorityRevision(a={},b={}){
  const ae=int(a.authority_epoch??a.authorityEpoch),be=int(b.authority_epoch??b.authorityEpoch);
  if(ae!==be)return ae>be?1:-1;
  const ar=int(a.revision??a.world_revision),br=int(b.revision??b.world_revision);
  if(ar===br)return 0;
  return ar>br?1:-1;
}
function normalizeChange(input={}){
  const changeId=int(input.change_id??input.changeId);
  if(changeId<1)throw new Error('federation change_id is required.');
  const siteId=uuid(input.site_id??input.siteId,'site id');
  const authorityDeviceId=uuid(input.authority_device_id??input.authorityDeviceId,'authority device id');
  const authorityEpoch=int(input.authority_epoch??input.authorityEpoch);
  const revision=int(input.revision??input.world_revision);
  if(authorityEpoch<1||revision<1)throw new Error('federation authority epoch and world revision are required.');
  const fragment=input.fragment&&typeof input.fragment==='object'?copy(input.fragment):null;
  if(!fragment)throw new Error('federation fragment is required.');
  if(fragment.site_id!==siteId||fragment.authority_device_id!==authorityDeviceId
    ||int(fragment.authority_epoch)!==authorityEpoch||int(fragment.revision)!==revision){
    throw new Error('federation change envelope does not match its world fragment.');
  }
  return {
    change_id:changeId,site_id:siteId,authority_device_id:authorityDeviceId,
    authority_epoch:authorityEpoch,revision,fragment
  };
}
export function compareFederationVersion(a,b){return compareAuthorityRevision(a,b);}

export function createFederationSyncState(cursor=0){
  return {
    protocol:FEDERATION_SYNC_PROTOCOL,schemaVersion:FEDERATION_SYNC_SCHEMA_VERSION,
    cursor:int(cursor),remoteSites:{},updatedAt:Date.now(),
    boundaries:[
      'local-authority-never-overwritten',
      'authority-epoch-before-world-revision',
      'remote-sites-read-only',
      'cursor-monotonic',
      'identity-remains-site-local'
    ]
  };
}

export function applyFederationDelta(stateInput,delta={},options={}){
  if(delta.protocol!==FEDERATION_SYNC_PROTOCOL)throw new Error('Unsupported federation sync protocol.');
  const state=stateInput&&stateInput.protocol===FEDERATION_SYNC_PROTOCOL?copy(stateInput):createFederationSyncState();
  const startCursor=int(delta.from_cursor??delta.fromCursor??state.cursor);
  if(startCursor>state.cursor)throw new Error('Federation delta starts after the local cursor.');
  const changes=Array.isArray(delta.changes)?delta.changes.map(normalizeChange):[];
  const localSiteIds=new Set((options.localSiteIds||[]).map((id)=>uuid(id,'local site id')));
  let applied=0,stale=0,idempotent=0,localSkipped=0,last=state.cursor;
  for(const change of changes.sort((a,b)=>a.change_id-b.change_id)){
    if(change.change_id<=state.cursor){idempotent++;last=Math.max(last,change.change_id);continue;}
    if(change.change_id!==last+1&&last>=state.cursor)throw new Error('Federation change stream contains a cursor gap.');
    last=change.change_id;
    if(localSiteIds.has(change.site_id)){localSkipped++;continue;}
    const prior=state.remoteSites[change.site_id]||null;
    if(prior){
      const cmp=compareAuthorityRevision(change,prior);
      if(cmp<0){stale++;continue;}
      if(cmp===0){
        if(prior.fragment.fingerprint!==change.fragment.fingerprint)throw new Error('Federation change conflicts with existing remote site world.');
        idempotent++;continue;
      }
    }
    state.remoteSites[change.site_id]=change;
    applied++;
  }
  const nextCursor=int(delta.next_cursor??delta.nextCursor??last);
  if(nextCursor<state.cursor||nextCursor<last)throw new Error('Federation next cursor moved backwards.');
  state.cursor=nextCursor;
  state.updatedAt=Date.now();
  return {
    state,applied,stale,idempotent,localSkipped,cursor:state.cursor,
    hasMore:!!(delta.has_more??delta.hasMore)
  };
}

export function federationRemoteSnapshot(stateInput){
  const state=stateInput&&stateInput.protocol===FEDERATION_SYNC_PROTOCOL?stateInput:createFederationSyncState();
  return {
    protocol:FEDERATION_SYNC_PROTOCOL,schema_version:FEDERATION_SYNC_SCHEMA_VERSION,
    cursor:state.cursor,
    sites:Object.values(state.remoteSites||{}).sort((a,b)=>a.site_id.localeCompare(b.site_id)).map(copy),
    remote_only:true,read_only:true,identity_scope:'site_local'
  };
}
