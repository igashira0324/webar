import { Scene } from "@babylonjs/core";
import { MmdModel } from "babylon-mmd";

export interface AudioLipSyncController {
  attach: (audioElement: HTMLAudioElement) => boolean;
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  dispose: () => void;
}

/**
 * 音楽ファイルの音量に合わせて口パク（リップシンク）を行うコントローラーを作成します。
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
  let enabled = true;          // デフォルト ON
  let attached = false;
  let smoothed = 0;

  // 調整パラメータ
  const SMOOTHING = 0.55;       // 平滑化（0=即時, 1=固定）
  const NOISE_FLOOR = 0.02;     // 無音判定のしきい値
  const SENSITIVITY = 2.8;      // 感度
  const MAX_OPEN = 0.85;        // 口の最大開き
  const MORPH_NAME = "あ";      // 使用するモーフ名

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

      // HTMLAudioElement → 解析 → 出力 のグラフを構築
      sourceNode = audioCtx.createMediaElementSource(audioElement);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;

      sourceNode.connect(analyser);
      analyser.connect(audioCtx.destination); 

      dataArray = new Uint8Array(analyser.frequencyBinCount);

      // 毎フレーム、VMD のアニメ後に口モーフを上書き
      observer = scene.onAfterAnimationsObservable.add(() => {
        if (!enabled || !analyser || !dataArray) return;
        const model = getModel();
        if (!model) return;

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

        // モーフ適用（複数候補で対応：日本語標準 → 英語 → ローマ字）
        const morph = model.morph;
        if (!morph) return;
        
        const setWeight = (name: string, val: number) => {
          try { morph.setMorphWeight(name, val); } catch (e) {}
        };

        setWeight(MORPH_NAME, smoothed);
        setWeight("a", smoothed);
        setWeight("A", smoothed);
        setWeight("Lip_A", smoothed);
      });

      attached = true;
      console.log("🎵 Audio LipSync attached");
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
      // OFF にしたら口を閉じる
      const model = getModel();
      if (model?.morph) {
        const setWeight = (name: string, val: number) => {
          try { model.morph.setMorphWeight(name, val); } catch (e) {}
        };
        setWeight(MORPH_NAME, 0);
        setWeight("a", 0);
        setWeight("A", 0);
        setWeight("Lip_A", 0);
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
