# Tracky

Tracky is a local-first experimental perception runtime for Agent systems. The original camera-tracked games remain in the repo as sensor-validation experiments.

## V1.9 — Physical World Recall, Search & Explainability

V1.9 makes the physical-world model directly queryable without sending room state to a cloud model.

The query path is deterministic and local-first:

```text
question
  → intent parse
  → entity / room resolution
  → policy-governed semantic state
  → evidence-backed answer
  → confidence + freshness + uncertainty + provenance
```

### Supported questions

The initial recall engine supports:

- `Where is <entity>?`
- `When did you last see <entity>?`
- `Where has <entity> been?`
- `Who had <object>?`
- `Who is in <room>?`
- `What changed?`
- `Any anomalies?`
- confirmed expected-location questions
- evidence / explanation requests
- physical-world entity search

Structured Agent requests can use the same intents directly.

### No guessing on ambiguity

Entity and room references are resolved against the current world index, spatial memory, and scene graph.

If two objects match `phone` with similar confidence, V1.9 returns an ambiguous result with candidate IDs instead of selecting one arbitrarily.

### Current vs last-known

Recall explicitly distinguishes:

- currently confirmed location
- transitioning location
- last-known location
- unknown location

A stale observation is never phrased as a current physical fact.

### Confirmed expectations only

Queries about where an object "usually" belongs treat V1.5's authority boundary as canonical.

An unreviewed learned candidate is returned only as **unconfirmed evidence**.

Only a confirmed expected-location proposal is presented as an authoritative expected location.

### Custody is not ownership

`Who had the phone?` uses semantic holding/custody history.

The answer explicitly preserves the rule:

```text
possession does not imply ownership
```

V1.9 does not infer ownership from repeated handling.

### World timeline

The query engine can build one semantic timeline from:

- multi-room transitions
- Scene Intelligence changes
- proactive anomaly lifecycle
- entity spatial-memory history

The timeline is bounded, deduplicated, newest-first, and filterable by:

- room
- entity
- time window
- result limit

### Privacy-aware historical recall

V1.9 checks V1.6 room Observation Policy before exposing historical spatial evidence.

If a room has:

```js
allowSpatialMemory: false
```

historical room evidence from that room is excluded from recall/timeline results.

Current already-governed physical state may still be queried where the room policy permits live observation.

### Evidence bundles

Agent Eyes can produce a privacy-safe evidence bundle containing:

- current entity state
- latest semantic history
- confirmed expected location
- scene-graph relationships
- relevant anomaly records
- provenance entries

The query sanitizer removes sensitive/raw fields such as:

- embeddings
- face/voice descriptors
- image data URLs
- raw provider payloads
- audio/sample/frame material

### Agent APIs

V1.9 adds:

```js
TrackyAgentEyes.queryPhysicalWorld(query)
TrackyAgentEyes.getWorldTimeline(options)
TrackyAgentEyes.getWorldEvidence(entityId)
TrackyAgentEyes.getRecentWorldQueries()
TrackyAgentEyes.subscribeWorldQueries(handler)
```

Browser integrations receive:

```text
tracky:world-query
```

and perception events include:

```text
world_query.answered
```

### Query history

Recent queries are stored locally as compact semantic records only:

- query text
- intent
- answer status
- summary
- confidence
- timestamp

Full evidence payloads, images, embeddings, descriptors, and raw sensor data are not persisted in query history.

### Agent Eyes console

The V1.9 console adds:

- Ask Physical World input
- common recall shortcuts
- answer confidence and freshness
- fact rows
- ambiguity candidates
- uncertainty notes
- provenance/source rows
- local recent-query history
- clear-history control

## V1.8 — Proactive Environmental Awareness & Anomaly Verification

V1.8 adds a governed proactive-awareness layer above the existing V1.3–V1.7 physical-world, privacy, spatial-memory, and attention systems.

The core rule is:

```text
observation
  → anomaly candidate
  → persistence / repeated evidence
  → confirmed anomaly
  → Agent attention
  → cleared / acknowledged / dismissed
```

A single frame is not enough to create a proactive alert for ordinary environmental changes.

### Supported anomaly classes

V1.8 currently recognizes:

