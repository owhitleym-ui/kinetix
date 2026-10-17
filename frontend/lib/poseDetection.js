/**
 * MediaPipe Pose setup. Expects global Pose / Camera from CDN scripts.
 */

const POSE_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/pose";

function waitForGlobal(name, timeoutMs = 15000) {
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
 * @param {(results: object) => void} onResults
 */
export async function createPose(onResults) {
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
  await pose.initialize();
  return pose;
}

/**
 * Start webcam via getUserMedia and feed frames to Pose.
 */
export async function startCamera(videoEl, pose) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();

  let running = true;
  let rafId = null;

  const tick = async () => {
    if (!running) return;
    if (videoEl.readyState >= 2) {
      try {
        await pose.send({ image: videoEl });
      } catch (e) {
        // Ignore transient send errors during teardown
      }
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  return {
    stream,
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      stream.getTracks().forEach((t) => t.stop());
      videoEl.srcObject = null;
    },
  };
}

export { waitForGlobal };
