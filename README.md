# Tracky

Tracky turns real-world movement into browser-game input.

## V0.4 — Futuristic UI + Participants & Identity

V0.4 adds a local-first participant identity layer and redesigns Tracky as a futuristic room/game HUD.

### Live room identity

- Detect multiple faces in the same camera view
- Maintain short-lived room Track IDs such as `T001`, `T002`, and `T003`
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
- Name, nickname, notes, recognition-enabled setting
- Camera-based **Capture / replace primary photo**
- Separate current/latest photo
- 3–5 local face-enrollment samples
- Import a pending live-room capture as the first onboarding photo/sample
- Face descriptors and profile photos stored in browser IndexedDB on the device

### Face recognition engine

Tracky uses the browser build of `@vladmandic/human@3.3.6` for multi-face detection and face descriptors.

- Recognition inference runs in the browser
- Pretrained model files are loaded from jsDelivr and may be cached by the browser
- Initial face-model loading therefore requires network access
- Tracky does not query an outside identity database
- Recognition compares current face descriptors only with Tracky participants enrolled on this device
- The movement/game tracker remains usable if the identity model cannot load

## V0.3 — Vertical Motion gameplay

- Choose a point goal from 1–50 before starting
- One of the three lane sections is highlighted as the active target
- Every active section receives a random rep target from 4–10
- One complete upward leg followed by one downward leg counts as one repetition
- Gameplay reps only count while the tracked object remains inside the highlighted section
- Completed reps count the displayed number down toward zero
- Clearing the section scores 1 point
- The next round moves to a different section and receives a new 4–10 rep target
- Reaching the selected point goal ends the game
- Raw high-volume micro-movement analytics continue independently of gameplay

## V0.2 — Games + Vertical Motion

- Games library at `games.html`
- 1 inch × 5 inch vertical movement lane
- Lane centered horizontally and positioned slightly below vertical center
- Cursor constrained inside the lane
- Lane split into three equal tracking zones
- High-volume frame-by-frame vertical movement capture
- Overall and per-zone up/down travel
- Micro-movement events and micro travel
- Direction reversals and micro reversals
- Oscillation rate
- Dwell time per zone
- Recent raw micro-movement trace
- Adjustable micro-movement noise floor
- Display smoothing kept separate from raw analytics

The lane uses CSS physical units. Actual physical inches depend on browser/OS display scaling and monitor calibration.

## V0.1 — Camera Tracking Core

- Browser webcam capture with camera switching
- HSV-based green object detection
- Largest connected-object selection
- Adjustable color thresholds
- Mirrored tracking mode
- Smoothed X/Y cursor output
- Velocity, speed, confidence, and FPS telemetry
- Four-point perspective calibration
- No server-side camera processing

## Run locally

Camera access requires a secure context. `localhost` qualifies.

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
