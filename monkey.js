// ── Pose config ───────────────────────────────────────────────────────
const POSES = {
  surprised: {
    img:     "monkey-images/surprised.jpeg",
    title:   "is this u?",
    caption: "why so shocked?",
    hint:    "Hands clasped at chest &amp; mouth open",
    emoji:   "&#x1F631;",
    hintId:  "hint-surprised"
  },
  thinking: {
    img:     "monkey-images/thinking.jpg",
    title:   "is this u?",
    caption: "what's got u thinkin so hard",
    hint:    "Finger on lip/chin",
    emoji:   "&#x1F914;",
    hintId:  "hint-thinking"
  },
  wink: {
    img:     "monkey-images/wink.jpg",
    title:   "is this u?",
    caption: "ok chill out now",
    hint:    "Finger on lip/chin &amp; wink",
    emoji:   "&#x1F609;",
    hintId:  "hint-wink"
  },
  hearttouch: {
    img:     "monkey-images/heart-touch.jpeg",
    title:   "is this u?",
    caption: "ur so sweet *wipes a tear*",
    hint:    "Hands at chest &amp; smile",
    emoji:   "&#x1F970;",
    hintId:  "hint-hearttouch"
  },
  idea: {
    img:     "monkey-images/idea.jpeg",
    title:   "is this u?",
    caption: "an idea? tell me more!!",
    hint:    "Pointer up &amp; open-mouth smile",
    emoji:   "&#x1F4A1;",
    hintId:  "hint-idea"
  }
};

const POSE_KEYS = Object.keys(POSES);

// ── DOM refs ──────────────────────────────────────────────────────────
const video       = document.getElementById("video");
const overlay     = document.getElementById("overlay");
const ctx         = overlay.getContext("2d");
const snapCanvas  = document.getElementById("snap");
const snapCtx     = snapCanvas.getContext("2d");
const statusBar   = document.getElementById("statusBar");
const loadingScreen = document.getElementById("loadingScreen");

// ── State ─────────────────────────────────────────────────────────────
let lastPose      = null;
let poseHoldStart = null;
let cooldown      = false;
let faceDetected  = false;
let handsDetected = false;
let modelReady    = false;
const HOLD_TIME   = 1200;

// Cached face for use in hand-pose helpers
let face_cached   = [];

// ── Calibration UI ────────────────────────────────────────────────────
function setCalStep(stepId, state) {
  const el = document.getElementById(stepId);
  if (!el) return;
  el.classList.remove("active", "done");
  if (state) el.classList.add(state);
}

function updateCalibration() {
  if (!loadingScreen || loadingScreen.style.display === "none") return;

  const loaderFill = document.getElementById("loaderFill");

  if (!modelReady) {
    setCalStep("cal-model", "active");
    setCalStep("cal-face", "");
    setCalStep("cal-hands", "");
    if (loaderFill) loaderFill.style.width = "15%";
    document.getElementById("calMsg").textContent = "Loading AI models...";
    return;
  }

  setCalStep("cal-model", "done");

  if (!faceDetected) {
    setCalStep("cal-face", "active");
    setCalStep("cal-hands", "");
    if (loaderFill) loaderFill.style.width = "50%";
    document.getElementById("calMsg").textContent = "Look at the camera so we can see your face!";
    return;
  }

  setCalStep("cal-face", "done");

  if (!handsDetected) {
    setCalStep("cal-hands", "active");
    if (loaderFill) loaderFill.style.width = "80%";
    document.getElementById("calMsg").textContent = "Now raise both hands so we can detect them!";
    return;
  }

  // All done!
  setCalStep("cal-hands", "done");
  if (loaderFill) loaderFill.style.width = "100%";
  document.getElementById("calMsg").textContent = "All set! Get ready to pose...";
  setTimeout(() => {
    loadingScreen.style.display = "none";
    setStatus("Strike a pose! \uD83D\uDC12", "");
  }, 700);
}

// ── Geometry helpers ──────────────────────────────────────────────────
function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// ── Face feature detectors ────────────────────────────────────────────

/**
 * Smile (closed): wide mouth, small vertical opening.
 * Wide mouth-width to mouth-height ratio = smile.
 */
