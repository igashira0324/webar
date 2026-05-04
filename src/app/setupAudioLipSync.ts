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

        // 周波数データを取得 (0 〜 255 の値)
        analyser.getByteFrequencyData(dataArray as any);

        // 人間の歌声（中音域）に近い帯域のみを抽出して平均を出す
        // fftSize=512 の場合、各ビンは約 86Hz 刻み (44.1kHzの場合)
        // 200Hz 〜 4000Hz 程度 (ビン番号 3 〜 46 程度) を重点的に見る
        let vocalEnergy = 0;
        const startBin = 3;
        const endBin = 46;
        for (let i = startBin; i <= endBin; i++) {
          vocalEnergy += dataArray[i];
        }
        const averageVocal = vocalEnergy / (endBin - startBin + 1) / 255;

        // ノイズフロア除去 -> 感度適用 -> 上限クランプ
        // 楽器音を無視するためしきい値を少し高めに設定
        let target = Math.max(0, (averageVocal - 0.08) * 3.5);
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
