import { normalizeWorldWatch } from './world-watch-core.js';

const CREATE_PREFIX=/^(?:please\s+)?(?:tell me|let me know|notify me|alert me|watch|watch for|keep an eye out)(?:\s+for)?\s+(?:when\s+)?/i;
const GENERIC_PEOPLE=new Set(['someone','somebody','anyone','anybody','a person','person','people']);
const GENERIC_ENTITIES=new Set([...GENERIC_PEOPLE,'something','anything','an object','object','objects']);

function txt(value,max=180){
  return String(value==null?'':value).replace(/\s+/g,' ').trim().slice(0,max);
}
function norm(value){
  return txt(value,160).toLowerCase()
    .replace(/[’']/g,'')
    .replace(/[^a-z0-9\s._:-]/g,' ')
    .replace(/\b(?:the|a|an|my)\b/g,' ')
    .replace(/\s+/g,' ').trim();
}
function arr(value){return Array.isArray(value)?value:[];}
function entityId(item){return String(item?.participantId||item?.objectId||item?.subjectId||item?.id||'');}
function entityLabel(item){return txt(item?.label||item?.name||item?.participantName||item?.objectLabel||'',80);}
function roomId(item){return String(item?.id||item?.roomId||'');}
function roomLabel(item){return txt(item?.name||item?.label||item?.room||item?.id||'',80);}
function percentThreshold(text){
  const m=String(text).match(/(\d{1,3})(?:\s*%|\s*percent)\b/i);
  if(m) return Math.max(0,Math.min(1,Number(m[1])/100));
  const d=String(text).match(/\b0(?:\.\d+)?|1(?:\.0+)?\b/);
  return d?Math.max(0,Math.min(1,Number(d[0]))):null;
}
function cooldownMs(text){
  const m=String(text).match(/(?:no more than|at most|maximum|every)\s+(?:once\s+)?(?:every\s+)?(\d+)\s*(second|sec|minute|min|hour|hr)s?/i);
  if(!m) return null;
  const n=Math.max(1,Number(m[1]));
  const unit=m[2].toLowerCase();
  return n*(unit.startsWith('hour')||unit==='hr'?3600000:unit.startsWith('min')?60000:1000);
}
function result(intent,extra={}){return {schemaVersion:1,intent,...extra};}

export function parseWorldWatchCommand(input){
  const raw=txt(input,500);
  const text=raw.replace(/[?.!]+$/,'').trim();
  const n=norm(text);
  if(!text) return result('unknown',{raw,status:'empty'});

  if(
    /^(?:what am i watching|what are my watches|show my watches|list my watches)$/.test(n) ||
    /^(?:show|list)(?: my)?(?: world| physical world)? watches?$/.test(n)
  ){
    return result('list',{raw});
  }
  if(/^(?:clear|delete) (?:my )?(?:watch )?(?:trigger )?history$/.test(n)){
    return result('clear-history',{raw});
  }

  let m=text.match(/^(?:stop|remove|delete|cancel)\s+(?:watching\s+|watch\s+)?(.+)$/i);
  if(m) return result('remove',{raw,watchRef:txt(m[1],140)});
  m=text.match(/^(?:pause|disable)\s+(?:watch\s+)?(.+)$/i);
  if(m) return result('pause',{raw,watchRef:txt(m[1],140)});
  m=text.match(/^(?:resume|enable)\s+(?:watch\s+)?(.+)$/i);
  if(m) return result('resume',{raw,watchRef:txt(m[1],140)});

  const body=text.replace(CREATE_PREFIX,'').trim();
  const cooldown=cooldownMs(body);

  m=body.match(/^(.+?)\s+(?:enters|enter|arrives?\s+(?:at|in)|gets?\s+to|comes?\s+into|comes?\s+in)\s+(.+?)(?:\s*,?\s*(?:no more than|at most|maximum|every)\b.*)?$/i);
  if(m) return result('create',{raw,watchType:'entity-enters-room',subjectText:txt(m[1],100),roomText:txt(m[2],100),cooldownMs:cooldown});

  m=body.match(/^(.+?)\s+(?:leaves?|exits?|goes?\s+out\s+of)\s+(.+?)(?:\s*,?\s*(?:no more than|at most|maximum|every)\b.*)?$/i);
  if(m) return result('create',{raw,watchType:'entity-leaves-room',subjectText:txt(m[1],100),roomText:txt(m[2],100),cooldownMs:cooldown});

  m=body.match(/^(.+?)\s+(?:moves?|is moved|changes? (?:rooms?|location)|goes? somewhere else)(?:\s*,?\s*(?:no more than|at most|maximum|every)\b.*)?$/i);
  if(m) return result('create',{raw,watchType:'entity-moved',subjectText:txt(m[1],100),cooldownMs:cooldown});

  if(/\banomal(?:y|ies)\b/i.test(body)&&/\b(?:clear|clears|cleared|resolve|resolves|resolved|goes away)\b/i.test(body)){
    const type=body.match(/\b(?:anomaly|anomalies)\s+(?:type\s+)?([a-z0-9_-]+)\b/i)?.[1]||null;
    return result('create',{raw,watchType:'anomaly-cleared',anomalyText:type?txt(type,100):null,cooldownMs:cooldown});
  }
  if(/\banomal(?:y|ies)\b/i.test(body)&&/\b(?:active|appears?|happens?|starts?|detected|shows up)\b/i.test(body)){
    const type=body.match(/\b(?:anomaly|anomalies)\s+(?:type\s+)?([a-z0-9_-]+)\b/i)?.[1]||null;
    return result('create',{raw,watchType:'anomaly-active',anomalyText:type?txt(type,100):null,cooldownMs:cooldown});
  }

  if(/\bpriorit(?:y|ies)\b/i.test(body)){
    const threshold=percentThreshold(body);
    if(threshold!=null) return result('create',{raw,watchType:'priority-threshold',priorityThreshold:threshold,cooldownMs:cooldown});
  }

  return result('unknown',{raw,status:'unsupported'});
}

function roomDirectory(context={}){
  const rooms=[...arr(context.rooms)];
  if(context.activeRoom) rooms.push(context.activeRoom);
  const seen=new Set();
  return rooms.filter((room)=>{
    const id=roomId(room); if(!id||seen.has(id)) return false; seen.add(id); return true;
  });
}
function resolveRoom(text,context={}){
  if(!text) return {status:'missing',matches:[]};
  const q=norm(text);
  if(['here','this room','current room'].includes(q)){
    return context.activeRoom?{status:'resolved',value:context.activeRoom,matches:[context.activeRoom]}:{status:'not-found',matches:[]};
  }
  const rooms=roomDirectory(context);
  let matches=rooms.filter((room)=>norm(roomLabel(room))===q||norm(roomId(room))===q);
  if(!matches.length) matches=rooms.filter((room)=>norm(roomLabel(room)).includes(q)||q.includes(norm(roomLabel(room))));
  return matches.length===1?{status:'resolved',value:matches[0],matches}:matches.length>1?{status:'ambiguous',matches}:{status:'not-found',matches:[]};
}
function resolveEntity(text,context={}){
  if(!text) return {status:'unscoped',matches:[]};
  const q=norm(text);
  if(GENERIC_ENTITIES.has(q)) return {
    status:'unscoped',
    matches:[],
    subjectKind:GENERIC_PEOPLE.has(q)?'person':'object'
  };
  const entities=[...arr(context.people),...arr(context.objects)];
  let matches=entities.filter((item)=>norm(entityLabel(item))===q||norm(entityId(item))===q);
  if(!matches.length) matches=entities.filter((item)=>norm(entityLabel(item)).includes(q)||q.includes(norm(entityLabel(item))));
  return matches.length===1?{status:'resolved',value:matches[0],matches}:matches.length>1?{status:'ambiguous',matches}:{status:'not-found',matches:[]};
}
function watchCandidates(ref,watches=[]){
  const q=norm(ref);
  let matches=arr(watches).filter((watch)=>norm(watch.id)===q||norm(watch.label)===q);
  if(!matches.length) matches=arr(watches).filter((watch)=>norm(watch.label).includes(q)||q.includes(norm(watch.label))||norm(watch.id).includes(q));
  return matches;
}
function candidateSummary(items,kind){
  return items.slice(0,8).map((item)=>kind==='room'?{id:roomId(item),label:roomLabel(item)}:
    kind==='watch'?{id:item.id,label:item.label,type:item.type,enabled:item.enabled}:
    {id:entityId(item),label:entityLabel(item),roomId:item.roomId||null});
}
function commandLabel(parsed,entity,room){
  if(parsed.watchType==='entity-enters-room') return (entity?.label||parsed.subjectText||'Anyone')+' enters '+(room?.label||room?.name||parsed.roomText);
  if(parsed.watchType==='entity-leaves-room') return (entity?.label||parsed.subjectText||'Anyone')+' leaves '+(room?.label||room?.name||parsed.roomText);
  if(parsed.watchType==='entity-moved') return (entity?.label||parsed.subjectText||'Any entity')+' moves';
  if(parsed.watchType==='anomaly-cleared') return parsed.anomalyText?'Anomaly '+parsed.anomalyText+' clears':'Any anomaly clears';
  if(parsed.watchType==='anomaly-active') return parsed.anomalyText?'Anomaly '+parsed.anomalyText+' becomes active':'Any anomaly becomes active';
  if(parsed.watchType==='priority-threshold') return 'Priority reaches '+Math.round(Number(parsed.priorityThreshold||.8)*100)+'%';
  return parsed.watchType||'Physical-world watch';
}

export function resolveWorldWatchCommand(parsed,context={},watches=[],now=Date.now()){
  if(!parsed||parsed.intent==='unknown') return {status:'unsupported',intent:parsed?.intent||'unknown',message:'I could not map that request to a supported physical-world watch.'};
  if(parsed.intent==='list') return {status:'ready',intent:'list',watches:arr(watches)};
  if(parsed.intent==='clear-history') return {status:'ready',intent:'clear-history'};

  if(['remove','pause','resume'].includes(parsed.intent)){
    const matches=watchCandidates(parsed.watchRef,watches);
    if(matches.length===1) return {status:'ready',intent:parsed.intent,watch:matches[0]};
    if(matches.length>1) return {status:'ambiguous',intent:parsed.intent,message:'More than one watch matches that description.',candidates:candidateSummary(matches,'watch')};
    return {status:'not-found',intent:parsed.intent,message:'No existing watch matches that description.',candidates:candidateSummary(watches,'watch')};
  }

  const entity=parsed.watchType.startsWith('entity-')?resolveEntity(parsed.subjectText,context):{status:'unscoped',matches:[]};
  if(entity.status==='ambiguous') return {status:'ambiguous',intent:'create',field:'subject',message:'More than one physical-world entity matches that name.',candidates:candidateSummary(entity.matches,'entity')};
  if(entity.status==='not-found') return {status:'not-found',intent:'create',field:'subject',message:'I could not resolve that physical-world entity.',candidates:candidateSummary([...arr(context.people),...arr(context.objects)],'entity')};

  const needsRoom=['entity-enters-room','entity-leaves-room'].includes(parsed.watchType);
  const room=needsRoom?resolveRoom(parsed.roomText,context):{status:'unused',value:null,matches:[]};
  if(room.status==='ambiguous') return {status:'ambiguous',intent:'create',field:'room',message:'More than one room matches that name.',candidates:candidateSummary(room.matches,'room')};
  if(needsRoom&&room.status!=='resolved') return {status:'not-found',intent:'create',field:'room',message:'I could not resolve that room.',candidates:candidateSummary(roomDirectory(context),'room')};

  const subject=entity.value||null;
  const resolvedRoom=room.value||null;
  const watch=normalizeWorldWatch({
    type:parsed.watchType,
    label:commandLabel(parsed,subject,resolvedRoom),
    subjectId:subject?entityId(subject):null,
    subjectLabel:subject?entityLabel(subject):(entity.status==='unscoped'?null:parsed.subjectText||null),
    subjectKind:subject?(subject.participantId?'person':subject.objectId?'object':null):(entity.subjectKind||null),
    roomId:resolvedRoom?roomId(resolvedRoom):null,
    anomalyType:parsed.anomalyText||null,
    priorityThreshold:parsed.priorityThreshold,
    cooldownMs:parsed.cooldownMs??30000
  },now);
  return {status:'ready',intent:'create',watch};
}

export function interpretWorldWatchCommand(input,context={},watches=[],now=Date.now()){
  const parsed=parseWorldWatchCommand(input);
  return {...resolveWorldWatchCommand(parsed,context,watches,now),parsed};
}