function isSmiling(face) {
  const mw = dist(face[61], face[291]);
  const mh = dist(face[13], face[14]);
  return (mw / mh) > 3.2;
}

/**
 * Open-mouth smile: smiling AND mouth visibly open.
 */
function isOpenMouthSmile(face) {
  const mw  = dist(face[61], face[291]);
  const mh  = dist(face[13], face[14]);
  const fh  = dist(face[10], face[152]);
  const ratio = mw / mh;
  const open  = mh / fh;
  // wide (smile) but also open enough
  return ratio > 2.2 && open > 0.06;
}

/**
 * Mouth open (non-smile — surprised gape).
 */
function isMouthOpen(face) {
  const mh = dist(face[13], face[14]);
  const fh = dist(face[10], face[152]);
  return (mh / fh) > 0.07;
}

/**
 * Winking: one eye significantly more closed than the other.
 * Eye openness = vertical distance between upper and lower lid landmarks.
 * Right eye: top=159, bot=145. Left eye: top=386, bot=374.
 */
function isWinking(face) {
  const rightOpen = dist(face[159], face[145]);
  const leftOpen  = dist(face[386], face[374]);
  const fh = dist(face[10], face[152]);
  const norm = fh * 0.001 + 0.0001; // avoid /0
  const diff = Math.abs(rightOpen - leftOpen);
  const avg  = (rightOpen + leftOpen) / 2;
  // One eye is at least 50% more closed than the other
  return diff / (avg + norm) > 0.45 && avg > 0.005;
}

// ── Hand helpers ──────────────────────────────────────────────────────

function isTouchingLip(hand, lipCenter, faceH) {
  return Math.min(dist(hand[8], lipCenter), dist(hand[4], lipCenter)) < faceH * 0.18;
}

function isPointerUp(hand) {
  const tip  = hand[8], pip = hand[6], mcp = hand[5], wrist = hand[0];
  const midT = hand[12], ringT = hand[16], pinkyT = hand[20];
  const fh   = dist(face_cached[10], face_cached[152]);
  return (
    tip.y < pip.y && tip.y < mcp.y &&
    midT.y  > hand[10].y &&
    ringT.y > hand[14].y &&
    pinkyT.y > hand[18].y &&
    tip.y < wrist.y - fh * 0.12
  );
}

function isHandNearFace(hand, noseTip, faceH) {
  return dist(hand[0], noseTip) < faceH * 1.4;
}

// ── Main pose detector ────────────────────────────────────────────────
/**
 * Returns { pose: string|null, warn: string|null }
 */
function detectPose(r) {
  if (!r.faceLandmarks) return { pose: null, warn: null };

  const face      = r.faceLandmarks;
  face_cached     = face;
  const lipCenter = { x: (face[13].x + face[14].x) / 2, y: (face[13].y + face[14].y) / 2 };
  const noseTip   = face[1];
  const faceH     = dist(face[10], face[152]);
  const hands     = [r.rightHandLandmarks, r.leftHandLandmarks].filter(Boolean);

  // ── THINKING: exactly ONE hand touching lip, no wink ─────────────────
  const lipHands = hands.filter(h => isTouchingLip(h, lipCenter, faceH));
  if (lipHands.length === 1 && !isWinking(face)) {
    return { pose: "thinking", warn: null };
  }

  // ── WINK: exactly ONE hand touching lip + winking ────────────────────
  if (lipHands.length === 1 && isWinking(face)) {
    return { pose: "wink", warn: null };
  }

  // Ignore 2 hands on lip
  if (lipHands.length > 1) return { pose: null, warn: null };

  // ── IDEA: exactly ONE pointer finger up near face + open-mouth smile ─
  const pointerHands = hands.filter(h => isPointerUp(h) && isHandNearFace(h, noseTip, faceH));
  if (pointerHands.length === 1) {
    if (!isOpenMouthSmile(face)) {
      return { pose: null, warn: "Open-mouth smile for this one! \uD83D\uDE04", warnPose: "idea" };
    }
    return { pose: "idea", warn: null };
  }
  if (pointerHands.length > 1) return { pose: null, warn: null };

  // ── Both-hands-at-chest poses ─────────────────────────────────────────
  if (r.rightHandLandmarks && r.leftHandLandmarks) {
    const rW = r.rightHandLandmarks[0];
    const lW = r.leftHandLandmarks[0];
    const hd = dist(rW, lW);
    const atChest = rW.y > noseTip.y + 0.08 && lW.y > noseTip.y + 0.08;

    if (hd < 0.30 && atChest) {
      // ── SURPRISED: mouth open ────────────────────────────────────────
      if (isMouthOpen(face) && !isSmiling(face)) {
        return { pose: "surprised", warn: null };
      }
      // ── HEARTTOUCH: closed smile ─────────────────────────────────────
      if (isSmiling(face) && !isMouthOpen(face)) {
        return { pose: "hearttouch", warn: null };
      }
      // Hands together but ambiguous expression
      if (!isMouthOpen(face) && !isSmiling(face)) {
        return { pose: null, warn: "Open your mouth OR smile! \uD83D\uDE0A", warnPose: "surprised" };
      }
    }
  }

  return { pose: null, warn: null };
}

