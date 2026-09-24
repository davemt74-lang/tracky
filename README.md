# Tracky

Tracky turns real-world movement into browser-game input. **V0.1 — Camera Tracking Core** uses a webcam to detect a green object and maps its position to an on-screen cursor.

## V0.1 features

- Browser webcam capture with camera switching
- HSV-based green object detection
- Largest connected-object selection to reject small green noise
- Adjustable hue, saturation, brightness, and minimum-area thresholds
- Mirrored tracking mode
- Smoothed X/Y cursor output
- Velocity, speed, confidence, and FPS telemetry
- Lost-object behavior: hide, hold, or ease toward center
- Debug bounding box and center marker
- Four-point perspective calibration for mapping a physical play area to the full game surface
- No server-side image processing; frames stay in the browser

## Run locally

Camera access requires a secure context. `localhost` qualifies.

### Python

```bash
python -m http.server 8080
```

Open `http://localhost:8080` and click **Start camera**.

### Node tests

```bash
npm test
```

No npm dependencies are required.

## Tracking pipeline

```text
Camera -> HSV green filter -> largest connected blob -> normalized X/Y
       -> optional four-point calibration -> smoothing -> game cursor
```

## Calibration

1. Start the camera and make sure the green object is detected.
2. Click **Start calibration**.
3. Hold the object at the physical play area's top-left corner and click **Capture point**.
4. Repeat for top-right, bottom-right, and bottom-left.
5. Tracky computes a projective transform so that quadrilateral maps to the full game surface.

## Browser support

Use a modern Chromium, Firefox, or Safari browser with `getUserMedia`, Canvas 2D, and ES module support.

## Next milestone

V0.2 can build the first actual game on top of the normalized tracking API while keeping the input layer hardware-agnostic.
