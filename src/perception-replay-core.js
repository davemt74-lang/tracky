export function createObservationFrame(input = {}) {
  return {
    timestamp: Number(input.timestamp || Date.now()),
    roomId: input.roomId || null,
    environment: input.environment || null,
    participants: input.participants || [],
    objects: input.objects || [],
    changes: input.changes || []
  };
}

export function appendReplayFrame(session, frame, limit = 600) {
  const next = session || {schemaVersion:1,frames:[]};
  next.frames.push(createObservationFrame(frame));
  if (next.frames.length > limit) {
    next.frames.splice(0, next.frames.length - limit);
  }
  return next;
}

export function replayFrames(session, reducer, initialState) {
  let state = initialState;
  const outputs = [];
  for (const frame of session?.frames || []) {
    const result = reducer(state, frame);
    state = result?.state ?? result;
    outputs.push({timestamp:frame.timestamp,state});
  }
  return {state,outputs};
}

export function simulateEnvironmentScenario(name = 'environment-change') {
  const base = 1000;
  if (name === 'camera-shift') {
    return {
      schemaVersion:1,
      frames:[
        createObservationFrame({timestamp:base,roomId:'ROOM01',environment:{classification:'known-view',cameraPoseDrift:0.02}}),
        createObservationFrame({timestamp:base+1000,roomId:'ROOM01',environment:{classification:'known-room-new-view',cameraPoseDrift:0.35}})
      ]
    };
  }
  if (name === 'object-transfer') {
    return {
      schemaVersion:1,
      frames:[
        createObservationFrame({timestamp:base,roomId:'ROOM01',objects:[{id:'WO1',label:'phone',holderParticipantId:null}]}),
        createObservationFrame({timestamp:base+1000,roomId:'ROOM01',objects:[{id:'WO1',label:'phone',holderParticipantId:'p1'}]}),
        createObservationFrame({timestamp:base+2000,roomId:'ROOM01',objects:[{id:'WO1',label:'phone',holderParticipantId:null}]})
      ]
    };
  }
  return {
    schemaVersion:1,
    frames:[
      createObservationFrame({timestamp:base,roomId:'ROOM01',environment:{classification:'known-view',drift:{environmentStateDrift:0.04}}}),
      createObservationFrame({timestamp:base+1000,roomId:'ROOM01',environment:{classification:'known-view',drift:{environmentStateDrift:0.42}}})
    ]
  };
}
