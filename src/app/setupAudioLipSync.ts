import { Scene } from "@babylonjs/core";
import { MmdModel } from "babylon-mmd";

export interface AudioLipSyncController {
  attach: (audioElement: HTMLAudioElement) => boolean;
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  dispose: () => void;
}

/**
 * LipSync v4 (Simple + Natural)
 * 自然な追従性と、最低限の楽器音抑制を両立させた実用版
 */
export const setupAudioLipSync = (
  scene: Scene,
  getModel: () => MmdModel | null
): AudioLipSyncController => {
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let sourceNode: MediaElementAudioSourceNode | null = null;
  let freqData: Uint8Array | null = null;
  let observer: any = null;
  let enabled = true;
  let attached = false;

  // 状態
  let smoothedMouth = 0;
  let prevVocal = 0;
  let recentVariations: number[] = [];

  // パラメータ（レスポンス重視）
  const MOUTH_SMOOTHING = 0.45;       // 口の動きの平滑化（軽め）
  const NOISE_FLOOR = 0.08;           // この音量以下は完全に無音扱い
  const SENSITIVITY = 4.0;            // 口の開き感度
  const MAX_OPEN = 0.9;
  const VARIATION_WINDOW = 30;        // 約 0.5 秒分
  const MORPH_NAMES = ["あ", "a", "A", "Lip_A"];

  const attach = (audioElement: HTMLAudioElement): boolean => {
    if (attached) return true;
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return false;
      audioCtx = new Ctx();
      if (!audioCtx) return false;

      sourceNode = audioCtx.createMediaElementSource(audioElement);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.2; // 短く（変動を捉える）

      sourceNode.connect(analyser);
      analyser.connect(audioCtx.destination);

      freqData = new Uint8Array(analyser.frequencyBinCount);

      observer = scene.onAfterAnimationsObservable.add(() => {
        if (!enabled || !analyser || !freqData) return;
        const model = getModel();
        if (!model) return;

        analyser.getByteFrequencyData(freqData as any);

        // ===== 中音域（声の主要帯域: 約 300Hz〜3kHz）=====
        // fftSize=1024, sampleRate=44100 → 約 43Hz/ビン
        let vocalSum = 0;
        const vStart = 7, vEnd = 70;
        for (let i = vStart; i <= vEnd; i++) vocalSum += freqData[i];
        const vocal = vocalSum / (vEnd - vStart + 1) / 255;

        // ===== 変動量（直近 0.5 秒の平均変動量）=====
        const delta = Math.abs(vocal - prevVocal);
        prevVocal = vocal;
        recentVariations.push(delta);
        if (recentVariations.length > VARIATION_WINDOW) recentVariations.shift();
        const avgVariation = recentVariations.reduce((a, b) => a + b, 0) / recentVariations.length;

        // ===== 楽器のみパート判定（緩めの条件）=====
        // 「音量が一定以上あるのに、変動がほとんどない」場合のみ抑制
        // 歌声は必ず変動する → この条件で楽器の持続音だけを除外
        let suppressionFactor = 1.0; 

        if (avgVariation < 0.008 && vocal > 0.15) {
          // 楽器の持続音っぽい（変動小・音量中以上）
          suppressionFactor = 0.0;
        } else if (avgVariation < 0.012 && vocal > 0.20) {
          // 弱めの楽器ライク → 段階的に抑制
          suppressionFactor = 0.4;
        }

        // ===== 基本の口の開き（音量直結）=====
        let target = 0;
        if (vocal > NOISE_FLOOR) {
          target = (vocal - NOISE_FLOOR) * SENSITIVITY;
          target = Math.min(MAX_OPEN, target);
          target *= suppressionFactor;
        }

        // 平滑化（軽め）
        smoothedMouth = smoothedMouth * MOUTH_SMOOTHING + target * (1 - MOUTH_SMOOTHING);

        // モーフ適用
        const morph = model.morph;
        if (!morph) return;
        for (const name of MORPH_NAMES) {
          try { morph.setMorphWeight(name, smoothedMouth); } catch (e) {}
        }

        // デバッグ用（必要に応じて有効化）
        // if (Math.random() < 0.02) {
        //   console.log(`vocal:${vocal.toFixed(2)} var:${avgVariation.toFixed(3)} suppress:${suppressionFactor.toFixed(1)} → mouth:${smoothedMouth.toFixed(2)}`);
        // }
      });

      attached = true;
      console.log("🎵 LipSync v4 attached (simple + natural)");
      return true;
    } catch (e) {
      console.warn("[LipSync] Attach failed:", e);
      if (sourceNode) { try { sourceNode.disconnect(); } catch {} sourceNode = null; }
      if (analyser) { try { analyser.disconnect(); } catch {} analyser = null; }
      if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
      return false;
    }
  };

  const setEnabled = (v: boolean) => {
    enabled = v;
    if (!v) {
      const model = getModel();
      if (model?.morph) {
        for (const name of MORPH_NAMES) {
          try { model.morph.setMorphWeight(name, 0); } catch (e) {}
        }
      }
      smoothedMouth = 0;
      recentVariations = [];
    }
  };

  const isEnabled = () => enabled;

  const dispose = () => {
    if (observer) {
      scene.onAfterAnimationsObservable.remove(observer);
      observer = null;
    }
    if (sourceNode) { try { sourceNode.disconnect(); } catch {} sourceNode = null; }
    if (analyser) { try { analyser.disconnect(); } catch {} analyser = null; }
    attached = false;
  };

  return { attach, setEnabled, isEnabled, dispose };
};