- `world-contradiction`
- `environment-unrecognized`
- `environment-structural-drift`
- `camera-pose-shift`
- `camera-quality-degraded`
- `expected-location-deviation`
- `expected-object-missing`
- `new-object-presence`

Each type defines:

- minimum observation count
- persistence duration
- clear grace period
- default severity

Critical physical-world contradictions may confirm immediately because they already represent conflicting authoritative state.

### Verification candidates

Before confirmation, anomaly evidence remains in a separate candidate state.

The Agent Eyes console shows:

- candidate type
- observations collected vs required
- persistence progress
- confidence

Candidates disappear if the supporting evidence does not persist.

### Confirmed anomalies

Confirmed anomalies carry:

- stable signature
- type/category
- severity
- confidence
- priority
- room/entity references
- evidence
- first/last seen times
- observation count
- status

They are injected into the V1.7 attention controller as governed attention items.

An anomaly cannot bypass privacy policy or directly enable a sensor/model that policy has disabled.

### Spatial-memory boundary

Expected-location anomaly detection uses **confirmed** V1.5 expected locations only.

Unreviewed learned candidates do not create proactive missing/moved-object alerts.

### Privacy enforcement

Object/location anomaly derivation checks the room observation policy.

If visual or object observation is disabled for the room, object anomalies are suppressed.

Current comparison imagery and long-term semantic storage continue to follow the V1.6 retention/policy layer.

### Environment reasoning

V1.8 keeps separate anomaly classes for:

- unknown environment
- structural environment drift
- camera pose shift
- degraded camera quality

A moved camera is not silently reported as room structure changing.

### Missing vs not visible

Expected-object-missing alerts require V1.4 visibility reasoning.

The system only escalates the condition when an object is last-known/absent **and** should be visible in calibrated camera coverage without an expected occlusion.

### New objects

New-object presence is intentionally low severity and requires repeated persistence in a known environment.

Ordinary brief detector appearances do not become proactive alerts.

### Acknowledge and dismiss

The proactive console supports:

- **Acknowledge** — keep the anomaly active but mark that it has been seen
- **Dismiss 1h** — remove it and suppress the same anomaly signature temporarily

Cleared and dismissed anomalies are retained in bounded semantic history.

### Agent APIs

V1.8 adds:

```js
TrackyAgentEyes.getAnomalyState()
TrackyAgentEyes.getProactiveAwareness()
TrackyAgentEyes.acknowledgeAnomaly(signature)
TrackyAgentEyes.dismissAnomaly(signature, suppressMs)
TrackyAgentEyes.subscribeAnomalies(handler)
```

Browser integrations receive:

```text
tracky:anomaly-state
```

Perception events include:

```text
anomaly.confirmed
anomaly.cleared
anomaly.acknowledged
anomaly.dismissed
proactive_awareness.updated
```

### Local persistence

Only semantic anomaly state/history is persisted locally:

- bounded history
- suppression timers
- aggregate anomaly stats

Live candidates/active conditions are re-derived from current physical-world evidence after restart.

### Relationship to V1.7 attention

V1.8 does not replace the task-conditioned attention controller.

Instead:

```text
physical world
+ confirmed spatial expectations
+ privacy policy
+ anomaly verification
        ↓
proactive anomaly attention items
        ↓
V1.7 attention queue / compute budget
```

This keeps proactive awareness governed by the same attention and privacy architecture as the rest of Agent Eyes.

## V1.8 — Proactive Environmental Awareness & Anomaly Detection

V1.8 turns persistent physical-world deviations into governed Agent attention without treating a single detector result as an anomaly.

### Evidence-gated anomalies

Anomalies move through:

```text
observation
→ candidate
→ persistence / independent evidence checks
→ confirmed anomaly
→ acknowledged / cleared / dismissed
```

Each anomaly type has explicit minimum observations, minimum persistence time, clear grace, severity, and confidence.

Repeated reads of the **same environment comparison** do not count as independent evidence.

### Current anomaly classes

V1.8 can verify:

- physical-world contradictions
- unrecognized environment
- persistent structural environment drift
- persistent camera-pose shift
- persistently degraded camera-view quality
- deviation from a **confirmed** expected object location
- a confirmed expected object missing despite unexpected visibility loss
- a newly appeared object that remains present in a known environment

