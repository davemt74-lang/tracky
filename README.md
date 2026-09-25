# Tracky

Tracky is a local-first experimental perception runtime for Agent systems. The original camera-tracked games remain in the repo as sensor-validation experiments.

## V1.2 — Room Mapping & Multi-Camera Fusion

V1.2 turns individual camera views into calibrated sensors inside a shared room coordinate system.

### Persistent camera registry

Agent Eyes now keeps a local camera registry with:

- camera ID such as `CAM01`, `CAM02`
- browser device ID
- display name
- explicit room ID
- enabled/disabled state
- main vs secondary role
- four camera source corners
- four mapped room corners

Camera configuration is stored locally in IndexedDB.

The active main camera is automatically registered when Agent Eyes starts. Additional configured cameras in the same room can run as secondary perception sensors.

### Four-point room calibration

Each camera maps its normalized image coordinates into normalized shared-room coordinates using a homography.

Quick setup can assign a rectangular coverage area with X/Y/width/height. The Camera Calibration Inspector exposes all four room corners:

- top-left
- top-right
- bottom-right
- bottom-left

This supports perspective-aware quadrilateral coverage instead of assuming every camera is square to the room.

Invalid/degenerate calibration polygons are rejected.

### Shared inference runtime

The main and secondary cameras use the same pinned Human perception engine.

Model inference is serialized across camera feeds so multiple streams do not concurrently mutate the same model runtime.

Secondary sensors maintain their own:

- local body Track IDs
- face/body association
- enrolled face identity
- body continuity
- pose/behavior evidence
- persistent local object IDs

Secondary body tracks must stabilize before they enter world fusion.

### Cross-camera participant fusion

Per-camera observations are transformed into room coordinates and then fused.

For enrolled participants:

- enrolled face identity remains the authority
- all simultaneous observations for the same participant are combined
- the highest-quality view becomes the primary camera
- face confidence, body confidence, pose confidence, and continuity contribute to camera arbitration
- overlapping views reinforce the same world participant instead of creating duplicates

If two cameras identify the same enrolled participant but their calibrated room positions strongly disagree, Tracky does **not** average the conflict. It trusts the stronger view for location and flags the conflicting camera calibration.

### Camera handoff

A known participant can move from one camera to another while retaining the same world participant identity.

Example:

`CAM01 / Dave → overlap → CAM02 / Dave`

Tracky emits:

- `camera.overlap_fused`
- `camera.handoff`

and preserves the participant's world trail and Scene Intelligence continuity.

A face/Voice Profile remains the identity authority. An unknown body appearing on another camera is not promoted to Dave merely because the trajectory looks plausible.

### Anonymous overlap

When two calibrated cameras simultaneously see an unknown body at nearly the same room position, those observations may be deduplicated into one temporary anonymous world entity.

The result is explicitly labeled:

`anonymous-spatial-overlap`

This is duplicate suppression, **not personal identification**.

If the authoritative simultaneous overlap disappears, geometry alone cannot carry a known identity through a camera handoff.

### Cross-camera object continuity

Objects use:

- detector label
- calibrated room position
- camera overlap
- prior world position

to maintain a room-level world object ID such as `WO001`.

Multiple cameras can reinforce the same object. A phone can leave CAM01 and appear in CAM02 while retaining its world object ID when label and spatial continuity are strong enough.

Two same-label objects from the same camera are never merged merely because they are close together.

### Fused World Map

Agent Eyes now includes a room-level world map with:

- camera coverage polygons
- online/offline camera state
- main-camera coverage
- known participants
- anonymous participants
- persistent world objects
- overlap indicators
- last-known states
- calibration-conflict warning state
- short participant movement trails
- live conversation links

The original Room Radar remains useful for inspecting the main camera's local tracks. The World Map represents the fused room coordinate system.

### Current World State

`getWorldState()` now returns three independent layers:

```js
{
  room,         // current main-camera perception state
  scene,        // temporal semantic memory
  cameraFusion  // fused multi-camera room state
}
```

Additional Agent interfaces:

```js
window.TrackyAgentEyes.getCameraFusionState()
window.TrackyAgentEyes.getCameras()
window.TrackyAgentEyes.subscribeCameraFusion(handler)
```

