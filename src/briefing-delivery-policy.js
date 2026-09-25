const clamp01=(v)=>Math.max(0,Math.min(1,Number.isFinite(Number(v))?Number(v):0));
const txt=(v,max=180)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);

export const BRIEFING_DELIVERY_SCHEMA_VERSION=1;
export const DELIVERY_STATES=Object.freeze(['queued','ready','deferred','digest','surfaced','acknowledged','expired']);

export function normalizeDeliveryContext(input={},now=Date.now()){
  return {
    schemaVersion:BRIEFING_DELIVERY_SCHEMA_VERSION,
    updatedAt:Number(input.updatedAt||now),
    agentConnected:input.agentConnected===true,
    conversationActive:input.conversationActive===true,
    voiceEnabled:input.voiceEnabled===true,
    doNotDisturb:input.doNotDisturb===true,
    activeRoomId:txt(input.activeRoomId||'',120)||null,
    taskMode:txt(input.taskMode||'general',80)||'general',
    agentIdleMs:Math.max(0,Number(input.agentIdleMs||0)),
    channel:txt(input.channel||'agent-chat',80)||'agent-chat'
  };
}

function urgencyRank(urgency){
  return ({high:4,medium:3,low:2,info:1})[String(urgency||'medium')]||2;
}
function roomRelevant(briefing,context){
  const room=briefing?.evidence?.roomId||null;
  return Boolean(room&&context.activeRoomId&&room===context.activeRoomId);
}
function lowConfidence(briefing){
  return clamp01(briefing?.confidence??1)<0.55;
}

export function planBriefingDelivery(briefing={},contextInput={},now=Date.now()){
  const context=normalizeDeliveryContext(contextInput,now);
  const urgency=String(briefing.urgency||'medium');
  const rank=urgencyRank(urgency);
  const relevant=roomRelevant(briefing,context);

  if(['acknowledged','expired'].includes(briefing.status)||['acknowledged','expired'].includes(briefing.deliveryState)){
    return {state:briefing.deliveryState||briefing.status,reason:'terminal',ready:false,interrupt:false,voiceEligible:false,retryAt:null};
  }
  if(!context.agentConnected){
    return {state:'deferred',reason:'agent-disconnected',ready:false,interrupt:false,voiceEligible:false,retryAt:now+60000};
  }
  if(lowConfidence(briefing)&&rank<4){
    return {state:'deferred',reason:'low-confidence',ready:false,interrupt:false,voiceEligible:false,retryAt:now+120000};
  }
  if(context.doNotDisturb&&rank<4){
    return {state:'deferred',reason:'do-not-disturb',ready:false,interrupt:false,voiceEligible:false,retryAt:now+300000};
  }
  if(context.conversationActive){
    if(rank>=4){
      return {state:'ready',reason:'high-urgency-breakthrough',ready:true,interrupt:true,voiceEligible:context.voiceEnabled,retryAt:null};
    }
    if(rank>=3){
      return {state:'deferred',reason:'active-conversation',ready:false,interrupt:false,voiceEligible:false,retryAt:now+30000};
    }
    return {state:'digest',reason:'active-conversation-low-urgency',ready:false,interrupt:false,voiceEligible:false,retryAt:null};
  }
  if(context.taskMode==='low-power'&&rank<4){
    return {state:'digest',reason:'low-power-mode',ready:false,interrupt:false,voiceEligible:false,retryAt:null};
  }
  if(rank>=4){
    return {state:'ready',reason:'high-urgency',ready:true,interrupt:false,voiceEligible:context.voiceEnabled,retryAt:null};
  }
  if(rank>=3&&(relevant||context.agentIdleMs>=5000)){
    return {state:'ready',reason:relevant?'active-room-relevant':'agent-available',ready:true,interrupt:false,voiceEligible:context.voiceEnabled,retryAt:null};
  }
  if(rank>=3){
    return {state:'queued',reason:'awaiting-attention-window',ready:false,interrupt:false,voiceEligible:false,retryAt:now+15000};
  }
  return {state:'digest',reason:'low-urgency-digest',ready:false,interrupt:false,voiceEligible:false,retryAt:null};
}

export function deliveryHandoff(briefing={},plan={},contextInput={},now=Date.now()){
  const context=normalizeDeliveryContext(contextInput,now);
  return {
    schemaVersion:BRIEFING_DELIVERY_SCHEMA_VERSION,
    briefingId:briefing.id||null,
    deliveryState:plan.state||'queued',
    reason:plan.reason||'policy',
    ready:plan.ready===true,
    interrupt:plan.interrupt===true,
    channel:context.channel,
    generatedAt:Number(now),
    voice:{
      eligible:plan.voiceEligible===true,
      mode:'handoff-only',
      text:txt(briefing.summary||briefing.title||'',320)
    },
    boundaries:['delivery-policy-only','no-direct-tts','no-ui-interruption-authority','no-autonomous-physical-control']
  };
}