These are physical-state observations. The system does not infer motive, ownership, suspiciousness, or abnormal human intent.

### Confirmed expectations only

Expected-location anomalies use only V1.5 spatial-memory proposals that were explicitly confirmed.

An unreviewed learned pattern cannot trigger:

> "This object is in the wrong place."

This preserves the authority ladder:

```text
repeated observation
→ learned proposal
→ human confirmation
→ confirmed expectation
→ anomaly comparison
```

### Persistence and independent evidence

Environment comparisons occur much less frequently than camera tracking.

V1.8 assigns evidence IDs to sampled environment evidence so one comparison cannot be reread hundreds of times by the faster scan loop and accidentally satisfy an anomaly threshold.

Continuous object-location evidence may continue accumulating because each live world observation is new physical evidence.

### Privacy boundaries

Anomaly reasoning respects the active room Observation Policy.

If environment comparison is disabled, stale environment-analysis state does not continue generating environment anomalies.

If object observation is disabled, object-location/new-object anomalies are suppressed.

V1.8 operates on the policy-governed world state rather than bypassing V1.6 privacy enforcement.

### Proactive-awareness lifecycle

Confirmed anomalies emit:

- `anomaly.confirmed`
- `anomaly.cleared`
- `anomaly.acknowledged`
- `anomaly.dismissed`
- `proactive_awareness.updated`

Active anomalies are fed into the V1.7 Agent Attention Controller with their semantic category and severity priority.

Clearing or dismissing an anomaly resolves its corresponding attention item.

### Acknowledge vs Dismiss

**Acknowledge** records that the anomaly has been seen but keeps it active while the evidence remains true.

**Dismiss 1h** closes the current anomaly and temporarily suppresses the same signature so persistent unchanged evidence does not immediately reopen it.

If the condition remains after suppression expires, it must satisfy the verification gate again.

### Proactive UI

Agent Eyes exposes three separate views:

- **Persistent anomalies** — confirmed current physical deviations
- **Verification candidates** — evidence still accumulating
- **Awareness history** — cleared/dismissed outcomes

The UI shows severity, confidence, verification progress, observation counts, room/entity context, and acknowledgment state.

### Persistence

Anomaly history, suppression windows, and statistics are stored locally.

Active/candidate conclusions are **not blindly restored after page reload**. Live evidence has to re-establish the condition.

### Agent APIs

V1.8 adds:

```js
TrackyAgentEyes.getAnomalyState()
TrackyAgentEyes.getProactiveAwareness()
TrackyAgentEyes.acknowledgeAnomaly(signature)
TrackyAgentEyes.dismissAnomaly(signature, suppressMs)
TrackyAgentEyes.subscribeAnomalies(handler)
```

Browser integrations also receive:

```text
tracky:anomaly-state
```

`getWorldState()` now includes:

```js
{
  proactiveAwareness
}
```

This gives a future VP3 Agent Brain a clean distinction between:

- raw perception
- semantic world facts
- learned expectations
- current attention priorities
- persistent proactive physical-world anomalies

## V1.7 — Task-Conditioned Perception & Agent Attention Controller

V1.7 adds a governed attention layer above Tracky's existing perception/world stack.

The controller changes **what deserves attention and how much compute perception receives**. It does not create a second perception pipeline and cannot override V1.6 privacy policy, participant identity authority, or evidence confidence rules.

### Task modes

Agent Eyes supports explicit perception tasks:

- `general` — balanced room awareness
- `find-object` — prioritize target objects and learned expected locations
- `follow-participant` — prioritize participant continuity and reacquisition
- `conversation` — prioritize participant/speaker/conversation evidence
- `environment-watch` — prioritize environment drift and structural changes
- `mapping` — prioritize room/environment mapping work
- `low-power` — reduce perception cadence while preserving privacy and high-severity world evidence

Tasks may include a target entity/label, room hint, expiry, and optional sticky persistence.

A task never auto-enables a disabled camera, microphone, identity capability, transcription, retention, or spatial-memory permission.

### Adaptive perception budget

