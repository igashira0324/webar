import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

export class PoseService {
  private landmarker: PoseLandmarker | null = null;

  async init() {
    if (this.landmarker) return;
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm"
    );
    this.landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
        delegate: "CPU"
      },
      runningMode: "VIDEO",
      numPoses: 1
    });
  }

  detect(video: HTMLVideoElement, timestamp: number) {
    if (!this.landmarker || video.readyState < 2) return null;
    try {
      const results = this.landmarker.detectForVideo(video, timestamp);
      if (results && results.worldLandmarks && results.worldLandmarks.length > 0) {
        // console.log("PoseService: Pose detected");
      }
      return results;
    } catch (e) {
      console.error("PoseService: Detection failed", e);
      return null;
    }
  }
}

export const poseService = new PoseService();
