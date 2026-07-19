import { Scene } from "@babylonjs/core";
import { MmdModel } from "babylon-mmd";

interface Expression {
  name: string;       // モーフ名
  intensity: number;  // 強さ (0.0〜1.0)
  duration: number;   // 表情を維持する時間 (ms)
  fadeIn: number;     // フェードイン時間 (ms)
  fadeOut: number;    // フェードアウト時間 (ms)
  chanceEligible?: boolean; // 「表情チャンス」ゲームのタップ対象になる表情か
}

// 表情パターン（MMD標準モーフ名）
const EXPRESSIONS: Expression[] = [
  { name: "笑い",     intensity: 0.8, duration: 2500, fadeIn: 400, fadeOut: 600 },
  { name: "ウィンク",  intensity: 1.0, duration: 800,  fadeIn: 150, fadeOut: 300, chanceEligible: true },
  { name: "ウィンク2", intensity: 1.0, duration: 800,  fadeIn: 150, fadeOut: 300, chanceEligible: true },
  { name: "なごみ",   intensity: 0.7, duration: 3000, fadeIn: 500, fadeOut: 700 },
  { name: "じと目",   intensity: 0.6, duration: 2000, fadeIn: 400, fadeOut: 500 },
  { name: "びっくり", intensity: 0.7, duration: 1200, fadeIn: 200, fadeOut: 400, chanceEligible: true },
  { name: "にこり",   intensity: 0.8, duration: 2500, fadeIn: 400, fadeOut: 600 },
  // 新規追加パターン
  { name: "怒り",     intensity: 0.8, duration: 2000, fadeIn: 300, fadeOut: 500 },
  { name: "困る",     intensity: 0.7, duration: 2500, fadeIn: 400, fadeOut: 600 },
  { name: "にやり",   intensity: 0.8, duration: 2000, fadeIn: 400, fadeOut: 500 },
  { name: "にっこり", intensity: 0.9, duration: 2500, fadeIn: 400, fadeOut: 600 },
];

const CHANCE_EXPRESSIONS = EXPRESSIONS.filter((e) => e.chanceEligible);

export interface ExpressionTuning {
  chanceRatio: number;   // チャンス対象表情を優先抽選する確率 (0-1)
  intervalScale: number; // 表情スケジュール間隔の倍率 (1=通常、小さいほど高頻度)
}

/**
 * MMDモデルにランダムな表情（まばたき、笑顔、ウィンク等）を設定します。
 * onChanceExpression: ウィンク等の「表情チャンス」対象表情が発火した瞬間に呼ばれる（表情チャンスゲーム用フック）
 * getTuning: ゲーム側から抽選確率・発火間隔を動的に調整するためのフック（AR中の高頻度化・フィーバー加速）
 * registerChanceTrigger: 「チャンス表情を即発火する関数」をゲーム側へ渡す（フィーバー中の連続チャンス用）
 */