Every fusion update is also dispatched as:

```js
tracky:camera-fusion
```

### Room IDs and multi-room groundwork

Each camera belongs to an explicit room ID.

V1.2 fuses only cameras assigned to the active main camera's room. Cameras assigned to another room remain registered but are not mixed into the active coordinate system.

This establishes the boundary needed for later room-to-room transitions and multiple simultaneous room models without pretending unrelated room coordinates are directly comparable.

## V1.1 — Scene Intelligence & Temporal Memory

V1.1 turns Agent Eyes from a live perception surface into a temporal scene model that can answer **what changed?** and preserve meaningful room context over time.

### Separate temporal layer

Current Room State still represents what is visible/active now. Scene Intelligence is a separate higher-level reducer that consumes stable room snapshots and produces:

- semantic scene changes
- persistent participant activities
- completed activity/conversation episodes
- named-zone transitions
- object permanence / last-known position
- meaningful object movement
- a change-only Agent feed

Raw camera frames, body landmarks, object-position refreshes, and other high-frequency sensor telemetry are not written into scene memory.

### Current World State

The Agent browser API now exposes both layers:

```js
window.TrackyAgentEyes.getState()       // current room perception
window.TrackyAgentEyes.getSceneState()  // temporal scene memory
window.TrackyAgentEyes.getWorldState()  // both together
window.TrackyAgentEyes.getChanges()
window.TrackyAgentEyes.getEpisodes()
window.TrackyAgentEyes.subscribeScene(handler)
```

Every semantic scene change is also dispatched as:

```js
window.addEventListener('tracky:scene-change', event => {
  console.log(event.detail)
})
```

### Named room zones

Agent Eyes can define persistent normalized rectangular zones such as:

- Desk
- Doorway
- Couch
- Workstation
- Kitchen

Zones are stored locally and shown on both the room radar and camera overlay. When multiple zones overlap, the smallest matching zone is treated as the most specific location.

Zone changes require dwell time before they become semantic events so boundary jitter does not create repeated transitions.

### Stable activities

Participant activity is consolidated from existing perception signals.

Current activity precedence includes:

1. holding an object
2. pointing at an object
3. active conversation membership
4. moving through the room
5. seated
6. stationary
7. present

Activity changes are debounced before they open or close temporal episodes.

Examples:

- `Dave is now holding phone`
- `Sarah is now in conversation G01`
- `Dave stopped moving through room`
- `T004 is now seated`

### Episodes

Stable activities and conversations become episodes with:

- participant / Track ID
- object when relevant
- conversation group
- named zone
- start time
- end time
- duration
- confidence
- source evidence

Active episodes remain in memory while they are occurring. Completed episodes are persisted locally with bounded retention.

### Object permanence

Objects no longer disappear semantically just because the detector cannot currently see them.

Scene memory preserves:

- persistent object ID
- label
- last known position
- last seen timestamp
- current/previous holder
- visible vs last-known status

A missing object becomes `last-known` and remains available to the scene model for a bounded memory window.

Meaningful object displacement generates a semantic `object.moved` change; tiny detector movement does not.

### Identity continuity

When an unknown persistent body track later becomes an enrolled participant, the temporal entity is migrated rather than split.

Tracky therefore avoids false sequences such as:

`T001 left → Dave entered`

when the actual event was simply:

`T001 recognized as Dave`

Pending zone/activity state and an active activity episode migrate to the recognized participant identity.

### Change-only Agent feed

The V1.1 **What changed?** panel contains only temporal semantic changes such as:

- participant entered/left scene
- location changed
- activity started/ended
- conversation started/ended
- object appeared/moved/became last-known/returned
- object picked up/put down

This is the layer intended for eventual Agent Brain ingestion.

### Scene Evidence Inspector

Every change and episode can be opened in the Scene Evidence Inspector to see:

- change/episode type
- confidence
- participant
- object
- named zone
- duration
- semantic summary
- exact evidence
- raw Agent-readable record

### Local persistence

Scene history uses a separate local IndexedDB store.

- up to 500 semantic scene changes
- up to 250 completed episodes
- named zones stored separately
- Clear scene history removes changes/episodes while preserving zone configuration