The active task and recent meaningful activity produce a current budget containing:

- main-camera scan interval
- secondary-camera scan interval
- environment comparison interval
- intensity level
- privacy-derived capability caps

General Awareness automatically backs off after periods without meaningful changes and wakes again when meaningful events occur.

Secondary camera cadence can be changed in-place without restarting the camera.

### Privacy remains the hard ceiling

The attention controller computes capability caps from the room's Observation Policy.

For example, a Conversation task in a room where audio/transcription is disabled creates a high-priority **policy-limited task** item instead of turning audio on.

Likewise, a Find Object task cannot re-enable object observation in a room where object observation is disabled.

### Task-derived attention

Tasks can add contextual queue items without changing the underlying evidence.

Examples:

- Find Object → target found, or search its learned expected location first
- Follow Participant → participant continuity requires reacquisition
- Conversation → room audio unavailable or blocked by policy
- Environment Watch → meaningful environment-state drift
- Mapping → room mapping proposal needed

### Agent attention queue

World attention and task-derived attention are merged into one deduplicated queue.

Each item carries:

- semantic type/category
- original evidence priority
- task-conditioned priority
- summary/context
- lifecycle state
- timestamps/expiry

Users or future Agent workflows can Resolve or Dismiss items.

Contradictions and privacy restrictions remain high-priority regardless of the active task.

### Meaningful-activity wake-up

Events such as participant entry/recognition, object pickup, room transition, conversation start, environment change, visibility change, privacy-policy change, spatial-memory proposals, and camera handoff reset the inactivity clock.

This lets Tracky spend less compute when a room is stable while responding faster when something meaningful changes.

### Persistence

Attention history is stored locally.

Only tasks explicitly marked **Persist task across reload** are restored after page reload. Ordinary active tasks return to General Awareness.

Pending queue items are not blindly restored because their evidence may already be stale.

### Agent APIs

V1.7 adds:

```js
TrackyAgentEyes.getAttentionState()
TrackyAgentEyes.getActiveTask()
TrackyAgentEyes.getPerceptionBudget()

TrackyAgentEyes.setTask(task)
TrackyAgentEyes.clearTask()

TrackyAgentEyes.resolveAttention(key)
TrackyAgentEyes.dismissAttention(key)
TrackyAgentEyes.subscribeAttention(handler)
```

Attention state is also dispatched through:

```text
tracky:attention-state
```

New perception events:

- `task.started`
- `task.cleared`
- `attention.updated`
- `attention.resolved`
- `perception.budget_changed`

### Current World State

`getWorldState()` now also exposes:

```js
{
  attentionController,
  perceptionBudget
}
```

This gives a future VP3 Agent Brain access to both **what Tracky currently knows** and **what Tracky is intentionally paying attention to**.

## V1.6 — Privacy Zones & Observation Policy

V1.6 turns the privacy/retention defaults introduced in V1.3 into an enforceable room-scoped observation policy.

The policy boundary is applied before information reaches downstream Agent state:

```text
camera / microphone
  → observation policy
  → permitted or sanitized perception
  → fusion / Current World State
  → persistence / learned memory
```

### Room observation policy

Each room can independently allow or disable:

- visual observation
- enrolled participant identity
- anonymous body tracking
- object observation
- behavior analysis
- environment comparison
- room audio
- Voice Profile matching
- live transcription
- transcript storage
- learned spatial memory
- Primary Environment image retention
- Alternate Environment image retention

Live transcription and transcript storage are separate permissions. A room can therefore use speech transiently without retaining transcript turns.

Voice Profile matching is also independent from room audio. Audio may remain available for live voice activity without speaker identity.

### Sensitive regions

Rooms can define normalized rectangular privacy regions that are visible on both the live camera view and room radar.

Each region supports one of three modes:

- `ignore` — observations inside the region are suppressed
- `anonymous` — presence can remain visible, but participant identity is removed
- `live-only` — live state may be used, but retention and learned spatial memory are blocked

Regions apply to participants, objects, behavior, voice/transcript context, environment capture, and spatial memory by default.

### Enforcement before fusion

Privacy is not a display-only filter.

Primary and secondary camera observations are filtered before they enter room fusion.

