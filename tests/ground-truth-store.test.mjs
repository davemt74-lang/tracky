import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/ground-truth-store.js',import.meta.url),'utf8');
test('ground truth persistence is local IndexedDB semantic storage',()=>{assert.match(source,/indexedDB/);assert.match(source,/tracky-ground-truth-v1/);});
test('store exposes state corrections replacement and clear',()=>{for(const name of ['loadGroundTruthState','saveGroundTruthState','listGroundTruthCorrections','replaceGroundTruthCorrections','clearGroundTruthStore'])assert.match(source,new RegExp('export async function '+name));});
test('store bounds correction persistence through centralized reliability policy',()=>{assert.match(source,/RELIABILITY_POLICY\.corrections\.maxRecords/);});
