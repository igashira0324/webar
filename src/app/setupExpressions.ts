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
  // 新規追加パターン
  { name: "怒り",     intensity: 0.8, duration: 2000, fadeIn: 300, fadeOut: 500 },
  { name: "困る",     intensity: 0.7, duration: 2500, fadeIn: 400, fadeOut: 600 },
  { name: "にやり",   intensity: 0.8, duration: 2000, fadeIn: 400, fadeOut: 500 },
  { name: "にっこり", intensity: 0.9, duration: 2500, fadeIn: 400, fadeOut: 600 },
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

  const scheduleExpression = () => {
    const wait = 4000 + Math.random() * 5000; // 4-9秒
    exprTimer = window.setTimeout(() => {
      // 30%の確率で口パク、70%の確率で通常表情
      if (Math.random() < 0.3) {
        playTalk();
      } else {
        const expr = EXPRESSIONS[Math.floor(Math.random() * EXPRESSIONS.length)];
        playExpression(expr);
      }
      scheduleExpression();
    }, wait);
  };

  scheduleBlink();
  scheduleExpression();

  console.log("✨ Enhanced random expressions, blinking and talk-sync enabled");

  // クリーンアップ関数を返す
  return () => {
    clearTimeout(blinkTimer);
    clearTimeout(exprTimer);
  };
};