## V1.0 — Objects & Interactions

V1.0 adds persistent room objects and conservative person↔object interaction inference to Agent Eyes.

### Object perception

Tracky now enables the pinned Human object and hand providers in the same browser perception pass used for faces and bodies.

- Human object detections are normalized into Tracky object observations
- `person` detections are excluded because people already use the stronger face/body pipeline
- persistent object IDs use `O001`, `O002`, etc.
- same-label position, overlap, and size continuity preserve object identity across scans
- an object must be observed repeatedly before Agent Eyes announces it
- brief detector loss enters reacquisition grace instead of immediately declaring the object gone
- stale lost objects are eventually removed from the long-running room state

### Person ↔ object interactions

Tracky fuses body pose, wrist landmarks, optional hand detections, persistent object tracks, and relative movement.

Current conservative relationships:

- `holding`
- `pointing-at`
- `approaching`
- `moving-away`

Semantic transitions also produce:

- `object.picked_up`
- `object.put_down`

A relationship must be confirmed on consecutive scans before it becomes an Agent event. Missing evidence receives a short grace period before the relationship ends.

#### Holding

Holding is inferred from:

- a tracked object near a confident left/right wrist
- distance threshold scaled against the participant body box
- optional independent hand-detector confidence as reinforcement

Holding is not inferred from object proximity to the body alone.

#### Pointing at

Pointing is inferred from:

- confident elbow and wrist landmarks
- elbow → wrist arm direction
- object center in front of that arm direction
- bounded angular error
- participant/object distance

This is a geometric pointing estimate, not semantic intent recognition.

#### Approach / retreat

Approach and moving-away relationships use changes in normalized participant↔object distance across consecutive room scans. Small changes remain `stable` and do not become events.

### Agent Eyes UI

The JARVIS display now includes:

- object count
- hand count
- active interaction count
- object-provider health
- amber persistent object boxes on the camera overlay
- participant↔object relationship lines
- persistent room object cards
- amber object entities on the room radar
- participant inspectors showing current object relationships
- a dedicated Object Evidence Inspector

The Object Evidence Inspector shows detector confidence, persistent object ID, continuity, holder, motion, active relationship, relationship evidence, and a privacy-safe JSON snapshot.

### Current Room State

The Agent-facing room schema is now version 2 and adds:

- `objects[]`
- `interactions[]`
- object provider health
- hand provider health

High-frequency `object.updated` events update Current Room State but are intentionally excluded from the recent semantic event history.

### V1.0 perception events

- `object.detected`
- `object.updated`
- `object.lost`
- `object.reacquired`
- `object.picked_up`
- `object.put_down`
- `interaction.started`
- `interaction.ended`

## V0.9 — Attention, Behavior & Perception Inspector

V0.9 makes Agent Eyes reason about participant behavior and makes every conclusion inspectable.

### Pose + behavior

- preserve named body landmarks on persistent person tracks
- draw live pose skeletons over tracked participants
- estimate standing, sitting, or uncertain posture from hip/knee/ankle geometry
- classify participant movement as stationary, shifting, or moving
- detect left/right/both hand raised from shoulder/wrist geometry
- detect a simple raised-hand wave from repeated wrist direction reversals
- use face yaw/pitch for conservative head orientation
- fall back to shoulder geometry when a face is unavailable
- never treat body shape alone as identity

### Attention + addressing

Agent Eyes now produces approximate attention relationships from head orientation and room position.

- facing Agent/camera
- facing left/right
- likely attention toward another tracked participant
- room-direction attention when no specific target is strong enough
- likely addressing relationship only when several signals agree:
  - participant is speaking
  - attention target is another participant
  - both participants share the same conversation group

These are explicitly probabilistic spatial conclusions, not precise eye-gaze claims.

### Explainable perception

Every participant card now exposes live behavior signals and an **Inspect** action.

The Perception Evidence Inspector shows:

- identity evidence
- body continuity
- Voice Profile readiness
- pose confidence
- head orientation
- posture
- movement
- gesture state
- attention target
- addressing conclusion
- individual landmark confidence
- a privacy-safe JSON evidence snapshot

The inspector does not expose face embeddings or Voice Profile embeddings.