When visual observation is disabled for a room:

- the active camera stream may remain available to the browser UI
- Tracky stops visual inference for that room
- configured secondary cameras for that room do not start perception scans
- stale room/fusion entities are purged when the policy changes

When participant identity is disabled:

- enrolled profiles are not supplied to secondary-camera face matching
- primary face identity resolution is disabled
- participant events that still contain identity context are anonymized before entering Current Room State

Anonymous body tracking can remain enabled without personal identity.

### Event policy boundary

Perception events pass through the room observation policy before the Perception Event Bus.

Suppressed private events therefore do not reach:

- Current Room State
- the recent semantic event feed
- browser `tracky:perception` listeners

Tracky intentionally does not emit a per-observation “privacy suppression” event because that could itself reveal that a private person or object was present.

The aggregate UI may show counts of suppressed/anonymized events without exposing what was suppressed.

### Transcript and audio privacy

Room audio is refused entirely when its room policy disables audio.

When audio is enabled:

- Voice Profile embeddings/matching run only if Voice Profile matching is allowed
- Whisper transcription runs only if live transcription is allowed
- accepted transcript turns are written to IndexedDB only if transcript storage is allowed
- `live-only` regions prohibit transcript retention
- anonymized regions strip participant identity before a transcript event can be saved

### Environment image masking

Sensitive regions are masked before environment image data is fingerprinted.

The capture pipeline is:

```text
camera frame
  → black privacy masks
  → imageData
  → environment fingerprint
  → optional retained image
```

This prevents masked pixels from entering either the saved reference image or its visual fingerprint.

Primary, Alternate, comparison, and change-evidence image retention remain independently governed.

### Learned-memory privacy

V1.5 spatial learning now receives only policy-permitted semantic state.

Participants, objects, relationships, and room transitions blocked from retention are removed before the spatial-memory learner sees them.

A `live-only` region can therefore participate in live perception without teaching an expected object location or participant circulation pattern.

### Policy changes

Applying a stricter active-room policy immediately clears stale live/fusion state for that room so facts observed under the previous policy do not remain visible as current state.

Confirmed physical facts intentionally taught by the user are not silently deleted by privacy-policy changes; the observation policy governs sensing and retention, not the user’s explicit knowledge declarations.

### Agent API

V1.6 adds:

```js
TrackyAgentEyes.getObservationPolicy(roomId)
TrackyAgentEyes.setObservationPolicy(policy)
TrackyAgentEyes.getPrivacyStats()
```

Current World State also includes:

```js
{
  observationPolicies,
  privacyStats
}
```

Policy changes produce:

```text
privacy.policy_changed
```

The Current Room State snapshot carries a privacy summary so an Agent can distinguish unavailable evidence from evidence that is intentionally disallowed.

## V1.5 — Spatial Memory & Learned Physical Knowledge

V1.5 adds a conservative learning layer above the V1.4 multi-room world.

The goal is not to make observations magically become truth. The learning pipeline is:

```text
observation
  → repeated evidence
  → learned proposal
  → explicit review
  → confirmed physical knowledge
```

### Semantic spatial memory

Tracky now keeps bounded semantic history for world entities without storing continuous video.

For an object or participant, history can record:

- room
- nearest stable landmark
- holder when relevant
- confidence
- normalized position
- semantic event
- timestamp
- source

Repeated identical states are compressed into semantic journeys rather than exposed as frame-by-frame telemetry.

### Expected locations

Confirmed, unheld objects can accumulate evidence for where they are normally observed.

Evidence is tied to:

- room
- nearest stable landmark when available
- observation count
- distinct perception sessions
- average confidence
- first/last observation time

A candidate expected location requires at least several observations across several independent sessions before a proposal can exist.

Held objects do **not** train a home location.

An observed candidate and an authoritative expected location are different things:

- `getExpectedLocationEvidence(entityId)` returns the strongest learned candidate evidence
- `getExpectedLocation(entityId)` returns only a user-confirmed learned expectation

### Learned relationships

Stable scene-graph relationships may accumulate evidence across sessions and become proposals.

The learning engine explicitly refuses to learn ownership from passive observation.

Relationships such as:

- `owned-by`
- `belongs-to`

