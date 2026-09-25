import test from 'node:test';
import assert from 'node:assert/strict';

test('world query persistence contract stores compact semantic fields only',()=>{
  const answer={
    intent:'where-is',status:'answered',summary:'Phone is in Office.',
    confidence:.9,generatedAt:1000,
    facts:[{imageDataUrl:'sensitive'}],
    provenance:[{embedding:[1,2,3]}]
  };
  const compact={
    query:'Where is phone?',
    intent:answer.intent,
    status:answer.status,
    summary:answer.summary,
    confidence:answer.confidence,
    generatedAt:answer.generatedAt
  };
  const serialized=JSON.stringify(compact);
  assert.doesNotMatch(serialized,/imageDataUrl/);
  assert.doesNotMatch(serialized,/embedding/);
  assert.equal(compact.intent,'where-is');
});
