import { Scene } from "@babylonjs/core";
import { MmdModel } from "babylon-mmd";

export interface AudioLipSyncController {
  attach: (audioElement: HTMLAudioElement) => boolean;
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  dispose: () => void;
}

/**
 * LipSync v3 (Soft Scoring)
 * 歌声らしさをスコア化し、自然な連動を実現するコントローラー
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
  let smoothedMouth = 0;
  let prevVocalEnergy = 0;
  let energyHistory: number[] = [];
  let vocalScoreSmoothed = 0;
  const HISTORY_SIZE = 15;

  // 調整パラメータ
  const MOUTH_SMOOTHING = 0.55;       // 口の動きの平滑化
  const SCORE_SMOOTHING = 0.75;       // スコアの平滑化（急激な変化を抑制）
  const MAX_OPEN = 0.9;
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
      analyser.smoothingTimeConstant = 0.25; // 短めで変動を捉える

      sourceNode.connect(analyser);
      analyser.connect(audioCtx.destination);

      freqData = new Uint8Array(analyser.frequencyBinCount);

      observer = scene.onAfterAnimationsObservable.add(() => {
        if (!enabled || !analyser || !freqData) return;
        const model = getModel();
        if (!model) return;

        analyser.getByteFrequencyData(freqData as any);

        // ===== 帯域別エネルギー（fftSize=1024, 約 43Hz/ビン）=====
        // 低音: 0〜200Hz（ベース・キック）
        let bassSum = 0;
        for (let i = 0; i <= 4; i++) bassSum += freqData[i];
        const bass = bassSum / 5 / 255;

        // ボーカル中心域: 300Hz〜3kHz（フォルマント主帯域）
        let vocalSum = 0;
        const vStart = 7, vEnd = 70;
        for (let i = vStart; i <= vEnd; i++) vocalSum += freqData[i];
        const vocal = vocalSum / (vEnd - vStart + 1) / 255;

        // ===== ボーカル帯域内のピーク性（フォルマント検出の簡易版）=====
        let vocalPeak = 0;
        for (let i = vStart; i <= vEnd; i++) {
          if (freqData[i] > vocalPeak) vocalPeak = freqData[i];
        }
        const peakRatio = (vocalPeak / 255) - vocal; // 歌声はピークが鋭い
        const peakScore = Math.min(1, peakRatio * 3.0);

        // ===== エネルギー変動 =====
        const delta = Math.abs(vocal - prevVocalEnergy);
        prevVocalEnergy = vocal;
        energyHistory.push(delta);
        if (energyHistory.length > HISTORY_SIZE) energyHistory.shift();
        const avgVariation = energyHistory.reduce((a, b) => a + b, 0) / energyHistory.length;
        const variationScore = Math.min(1, avgVariation * 40);

        // ===== 中音域支配度（楽器低音だけの場合に弱くする）=====
        const dominanceScore = Math.min(1, vocal / Math.max(0.05, bass) * 0.6);

        // ===== エネルギースコア（基礎的な「音があるか」）=====
        const energyScore = Math.min(1, Math.max(0, (vocal - 0.06) * 4));

        // ===== 総合スコア（重み付き加算）=====
        const rawScore =
          energyScore * 0.35 +
          variationScore * 0.30 +
          peakScore * 0.20 +
          dominanceScore * 0.15;

        // スコアを平滑化
        vocalScoreSmoothed = vocalScoreSmoothed * SCORE_SMOOTHING +
                             rawScore * (1 - SCORE_SMOOTHING);

        // ===== 口の開き量計算 =====
        let target = 0;
        if (vocalScoreSmoothed > 0.25) {
          // スコア 0.25〜1.0 を 0〜1.0 にリマップ
          const scoreRamp = (vocalScoreSmoothed - 0.25) / 0.75;
          // 開き量 = スコアの確信度 × 音量
          target = scoreRamp * vocal * 3.5;
          target = Math.min(MAX_OPEN, target);
        }

        // 口の動きの平滑化
        smoothedMouth = smoothedMouth * MOUTH_SMOOTHING +
                        target * (1 - MOUTH_SMOOTHING);

        // モーフ適用
        const morph = model.morph;
        if (!morph) return;
        for (const name of MORPH_NAMES) {
          try { morph.setMorphWeight(name, smoothedMouth); } catch (e) {}
        }
      });

      attached = true;
      console.log("🎵 LipSync v3 attached (soft scoring)");
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
      vocalScoreSmoothed = 0;
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
