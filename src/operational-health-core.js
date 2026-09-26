import {
  cameraCalibrationValid,
  cameraCoveragePolygon,
  polygonArea
} from './camera-core.js';
import { RELIABILITY_POLICY } from './reliability-policy.js';

const arr=(v)=>Array.isArray(v)?v:(v&&typeof v==='object'?Object.values(v):[]);
const clamp01=(v)=>Math.max(0,Math.min(1,Number.isFinite(Number(v))?Number(v):0));

export const OPERATIONAL_HEALTH_SCHEMA_VERSION=1;

function pointInside(point,polygon=[]){
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    const crosses=((a.y>point.y)!==(b.y>point.y))&&
      point.x<(b.x-a.x)*(point.y-a.y)/((b.y-a.y)||Number.EPSILON)+a.x;
    if(crosses) inside=!inside;
  }
  return inside;
}
export function combinedCoverage(cameras=[],grid=20){
  const polygons=arr(cameras)
    .filter((camera)=>camera.enabled!==false&&cameraCalibrationValid(camera))
    .map(cameraCoveragePolygon);
  if(!polygons.length) return 0;
  let covered=0;
  for(let y=0;y<grid;y+=1){
    for(let x=0;x<grid;x+=1){
      const point={x:(x+.5)/grid,y:(y+.5)/grid};
      if(polygons.some((polygon)=>pointInside(point,polygon))) covered+=1;
    }
  }
  return covered/(grid*grid);
}
export function cameraOperationalHealth(camera={},status='offline',environment=null,now=Date.now()){
  const valid=cameraCalibrationValid(camera);
  const coverageArea=valid?polygonArea(cameraCoveragePolygon(camera)):0;
  const online=['online','starting'].includes(String(status));
  const reportedMoved=arr(environment?.reportedMovedCameraIds).includes(camera.id);
  const primaryShift=reportedMoved||(
    camera.primary===true &&
    environment?.drift?.likelyCameraShift===true
  );
  const updatedAt=Number(camera.updatedAt||camera.createdAt||0)||null;
  const configAgeMs=updatedAt?Math.max(0,now-updatedAt):null;
  const issues=[];
  if(camera.enabled===false) issues.push('disabled');
  else if(!online) issues.push('offline');
  if(!valid) issues.push('invalid-calibration');
  if(valid&&coverageArea<RELIABILITY_POLICY.operationalHealth.minimumCalibrationCoverage) issues.push('very-low-calibrated-coverage');
  if(primaryShift) issues.push('camera-pose-shift');
  const statusLabel=issues.some((issue)=>['invalid-calibration','camera-pose-shift'].includes(issue))
    ?'needs-review'
    :issues.includes('offline')?'offline'
      :issues.length?'degraded':'healthy';
  const trust=statusLabel==='healthy'
    ?Math.min(
      1,
      RELIABILITY_POLICY.operationalHealth.healthyCameraBaseTrust+
      Math.min(RELIABILITY_POLICY.operationalHealth.healthyCoverageTrustBonus,coverageArea)+
      (RELIABILITY_POLICY.operationalHealth.healthyOnlineTrustBonus*(online?1:0))
    )
    :statusLabel==='degraded'?RELIABILITY_POLICY.operationalHealth.degradedCameraTrust
      :statusLabel==='needs-review'?RELIABILITY_POLICY.operationalHealth.reviewCameraTrust:RELIABILITY_POLICY.operationalHealth.offlineCameraTrust;
  return {
    cameraId:camera.id||null,
    name:camera.name||camera.id||null,
    roomId:camera.roomId||null,
    enabled:camera.enabled!==false,
    primary:camera.primary===true,
    runtimeStatus:String(status||'offline'),
    calibrationValid:valid,
    coverageArea:clamp01(coverageArea),
    configUpdatedAt:updatedAt,
    configAgeMs,
    poseShiftDetected:primaryShift,
    status:statusLabel,
    trust:clamp01(trust),
    issues
  };
}
export function roomOperationalHealth(room={},cameras=[],statuses={},policy={},environment=null,now=Date.now()){
  const roomCameras=arr(cameras).filter((camera)=>camera.roomId===room.id&&camera.enabled!==false);
  const cameraHealth=roomCameras.map((camera)=>cameraOperationalHealth(
    camera,
    statuses[camera.id]||'offline',
    environment,
    now
  ));
  const activeCameras=roomCameras.filter((camera)=>['online','starting'].includes(String(statuses[camera.id]||'offline')));
  const coverage=combinedCoverage(activeCameras);
  const privacyAllowsOccupancy=policy.allowVisualObservation!==false&&policy.allowAnonymousTracking!==false;
  const blindSpot=(policy.sensitiveRegions||[]).some((region)=>(
    region.enabled!==false&&region.mode==='ignore'&&(region.appliesTo||[]).includes('participant')
  ));
  const occupancyVerifiable=privacyAllowsOccupancy&&!blindSpot&&coverage>=RELIABILITY_POLICY.operationalHealth.occupancyCoverage;
  const issues=[];
  if(!roomCameras.length) issues.push('no-enabled-cameras');
  if(roomCameras.length&&!activeCameras.length) issues.push('no-live-cameras');
  if(cameraHealth.some((camera)=>camera.status==='needs-review')) issues.push('camera-calibration-review');
  if(coverage<RELIABILITY_POLICY.operationalHealth.lowRoomCoverage) issues.push('low-room-coverage');
  else if(coverage<RELIABILITY_POLICY.operationalHealth.occupancyCoverage) issues.push('partial-room-coverage');
  if(!privacyAllowsOccupancy) issues.push('occupancy-observation-disabled');
  if(blindSpot) issues.push('participant-privacy-blind-spot');
  const status=issues.some((issue)=>['no-live-cameras','camera-calibration-review'].includes(issue))
    ?'needs-attention'
    :issues.length?'limited':'healthy';
  return {
    roomId:room.id,
    roomName:room.name||room.label||room.id,
    status,
    enabledCameraCount:roomCameras.length,
    liveCameraCount:activeCameras.length,
    coverage,
    occupancyVerifiable,
    issues,
    cameras:cameraHealth
  };
}
export function buildOperationalHealth(input={},now=Date.now()){
  const rooms=arr(input.rooms);
  const statuses=input.cameraStatuses||{};
  const roomPolicies=input.roomPolicies||{};
  const cameraHealth=arr(input.cameras).map((camera)=>cameraOperationalHealth(
    camera,statuses[camera.id]||'offline',input.environment,now
  ));
  const roomHealth=rooms.map((room)=>roomOperationalHealth(
    room,
    input.cameras||[],
    statuses,
    roomPolicies[room.id]||{},
    room.id===input.activeRoomId?input.environment:null,
    now
  ));
  const staleEntities=arr(input.groundTruth?.entities).filter((entity)=>['stale','unknown'].includes(entity.freshness));
  const conflictedEntities=arr(input.groundTruth?.entities).filter((entity)=>entity.state==='conflicted');
  const continuityIssues=arr(input.groundTruth?.continuityIssues);
  const issues=[
    ...cameraHealth.flatMap((camera)=>camera.issues.map((issue)=>({
      type:'camera',id:camera.cameraId,roomId:camera.roomId,issue
    }))),
    ...roomHealth.flatMap((room)=>room.issues.map((issue)=>({
      type:'room',id:room.roomId,roomId:room.roomId,issue
    }))),
    ...staleEntities.map((entity)=>({type:'entity',id:entity.subjectId,issue:'stale-ground-truth'})),
    ...conflictedEntities.map((entity)=>({type:'entity',id:entity.subjectId,issue:'conflicted-ground-truth'})),
    ...continuityIssues.map((item)=>({type:'continuity',id:item.id,issue:item.type}))
  ];
  const status=issues.some((item)=>[
    'camera-pose-shift','invalid-calibration','no-live-cameras','conflicted-ground-truth'
  ].includes(item.issue))
    ?'needs-attention'
    :issues.length?'limited':'healthy';
  return {
    schemaVersion:OPERATIONAL_HEALTH_SCHEMA_VERSION,
    generatedAt:now,
    status,
    activeRoomId:input.activeRoomId||null,
    cameras:cameraHealth,
    rooms:roomHealth,
    staleEntityCount:staleEntities.length,
    conflictedEntityCount:conflictedEntities.length,
    continuityIssueCount:continuityIssues.length,
    issues:issues.slice(0,100),
    boundaries:['diagnostic-only','privacy-policy-aware','no-autonomous-camera-reconfiguration','no-autonomous-physical-control']
  };
}
export function operationalHealthSnapshot(value){
  return JSON.parse(JSON.stringify(value||buildOperationalHealth({})));
}
