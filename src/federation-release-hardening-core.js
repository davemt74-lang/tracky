const arr=v=>Array.isArray(v)?v:[];
const bool=v=>v===true;
const terminal=new Set(['completed','failed','rejected','cancelled','expired']);
export const FEDERATION_V280_RELEASE_PROTOCOL='physical_federation_v280_release_hardening.v1';
export const FEDERATION_V280_RELEASE_VERSION='2.80';

export function trustedCurrent(input={}){
  return input.state==='current'&&bool(input.fresh)&&bool(input.recovery_complete);
}

export function evaluateGoldenOperationalScenario(scenario={}){
  const i=scenario.input||{};
  switch(String(scenario.kind||'')){
    case 'health':
      return {trusted_current:trustedCurrent(i)};
    case 'idempotency':
      return {ledger_entries:i.same_key?1:2,conflict:bool(i.same_key)&&!bool(i.same_semantics)};
    case 'operation_restart':
      return {after:bool(i.durable)?String(i.before||'unknown'):'unknown',lost:!bool(i.durable)};
    case 'authority_transfer': {
      const accepted=bool(i.explicit)&&bool(i.source_current)&&Number(i.epoch_after)>Number(i.epoch_before);
      return {accepted,old_authority_writable:accepted?false:true,trusted_current:accepted&&bool(i.reconciliation_current)};
    }
    case 'authority_conflict':
      return Number(i.claim_count)>1&&bool(i.same_epoch)?{state:'failed',fail_closed:true}:{state:'current',fail_closed:false};
    case 'revocation':
      return {allowed:!(bool(i.site_revoked)||false),revocation_wins:bool(i.site_revoked)&&bool(i.cached_grant)};
    case 'device_revocation':
      return {effective_trust:i.trust_state==='revoked'?'revoked':String(i.replayed_trusted_state?'trusted':i.trust_state||'unknown')};
    case 'cloud_outage':
      return {local_operations_available:bool(i.local_ledger_durable),authority_unchanged:true};
    case 'cloud_boundary':
      return {execute:false,authority_mutation:false};
    case 'agent_boundary':
      return {execute:false,proposal_only:true};
    case 'terminal':
      return {next_allowed:!terminal.has(String(i.terminal||''))};
    case 'update':
      return {request_accepted:bool(i.package_checksum_valid)&&String(i.release_version||'').length>0,installed_by_request:false};
    case 'migration':
      return {latest:Number(i.latest)||0,repeat_safe:bool(i.repeat)};
    case 'privacy':
      return {safe:!bool(i.raw_media)&&!bool(i.credentials)&&!bool(i.local_paths)&&bool(i.semantic_summary)};
    case 'routes':
      return {unique:Number(i.legacy_route_count)===1&&Number(i.governed_route_count)===1};
    default:
      throw new Error('unsupported_golden_scenario');
  }
}

export function runGoldenOperationalRelease(manifest={}){
  const scenarios=arr(manifest.scenarios);
  const results=scenarios.map(s=>{
    const actual=evaluateGoldenOperationalScenario(s);
    const expected=s.expect||{};
    const pass=Object.keys(expected).every(k=>JSON.stringify(actual[k])===JSON.stringify(expected[k]));
    return {id:String(s.id||''),kind:String(s.kind||''),pass,actual,expected};
  });
  return {
    protocol:FEDERATION_V280_RELEASE_PROTOCOL,
    version:FEDERATION_V280_RELEASE_VERSION,
    format:String(manifest.format||''),
    scenario_count:results.length,
    passed:results.filter(x=>x.pass).length,
    failed:results.filter(x=>!x.pass).length,
    release_ready:results.length>0&&results.every(x=>x.pass),
    results
  };
}

export function federationV280ReleaseCapability(manifest={}){
  return {
    protocol:FEDERATION_V280_RELEASE_PROTOCOL,
    version:FEDERATION_V280_RELEASE_VERSION,
    final_section:10,
    golden_scenarios:arr(manifest.scenarios).length,
    invariants:arr(manifest.invariants),
    split_brain_allowed:false,
    stale_current_promotion_allowed:false,
    revocation_resurrection_allowed:false,
    cloud_execution_allowed:false,
    agent_execution_allowed:false,
    recovery_authority:'section7_authoritative_reconciliation',
    schema_version:53
  };
}