are never promoted from repeated visual evidence.

Ephemeral spatial relationships such as `near`, `left-of`, or `right-of` are also excluded from durable relationship learning.

### Circulation patterns

Verified participant room transitions can build evidence for recurring movement paths.

Example:

```text
Office → Hallway
6 observed transitions
3 independent sessions
```

This becomes an observational `circulation-pattern` proposal only.

It does not claim intent and it does not create or alter physical room topology.

### Proposal governance

Learned knowledge appears in a Review Required panel.

Each proposal may be:

- Confirmed
- Ignored

Confirmed expected-location/stable-relationship proposals may become user-confirmed scene-graph facts when their entities are present in the active graph.

Ignored proposals are remembered so the same learned suggestion is not immediately recreated.

### User authority

V1.5 preserves the V1.3 authority hierarchy:

```text
user-confirmed fact
  > confirmed learned proposal
  > repeated learned evidence
  > inferred relationship
  > single observation
```

Clearing learned spatial memory removes learned evidence, journeys, recurring-route evidence, and unconfirmed proposals.

It does not erase already user-confirmed physical scene-graph facts.

### Entity journeys

Agent Eyes exposes compressed semantic journeys such as:

```text
phone
Office · Desk
  → Dave holding
  → Kitchen · Counter
```

This is intended to answer questions such as:

- Where has this object been?
- Where was it last observed?
- Who was holding it?
- Which room/landmark was it associated with?

without replaying raw sensor history.

### Local persistence

Spatial memory is stored in a separate local IndexedDB database.

The memory state contains:

- bounded entity histories
- expected-location evidence
- stable-relationship evidence
- circulation evidence
- proposals
- ignored proposal keys

Learning evidence is time-gated so high-frequency camera/model refreshes cannot inflate confidence.

### Agent API

V1.5 adds:

```js
TrackyAgentEyes.getSpatialMemory()
TrackyAgentEyes.getExpectedLocation(entityId)
TrackyAgentEyes.getExpectedLocationEvidence(entityId)
TrackyAgentEyes.getEntityHistory(entityId, limit)
TrackyAgentEyes.getEntityJourney(entityId, limit)
TrackyAgentEyes.subscribeSpatialMemory(handler)
TrackyAgentEyes.confirmMemoryProposal(key)
TrackyAgentEyes.ignoreMemoryProposal(key)
```

Spatial memory updates are also dispatched as:

```text
tracky:spatial-memory
```

Proposal lifecycle events include:

- `spatial_memory.proposed`
- `spatial_memory.confirmed`
- `spatial_memory.ignored`

## V1.4 — Multi-Room World & Cross-Room Continuity

V1.4 moves Agent Eyes above a single-room model and maintains a coherent physical world across multiple mapped rooms.

### Room-partitioned camera fusion

Every enabled camera now continues to belong to exactly one room. Camera observations are fused only with other cameras from the same room, producing independent room-level fusion states.

The main Agent Eyes room remains the active local UI, while secondary cameras in other configured rooms may continue contributing to their own room models.

This prevents unrelated room coordinate systems from ever being averaged together.

### Global room topology

Saved environment rooms now form a world topology graph.

Rooms may be explicitly connected through user-confirmed portals such as:

- doorway
- opening
- hallway
- stairs
- elevator
- passage

Connections are bidirectional only when both room-side portal records agree.

Agent Eyes includes a global room map and a topology editor for confirming or removing physical room connections.

### Topology learning proposals

Repeated face-confirmed reappearances between rooms that are not yet connected may create a topology **proposal**.

A proposal records:

- source room
- destination room
- observation count
- confidence
- whether enough evidence exists to request confirmation

Tracky never silently promotes a proposal into physical topology. A person still has to confirm the connection.

### Cross-room participant continuity

Known participants retain continuity across rooms only when identity evidence and physical-world evidence support it.

Presence states include:

- `confirmed`
- `transitioning`
- `last-known`
- `uncertain`
- `absent`

For a nearby confirmed room transition, Agent Eyes emits:

- `participant.room_exit`
- `participant.room_transition`
- `participant.room_enter`
- `portal.crossing` when a confirmed portal is known