### Perception events

V0.9 adds:

- `behavior.changed`
- `attention.changed`
- `gesture.detected`

Behavior events are gated behind stable participant presence so short detector flicker cannot create phantom Agent events.

### Model grounding

Tracky uses the Human body result's named landmarks and face rotation data. Human exposes body landmarks such as shoulders, wrists, hips, knees and ankles, plus face yaw/pitch rotation. Tracky uses those raw outputs to build conservative higher-level behavior evidence.

## V0.8 — Agent Eyes / Spatial Perception Runtime

V0.8 changes Tracky's primary purpose from a game/tracker prototype into an experimental perception layer for an Agent system.

### Agent Eyes is now the product home

`index.html` is the live Agent Eyes console. It combines:

- multi-person body tracking
- enrolled face recognition
- persistent body identity when faces turn away
- unknown participant tracking
- current/recent participant photos
- Voice Profile speaker recognition
- adaptive room audio and noise rejection
- speaker-attributed transcription
- body-proximity conversation grouping
- a live spatial room map
- participant/entity cards
- active-speaker state
- perception health and sensor status
- normalized event history
- a JSON Current Room State snapshot

### Perception Event Bus

The new `src/perception-core.js` provides a normalized integration boundary between sensors and the future Agent Brain.

Events include:

- `participant.detected`
- `participant.recognized`
- `participant.entered`
- `participant.left`
- `participant.reacquired`
- `face.visible`
- `face.hidden`
- `face.capture_ready`
- `face.matched`
- `body.locked`
- `body.occluded`
- `body.reacquired`
- `voice.activity_started`
- `voice.activity_stopped`
- `voice.matched`
- `conversation.started`
- `conversation.ended`
- `conversation.participant_joined`
- `conversation.participant_left`
- `transcript.turn`
- `sensor.status`
- `room.state_changed`

Every event can carry timestamp, participant ID, body Track ID, confidence, source, normalized room position, nearby participants, conversation group, and evidence.

### Current Room State

The event stream is reduced into one serializable Agent-facing state object containing:

- known participants currently present
- unknown body tracks
- active speaker
- active conversation groups
- recent perception events
- recent transcript turns
- camera/microphone/identity/voice/transcription state
- perception health and warnings

The browser exposes:

```js
window.TrackyAgentEyes.getState()
window.TrackyAgentEyes.subscribe('participant.recognized', handler)
window.TrackyAgentEyes.subscribe('*', handler)
```

Each perception event is also dispatched as a browser `tracky:perception` CustomEvent so another Agent shell can integrate without importing Tracky's internal modules.

### Experiments are preserved

The game and green-object work remain in the repository as sensor/perception experiments:

- `experiments.html` — experiment landing page
- `tracker.html` — original HSV green-object tracker and calibration laboratory
- `vertical-motion.html` — movement/game test harness

They consume the same identity, body, voice, and tracking capabilities but no longer define the main product experience.

### Identity and room behavior

- new body tracks are stabilized before Agent Eyes announces a new participant
- enrolled face matches bind identity to the persistent body track
- face visibility is tracked independently from body presence
- brief body occlusions preserve identity
- stale conversation groups are removed when people separate
- current participant photos are refreshed when a clean recognized face is available
- unknown clean face captures can be sent directly to Participant onboarding

## V0.7 — Codebase Hardening & Release Quality

V0.7 is a full audit/hardening release. It does not change the game concept; it makes the camera, identity, Voice Profile, dialogue, privacy, performance, and release paths safer and more deterministic.

### Identity correctness

- Face matching requires a complete multi-sample profile and a clear margin over the second-best participant
- Face and Voice Profile matching use robust multi-sample similarity instead of trusting one outlier enrollment sample
- Voice Profile matching ignores incomplete profiles
- Voice enrollment rejects samples that are too noisy, contain too little sustained speech, or conflict with the participant's existing Voice Profile
- One participant cannot remain assigned to two live body tracks after reacquisition
- Occluded/stale body positions are excluded from conversation-proximity grouping
- Speech turns capture a room/body snapshot at the time the speech occurred so later movement does not rewrite transcript context

### Audio/runtime hardening

