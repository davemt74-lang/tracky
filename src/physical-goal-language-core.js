import { normalizePhysicalGoal } from './physical-goal-core.js';

const arr=(v)=>Array.isArray(v)?v:[];
const txt=(v,max=200)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);
const norm=(v)=>txt(v,180).toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9\s._:-]/g,' ').replace(/\b(?:the|a|an|my)\b/g,' ').replace(/\s+/g,' ').trim();
const SELF_WORDS=new Set(['i','me','myself']);
function idOf(item){return String(item?.participantId||item?.objectId||item?.subjectId||item?.id||'');}
function labelOf(item){return txt(item?.label||item?.name||item?.participantName||item?.objectLabel||item?.id||'',100);}
function roomId(item){return String(item?.id||item?.roomId||'');}
function roomLabel(item){return txt(item?.name||item?.label||item?.room||item?.id||'',100);}
function anchorId(item){return String(item?.id||item?.anchorId||'');}
function anchorLabel(item){return txt(item?.label||item?.name||item?.anchorLabel||item?.id||'',100);}
function out(intent,extra={}){return {schemaVersion:1,intent,...extra};}

export function parsePhysicalGoalCommand(input){
  const raw=txt(input,500);
  const text=raw.replace(/[?.!]+$/,'').trim();
  const n=norm(text);
  if(!text) return out('unknown',{raw,status:'empty'});

  if(/^(?:what are|show|list)(?: my)? physical (?:goals|expectations|routines)$/.test(n)||
     /^(?:show|list)(?: my)? (?:goals|expectations|routines)$/.test(n)){
    return out('list',{raw});
  }
  if(/^(?:clear|delete)(?: my)? physical goal history$/.test(n)||/^(?:clear|delete)(?: my)? goal history$/.test(n)){
    return out('clear-history',{raw});
  }
  let m=text.match(/^(?:stop|remove|delete|cancel)\s+(?:goal\s+|expectation\s+|routine\s+)?(.+)$/i);
  if(m) return out('remove',{raw,goalRef:txt(m[1],160)});
  m=text.match(/^(?:pause|disable)\s+(?:goal\s+|expectation\s+|routine\s+)?(.+)$/i);
  if(m) return out('pause',{raw,goalRef:txt(m[1],160)});
  m=text.match(/^(?:resume|enable)\s+(?:goal\s+|expectation\s+|routine\s+)?(.+)$/i);
  if(m) return out('resume',{raw,goalRef:txt(m[1],160)});
  m=text.match(/^(?:run|check)\s+(?:goal\s+|routine\s+)?(.+)$/i);
  if(m) return out('run',{raw,goalRef:txt(m[1],160)});

  m=text.match(/^make sure\s+(.+?)\s+is empty\s+when\s+(.+?)\s+(?:leave|leaves)(?:\s+(.+))?$/i);
  if(m) return out('create',{
    raw,type:'routine',template:'room-empty-on-leave',
    checkRoomText:txt(m[1],100),triggerSubjectText:txt(m[2],100),
    triggerRoomText:txt(m[3]||m[1],100)
  });

  m=text.match(/^(?:make sure|keep)\s+(.+?)\s+(?:is|stays?)\s+empty$/i);
  if(m) return out('create',{raw,type:'standing-expectation',template:'room-empty',roomText:txt(m[1],100)});

  m=text.match(/^(?:expect\s+)?(.+?)\s+(?:to\s+)?(?:normally\s+)?(?:stay|stays|remain|remains|be)\s+(?:in|inside)\s+(.+)$/i);
  if(m) return out('create',{raw,type:'standing-expectation',template:'entity-in-room',subjectText:txt(m[1],100),roomText:txt(m[2],100)});

  m=text.match(/^(.+?)\s+normally\s+(?:stays|stay|belongs|is)\s+(?:in|inside)\s+(.+)$/i);
  if(m) return out('create',{raw,type:'standing-expectation',template:'entity-in-room',subjectText:txt(m[1],100),roomText:txt(m[2],100)});

  m=text.match(/^(?:expect\s+)?(.+?)\s+(?:to\s+)?(?:normally\s+)?(?:stay|stays|remain|remains|be|should be)\s+(?:by|near|at)\s+(.+)$/i);
  if(m) return out('create',{raw,type:'standing-expectation',template:'entity-at-anchor',subjectText:txt(m[1],100),anchorText:txt(m[2],100)});

  m=text.match(/^(.+?)\s+normally\s+(?:stays|stay|belongs|is)\s+(?:by|near|at)\s+(.+)$/i);
  if(m) return out('create',{raw,type:'standing-expectation',template:'entity-at-anchor',subjectText:txt(m[1],100),anchorText:txt(m[2],100)});

  return out('unknown',{raw,status:'unsupported'});
}

