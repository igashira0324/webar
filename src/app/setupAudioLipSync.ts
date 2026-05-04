import { Scene } from "@babylonjs/core";
import { MmdModel } from "babylon-mmd";

export interface AudioLipSyncController {
  attach: (audioElement: HTMLAudioElement) => boolean;
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  dispose: () => void;
}

/**
 * 音楽ファイルの音量に合わせて口パク（リップシンク）を行うコントローラー
 * v1 復元版：シンプルで自然な追従を優先
 */
export const setupAudioLipSync = (
  scene: Scene,
  getModel: () => MmdModel | null
): AudioLipSyncController => {
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let sourceNode: MediaElementAudioSourceNode | null = null;
  let dataArray: Uint8Array | null = null;
  let observer: any = null;
  let enabled = true;
  let attached = false;
  let smoothed = 0;

  // 調整パラメータ（v1 と同じ設定）
  const SMOOTHING = 0.55;       // 平滑化（0=即時, 1=固定）
  const NOISE_FLOOR = 0.02;     // 無音判定のしきい値
  const SENSITIVITY = 2.8;      // 感度
  const MAX_OPEN = 0.85;        // 口の最大開き
  const MORPH_NAMES = ["あ", "a", "A", "Lip_A"];

  const attach = (audioElement: HTMLAudioElement): boolean => {
    if (attached) return true;
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) {
        console.warn("[LipSync] Web Audio API not supported");
        return false;
      }
      audioCtx = new Ctx();
      if (!audioCtx) return false;

      sourceNode = audioCtx.createMediaElementSource(audioElement);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;

      sourceNode.connect(analyser);
      analyser.connect(audioCtx.destination);

      dataArray = new Uint8Array(analyser.frequencyBinCount);

      observer = scene.onAfterAnimationsObservable.add(() => {
        if (!enabled || !analyser || !dataArray) return;
        const model = getModel();
        if (!model) return;

        // 時間波形を取得
        analyser.getByteTimeDomainData(dataArray as any);

        // RMS（音の大きさ）計算
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / dataArray.length);

        // ノイズフロア除去 → 感度適用 → 上限クランプ
        let target = Math.max(0, (rms - NOISE_FLOOR) * SENSITIVITY);
        target = Math.min(MAX_OPEN, target);

        // 平滑化（カクつき防止）
        smoothed = smoothed * SMOOTHING + target * (1 - SMOOTHING);

        // モーフ適用
        const morph = model.morph;
        if (!morph) return;
        for (const name of MORPH_NAMES) {
          try { morph.setMorphWeight(name, smoothed); } catch (e) {}
        }
      });

      attached = true;
      console.log("🎵 LipSync v1 (restored) attached");
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
      smoothed = 0;
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
