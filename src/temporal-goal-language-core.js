import { interpretPhysicalGoalCommand } from './physical-goal-language-core.js';
import { normalizeTemporalPolicy } from './temporal-goal-core.js';

const arr=(v)=>Array.isArray(v)?v:[];
const txt=(v,max=500)=>String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,max);
const norm=(v)=>txt(v,220).toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9\s._:-]/g,' ').replace(/\s+/g,' ').trim();
const WEEKDAYS=[1,2,3,4,5];
const WEEKENDS=[0,6];

function parseClock(value){
  const m=String(value||'').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if(!m) return null;
  let hour=Number(m[1]),minute=Number(m[2]||0);
  if(hour>23||minute>59) return null;
  if(m[3]){
    if(hour<1||hour>12) return null;
    if(m[3].toLowerCase()==='pm'&&hour!==12) hour+=12;
    if(m[3].toLowerCase()==='am'&&hour===12) hour=0;
  }
  return hour*60+minute;
}
function daypart(name){
  const n=String(name||'').toLowerCase();
  if(/morning/.test(n)) return {startMinute:360,endMinute:719};
  if(/afternoon/.test(n)) return {startMinute:720,endMinute:1019};
  if(/evening/.test(n)) return {startMinute:1020,endMinute:1319};
  if(/night|overnight/.test(n)) return {startMinute:1200,endMinute:359};
  return null;
}
function parseDurationMs(value,unit){
  const n=Number(value);
  if(!Number.isFinite(n)||n<0) return null;
  const mult=/hour/i.test(unit)?3600000:/second/i.test(unit)?1000:60000;
  return Math.min(86400000,Math.round(n*mult));
}
function proposalMatches(ref,proposals=[]){
  const q=norm(ref);
  let matches=arr(proposals).filter((p)=>norm(p.id)===q||norm(p.key)===q||norm(p.label)===q);
  if(!matches.length) matches=arr(proposals).filter((p)=>norm(p.label).includes(q)||norm(p.id).includes(q)||norm(p.key).includes(q));
  return matches;
}
function resolveGoalRef(ref,context,goals,now){
  const r=interpretPhysicalGoalCommand('pause goal '+ref,context,goals,now);
  if(r.status==='ready') return {status:'ready',goal:r.goal};
  return r;
}

