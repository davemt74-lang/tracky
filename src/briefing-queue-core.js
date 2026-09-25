import { planBriefingDelivery } from './briefing-delivery-policy.js';

const arr=(v)=>Array.isArray(v)?v:[];
const txt=(v,max=240)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);
export const BRIEFING_COALESCE_WINDOW_MS=90000;
export const BRIEFING_DEFAULT_TTL_MS=86400000;

export function briefingSemanticKey(briefing={}){
  const e=briefing.evidence||{};
  return [
    briefing.goalId||briefing.watchId||briefing.type||'briefing',
    e.subjectId||'',
    e.roomId||'',
    e.anomalySignature||e.anomalyType||'',
    briefing.urgency||''
  ].join('::');
}

function deliveryHistory(item,state,reason,now){
  const history=arr(item?.deliveryHistory).slice(-39).map((entry)=>({...entry}));
  const cleanReason=txt(reason||'policy',100);
  const last=history[history.length-1];
  if(last?.state===state&&last?.reason===cleanReason) return history;
  history.push({state,reason:cleanReason,at:Number(now)});
  return history;
}
function transition(item,state,reason,now,extra={}){
  return {
    ...item,
    ...extra,
    deliveryState:state,
    deliveryReason:reason,
    deliveryHistory:deliveryHistory(item,state,reason,now)
  };
}

function queuedRecord(briefing,plan,now,options={}){
  const base={
    ...briefing,
    deliveryReady:plan.ready===true,
    interrupt:plan.interrupt===true,
    voiceEligible:plan.voiceEligible===true,
    retryAt:plan.retryAt==null?null:Number(plan.retryAt),
    semanticKey:briefingSemanticKey(briefing),
    occurrenceCount:Number(briefing.occurrenceCount||1),
    firstQueuedAt:Number(briefing.firstQueuedAt||now),
    lastQueuedAt:Number(now),
    expiresAt:Number(briefing.expiresAt||now+Number(options.ttlMs||BRIEFING_DEFAULT_TTL_MS))
  };
  return transition(base,plan.state,plan.reason,now);
}

export function enqueueBriefing(queue=[],briefing={},context={},now=Date.now(),options={}){
  const items=arr(queue).map((item)=>({...item}));
  const key=briefingSemanticKey(briefing);
  const windowMs=Number(options.coalesceWindowMs||BRIEFING_COALESCE_WINDOW_MS);
  const existingIndex=items.findIndex((item)=>(
    item.semanticKey===key &&
    !['acknowledged','expired','surfaced'].includes(item.deliveryState) &&
    now-Number(item.lastQueuedAt||item.generatedAt||0)<=windowMs
  ));
  const plan=planBriefingDelivery(briefing,context,now);
  if(existingIndex>=0){
    const prior=items[existingIndex];
    items[existingIndex]=queuedRecord({
      ...prior,
      ...briefing,
      id:prior.id,
      occurrenceCount:Number(prior.occurrenceCount||1)+1,
      firstQueuedAt:prior.firstQueuedAt,
      summary:txt(briefing.summary||prior.summary,320)
    },plan,now,options);
    return {queue:sortQueue(items),entry:items[existingIndex],coalesced:true};
  }
  const entry=queuedRecord(briefing,plan,now,options);
  items.push(entry);
  return {queue:sortQueue(items),entry,coalesced:false};
}

export function reevaluateBriefingQueue(queue=[],context={},now=Date.now()){
  const updated=arr(queue).map((item)=>{
    const base={
      ...item,
      semanticKey:item.semanticKey||briefingSemanticKey(item),
      occurrenceCount:Number(item.occurrenceCount||1),
      firstQueuedAt:Number(item.firstQueuedAt||item.generatedAt||now),
      lastQueuedAt:Number(item.lastQueuedAt||item.generatedAt||now),
      expiresAt:Number(item.expiresAt||Number(item.generatedAt||now)+BRIEFING_DEFAULT_TTL_MS)
    };
    if(['acknowledged','expired','surfaced'].includes(base.deliveryState)) return base;
    if(Number(base.expiresAt||Infinity)<=now) return transition(base,'expired','ttl-expired',now,{deliveryReady:false,expiredAt:now});
    if(
      base.deliveryState==='deferred' &&
      String(base.deliveryReason||'').startsWith('user-') &&
      Number(base.retryAt||0)>now
    ) return base;
    const plan=planBriefingDelivery(base,context,now);
    return transition(base,plan.state,plan.reason,now,{
      deliveryReady:plan.ready===true,
      interrupt:plan.interrupt===true,
      voiceEligible:plan.voiceEligible===true,
      retryAt:plan.retryAt==null?null:Number(plan.retryAt)
    });
  });
  return sortQueue(updated);
}

export function markBriefingSurfaced(queue=[],id,now=Date.now()){
  return arr(queue).map((item)=>item.id===id
    ? transition(item,'surfaced','downstream-surfaced',now,{deliveryReady:false,surfacedAt:now})
    : item);
}
export function deferBriefing(queue=[],id,delayMs=300000,reason='user-deferred',now=Date.now()){
  const delay=Math.max(1000,Math.min(86400000,Number(delayMs||300000)));
  return arr(queue).map((item)=>item.id===id
    ? transition(item,'deferred',reason,now,{deliveryReady:false,retryAt:now+delay,deferredAt:now})
    : item);
}
export function acknowledgeQueuedBriefing(queue=[],id,now=Date.now()){
  return arr(queue).map((item)=>item.id===id
    ? transition({...item,status:'acknowledged'},'acknowledged','user-acknowledged',now,{deliveryReady:false,acknowledgedAt:now})
    : item);
}
export function readyBriefings(queue=[]){
  return sortQueue(arr(queue).filter((item)=>item.deliveryState==='ready'&&item.deliveryReady===true));
}
export function digestBriefings(queue=[],limit=8){
  return sortQueue(arr(queue).filter((item)=>item.deliveryState==='digest')).slice(0,Math.max(1,Math.min(20,Number(limit||8))));
}
export function buildBriefingDigest(queue=[],limit=8,now=Date.now()){
  const items=digestBriefings(queue,limit);
  return {
    generatedAt:now,
    count:items.length,
    briefingIds:items.map((item)=>item.id),
    summary:items.length?items.map((item)=>item.summary).join(' '):'No deferred physical-world updates.',
    items:items.map((item)=>({id:item.id,title:item.title,summary:item.summary,urgency:item.urgency,generatedAt:item.generatedAt,occurrenceCount:item.occurrenceCount||1})),
    boundaries:['semantic-digest-only','no-direct-tts','no-autonomous-physical-control']
  };
}
function sortQueue(items){
  const rank={high:4,medium:3,low:2,info:1};
  return items.sort((a,b)=>(
    Number(b.deliveryReady===true)-Number(a.deliveryReady===true) ||
    (rank[b.urgency]||0)-(rank[a.urgency]||0) ||
    Number(b.generatedAt||0)-Number(a.generatedAt||0)
  ));
}
