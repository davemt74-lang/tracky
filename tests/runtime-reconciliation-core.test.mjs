import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createReconciliationState,markReconciliationDirty,reconciliationDue,
 consumeReconciliation,nextFreshnessBoundary,persistenceNeeded,notePersisted
} from '../src/runtime-reconciliation-core.js';

test('reconciliation starts dirty and becomes clean after consumption',()=>{
 const s=createReconciliationState(1000);
 assert.equal(reconciliationDue(s,1000),true);
 markReconciliationDirty(s,'camera');
 const r=consumeReconciliation(s,[],1000);
 assert.deepEqual(new Set(r.reasons),new Set(['startup','camera']));
 assert.equal(s.dirty,false);
});
test('freshness boundary schedules semantic decay instead of blind full polling',()=>{
 const next=nextFreshnessBoundary([{observedAt:1000,halfLifeMs:100000}],2000);
 assert.equal(next,16001);
});
test('dirty reasons deduplicate and force reconciliation',()=>{
 const s=createReconciliationState(1000); consumeReconciliation(s,[],1000);
 markReconciliationDirty(s,'privacy');markReconciliationDirty(s,'privacy');
 assert.equal(s.reasons.length,1);assert.equal(reconciliationDue(s,1001),true);
});
test('persistence skips identical semantic signatures',()=>{
 const s=createReconciliationState(1000);
 assert.equal(persistenceNeeded(s,'abc'),true);
 notePersisted(s,'abc');
 assert.equal(persistenceNeeded(s,'abc'),false);
 assert.equal(persistenceNeeded(s,'abc',true),true);
});