// ── Snapshot & popup ──────────────────────────────────────────────────
function takeSnapshot(poseKey) {
  if (cooldown) return;
  cooldown = true;

  // Capture mirrored frame
  snapCanvas.width  = video.videoWidth;
  snapCanvas.height = video.videoHeight;
  snapCtx.save();
  snapCtx.translate(snapCanvas.width, 0);
  snapCtx.scale(-1, 1);
  snapCtx.drawImage(video, 0, 0);
  snapCtx.restore();

  // User photo canvas
  const userPhoto = document.getElementById("userPhoto");
  userPhoto.width  = snapCanvas.width;
  userPhoto.height = snapCanvas.height;
  userPhoto.getContext("2d").drawImage(snapCanvas, 0, 0);

  const cfg = POSES[poseKey];
  document.getElementById("monkeyPhoto").src          = cfg.img;
  document.getElementById("popupTitle").textContent   = cfg.title;
  document.getElementById("popupCaption").textContent = cfg.caption;
  document.getElementById("popup").classList.add("show");

  // Store pose key for save
  document.getElementById("popup").dataset.pose = poseKey;
}

function closePopup() {
  document.getElementById("popup").classList.remove("show");
  setTimeout(() => { cooldown = false; }, 1500);
  lastPose = null;
  poseHoldStart = null;
  setStatus("Strike a pose! \uD83D\uDC12", "");
}
window.closePopup = closePopup;

function saveImage() {
  const userPhoto   = document.getElementById("userPhoto");
  const monkeyPhoto = document.getElementById("monkeyPhoto");

  // Build a combined canvas: user | arrow | monkey
  const gap    = 24;
  const mw     = userPhoto.width;
  const mh     = userPhoto.height;
  const arrowW = 80;
  const totalW = mw + arrowW + mw + gap * 2;
  const totalH = mh + 60; // extra for labels

  const saveCanvas = document.createElement("canvas");
  saveCanvas.width  = totalW;
  saveCanvas.height = totalH;
  const sc = saveCanvas.getContext("2d");

  // Background
  sc.fillStyle = "#8B4513";
  sc.fillRect(0, 0, totalW, totalH);

  // User photo
  sc.drawImage(userPhoto, gap, 10, mw, mh);

  // Arrow
  sc.fillStyle = "#FFE135";
  sc.font = "bold 48px Arial";
  sc.textAlign = "center";
  sc.textBaseline = "middle";
  sc.fillText("→", mw + gap + arrowW / 2, mh / 2 + 10);

  // "is this u?" text above arrow
  sc.font = "bold 16px Arial";
  sc.fillStyle = "#FFE135";
  sc.fillText("is this u?", mw + gap + arrowW / 2, mh / 2 - 30);

  // Monkey photo
  const monkeyImg = new Image();
  monkeyImg.crossOrigin = "anonymous";
  monkeyImg.onload = () => {
    sc.drawImage(monkeyImg, mw + gap + arrowW, 10, mw, mh);

    // Labels
    sc.font = "bold 20px Arial";
    sc.fillStyle = "rgba(255,248,231,0.7)";
    sc.fillText("you", gap + mw / 2, mh + 35);
    sc.fillText("the og 🐒", mw + gap + arrowW + mw / 2, mh + 35);

    // Download
    const a = document.createElement("a");
    a.download = "is-this-u.png";
    a.href = saveCanvas.toDataURL("image/png");
    a.click();
  };
  monkeyImg.src = monkeyPhoto.src;
}
window.saveImage = saveImage;

