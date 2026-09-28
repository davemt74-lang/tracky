const copy=(v)=>JSON.parse(JSON.stringify(v??null));
const txt=(v,max=160)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const HEALTH_ORDER={critical:0,degraded:1,unknown:2,healthy:3};

export const FEDERATION_CONTROL_CENTER_PROTOCOL='physical_federation_control_center.v1';
export const FEDERATION_CONTROL_CENTER_VERSION='2.80';

export function buildFederationControlCenterModel(operationsInput={}){
  const operations=copy(operationsInput||{});
  const sites=Array.isArray(operations.sites)?operations.sites:[];
  const devices=Array.isArray(operations.devices)?operations.devices:[];
  const relationships=Array.isArray(operations.relationships)?operations.relationships:[];
  const issues=Array.isArray(operations.issues)?operations.issues:[];
  const nodes=[];
  const edges=[];

  for(const site of sites){
    const siteId=txt(site?.id,64).toLowerCase();
    if(!siteId)continue;
    const health=txt(site?.health||'unknown',24).toLowerCase();
    nodes.push({
      id:'site:'+siteId,
      entity_id:siteId,
      type:'site',
      label:txt(site?.label||'Site',160),
      health:HEALTH_ORDER[health]!==undefined?health:'unknown',
      status:txt(site?.status||'unknown',24).toLowerCase(),
      authority_device_id:txt(site?.authority?.device_id,64).toLowerCase(),
      authority_epoch:Math.max(0,Number(site?.authority?.epoch)||0),
      federation_status:txt(site?.federation?.status||'unknown',24).toLowerCase(),
      device_count:Math.max(0,Number(site?.device_count)||0),
      profiles:Array.isArray(site?.profiles)?[...site.profiles].sort():[],
      read_only:true
    });
  }

  for(const device of devices){
    const id=txt(device?.id,64).toLowerCase();
    if(!id)continue;
    const siteId=txt(device?.site_id,64).toLowerCase();
    nodes.push({
      id:'device:'+id,
      entity_id:id,
      type:'device',
      label:txt(device?.label||device?.hardware_profile||'Device',160),
      site_id:siteId,
      hardware_profile:txt(device?.hardware_profile||'custom',40).toLowerCase(),
      hardware_profile_label:txt(device?.hardware_profile_label||device?.hardware_profile||'Custom',80),
      trust_state:txt(device?.trust_state||'unknown',24).toLowerCase(),
      runtime_status:txt(device?.runtime_status||'unknown',32).toLowerCase(),
      version:txt(device?.version,64),
      roles:Array.isArray(device?.roles)?[...device.roles].sort():[],
      read_only:true
    });
    if(siteId){
      edges.push({
        id:'member:'+id+':'+siteId,
        type:'member_of',
        from:'device:'+id,
        to:'site:'+siteId,
        read_only:true
      });
    }
  }

  for(const rel of relationships){
    const subject=txt(rel?.subject_id??rel?.subjectId,64).toLowerCase();
    const object=txt(rel?.object_id??rel?.objectId,64).toLowerCase();
    const type=txt(rel?.type||'related_to',64).toLowerCase();
    if(!subject||!object)continue;
    const from=nodes.some(n=>n.id==='site:'+subject)?'site:'+subject:'device:'+subject;
    const to=nodes.some(n=>n.id==='site:'+object)?'site:'+object:'device:'+object;
    edges.push({id:'rel:'+subject+':'+type+':'+object,type,from,to,read_only:true});
  }

  const orderedSites=nodes.filter(n=>n.type==='site').sort((a,b)=>{
    const h=(HEALTH_ORDER[a.health]??9)-(HEALTH_ORDER[b.health]??9);
    return h||a.label.localeCompare(b.label);
  });
  const orderedIssues=issues.map(row=>({
    site_id:txt(row?.site_id,64).toLowerCase(),
    severity:txt(row?.severity||'unknown',24).toLowerCase(),
    code:txt(row?.code||'unknown',80),
    message:txt(row?.message||'',240)
  })).sort((a,b)=>(HEALTH_ORDER[a.severity]??9)-(HEALTH_ORDER[b.severity]??9)||a.site_id.localeCompare(b.site_id)||a.code.localeCompare(b.code));

  return {
    protocol:FEDERATION_CONTROL_CENTER_PROTOCOL,
    version:FEDERATION_CONTROL_CENTER_VERSION,
    source_protocol:txt(operations.protocol,80),
    generated_at:operations.generated_at??0,
    health:txt(operations.health||'unknown',24).toLowerCase(),
    local_site_id:txt(operations.local_site_id,64).toLowerCase(),
    summary:copy(operations.summary||{}),
    site_cards:orderedSites,
    device_cards:nodes.filter(n=>n.type==='device').sort((a,b)=>a.label.localeCompare(b.label)),
    topology:{nodes,edges},
    issues:orderedIssues,
    controls:{
      mode:'observe_only',
      authority_mutation:false,
      identity_mutation:false,
      cloud_authority:false
    },
    boundaries:[
      'control-center-is-observational-in-section-2',
      'origin-site-authority-only',
      'cloud-remains-relay-and-mirror-only',
      'local-freshness-is-not-inferred-by-cloud'
    ]
  };
}