- Room audio uses AudioWorklet as the primary PCM path with ScriptProcessor only as a compatibility fallback
- AudioWorklet PCM messages are batched to reduce cross-thread overhead
- JARVIS spoken acknowledgements temporarily suppress room capture so Tracky does not transcribe itself
- A safety timer releases microphone suppression if browser speech events fail
- In-flight speech analysis is invalidated when audio is stopped or dialogue is cleared
- Browser capability checks fail cleanly when camera, microphone, MediaRecorder, Web Audio, or OfflineAudioContext are unavailable
- WavLM, Whisper, Human, and browser library versions/revisions are pinned in one model configuration module

### Privacy and lifecycle

- Pending face-capture handoffs expire automatically after 24 hours
- Saved dialogue history is bounded to the most recent 500 turns
- Deleting a participant removes their attributed dialogue and scrubs their nearby-participant references
- The game can reload recent locally saved dialogue and provides a Clear saved dialogue control
- Voice Profile recordings remain ephemeral; only speaker embeddings and quality metadata are stored
- Switching participant profiles during voice enrollment cancels and discards the active sample instead of risking cross-profile assignment

### Performance and maintainability

- Camera/tracking canvases are resized only when dimensions actually change rather than reallocating every frame
- The core tracker runtime was expanded from compressed source into maintainable functions
- The calibration polling timer was removed; capture readiness now updates in the render loop
- Runtime DOM updates use safe node construction/textContent instead of dynamic innerHTML

### Release-quality CI

V0.7 adds a repository audit that fails CI for:

- missing deploy/runtime files
- broken relative imports
- missing HTML elements referenced by JavaScript
- duplicate HTML IDs
- external script tags
- unsafe runtime DOM/eval patterns
- obsolete voice-clone terminology
- moving/unpinned model revisions
- missing AudioWorklet/fallback paths
- incomplete V0.7 deploy manifests

The CI gate runs the complete unit suite, JavaScript syntax checks, the repository audit, deploy-ZIP construction, ZIP integrity verification, and SHA-256 generation.

## V0.6 — Voice Profiles + Spatial Dialogue

V0.6 adds participant-specific Voice Profiles and combines them with full-body room tracking for conservative speaker attribution and transcription.

### Voice Profiles

- Each saved participant can capture multiple clean speech samples
- Tracky converts those samples into local WavLM speaker embeddings
- A Voice Profile becomes ready after at least 3 redundant samples and 15 seconds of captured speech
- Enrollment recordings are discarded after processing; Tracky keeps speaker embeddings and sample-quality metadata
- Voice Profile matching is independent from face matching
- Ambiguous matches are rejected when the two best enrolled speakers are too close in confidence
- Voice Profile recognition can be disabled per participant

### Multi-signal room audio

Room audio uses several independent filters and identity signals instead of trusting one detector:

1. browser echo cancellation and microphone noise suppression
2. speech-band high-pass / low-pass filtering
3. adaptive room noise-floor estimation
4. voice activity detection
5. minimum speech-turn duration
6. Voice Profile match confidence
7. face identity when visible
8. persistent body identity when the face is not visible
9. body proximity for conversation grouping
10. transcript confidence gating

Background/noise-only and ambiguous-speaker segments are rejected instead of being assigned to a participant.

### Spatial dialogue + transcription

- Enable room audio from the Vertical Motion game
- Live JARVIS HUD shows mic dB, adaptive noise floor, VAD state, Voice Profile model state, current speaker, match confidence, body lock, and dialogue group
- Participant cards show Voice Profile readiness, recent speaker confirmation, body lock, and conversation group
- Nearby tracked bodies are grouped into dialogue groups such as `G01`
- Unknown tracked bodies can still appear in proximity context using their Track ID
- Accepted speech turns can be transcribed locally with browser Whisper
- Transcript turns record speaker, body track, dialogue group, nearby participants, Voice Profile confidence, signal confidence, and transcript
- Dialogue turns are persisted locally in IndexedDB

### Participant acknowledgement

Tracky now explicitly acknowledges room arrivals:

- a stable unknown body track produces a **New participant tracked** event
- a later face match produces a **Participant recognized** event
- JARVIS room events appear in the transcript HUD
- optional browser speech synthesis can speak these acknowledgements

