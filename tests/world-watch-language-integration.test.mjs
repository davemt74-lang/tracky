import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../agent-eyes.js',import.meta.url),'utf8');

test('Agent Eyes imports natural-language watch and briefing modules',()=>{
  assert.match(source,/from ['"]\.\/src\/world-watch-language-core\.js['"]/);
  assert.match(source,/from ['"]\.\/src\/agent-briefing-core\.js['"]/);
  assert.match(source,/from ['"]\.\/src\/agent-briefing-store\.js['"]/);
  for(const symbol of ['interpretWorldWatchCommand','buildAgentBriefing','listAgentBriefings','saveAgentBriefing']){
    assert.match(source,new RegExp('\\b'+symbol+'\\b'));
  }
});

test('Agent Eyes exposes conversational watch APIs',()=>{
  for(const symbol of ['interpretWorldWatch','processWorldWatchCommand']){
    assert.match(source,new RegExp('\\b'+symbol+'\\b'));
  }
  for(const intent of ["interpreted.intent === 'create'","interpreted.intent === 'list'","interpreted.intent === 'remove'","interpreted.intent === 'pause'","interpreted.intent === 'resume'","interpreted.intent === 'clear-history'"]){
    assert.ok(source.includes(intent));
  }
});

test('Agent Eyes exposes briefing delivery and acknowledgement APIs',()=>{
  for(const symbol of [
    'getAgentBriefings','getPendingAgentBriefings','acknowledgeAgentBriefing',
    'clearAgentBriefings','subscribeAgentBriefings'
  ]) assert.match(source,new RegExp('\\b'+symbol+'\\b'));
  assert.match(source,/tracky:agent-briefing/);
});

test('watch triggers are converted to briefings after semantic watch evaluation',()=>{
  const watchEvent=source.indexOf("window.dispatchEvent(new CustomEvent('tracky:world-watch'");
  const delivery=source.indexOf('await deliverAgentBriefing(event, watch, reason, now);');
  assert.ok(watchEvent>=0);
  assert.ok(delivery>watchEvent);
});

test('briefings and watches load before Agent context baseline',()=>{
  const watches=source.indexOf('await initializeWorldWatches();');
  const briefings=source.indexOf('await initializeAgentBriefings();');
  const baseline=source.indexOf('runtime.agentContext = currentAgentContext({}, Date.now());');
  assert.ok(watches>=0);assert.ok(briefings>watches);assert.ok(baseline>briefings);
});

test('V2.2 integration does not add autonomous physical execution authority',()=>{
  assert.doesNotMatch(source,/executePhysicalAction|sendDeviceCommand|unlockDoor|openGarage|armSecuritySystem/);
});