// ── Status helper ─────────────────────────────────────────────────────
function setStatus(text, cls) {
  statusBar.textContent = text;
  statusBar.className   = "status-bar" + (cls ? " " + cls : "");
}

// ── MediaPipe Holistic ────────────────────────────────────────────────
const holistic = new Holistic({
  locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${f}`
});

holistic.setOptions({
  modelComplexity:        1,
  smoothLandmarks:        true,
  enableSegmentation:     false,
  refineFaceLandmarks:    true,
  minDetectionConfidence: 0.6,
  minTrackingConfidence:  0.5
});

holistic.onResults(results => {
  if (!modelReady) {
    modelReady = true;
    updateCalibration();
  }

  // Sync overlay size
  overlay.width  = video.videoWidth  || overlay.clientWidth;
  overlay.height = video.videoHeight || overlay.clientHeight;
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  // Track calibration state
  const hadFace  = faceDetected;
  const hadHands = handsDetected;

  if (results.faceLandmarks)  faceDetected  = true;
  const currentHands = [results.rightHandLandmarks, results.leftHandLandmarks].filter(Boolean);
  if (currentHands.length >= 2) handsDetected = true;

  if ((!hadFace && faceDetected) || (!hadHands && handsDetected)) {
    updateCalibration();
  }

  // Draw overlays
  if (results.faceLandmarks) {
    drawConnectors(ctx, results.faceLandmarks, FACEMESH_CONTOURS,
      { color: "rgba(255,225,53,0.45)", lineWidth: 1.5 });
  }
  for (const hand of [results.rightHandLandmarks, results.leftHandLandmarks]) {
    if (!hand) continue;
    drawConnectors(ctx, hand, HAND_CONNECTIONS,
      { color: "rgba(255,107,53,0.9)", lineWidth: 2 });
    drawLandmarks(ctx, hand, { color: "#FFE135", lineWidth: 1, radius: 3 });
  }

  // Skip detection until calibration done
  if (loadingScreen && loadingScreen.style.display !== "none") return;
  if (cooldown) return;

  const { pose, warn, warnPose } = detectPose(results);

  // Update hint pills
  POSE_KEYS.forEach(k => {
    const el = document.getElementById(POSES[k].hintId);
    if (!el) return;
    el.classList.remove("active", "warn");
    if (pose === k) el.classList.add("active");
    if (warnPose === k) el.classList.add("warn");
  });

  if (pose) {
    if (pose !== lastPose) {
      lastPose      = pose;
      poseHoldStart = Date.now();
      setStatus("Hold it... \uD83D\uDC12", "detecting");
    } else if (Date.now() - poseHoldStart >= HOLD_TIME) {
      setStatus("\uD83D\uDCF8 SNAP!", "ok-state");
      takeSnapshot(pose);
    }
  } else {
    if (warn) {
      setStatus(warn, "warn-state");
    } else if (lastPose) {
      setStatus("Strike a pose! \uD83D\uDC12", "");
    }
    lastPose      = null;
    poseHoldStart = null;
  }
});

// ── Camera startup ────────────────────────────────────────────────────
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }
    });
    video.srcObject = stream;
    await new Promise(res => (video.onloadedmetadata = res));
    overlay.width  = video.videoWidth;
    overlay.height = video.videoHeight;

    const camera = new Camera(video, {
      onFrame: async () => { await holistic.send({ image: video }); },
      width: 640, height: 480
    });
    await camera.start();
  } catch (e) {
    loadingScreen.style.display = "none";
    setStatus("Camera access denied \uD83D\uDE22", "warn-state");
    console.error(e);
  }
}

startCamera();