If the same enrolled participant appears in two different rooms at the same time, location becomes `uncertain` instead of accepting two simultaneous locations.

Anonymous body geometry does not establish cross-room identity.

### Cross-room object continuity

Objects may keep a canonical world identity across room-local object IDs when strong supporting evidence exists.

The strongest current continuity path is:

```text
known participant transition
+ confirmed holding/custody
+ compatible object label
+ bounded transition time
= cross-room object continuity
```

Room-local object aliases are persisted inside the world runtime so an object does not duplicate again on the next scan after a successful handoff.

Object transitions can emit:

- `object.room_exit`
- `object.room_transition`
- `object.room_enter`

### Room-scoped conversations

Conversation groups are keyed by room, preventing one room's spatial dialogue group from colliding with another.

The main microphone remains tied to the active room unless additional room audio providers are added later.

### Visibility reasoning

V1.4 distinguishes:

- `visible`
- `expected-occlusion`
- `missing-unexpected`
- `outside-coverage`
- `no-online-camera`
- `unknown-position`

Camera calibration polygons determine whether an entity should be visible.

Large stable furniture such as desks, tables, couches, beds, and shelving can contribute conservative expected-occlusion evidence in the active room.

A missing detection inside calibrated coverage is therefore different from an entity simply being outside all camera coverage.

### Global physical-world UI

The Agent Eyes console now includes a global room/topology view with:

- all known rooms
- confirmed room connections
- active/main room
- room occupancy
- world objects
- uncertainty count
- room-scoped conversations
- recent cross-room transitions
- room drill-down
- per-room visibility state

### Agent APIs

V1.4 adds:

```js
TrackyAgentEyes.getRooms()
TrackyAgentEyes.getRoomState(roomId)
TrackyAgentEyes.getParticipantLocation(participantId)
TrackyAgentEyes.getObjectLocation(objectId)
TrackyAgentEyes.getWorldTopology()
TrackyAgentEyes.getMultiRoomWorld()
TrackyAgentEyes.subscribeRoom(roomId, handler)
```

The complete `getWorldState()` also carries:

```js
{
  room,
  scene,
  cameraFusion,
  environment,
  sceneGraph,
  physicalWorld,
  topology,
  multiRoom
}
```

Browser integrations receive:

```text
tracky:room-state
tracky:multi-room-world
```

### Continuity boundaries

V1.4 deliberately keeps several conservative rules:

- face / Voice Profile remain identity authorities
- topology suggestions never self-confirm
- anonymous body tracks do not gain cross-room identity
- unrelated room coordinates are never fused
- simultaneous incompatible room claims become uncertainty
- object handoff requires strong supporting evidence
- camera absence is interpreted through coverage/occlusion evidence before becoming a location conclusion

## V1.3 — Environment Baselines, Assisted Mapping & Physical World State

V1.3 gives Agent Eyes a persistent understanding of **where the camera is, what the environment normally looks like, what changed, and which physical facts are currently trustworthy**.

### Primary + Current Environment

Each room can save a local **Primary Environment** reference photo plus alternate view photos.

When Agent Eyes engages it automatically captures a short burst, selects the highest-quality frame, and keeps that frame as the **Current Environment** comparison. Current comparison images are ephemeral by default.

Saving or replacing a Primary Environment remains an explicit user action.

A saved view contains:

- room ID and room name
- view ID/name and primary/alternate role
- reference photo
- visual environment fingerprint
- baseline quality score
- camera ID and calibration
- floor proposal
- stable landmarks
- accepted zones
- portal candidates
- version number

### Environment recognition

Current Environment is compared with saved views using independent evidence:

- lighting-normalized visual fingerprint similarity
- stable landmark layout
- camera identity
- floor/calibration evidence

The runtime classifies the result as:

- `known-view`
- `known-room-new-view`
- `uncertain`
- `unknown`

A different chair position, person, cup, or laptop does not automatically create a new room because temporary landmarks carry little or no room-identity weight.

### Camera movement vs room change

Landmark displacement is analyzed for coherent movement.

If several stable landmarks shift together in the same direction, Agent Eyes can classify the observation as likely **camera pose drift** rather than claiming the room structure changed.

