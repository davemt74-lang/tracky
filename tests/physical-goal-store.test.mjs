import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/physical-goal-store.js',import.meta.url),'utf8');
test('physical goal store is bounded and local IndexedDB',()=>{assert.match(source,/indexedDB/);assert.match(source,/MAX_GOALS=100/);assert.match(source,/MAX_EVENTS=250/);});
test('physical goal store exposes durable definitions and event history',()=>{for(const n of ['savePhysicalGoal','listPhysicalGoals','deletePhysicalGoal','savePhysicalGoalEvent','listPhysicalGoalEvents','clearPhysicalGoalEvents'])assert.match(source,new RegExp('export async function '+n));});
