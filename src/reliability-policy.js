export const RELIABILITY_POLICY_VERSION=1;

export const RELIABILITY_POLICY=Object.freeze({
  groundTruth:{
    fallbackTickMs:5000,
    persistenceThrottleMs:10000,
    confidenceBucketStep:.05,
    recoveredConfidenceCeiling:.35
  },
  operationalHealth:{
    minimumCalibrationCoverage:.01,
    lowRoomCoverage:.50,
    occupancyCoverage:.85,
    healthyCameraBaseTrust:.75,
    healthyCoverageTrustBonus:.20,
    healthyOnlineTrustBonus:.05,
    degradedCameraTrust:.55,
    reviewCameraTrust:.35,
    offlineCameraTrust:.15
  },
  corrections:{
    maxRecords:250
  },
  calibration:{
    minimumModelSettlements:20,
    minimumContextSettlements:12,
    minimumBucketSettlements:6,
    confidenceBucketStep:.10,
    priorStrength:12,
    maximumConfidenceAdjustment:.20,
    maximumHorizonMs:7*24*60*60*1000,
    maxPredictions:2000,
    maxSettlements:4000
  },
  soak:{
    maximumSemanticEventBurst:5000,
    maximumSimulatedDurationMs:7*24*60*60*1000
  }
});

export function reliabilityPolicySnapshot(){
  return JSON.parse(JSON.stringify(RELIABILITY_POLICY));
}