Environment state therefore exposes separate signals for:

- structural drift
- visual drift
- environment-state drift
- camera-pose drift
- coherent camera-shift evidence

### Baseline quality

Reference capture scores:

- exposure/brightness
- contrast
- sharpness/edge detail
- obstruction level
- useful landmark coverage

The Primary/Current panel shows baseline quality before a reference is promoted.

### Assisted room mapping

**Scan / Map Environment** analyzes the current environment plus fused world objects and proposes:

- visible floor region
- stable landmarks
- semantic zones
- portal candidates
- mapping confidence

Current V1.3 floor inference is deliberately conservative: Human object detections plus a visual floor heuristic propose the map, and the user confirms it.

The mapping-provider contract is separate from the world schema so a future local structural segmentation/depth provider can replace the heuristic without changing stored room facts.

### Physical scene graph

The canonical physical representation is now a provenance-aware graph.

Example:

```text
ROOM01 Office
  contains → L001 Desk
  has-portal → PORTAL-L004

PERSON:p1 Dave
  located-in → ROOM01
  near → L001

WO014 phone
  located-in → ROOM01
```

Nodes and relationships can be:

- `observed`
- `inferred`
- `last-known`
- `user-confirmed`
- `contradicted`
- `expired`

Each fact carries confidence, timestamps, and provenance.

### User-confirmed physical teaching

User-confirmed knowledge outranks detector inference and cannot be silently downgraded by later vision observations.

Agent APIs include:

```js
TrackyAgentEyes.teachPhysicalEntity(...)
TrackyAgentEyes.teachPhysicalRelationship(...)
TrackyAgentEyes.teachAtPoint(...)
TrackyAgentEyes.getPhysicalFacts(entityId)
```

The point-teaching hook finds the nearest visible scene-graph entity, providing the foundation for future gesture + voice workflows such as:

> "That's my desk."

### Physical World State Manager

Above the scene graph, V1.3 adds an authoritative World State Manager.

It handles:

- confidence decay over time
- different staleness rates for people, phones, laptops, furniture, etc.
- evidence quorum helpers
- contradiction detection
- environment uncertainty
- camera displacement
- structural drift
- world-attention prioritization

For example, a phone's location becomes stale quickly while a user-confirmed desk location remains durable.

### Contradictions

The system explicitly detects impossible physical claims instead of silently accepting them.

Example:

```text
PERSON:p1 located-in ROOM01
PERSON:p1 located-in ROOM02
```

becomes conflicting evidence and the relevant facts are downgraded until resolved.

### Physical attention

The World State Manager prioritizes meaningful issues such as:

- unknown environment
- uncertain environment match
- camera pose shift
- structural environment drift
- contradiction
- participant arrival
- important object movement

This forms the future boundary between perception and Agent cognition.

### Privacy + retention architecture

Environment storage includes room-scoped policy defaults.

By default:

- Primary reference images may be retained locally
- Alternate reference images may be retained locally
- Current comparison frames are ephemeral
- change-evidence images are not retained automatically
- screen-content analysis defaults off
- sensitive-region masks are represented in policy
- transcript/identity permissions remain separate

### Environment history

Semantic environment comparisons are stored with bounded history.

History may contain:

- matched room/view
- match confidence
- drift evidence
- semantic changes

The comparison image itself is not retained unless policy explicitly allows it.

### Replay + simulation

V1.3 adds deterministic sanitized observation replay and physical-world scenario simulation.

Built-in test scenarios include:

- camera shift
- environment change
- object transfer

This allows newer mapping/world algorithms to be regression-tested without storing or replaying raw continuous video.

### Agent APIs

V1.3 extends the Agent surface with:

```js
TrackyAgentEyes.getEnvironmentState()
TrackyAgentEyes.getSceneGraph()
TrackyAgentEyes.getPhysicalWorldState()
TrackyAgentEyes.subscribeWorld(handler)
TrackyAgentEyes.refreshEnvironment()
```

`getWorldState()` now combines:

```js
{
  room,
  scene,
  cameraFusion,
  environment,
  sceneGraph,
  physicalWorld
}
```

Physical world updates are also emitted through:

```text
tracky:world-state
```

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