function resolveEntity(text,context={}){
  if(!text) return {status:'missing',matches:[]};
  const q=norm(text);
  const entities=[...arr(context.people),...arr(context.objects)];
  if(SELF_WORDS.has(q)){
    if(!context.selfSubjectId) return {status:'self-unresolved',matches:[]};
    const match=entities.find((item)=>idOf(item)===context.selfSubjectId);
    return match?{status:'resolved',value:match,matches:[match]}:{status:'self-unresolved',matches:[]};
  }
  let matches=entities.filter((item)=>norm(labelOf(item))===q||norm(idOf(item))===q);
  if(!matches.length) matches=entities.filter((item)=>norm(labelOf(item)).includes(q)||q.includes(norm(labelOf(item))));
  return matches.length===1?{status:'resolved',value:matches[0],matches}:matches.length>1?{status:'ambiguous',matches}:{status:'not-found',matches:[]};
}
function resolveRoom(text,context={}){
  if(!text) return {status:'missing',matches:[]};
  const q=norm(text);
  const rooms=arr(context.rooms);
  let matches=rooms.filter((item)=>norm(roomLabel(item))===q||norm(roomId(item))===q);
  if(!matches.length) matches=rooms.filter((item)=>norm(roomLabel(item)).includes(q)||q.includes(norm(roomLabel(item))));
  return matches.length===1?{status:'resolved',value:matches[0],matches}:matches.length>1?{status:'ambiguous',matches}:{status:'not-found',matches:[]};
}
function resolveAnchor(text,context={}){
  if(!text) return {status:'missing',matches:[]};
  const q=norm(text);
  const anchors=arr(context.anchors);
  let matches=anchors.filter((item)=>norm(anchorLabel(item))===q||norm(anchorId(item))===q);
  if(!matches.length) matches=anchors.filter((item)=>norm(anchorLabel(item)).includes(q)||q.includes(norm(anchorLabel(item))));
  return matches.length===1?{status:'resolved',value:matches[0],matches}:matches.length>1?{status:'ambiguous',matches}:{status:'not-found',matches:[]};
}
function goalCandidates(ref,goals=[]){
  const q=norm(ref);
  let matches=arr(goals).filter((goal)=>norm(goal.id)===q||norm(goal.label)===q);
  if(!matches.length) matches=arr(goals).filter((goal)=>norm(goal.label).includes(q)||q.includes(norm(goal.label))||norm(goal.id).includes(q));
  return matches;
}
function candidates(items,kind){
  if(kind==='goal') return items.slice(0,10).map((x)=>({id:x.id,label:x.label,type:x.type,enabled:x.enabled}));
  if(kind==='room') return items.slice(0,10).map((x)=>({id:roomId(x),label:roomLabel(x)}));
  if(kind==='anchor') return items.slice(0,10).map((x)=>({id:anchorId(x),label:anchorLabel(x),roomId:x.roomId||null}));
  return items.slice(0,10).map((x)=>({id:idOf(x),label:labelOf(x),roomId:x.roomId||null}));
}
function subjectKind(entity){return entity?.participantId?'person':entity?.objectId?'object':null;}

