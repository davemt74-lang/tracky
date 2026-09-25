import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../agent-eyes.js',import.meta.url),'utf8');

test('Agent Eyes imports V2.3 delivery policy and queue cores',()=>{
  assert.match(source,/from ['"]\.\/src\/briefing-delivery-policy\.js['"]/);
  assert.match(source,/from ['"]\.\/src\/briefing-queue-core\.js['"]/);
  for(const symbol of ['deliveryHandoff','normalizeDeliveryContext','enqueueBriefing','reevaluateBriefingQueue','buildBriefingDigest']){
    assert.match(source,new RegExp('\\b'+symbol+'\\b'));
  }
});

test('Agent Eyes exposes delivery context queue digest and lifecycle APIs',()=>{
  for(const symbol of [
    'getAgentDeliveryContext','setAgentDeliveryContext','getAgentBriefingQueue',
    'getReadyAgentBriefings','getNextAgentBriefing','getAgentBriefingDigest',
    'markAgentBriefingSurfaced','deferAgentBriefing','subscribeAgentDelivery'
  ]) assert.match(source,new RegExp('\\b'+symbol+'\\b'));
});

test('delivery-ready is a handoff event and not direct voice execution',()=>{
  assert.match(source,/tracky:agent-delivery-ready/);
  assert.match(source,/publishAgentDeliveryReady/);
  assert.match(source,/deliveryHandoff/);
});

test('new briefings are queued before delivery-ready publication',()=>{
  const enqueue=source.indexOf('const result = enqueueBriefing(');
  const publish=source.indexOf('publishAgentDeliveryReady(result.entry');
  assert.ok(enqueue>=0);assert.ok(publish>enqueue);
});

test('context change re-evaluates durable briefings and only publishes newly ready records',()=>{
  assert.match(source,/reevaluateAgentBriefingDelivery/);
  assert.match(source,/const prior = new Map/);
  assert.match(source,/if \(!before\?\.ready \|\| before\.state !== 'ready'\)/);
});

test('startup loads durable briefings before the Agent-context baseline',()=>{
  const briefings=source.indexOf('await initializeAgentBriefings();');
  const baseline=source.indexOf('runtime.agentContext = currentAgentContext({}, Date.now());');
  assert.ok(briefings>=0);assert.ok(baseline>briefings);
});

test('delivery timer re-evaluates due deferred records',()=>{
  assert.match(source,/delivery-timer/);
  assert.match(source,/Number\(item\.retryAt\) <= now/);
});

test('V2.3 integration retains no autonomous action authority',()=>{
  assert.doesNotMatch(source,/sendDeviceCommand|unlockDoor|openGarage|armSecuritySystem/);
});
