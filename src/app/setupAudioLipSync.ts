import { Scene } from "@babylonjs/core";
import { MmdModel } from "babylon-mmd";

export interface AudioLipSyncController {
  attach: (audioElement: HTMLAudioElement) => boolean;
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  dispose: () => void;
}

/**
 * 歌声の特徴（変動性・周波数バランス）を捉えて高精度なリップシンクを行うコントローラー
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

  // 状態保持
  let smoothedMouth = 0;        // 最終的な口の開き
  let prevVocalEnergy = 0;      // 前フレームの中音域エネルギー
  let energyHistory: number[] = []; // エネルギー変動の履歴
  const HISTORY_SIZE = 20;      // 約 0.3 秒分（60fps想定）

  // 調整パラメータ
  const SMOOTHING = 0.65;       // 平滑化（カクつき防止）
  const MAX_OPEN = 0.85;        // 口の最大開き
  const ENERGY_THRESHOLD = 0.15; // この値以下のエネルギーは無視
  const VARIATION_THRESHOLD = 0.020; // この変動以下は楽器音と判定
  const SENSITIVITY = 3.0;      // 感度
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
      analyser.fftSize = 1024;            // 解像度向上（約 43Hz/ビン）
      analyser.smoothingTimeConstant = 0.3; // 短めにして変動を捉える

      sourceNode.connect(analyser);
      analyser.connect(audioCtx.destination);

      freqData = new Uint8Array(analyser.frequencyBinCount);

      observer = scene.onAfterAnimationsObservable.add(() => {
        if (!enabled || !analyser || !freqData) return;
        const model = getModel();
        if (!model) return;

        analyser.getByteFrequencyData(freqData as any);

        // ===== 1. 中音域エネルギー（声帯の主要帯域: 300Hz〜3.4kHz）=====
        // fftSize=1024, sampleRate=44100 → ビン1つ ≈ 43.07Hz
        // 300Hz ≈ ビン7, 3400Hz ≈ ビン79
        let vocalEnergy = 0;
        const startBin = 7;
        const endBin = 79;
        for (let i = startBin; i <= endBin; i++) {
          vocalEnergy += freqData[i];
        }
        const avgVocal = vocalEnergy / (endBin - startBin + 1) / 255;

        // ===== 2. 低音域エネルギー（ベース・キック: 〜200Hz）=====
        let bassEnergy = 0;
        for (let i = 0; i <= 4; i++) {
          bassEnergy += freqData[i];
        }
        const avgBass = bassEnergy / 5 / 255;

        // ===== 3. エネルギー変動の計算（歌声 vs 楽器音の判別の核心）=====
        const energyDelta = Math.abs(avgVocal - prevVocalEnergy);
        prevVocalEnergy = avgVocal;

        energyHistory.push(energyDelta);
        if (energyHistory.length > HISTORY_SIZE) energyHistory.shift();

        // 直近の平均変動量
        const avgVariation = energyHistory.reduce((a, b) => a + b, 0) / energyHistory.length;

        // ===== 4. 歌声判定 =====
        // 条件1: 中音域に十分なエネルギーがある
        // 条件2: エネルギーの変動が大きい（歌声の特徴）
        // 条件3: 中音域が低音域に対して一定以上の存在感がある（ベース支配を除外）
        const hasEnoughEnergy = avgVocal > ENERGY_THRESHOLD;
        const isVarying = avgVariation > VARIATION_THRESHOLD;
        const isVocalDominant = avgVocal > avgBass * 0.65; 

        let target = 0;
        if (hasEnoughEnergy && isVarying && isVocalDominant) {
          target = Math.max(0, (avgVocal - ENERGY_THRESHOLD) * SENSITIVITY);
          target = Math.min(MAX_OPEN, target);
        }

        // 平滑化
        smoothedMouth = smoothedMouth * SMOOTHING + target * (1 - SMOOTHING);

        // モーフ適用
        const morph = model.morph;
        if (!morph) return;
        for (const name of MORPH_NAMES) {
          try { morph.setMorphWeight(name, smoothedMouth); } catch (e) {}
        }
      });

      attached = true;
      console.log("🎵 Audio LipSync v2 attached (vocal-aware)");
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
      energyHistory = [];
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