export function extractTemporalClause(input){
  let text=txt(input,500).replace(/[?.!]+$/,'').trim();
  let days=[];
  let schedule=null;

  let m=text.match(/\b(weekday|weekend)\s+(mornings?|afternoons?|evenings?|nights?|overnights?)\b/i);
  if(m){
    days=m[1].toLowerCase()==='weekday'?WEEKDAYS:WEEKENDS;
    const part=daypart(m[2]);
    schedule={mode:'window',...part};
    text=(text.slice(0,m.index)+' '+text.slice(m.index+m[0].length)).replace(/\s+/g,' ').trim();
  }

  m=text.match(/\b(?:on|every)\s+(weekdays?|weekends?)\b/i);
  if(m){
    days=/weekday/i.test(m[1])?WEEKDAYS:WEEKENDS;
    text=(text.slice(0,m.index)+' '+text.slice(m.index+m[0].length)).replace(/\s+/g,' ').trim();
  }

  m=text.match(/\bbetween\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+and\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  if(m){
    const start=parseClock(m[1]),end=parseClock(m[2]);
    if(start!=null&&end!=null) schedule={mode:'window',startMinute:start,endMinute:end};
    text=(text.slice(0,m.index)+' '+text.slice(m.index+m[0].length)).replace(/\s+/g,' ').trim();
  }

  if(!schedule){
    m=text.match(/\bafter\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
    if(m){
      const start=parseClock(m[1]);
      if(start!=null) schedule={mode:'window',startMinute:start,endMinute:1439};
      text=(text.slice(0,m.index)+' '+text.slice(m.index+m[0].length)).replace(/\s+/g,' ').trim();
    }
  }
  if(!schedule){
    m=text.match(/\bbefore\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
    if(m){
      const end=parseClock(m[1]);
      if(end!=null) schedule={mode:'window',startMinute:0,endMinute:end};
      text=(text.slice(0,m.index)+' '+text.slice(m.index+m[0].length)).replace(/\s+/g,' ').trim();
    }
  }
  if(!schedule){
    m=text.match(/\bby\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
    if(m){
      const deadline=parseClock(m[1]);
      if(deadline!=null) schedule={mode:'deadline',deadlineMinute:deadline};
      text=(text.slice(0,m.index)+' '+text.slice(m.index+m[0].length)).replace(/\s+/g,' ').trim();
    }
  }
  if(!schedule){
    m=text.match(/\b(?:at\s+night|overnight|in\s+the\s+morning|in\s+the\s+afternoon|in\s+the\s+evening)\b/i);
    if(m){
      const part=daypart(m[0]);
      schedule={mode:'window',...part};
      text=(text.slice(0,m.index)+' '+text.slice(m.index+m[0].length)).replace(/\s+/g,' ').trim();
    }
  }

  if(!schedule&&days.length) schedule={mode:'always'};
  if(schedule) schedule.days=days;
  return {baseText:text,temporalPolicy:schedule?normalizeTemporalPolicy(schedule):null};
}

export function interpretTemporalGoalCommand(input,context={},goals=[],proposals=[],now=Date.now()){
  const raw=txt(input,500);
  const n=norm(raw);

  if(/^(?:what|which) routines? (?:have been )?(?:failing|failed|need attention)(?: lately| recently)?$/.test(n)||
     /^(?:show|list) routine health$/.test(n)){
    return {status:'ready',intent:'routine-health',raw};
  }
  if(/^(?:show|list)(?: my)? (?:learned )?(?:routine )?proposals$/.test(n)){
    return {status:'ready',intent:'list-learning-proposals',raw};
  }

  let m=raw.match(/^(?:confirm|accept)\s+(?:learned\s+)?(?:routine\s+)?proposal\s+(.+)$/i);
  if(m){
    const matches=proposalMatches(m[1],proposals);
    if(matches.length===1) return {status:'ready',intent:'confirm-learning-proposal',proposal:matches[0],raw};
    return {status:matches.length?'ambiguous':'not-found',intent:'confirm-learning-proposal',raw,candidates:matches};
  }
  m=raw.match(/^(?:ignore|dismiss|reject)\s+(?:learned\s+)?(?:routine\s+)?proposal\s+(.+)$/i);
  if(m){
    const matches=proposalMatches(m[1],proposals);
    if(matches.length===1) return {status:'ready',intent:'ignore-learning-proposal',proposal:matches[0],raw};
    return {status:matches.length?'ambiguous':'not-found',intent:'ignore-learning-proposal',raw,candidates:matches};
  }

  m=raw.match(/^give\s+(?:goal\s+|routine\s+|expectation\s+)?(.+?)\s+(\d+(?:\.\d+)?)\s*(seconds?|minutes?|hours?)\s+before\s+(?:warning|alerting|notifying)\s+me$/i);
  if(m){
    const resolved=resolveGoalRef(m[1],context,goals,now);
    if(resolved.status!=='ready') return {...resolved,intent:'set-grace',raw};
    const graceMs=parseDurationMs(m[2],m[3]);
    return {status:'ready',intent:'set-grace',goal:resolved.goal,graceMs,raw};
  }

  m=raw.match(/^only\s+check\s+(?:goal\s+|routine\s+|expectation\s+)?(.+?)\s+(at\s+night|overnight|in\s+the\s+morning|in\s+the\s+afternoon|in\s+the\s+evening)$/i);
  if(m){
    const resolved=resolveGoalRef(m[1],context,goals,now);
    if(resolved.status!=='ready') return {...resolved,intent:'set-temporal-policy',raw};
    const part=daypart(m[2]);
    return {status:'ready',intent:'set-temporal-policy',goal:resolved.goal,temporalPolicy:normalizeTemporalPolicy({mode:'window',...part}),raw};
  }

  m=raw.match(/^(?:check|run)\s+(?:goal\s+|routine\s+|expectation\s+)?(.+?)\s+(?:on|every)\s+(weekdays?|weekends?)$/i);
  if(m){
    const resolved=resolveGoalRef(m[1],context,goals,now);
    if(resolved.status!=='ready') return {...resolved,intent:'set-temporal-days',raw};
    const days=/weekday/i.test(m[2])?WEEKDAYS:WEEKENDS;
    return {status:'ready',intent:'set-temporal-days',goal:resolved.goal,days,raw};
  }

  const extracted=extractTemporalClause(raw);
  if(extracted.temporalPolicy&&extracted.baseText!==raw.replace(/[?.!]+$/,'').trim()){
    const base=interpretPhysicalGoalCommand(extracted.baseText,context,goals,now);
    if(base.status==='ready'&&base.intent==='create'){
      return {
        ...base,
        raw,
        goal:{...base.goal,temporalPolicy:extracted.temporalPolicy},
        temporalPolicy:extracted.temporalPolicy,
        temporal:true
      };
    }
    return {...base,raw,temporalPolicy:extracted.temporalPolicy,temporal:true};
  }

  return interpretPhysicalGoalCommand(raw,context,goals,now);
}
