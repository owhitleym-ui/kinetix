/**
 * MediaPipe Pose setup. Expects global Pose from CDN script in _document.js.
 * Guarded against double-init / overlapping send (WASM aborts otherwise).
 */

const POSE_VERSION = "0.5.1675469404";
const POSE_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/pose@${POSE_VERSION}`;

let poseLoading = null;

function waitForGlobal(name, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (typeof window !== "undefined" && window[name]) {
      resolve(window[name]);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => {
      if (typeof window !== "undefined" && window[name]) {
        clearInterval(id);
        resolve(window[name]);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(id);
        reject(new Error(`${name} failed to load from CDN`));
      }
    }, 50);
  });
}

/**
 * Create and configure a MediaPipe Pose instance.
 * Only one initialize() may run at a time in this tab.
 * @param {(results: object) => void} onResults
 */
export async function createPose(onResults) {
  // Serialize init — Strict Mode / Fast Refresh can race two constructors
  if (poseLoading) {
    await poseLoading.catch(() => {});
  }

  poseLoading = (async () => {
    const Pose = await waitForGlobal("Pose");
    const pose = new Pose({
      locateFile: (file) => `${POSE_CDN}/${file}`,
    });
    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    pose.onResults(onResults);
    // First send() also initializes; explicit init is more reliable for camera start
    if (typeof pose.initialize === "function") {
      await pose.initialize();
    }
    return pose;
  })();

  try {
    return await poseLoading;
  } finally {
    poseLoading = null;
  }
}

/**
 * Start webcam via getUserMedia and feed frames to Pose.
 * Never overlaps pose.send — concurrent WASM calls abort the module.
 */
export async function startCamera(videoEl, pose) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 },
    },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();

  let running = true;
  let busy = false;
  let rafId = null;

  const tick = () => {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    if (busy || videoEl.readyState < 2) return;
    busy = true;
    pose
      .send({ image: videoEl })
      .catch(() => {
        // Ignore transient send errors during teardown / WASM warmup
      })
      .finally(() => {
        busy = false;
      });
  };
  rafId = requestAnimationFrame(tick);

  return {
    stream,
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      stream.getTracks().forEach((t) => t.stop());
      if (videoEl) videoEl.srcObject = null;
    },
  };
}

export { waitForGlobal, POSE_CDN };
