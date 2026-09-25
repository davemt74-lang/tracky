import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/world-watch-store.js',import.meta.url),'utf8');
test('world watch store is local IndexedDB with bounded semantic history',()=>{
 assert.match(source,/indexedDB/);
 assert.match(source,/MAX_WATCHES=100/);
 assert.match(source,/MAX_HISTORY=250/);
 for(const symbol of ['saveWorldWatch','listWorldWatches','deleteWorldWatch','saveWorldWatchTrigger','listWorldWatchHistory','clearWorldWatchHistory']) assert.match(source,new RegExp('export async function '+symbol));
});
test('world watch store does not define raw sensor fields',()=>{
 assert.doesNotMatch(source,/imageDataUrl|embedding|faceDescriptor|voiceDescriptor|providerPayload/);
});
