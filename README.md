# 🐒 Silly Monkey Meme Detector

A real-time pose detection web app that matches your facial expressions and hand gestures to the equivalent Gibraltar monkey meme. Strike a pose, hold it for a second, and get snapped side-by-side with your monkey twin.

[TRY IT YOURSELF!](https://yanisa-monkeymeme.netlify.app)

![Monkey Meme Detector](demo-screenshot.png)

## 🌟 Features

### Core Functionality
- **Real-time Pose Detection** — Uses MediaPipe Holistic to track face landmarks and hand landmarks simultaneously at 30+ fps
- **5 Detectable Poses** — Each mapped to a specific monkey meme with a matching facial expression or hand gesture
- **Hold-to-Snap** — A pose must be held for 1.2 seconds before a photo is taken, reducing accidental captures
- **Guided Calibration Screen** — A step-by-step startup flow that waits until the model loads, your face is detected, and both hands are visible before starting
- **Live Feedback** — Hint pills highlight when a pose is active or when a sub-condition isn't met (e.g. "open-mouth smile for this one!")
- **Photo Popup** — Displays your snapshot side-by-side with the matching monkey meme
- **Save Image** — Composites both photos onto a single canvas and downloads as a PNG

### Design Features
- **Jungle-themed UI** — Deep green and banana yellow palette with Bangers display font
- **Skeleton overlay** — Face mesh contours and hand joint connections drawn live on a canvas layered over the video feed
- **Fully responsive** — Scales cleanly from mobile to desktop using `clamp()`, `min()`, and aspect-ratio constraints
- **Pose hint pills** — Five always-visible hint cards that pulse active (yellow) or warn (red) in real time

## 🛠️ Tech Stack
- **HTML5 / CSS3 / Vanilla JavaScript** — No frameworks, no build step
- **MediaPipe Holistic** — Google's on-device ML pipeline for simultaneous face mesh + hand landmark detection
- **MediaPipe Camera Utils / Drawing Utils** — Frame capture loop and skeleton rendering helpers
- **Canvas API** — Live overlay drawing, snapshot capture (with mirror correction), and save-image compositing
- **Google Fonts** — Bangers (display) + Comic Neue (body)

## 🚀 Deployment

This app is deployed on Netlify. See it [here](https://yanisa-monkeymeme.netlify.app).

No build step or server required — open `monkey.html` directly in a browser (camera permission required).

## 📁 File Structure

```
/
├── index.html          # Markup: calibration screen, hint pills, video, popup
├── monkey.css           # All styles: layout, animations, popup, responsive
├── monkey.js            # All logic: detection, calibration, snapshot, save
└── monkey-images/
    ├── thinking.jpg     # Finger on lip/chin
    ├── wink.jpg         # Finger on lip/chin + winking
    ├── idea.jpeg        # Pointer finger up + open-mouth smile
    ├── surprised.jpeg   # Hands clasped at chest + mouth open
    └── heart-touch.jpeg # Hands clasped at chest + closed-mouth smile
```

## 🎭 Poses & Detection Logic

Each pose is resolved by `detectPose()` in `monkey.js`, which runs on every frame returned by MediaPipe Holistic. Poses are checked in priority order, and a pose must be confirmed for `HOLD_TIME = 1200ms` before `takeSnapshot()` is called.

| Pose | Monkey | Hand Condition | Face Condition |
|------|--------|----------------|----------------|
| `thinking` | `thinking.jpg` | Exactly 1 hand — fingertip or thumb within 18% of face height from lip centre | No wink |
| `wink` | `wink.jpg` | Exactly 1 hand touching lip (same as above) | One eye ≥ 45% more closed than the other |
| `idea` | `idea.jpeg` | Exactly 1 hand — index finger extended up, other fingers curled, near face | Open-mouth smile (wide mouth ratio > 2.2 AND mouth height > 6% of face height) |
| `surprised` | `surprised.jpeg` | Both hands with wrists close together (< 30% of frame width) at chest level | Mouth open (> 7% of face height), not smiling |
| `hearttouch` | `heart-touch.jpeg` | Both hands clasped at chest (same as above) | Closed-mouth smile (mouth width/height ratio > 3.2) |

### Face Landmark Indices Used

MediaPipe's 468-point face mesh is used to derive all facial features:

| Feature | Landmarks |
|---------|-----------|
| Lip centre | `[13]` (upper), `[14]` (lower) — averaged |
| Mouth width | `[61]` (left corner), `[291]` (right corner) |
| Face height | `[10]` (forehead top) → `[152]` (chin bottom) |
| Nose tip | `[1]` |
| Right eye | Top lid `[159]`, bottom lid `[145]` |
| Left eye | Top lid `[386]`, bottom lid `[374]` |

### Hand Landmark Indices Used

MediaPipe's 21-point hand skeleton is used for gesture detection:

| Landmark | Index |
|----------|-------|
| Wrist | `[0]` |
| Index fingertip | `[8]` |
| Index PIP / MCP | `[6]` / `[5]` |
| Middle / Ring / Pinky tips | `[12]` / `[16]` / `[20]` |
| Thumb tip | `[4]` |

### Wink Detection

```js
function isWinking(face) {
  const rightOpen = dist(face[159], face[145]); // right eye vertical span
  const leftOpen  = dist(face[386], face[374]); // left eye vertical span
  const diff = Math.abs(rightOpen - leftOpen);
  const avg  = (rightOpen + leftOpen) / 2;
  return diff / avg > 0.45 && avg > 0.005;
}
```

One eye must be at least 45% more closed than the other for a wink to register. The `avg > 0.005` guard prevents false positives when the face is very small in frame.

### Pointer-Up Detection

```js
function isPointerUp(hand) {
  const tip  = hand[8], pip = hand[6], mcp = hand[5], wrist = hand[0];
  const midT = hand[12], ringT = hand[16], pinkyT = hand[20];
  const fh   = dist(face_cached[10], face_cached[152]);
  return (
    tip.y < pip.y && tip.y < mcp.y &&   // index extended
    midT.y  > hand[10].y &&              // middle curled
    ringT.y > hand[14].y &&              // ring curled
    pinkyT.y > hand[18].y &&             // pinky curled
    tip.y < wrist.y - fh * 0.12         // pointing sufficiently upward
  );
}
```

All coordinates are normalised (0–1) by MediaPipe, so distance comparisons are scale-invariant and work at any camera distance.

## 🎬 Calibration Flow

On page load, a calibration screen walks the user through three sequential steps before detection begins:

1. **AI models loading** — MediaPipe Holistic downloads and initialises its WASM + model files (~10–15 MB)
2. **Face detection** — `faceDetected` flips to `true` on the first frame where `results.faceLandmarks` is present
3. **Hand detection** — `handsDetected` flips to `true` when both `rightHandLandmarks` and `leftHandLandmarks` are present simultaneously

A CSS progress bar and instruction text update at each step. Once all three pass, the screen fades out and the main UI becomes interactive.

## 📸 Snapshot & Save

When a pose is confirmed, `takeSnapshot()`:
1. Draws the current video frame onto a hidden `<canvas>` with a horizontal flip applied (`ctx.scale(-1, 1)`) to un-mirror the selfie view
2. Copies the result to the `#userPhoto` canvas in the popup
3. Sets `#monkeyPhoto` src to the matching image file
4. Shows the popup

When the save button is clicked, `saveImage()` composites both images onto a new off-screen canvas (user photo | arrow + text | monkey photo) and triggers a download as `is-this-u.png`.

## 📱 Usage

1. **Allow camera access** when the browser prompts
2. **Wait for calibration** — look at the camera, then raise both hands
3. **Strike a pose** — match any of the five gestures shown in the hint pills
4. **Hold it** — keep the pose steady for ~1 second until the snap triggers
5. **View your match** — see yourself next to your monkey twin in the popup
6. **Save or close** — download the side-by-side image or dismiss and go again

## 👩‍💻 Author

**Yanisa Srisa-ard**
- Portfolio: [yanisa.netlify.app](https://yanisa.netlify.app)
- GitHub: [@yanisasri](https://github.com/yanisasri)
- LinkedIn: [linkedin.com/in/yanisa](https://linkedin.com/in/yanisa)

## 🙏 Acknowledgments

- Pose detection powered by [MediaPipe Holistic](https://developers.google.com/mediapipe/solutions/vision/holistic_landmarker) (Google)
- Monkey meme images sourced from the internet — Gibraltar Barbary macaque, a true icon
- Inspired by the very serious question: *is this u?*