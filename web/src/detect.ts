/** Live object detection for the camera overlay, on the GPU.
 *
 *  coco-ssd (~80 everyday classes) run through TensorFlow.js. The backend is
 *  picked once: WebGPU when the browser has it (fastest), else WebGL — both run
 *  on the GPU, so `detect()` stays real-time instead of freezing the tab on the
 *  CPU. The heavy bits (tf, the model) are dynamically imported the first time a
 *  detector is asked for, so opening the app without ever touching the camera
 *  pays none of that download or init cost.
 *
 *  The pure geometry/label helpers live in detect-box.ts (no TF import, so they
 *  stay unit-testable in plain node); they are re-exported here so callers have
 *  one import site. */
import { Detection } from './detect-box';
export { coverBox, label } from './detect-box';
export type { Detection, Box } from './detect-box';

// --- GPU model, browser-only (dynamic imports keep it out of the SSR/build
// graph and off the startup path) ---

let _backend: Promise<string> | null = null;
let _model: Promise<{ detect(input: unknown, max?: number): Promise<Detection[]> }> | null = null;

/** Select and initialise a GPU backend once. WebGPU first, WebGL as the
 *  fallback; a browser with neither lands on WebGL's own failure, surfaced to
 *  the caller so the overlay can say detection is unavailable rather than hang. */
export function initBackend(): Promise<string> {
  if (!_backend) {
    _backend = (async () => {
      try {
        const tfPkg = '@tensorflow/tfjs';
        const tf = await import(/* webpackIgnore: true */ tfPkg);
        try {
          const webgpuPkg = '@tensorflow/tfjs-backend-webgpu';
          await import(/* webpackIgnore: true */ webgpuPkg);
          await tf.setBackend('webgpu');
          await tf.ready();
          return 'webgpu';
        } catch {
          await tf.setBackend('webgl');
          await tf.ready();
          return tf.getBackend();
        }
      } catch (err) {
        throw new Error('TensorFlow.js not available');
      }
    })();
  }
  return _backend;
}

/** The shared coco-ssd detector, loaded once and reused across every time the
 *  camera is opened. `lite_mobilenet_v2` is the fastest base — the point is a
 *  smooth live overlay, not the last percent of accuracy, and the still frame
 *  the operator captures still goes to the full vision model. */
export function loadDetector() {
  if (!_model) {
    _model = (async () => {
      await initBackend();
      const cocoPkg = '@tensorflow-models/coco-ssd';
      const cocoSsd = await import(/* webpackIgnore: true */ cocoPkg);
      return cocoSsd.load({ base: 'lite_mobilenet_v2' }) as unknown as {
        detect(input: unknown, max?: number): Promise<Detection[]>;
      };
    })();
  }
  return _model;
}
