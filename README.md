# Tracky

Tracky turns real-world movement into browser-game input.

## V0.3 — Vertical Motion gameplay

V0.3 turns the Vertical Motion tracker into a playable scoring game.

- Choose a point goal from 1–50 before starting
- Start Game can request the camera automatically
- One of the three lane sections is highlighted as the active target
- Every active section receives a random rep target from 4–10
- One complete upward leg followed by one downward leg counts as one repetition
- Gameplay reps only count while the tracked object remains inside the highlighted section
- Completed reps count the displayed number down toward zero
- Clearing the section scores 1 point
- The next round moves to a different section and receives a new 4–10 rep target
- Reaching the selected point goal ends the game
- Gameplay rep detection uses a larger excursion threshold than analytics so camera jitter cannot generate points
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
- Largest connected-object selection to reject small green noise
- Adjustable hue, saturation, brightness, and minimum-area thresholds
- Mirrored tracking mode
- Smoothed X/Y cursor output
- Velocity, speed, confidence, and FPS telemetry
- Lost-object behavior
- Four-point perspective calibration
- No server-side image processing; frames stay in the browser

## Run locally

Camera access requires a secure context. `localhost` qualifies.

```bash
python -m http.server 8080
```

Open `http://localhost:8080/games.html` and choose **Vertical Motion**.

## Tests

```bash
npm test
```

No npm dependencies are required.
