import { Scene } from "@babylonjs/core";
import { MmdModel } from "babylon-mmd";

interface Expression {
  name: string;       // モーフ名
  intensity: number;  // 強さ (0.0〜1.0)
  duration: number;   // 表情を維持する時間 (ms)
  fadeIn: number;     // フェードイン時間 (ms)
  fadeOut: number;    // フェードアウト時間 (ms)
}

// 表情パターン（MMD標準モーフ名）
const EXPRESSIONS: Expression[] = [
  { name: "笑い",     intensity: 0.8, duration: 2500, fadeIn: 400, fadeOut: 600 },
  { name: "ウィンク",  intensity: 1.0, duration: 800,  fadeIn: 150, fadeOut: 300 },
  { name: "ウィンク2", intensity: 1.0, duration: 800,  fadeIn: 150, fadeOut: 300 },
  { name: "なごみ",   intensity: 0.7, duration: 3000, fadeIn: 500, fadeOut: 700 },
  { name: "じと目",   intensity: 0.6, duration: 2000, fadeIn: 400, fadeOut: 500 },
  { name: "びっくり", intensity: 0.7, duration: 1200, fadeIn: 200, fadeOut: 400 },
  { name: "にこり",   intensity: 0.8, duration: 2500, fadeIn: 400, fadeOut: 600 },
];

/**
 * MMDモデルにランダムな表情（まばたき、笑顔、ウィンク等）を設定します。
 */
export const setupExpressions = (_scene: Scene, model: MmdModel) => {
  const morph = model.morph;
  if (!morph) {
    console.warn("Model has no morph controller");
    return () => {};
  }

  // 利用可能なモーフ名を一覧表示（開発デバッグ用）
  try {
    // babylon-mmd の内部構造から利用可能なモーフ名を抽出
    const available = (morph as any)._morphTargets?.map((m: any) => m.name) ||
                      (morph as any).morphs?.map((m: any) => m.name) || [];
    console.log("MMD Available morphs:", available);
  } catch (e) { /* ignore */ }

  // 安全にモーフ値を設定するヘルパー
  const setWeight = (name: string, value: number) => {
    try {
      morph.setMorphWeight(name, value);
    } catch (e) {
      // モーフが存在しない場合はスキップ
    }
  };

  // フェード付きで表情を実行
  const playExpression = (expr: Expression) => {
    const start = performance.now();
    const total = expr.fadeIn + expr.duration + expr.fadeOut;

    const tick = () => {
      const elapsed = performance.now() - start;
      let weight = 0;
      
      if (elapsed < expr.fadeIn) {
        // フェードイン
        weight = (elapsed / expr.fadeIn) * expr.intensity;
      } else if (elapsed < expr.fadeIn + expr.duration) {
        // 維持
        weight = expr.intensity;
      } else if (elapsed < total) {
        // フェードアウト
        const t = (elapsed - expr.fadeIn - expr.duration) / expr.fadeOut;
        weight = expr.intensity * (1 - t);
      } else {
        // 終了
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

  const scheduleExpression = () => {
    const wait = 5000 + Math.random() * 5000; // 5-10秒
    exprTimer = window.setTimeout(() => {
      const expr = EXPRESSIONS[Math.floor(Math.random() * EXPRESSIONS.length)];
      playExpression(expr);
      scheduleExpression();
    }, wait);
  };

  scheduleBlink();
  scheduleExpression();

  console.log("✨ Random expressions and blinking enabled for model");

  // クリーンアップ関数を返す
  return () => {
    clearTimeout(blinkTimer);
    clearTimeout(exprTimer);
  };
};
