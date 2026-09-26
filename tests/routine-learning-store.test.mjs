import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/routine-learning-store.js',import.meta.url),'utf8');
test('routine learning store is local IndexedDB state',()=>{assert.match(source,/indexedDB/);assert.match(source,/tracky-routine-learning-v1/);});
test('routine learning store exposes load save and clear',()=>{for(const n of ['loadRoutineLearningState','saveRoutineLearningState','clearRoutineLearningState'])assert.match(source,new RegExp('export async function '+n));});