### Local models

- Speaker identity: `Xenova/wavlm-base-plus-sv`
- English transcription: `Xenova/whisper-tiny.en`
- Both execute in the browser through Transformers.js and are loaded lazily
- Initial model download requires network access; browser caching is enabled

## V0.5 — Full-Body Room Persistence

V0.5 upgrades participant identity from face-only tracking to persistent person/body tracking.

### Persistent room tracking

- Detect multiple full bodies in the camera view
- Bind a recognized face to the corresponding body track
- Keep the participant identity attached when the person turns their face away
- Maintain per-person room Track IDs such as `T001`, `T002`, and `T003`
- Predict short-term motion to reduce ID swaps when participants cross paths
- Use body-box overlap and body-size consistency when associating frames
- Preserve an identified track through brief occlusion for up to about 6 seconds
- Reconnect the participant when the same body track becomes visible again
- Fall back to an estimated body region when a usable face is visible but the body detector misses
- Keep face recognition as the identity authority; body tracking preserves an already-established identity rather than identifying someone from their body alone

### Futuristic room radar

The live game HUD now includes a room map showing the normalized position of every active body track.

- cyan dot: unknown person/body track
- green dot: identified participant
- faded/dashed dot: participant temporarily occluded
- labels show participant name or Track ID
- cards transition between **FACE + BODY LOCK**, **BODY LOCK**, **OCCLUSION MEMORY**, and reacquisition states

### Identity limits

Body tracking preserves identity while a participant remains continuously trackable or is only briefly occluded. If someone leaves the camera view long enough for the body track to expire and later returns with no usable face visible, Tracky does not guess who they are; it waits for a face match before restoring identity.

## V0.4 — Futuristic UI + Participants & Identity

V0.4 adds a local-first participant identity layer and redesigns Tracky as a futuristic room/game HUD.

### Live room identity

- Detect multiple faces in the same camera view
- Upper-right participant cards on the game screen
- Live face-quality and scan-progress states
- Match only against participants explicitly enrolled on the current device
- Unknown people remain unidentified until a participant is created
- Save a fresh current face capture after a successful match
- Display both the saved primary photo and the current capture
- Promote the latest capture to the participant's primary photo
- Reject an incorrect match with **Not this person**
- Send an unknown live capture directly into participant onboarding

### Participant roster and onboarding

- Dedicated `participants.html` contact / participant list
- Create, edit, and delete participant profiles
- Camera-based **Capture / replace primary photo**
- Separate current/latest photo
- 3–5 local face-enrollment samples
- Face descriptors and profile photos stored in browser IndexedDB on the device

### Recognition engine

Tracky uses the browser build of `@vladmandic/human@3.3.6` for face descriptions and full-body detection.

- Inference runs in the browser
- Pretrained model files are loaded from jsDelivr and may be cached by the browser
- Initial model loading requires network access
- Tracky does not query an outside identity database
- Recognition compares current face descriptors only with participants enrolled on this device
- Movement/game tracking remains usable if the identity model cannot load

## V0.3 — Vertical Motion gameplay

- Choose a point goal from 1–50
- Highlight one of three lane sections
- Assign a random 4–10 rep target
- One upward leg followed by one downward leg counts as one repetition
- Clearing the section scores 1 point
- Reaching the selected point goal ends the game
- High-volume micro-movement analytics continue independently

## V0.2 — Games + Vertical Motion

- Games library
- 1 inch × 5 inch vertical lane
- Three equal tracking zones
- High-volume frame-by-frame vertical movement
- Overall and per-zone analytics

## V0.1 — Camera Tracking Core

- Browser webcam capture
- HSV green-object tracking
- Smoothed game cursor
- Tracking telemetry
- Four-point calibration

## Run locally

Camera access requires localhost or HTTPS.

```bash
python -m http.server 8080
```

Open:

- `http://localhost:8080/` for Agent Eyes
- `http://localhost:8080/participants.html` for participant identity/Voice Profiles
- `http://localhost:8080/experiments.html` for tracker/game experiments

## Tests

```bash
npm test
```

No npm install is required for the Tracky application itself.
