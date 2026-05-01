export interface Lyric {
  time: number;
  duration: number;
  text: string;
  animation: 'fadeInUp' | 'fadeInDown' | 'bounceIn' | 'typewriter' | 'scaleUp' | 'slideFromLeft' | 'slideFromRight' | 'glitch' | 'explode' | 'wave';
  style: 'normal' | 'glow' | 'neon' | 'outline' | 'gradient' | 'fire';
  isChorus?: boolean;
}

export interface PoseTarget {
  time: number;
  pose: {
    leftArm: number; // angle in degrees
    rightArm: number;
    leftLeg: number;
    rightLeg: number;
  };
  name: string;
}

export const SONG_DURATION = 35;

export const DEMO_LYRICS: Lyric[] = [
  { time: 0.5, duration: 2.0, text: "光の中で", animation: "fadeInUp", style: "glow" },
  { time: 2.5, duration: 2.0, text: "AIが目覚める", animation: "typewriter", style: "neon" },
  { time: 4.5, duration: 2.5, text: "デジタルの鼓動", animation: "scaleUp", style: "gradient" },
  { time: 7.0, duration: 2.0, text: "境界を超えて", animation: "slideFromLeft", style: "outline" },
  { time: 9.0, duration: 2.5, text: "君と繋がる", animation: "fadeInDown", style: "normal" },
  { time: 11.5, duration: 2.0, text: "夢と現実の", animation: "glitch", style: "neon" },
  { time: 13.5, duration: 2.5, text: "狭間で踊ろう", animation: "wave", style: "gradient" },
  { time: 16.0, duration: 3.0, text: "踊れ！ 踊れ！ AIダンスフロア！", animation: "scaleUp", style: "fire", isChorus: true },
  { time: 19.0, duration: 3.0, text: "未来を今、刻み込め", animation: "bounceIn", style: "glow", isChorus: true },
  { time: 22.0, duration: 2.5, text: "光の速さで", animation: "slideFromRight", style: "outline" },
  { time: 24.5, duration: 2.5, text: "加速する世界", animation: "explode", style: "fire" },
  { time: 27.0, duration: 3.0, text: "終わらない夜を", animation: "fadeInUp", style: "neon" },
  { time: 30.0, duration: 4.0, text: "AI Dance Challenge!", animation: "scaleUp", style: "glow", isChorus: true },
];

export const DEMO_POSES: PoseTarget[] = [
  { time: 4.0, name: "両手アップ", pose: { leftArm: 160, rightArm: 160, leftLeg: 0, rightLeg: 0 } },
  { time: 8.0, name: "右手を横に", pose: { leftArm: 0, rightArm: 90, leftLeg: 0, rightLeg: 0 } },
  { time: 12.0, name: "左手を横に", pose: { leftArm: 90, rightArm: 0, leftLeg: 0, rightLeg: 0 } },
  { time: 16.0, name: "サビ：Vポーズ", pose: { leftArm: 135, rightArm: 135, leftLeg: 20, rightLeg: 20 } },
  { time: 20.0, name: "サビ：クロス", pose: { leftArm: 45, rightArm: 45, leftLeg: 0, rightLeg: 0 } },
  { time: 24.0, name: "スクワット", pose: { leftArm: 0, rightArm: 0, leftLeg: 45, rightLeg: 45 } },
  { time: 28.0, name: "フィニッシュ", pose: { leftArm: 180, rightArm: 180, leftLeg: 0, rightLeg: 0 } },
];
