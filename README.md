# Tracky

Tracky turns real-world movement into browser-game input.

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

- `http://localhost:8080/games.html` for games
- `http://localhost:8080/participants.html` for participant onboarding

## Tests

```bash
npm test
```

No npm install is required for the Tracky application itself.