export const setupExpressions = (
  _scene: Scene,
  model: MmdModel,
  onChanceExpression?: (name: string, windowMs: number) => void,
  getTuning?: () => ExpressionTuning,
  registerChanceTrigger?: (trigger: () => void) => void
) => {
  const morph = model.morph;
  if (!morph) {
    console.warn("Model has no morph controller");
    return () => {};
  }

  // 利用可能なモーフ名を一覧表示（開発デバッグ用）
  try {
    const available = (morph as any)._morphTargets?.map((m: any) => m.name) ||
                      (morph as any).morphs?.map((m: any) => m.name) || [];
    console.log("MMD Available morphs:", available);
  } catch (e) { /* ignore */ }

  // 安全にモーフ値を設定するヘルパー（エイリアス対応）
  const setWeight = (name: string, value: number) => {
    // モデルによって異なる可能性があるモーフ名の対応表
    const aliases: Record<string, string[]> = {
      "まばたき": ["まばたき", "Blink", "blink", "瞳閉じ", "Close"],
      "笑い": ["笑い", "Smile", "smile", "にっこり", "にこり", "W笑い"],
      "ウィンク": ["ウィンク", "Wink", "wink", "ウィンク右", "ウィンク左"],
      "ウィンク2": ["ウィンク2", "Wink2", "wink2", "ウィンク右2", "ウィンク左2"],
      "なごみ": ["なごみ", "Calm", "calm", "真面目"],
      "あ": ["あ", "A", "a", "Lip_A"],
      "い": ["い", "I", "i", "Lip_I"],
      "う": ["う", "U", "u", "Lip_U"],
      "え": ["え", "E", "e", "Lip_E"],
      "お": ["お", "O", "o", "Lip_O"],
    };

    const targetNames = aliases[name] || [name];
    
    for (const target of targetNames) {
      try {
        // babylon-mmd の morph.setMorphWeight は存在しないモーフ名を渡すとエラーになるか
        // 何もしない場合があるため、明示的にチェックする
        morph.setMorphWeight(target, value);
      } catch (e) {
        // 存在しない場合は次を試す
      }
    }
  };

  // フェード付きで表情を実行
  const playExpression = (expr: Expression) => {
    if (expr.chanceEligible) {
      // タップ有効ウィンドウ = フェードイン+維持時間（フェードアウト中の緩慢な変化はヒット判定に含めない）
      onChanceExpression?.(expr.name, expr.fadeIn + expr.duration);
    }
    const start = performance.now();
    const total = expr.fadeIn + expr.duration + expr.fadeOut;

    const tick = () => {
      const elapsed = performance.now() - start;
      let weight = 0;
      
      if (elapsed < expr.fadeIn) {
        weight = (elapsed / expr.fadeIn) * expr.intensity;
      } else if (elapsed < expr.fadeIn + expr.duration) {
        weight = expr.intensity;
      } else if (elapsed < total) {
        const t = (elapsed - expr.fadeIn - expr.duration) / expr.fadeOut;
        weight = expr.intensity * (1 - t);
      } else {
        setWeight(expr.name, 0);
        return;
      }
      
      setWeight(expr.name, weight);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  // まばたき（0.15秒で開閉）
  const playBlink = () => {
    const start = performance.now();
    const duration = 150; 
    const tick = () => {
      const elapsed = performance.now() - start;
      const t = elapsed / duration;
      if (t >= 1) {
        setWeight("まばたき", 0);
        return;
      }
      const w = Math.sin(t * Math.PI);
      setWeight("まばたき", w);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  // 口パク（喋っている雰囲気）
  const playTalk = () => {
    const vowels = ["あ", "い", "う", "え", "お"];
    const start = performance.now();
    const duration = 1500 + Math.random() * 1500; // 1.5〜3秒喋る
    
    const tick = () => {
      const elapsed = performance.now() - start;
      if (elapsed > duration) {
        vowels.forEach(v => setWeight(v, 0));
        return;
      }
      
      // 0.15秒ごとに母音を切り替える
      const idx = Math.floor(elapsed / 150) % vowels.length;
      vowels.forEach((v, i) => {
        // 現在の母音をランダムな強さで設定
        const weight = i === idx ? 0.2 + Math.random() * 0.4 : 0;
        setWeight(v, weight);
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  // ランダムタイマー管理
  let blinkTimer: number;
  let exprTimer: number;

  const scheduleBlink = () => {
    const wait = 3000 + Math.random() * 3000; // 3-6秒
    blinkTimer = window.setTimeout(() => {
      playBlink();
      scheduleBlink();
    }, wait);
  };

  // ゲーム側のチューニングに応じて表情チャンス対象（ウィンク/びっくり）を優先抽選する
  const pickExpression = (): Expression => {
    const ratio = getTuning?.().chanceRatio ?? 0;
    if (ratio > 0 && Math.random() < ratio) {
      return CHANCE_EXPRESSIONS[Math.floor(Math.random() * CHANCE_EXPRESSIONS.length)];
    }
    return EXPRESSIONS[Math.floor(Math.random() * EXPRESSIONS.length)];
  };

  const scheduleExpression = () => {
    const scale = getTuning?.().intervalScale ?? 1;
    const wait = (4000 + Math.random() * 5000) * scale; // 基準4-9秒 × チューニング倍率
    exprTimer = window.setTimeout(() => {
      // 30%の確率で口パク、70%の確率で通常表情
      if (Math.random() < 0.3) {
        playTalk();
      } else {
        playExpression(pickExpression());
      }
      scheduleExpression();
    }, wait);
  };

  scheduleBlink();
  scheduleExpression();

  // フィーバー中などにゲーム側がスケジューラを待たずチャンス表情を発火できるようにする
  registerChanceTrigger?.(() => {
    playExpression(CHANCE_EXPRESSIONS[Math.floor(Math.random() * CHANCE_EXPRESSIONS.length)]);
  });

  console.log("✨ Enhanced random expressions, blinking and talk-sync enabled");

  // クリーンアップ関数を返す
  return () => {
    clearTimeout(blinkTimer);
    clearTimeout(exprTimer);
  };
};