export function resolvePhysicalGoalCommand(parsed,context={},goals=[],now=Date.now()){
  if(!parsed||parsed.intent==='unknown') return {status:'unsupported',intent:'unknown',message:'I could not map that request to a supported physical-world goal or routine.'};
  if(parsed.intent==='list') return {status:'ready',intent:'list',goals:arr(goals)};
  if(parsed.intent==='clear-history') return {status:'ready',intent:'clear-history'};
  if(['remove','pause','resume','run'].includes(parsed.intent)){
    const matches=goalCandidates(parsed.goalRef,goals);
    if(matches.length===1) return {status:'ready',intent:parsed.intent,goal:matches[0]};
    if(matches.length>1) return {status:'ambiguous',intent:parsed.intent,message:'More than one physical goal matches that description.',candidates:candidates(matches,'goal')};
    return {status:'not-found',intent:parsed.intent,message:'No existing physical goal matches that description.',candidates:candidates(goals,'goal')};
  }

  if(parsed.template==='room-empty'){
    const room=resolveRoom(parsed.roomText,context);
    if(room.status==='ambiguous') return {status:'ambiguous',intent:'create',field:'room',message:'More than one room matches that name.',candidates:candidates(room.matches,'room')};
    if(room.status!=='resolved') return {status:'not-found',intent:'create',field:'room',message:'I could not resolve that room.',candidates:candidates(context.rooms||[],'room')};
    const r=room.value;
    return {status:'ready',intent:'create',goal:normalizePhysicalGoal({
      type:'standing-expectation',label:(roomLabel(r)||roomId(r))+' stays empty',severity:'medium',
      expectation:{kind:'room-empty',roomId:roomId(r)}
    },now)};
  }

  if(parsed.template==='entity-in-room'||parsed.template==='entity-at-anchor'){
    const entity=resolveEntity(parsed.subjectText,context);
    if(entity.status==='self-unresolved') return {status:'needs-context',intent:'create',field:'selfSubjectId',message:'The request refers to you, but no physical self identity was supplied by the Agent.'};
    if(entity.status==='ambiguous') return {status:'ambiguous',intent:'create',field:'subject',message:'More than one entity matches that name.',candidates:candidates(entity.matches,'entity')};
    if(entity.status!=='resolved') return {status:'not-found',intent:'create',field:'subject',message:'I could not resolve that physical-world entity.',candidates:candidates([...(context.people||[]),...(context.objects||[])],'entity')};
    const subject=entity.value;
    if(parsed.template==='entity-in-room'){
      const room=resolveRoom(parsed.roomText,context);
      if(room.status==='ambiguous') return {status:'ambiguous',intent:'create',field:'room',message:'More than one room matches that name.',candidates:candidates(room.matches,'room')};
      if(room.status!=='resolved') return {status:'not-found',intent:'create',field:'room',message:'I could not resolve that room.',candidates:candidates(context.rooms||[],'room')};
      const r=room.value;
      return {status:'ready',intent:'create',goal:normalizePhysicalGoal({
        type:'standing-expectation',
        label:(labelOf(subject)||idOf(subject))+' stays in '+(roomLabel(r)||roomId(r)),
        severity:'medium',
        expectation:{kind:'entity-in-room',subjectId:idOf(subject),subjectLabel:labelOf(subject),subjectKind:subjectKind(subject),roomId:roomId(r)}
      },now)};
    }
    const anchor=resolveAnchor(parsed.anchorText,context);
    if(anchor.status==='ambiguous') return {status:'ambiguous',intent:'create',field:'anchor',message:'More than one known place or anchor matches that name.',candidates:candidates(anchor.matches,'anchor')};
    if(anchor.status!=='resolved') return {status:'not-found',intent:'create',field:'anchor',message:'I could not resolve that known place or anchor.',candidates:candidates(context.anchors||[],'anchor')};
    const a=anchor.value;
    return {status:'ready',intent:'create',goal:normalizePhysicalGoal({
      type:'standing-expectation',
      label:(labelOf(subject)||idOf(subject))+' stays by '+(anchorLabel(a)||anchorId(a)),
      severity:'medium',
      expectation:{kind:'entity-at-anchor',subjectId:idOf(subject),subjectLabel:labelOf(subject),subjectKind:subjectKind(subject),roomId:a.roomId||null,anchorId:anchorId(a),anchorLabel:anchorLabel(a)}
    },now)};
  }

  if(parsed.template==='room-empty-on-leave'){
    const checkRoom=resolveRoom(parsed.checkRoomText,context);
    if(checkRoom.status==='ambiguous') return {status:'ambiguous',intent:'create',field:'checkRoom',message:'More than one room matches the room to check.',candidates:candidates(checkRoom.matches,'room')};
    if(checkRoom.status!=='resolved') return {status:'not-found',intent:'create',field:'checkRoom',message:'I could not resolve the room to check.',candidates:candidates(context.rooms||[],'room')};
    const triggerRoom=resolveRoom(parsed.triggerRoomText,context);
    if(triggerRoom.status==='ambiguous') return {status:'ambiguous',intent:'create',field:'triggerRoom',message:'More than one room matches the trigger room.',candidates:candidates(triggerRoom.matches,'room')};
    if(triggerRoom.status!=='resolved') return {status:'not-found',intent:'create',field:'triggerRoom',message:'I could not resolve the trigger room.',candidates:candidates(context.rooms||[],'room')};
    const subject=resolveEntity(parsed.triggerSubjectText,context);
    if(subject.status==='self-unresolved') return {status:'needs-context',intent:'create',field:'selfSubjectId',message:'The routine refers to you, but no physical self identity was supplied by the Agent.'};
    if(subject.status==='ambiguous') return {status:'ambiguous',intent:'create',field:'subject',message:'More than one person matches the routine trigger.',candidates:candidates(subject.matches,'entity')};
    if(subject.status!=='resolved') return {status:'not-found',intent:'create',field:'subject',message:'I could not resolve the routine trigger person.',candidates:candidates(context.people||[],'entity')};
    if(!subject.value.participantId) return {status:'invalid',intent:'create',field:'subject',message:'Room-exit routines require a person as the trigger subject.'};
    const cr=checkRoom.value,tr=triggerRoom.value,s=subject.value;
    return {status:'ready',intent:'create',goal:normalizePhysicalGoal({
      type:'routine',
      label:(roomLabel(cr)||roomId(cr))+' empty when '+(labelOf(s)||idOf(s))+' leaves '+(roomLabel(tr)||roomId(tr)),
      severity:'medium',
      trigger:{kind:'entity-leaves-room',subjectId:idOf(s),subjectLabel:labelOf(s),subjectKind:'person',roomId:roomId(tr)},
      checks:[{kind:'room-empty',roomId:roomId(cr)}]
    },now)};
  }

  return {status:'unsupported',intent:parsed.intent,message:'That physical-world goal pattern is not supported yet.'};
}

export function interpretPhysicalGoalCommand(input,context={},goals=[],now=Date.now()){
  const parsed=parsePhysicalGoalCommand(input);
  return {...resolvePhysicalGoalCommand(parsed,context,goals,now),parsed};
}
