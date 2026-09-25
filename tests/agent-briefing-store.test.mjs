import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const s=fs.readFileSync(new URL('../src/agent-briefing-store.js',import.meta.url),'utf8');
test('briefing store is bounded local IndexedDB',()=>{assert.match(s,/indexedDB/);assert.match(s,/MAX_RECORDS=200/);});
test('briefing store exposes save list and clear APIs',()=>{for(const n of ['saveAgentBriefing','listAgentBriefings','clearAgentBriefings'])assert.match(s,new RegExp('export async function '+n));});
