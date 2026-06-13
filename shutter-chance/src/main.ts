/**
 * main.ts  — shutter-chance/src/main.ts
 * 「Shutter Chance AR ― ミクと撮る一瞬」 エントリポイント
 *
 * 処理フロー:
 *   1. AR可否判定
 *   2. モード選択UI表示
 *   3. ユーザー選択 → Babylon.js シーン初期化
 *   4. ミク(MMD)モデル + VMDロード
 *   5. TextAlive Player 初期化・楽曲ロード
 *   6. TextAlive position をマスタークロックとしてレンダーループに注入
 *   7. サビ演出・歌詞オーバーレイ制御
 */
import { Scene } from "@babylonjs/core";
import { MmdRuntime } from "babylon-mmd";
import { loadMmdModel } from "../../src/app/loadMmdModel";

import { createStudioScene, createARScene } from "./sceneSetup";
import { TextAliveSync } from "./textAliveSync";
import { LyricDisplay } from "./lyricDisplay";
import { ShutterSystem } from "./shutterSystem";
import { checkARSupport, setupFallbackBanner, showARCapableMessage } from "./arFallback";

// ──────────────────────────────────────────────
// 定数
// ──────────────────────────────────────────────
const MIKU_PMX = "/assets/model/miku.pmx"; // 既存アセットを流用（絶対パス指定）
// 要確認: 「シャッターチャンス」専用VMDがあればここを変更
const DANCE_VMD = "/assets/motion/dindondan.vmd";
const AR_URL = "https://webar-coral.vercel.app/shutter-chance/";

// ──────────────────────────────────────────────
// グローバル状態
// ──────────────────────────────────────────────
let taSync: TextAliveSync | null = null;
let lyricDisplay: LyricDisplay | null = null;
let shutterSystem: ShutterSystem | null = null;
let mmdRuntime: MmdRuntime | null = null;
let currentPosition = 0; // TextAlive再生位置(ms) — マスタークロック
let isPlaying = false;
let lastBeatIndex = -1;

// タイミングゲームの得点状態
let score = 0;
let perfectCount = 0;
let goodCount = 0;
let missCount = 0;

// ──────────────────────────────────────────────
// 初期化
// ──────────────────────────────────────────────
async function init() {
  // ① AR可否判定
  const arSupported = await checkARSupport();
  setStatusMessage(arSupported
    ? "✨ ARモード対応端末です"
    : "🎬 スタジオモードで起動します");

  if (arSupported) {
    showARCapableMessage("ar-status-area");
  }

  // ② モード選択UI
  showModeSelect(arSupported);
}

// ──────────────────────────────────────────────
// モード選択
// ──────────────────────────────────────────────
function showModeSelect(arSupported: boolean): void {
  const modeSelect = document.getElementById("mode-select")!;
  const arBtn = document.getElementById("btn-ar")!;
  const studioBtn = document.getElementById("btn-studio")!;

  if (!arSupported) {
    arBtn.setAttribute("disabled", "true");
    arBtn.style.opacity = "0.4";
    arBtn.title = "この端末はAR非対応です";
  }

  // Hide the loading screen so that the mode-select screen is visible and clickable
  document.getElementById("loading")?.classList.add("hidden");
  modeSelect.classList.remove("hidden");

  arBtn.addEventListener("click", () => {
    modeSelect.classList.add("hidden");
    // Show loading screen again while loading model assets
    document.getElementById("loading")?.classList.remove("hidden");
    startApp("ar");
  });
  studioBtn.addEventListener("click", () => {
    modeSelect.classList.add("hidden");
    // Show loading screen again while loading model assets
    document.getElementById("loading")?.classList.remove("hidden");
    startApp("studio");
  });
}

// ──────────────────────────────────────────────
// アプリ本体起動
// ──────────────────────────────────────────────
async function startApp(mode: "ar" | "studio") {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  setStatusMessage("ロード中...");
  showLoadingBar(true);

  // ③ Babylon.js シーン構築
  let enterAR: (() => Promise<void>) | undefined;
  let scene: Scene;
  let shadowGenerator: any;

  if (mode === "ar") {
    const bundle = await createARScene(canvas);
    scene = bundle.scene;
    shadowGenerator = bundle.shadowGenerator;
    enterAR = bundle.enterAR;
  } else {
    const bundle = await createStudioScene(canvas);
    scene = bundle.scene;
    shadowGenerator = bundle.shadowGenerator;
  }

  // AR非対応環境 → フォールバックバナー表示
  if (mode === "studio") {
    setupFallbackBanner("ar-fallback-banner", AR_URL);
    document.body.classList.add("has-fallback-banner");
  }

  // ④ MMDランタイム + ミクモデル + VMDロード
  mmdRuntime = new MmdRuntime(scene);
  mmdRuntime.register(scene); // 必須: これでランタイムがシーンの毎フレーム更新サイクルに組み込まれる

  setStatusMessage("ミクを読み込み中...");
  let mmdModel: any = null;
  try {
    const result = await loadMmdModel(
      scene,
      mmdRuntime,
      MIKU_PMX,
      DANCE_VMD,
      shadowGenerator,
      undefined,
      (ev) => {
        if (ev.lengthComputable && ev.total > 0) {
          updateLoadingProgress(Math.floor((ev.loaded / ev.total) * 100));
        }
      }
    );

    mmdModel = result.model;
    mmdModel.mesh.scaling.setAll(0.07);
    mmdModel.mesh.position.y = 0.5;
  } catch (e) {
    console.error("Model load failed:", e);
    setStatusMessage("⚠ モデルの読み込みに失敗しました");
  }

  // ⑤ TextAlive 初期化
  setStatusMessage("楽曲を読み込み中...");
  const mediaEl = document.getElementById("textalive-media")!;

  taSync = new TextAliveSync({
    onReady: () => {
      setStatusMessage("準備完了");
      showLoadingBar(false);
      showMainUI();
      // 歌詞表示を有効化（これを呼ばないと歌詞 DOM が出ない）
      lyricDisplay?.show();
    },
    onPlay: () => {
      isPlaying = true;
      const btn = document.getElementById("play-btn");
      if (btn) btn.textContent = "⏸ 一時停止";
    },
    onPause: () => {
      isPlaying = false;
      const btn = document.getElementById("play-btn");
      if (btn) btn.textContent = "▶ 再生";
    },
    onStop: () => {
      isPlaying = false;
      // 曲終了 → ギャラリー表示
      setTimeout(() => openGallery(), 1500);
    },
    onTimeUpdate: (pos) => {
      // onTimeUpdate は TextAlive が再生の進行に合わせて確実に発火するコールバック
      // timer.position より信頼性が高いので、ここで currentPosition を更新する
      currentPosition = pos;
      console.log("[onTimeUpdate]", Math.round(pos), "ms"); // DEBUG: 発火確認用
    },
    onError: (e) => {
      console.error("[TextAlive]", e);
      setStatusMessage("⚠ 楽曲の読み込みに失敗しました（ネットワーク確認）");
      showLoadingBar(false);
      showMainUI(); // エラーでもUI表示
    },
  });

  await taSync.init(mediaEl);

  // ⑥ currentPosition （onTimeUpdate から更新）をマスタークロックとしてMMD同期
  // timer.position が込まない環境でも onTimeUpdate は確実に発火するため、こちらを使う
  scene.onBeforeRenderObservable.add(() => {
    if (!taSync?.isReady) return;

    // currentPosition を常に使う（isPlaying 時は onTimeUpdate が更新する）
    const pos = currentPosition;
    onTick(pos);

    if (!isPlaying || !mmdRuntime) return;
    mmdRuntime.seekAnimation((pos / 1000) * 30, true);
  });

  // ⑦ サブシステム初期化
  lyricDisplay = new LyricDisplay("lyric-word", "lyric-phrase");
  shutterSystem = new ShutterSystem("viewfinder", "flash", "photo-stack", canvas);

  // 手動撮影コールバック
  shutterSystem.setManualShutterCallback(() => {
    const lyric = lyricDisplay ? (document.getElementById("lyric-word")?.textContent ?? "") : "";
    
    // リズム判定計算
    let rating: "PERFECT" | "GOOD" | "MISS" = "MISS";
    if (taSync && taSync.isReady) {
      const pos = taSync.getPosition();
      const beat = taSync.getCurrentBeat(pos);
      if (beat) {
        const distToCurrentBeat = Math.abs(pos - beat.startTime);
        const distToNextBeat = Math.abs(pos - (beat.startTime + beat.duration));
        const timingOffset = Math.min(distToCurrentBeat, distToNextBeat);
        
        if (timingOffset < 80) {
          rating = "PERFECT";
        } else if (timingOffset < 180) {
          rating = "GOOD";
        }
      }
    }
    shutterSystem?.shoot(lyric, rating);
  });

  // 撮影成功時のスコア処理・HUD更新コールバック
  shutterSystem.setOnPhotoCapturedCallback((photo) => {
    const rating = photo.rating === "AUTO" ? "PERFECT" : (photo.rating ?? "MISS");
    if (rating === "PERFECT") {
      score += 1000;
      perfectCount++;
      showRatingPop("PERFECT");
    } else if (rating === "GOOD") {
      score += 500;
      goodCount++;
      showRatingPop("GOOD");
    } else if (rating === "MISS") {
      missCount++;
      showRatingPop("MISS");
    }
    updateGameHUD();
  });

  // ⑧ 再生ボタン
  const playBtn = document.getElementById("play-btn");
  playBtn?.addEventListener("click", () => {
    if (isPlaying) {
      taSync?.pause();
    } else {
      taSync?.play();
    }
  });

  // ⑨ ギャラリーボタン
  document.getElementById("gallery-btn")?.addEventListener("click", openGallery);
  document.getElementById("gallery-close")?.addEventListener("click", () => {
    document.getElementById("gallery-modal")?.classList.add("hidden");
  });

  // ⑩ クレジットボタン
  document.getElementById("credits-btn")?.addEventListener("click", () => {
    document.getElementById("credits-modal")?.classList.remove("hidden");
  });
  document.getElementById("credits-close")?.addEventListener("click", () => {
    document.getElementById("credits-modal")?.classList.add("hidden");
  });

  // ⑪ AR起動ボタン（ARモード時）
  if (mode === "ar" && enterAR) {
    const arStartBtn = document.getElementById("ar-start-btn");
    if (arStartBtn) {
      arStartBtn.classList.remove("hidden");
      arStartBtn.addEventListener("click", () => enterAR!());
    }
  }

  // ⑫ 戻るリンク
  // （index.htmlのナビで対応済み）
}

// ──────────────────────────────────────────────
// レンダーループ毎のサブシステム更新
// ──────────────────────────────────────────────
function onTick(position: number): void {
  if (!taSync?.isReady) return;

  // DEBUG: 再生位置の確認用ログ（position が 0 のまま動かない場合は同期方式を変える必要あり）
  if (isPlaying && Math.floor(position / 500) !== Math.floor((position - 16) / 500)) {
    console.log("[onTick] pos:", Math.round(position), "ms");
  }

  // 歌詞表示
  const word = taSync.getCurrentWord(position);
  const phrase = taSync.getCurrentPhrase(position);
  lyricDisplay?.update(word, phrase);

  // ビート検出とパルス演出
  const beat = taSync.getCurrentBeat(position);
  if (beat && beat.index !== lastBeatIndex) {
    lastBeatIndex = beat.index;
    triggerBeatPulse();
  }

  // シャッターシステム
  const isInChorus = taSync.isInChorus(position);
  const currentChorusStart = taSync.getCurrentChorusStart(position);
  const nextChorus = taSync.getNextChorusStart(position);
  shutterSystem?.update(position, isInChorus, currentChorusStart, nextChorus, word ?? "");
}

// ──────────────────────────────────────────────
// ギャラリー
// ──────────────────────────────────────────────
function openGallery(): void {
  shutterSystem?.showGallery("gallery-grid");
  const modal = document.getElementById("gallery-modal");
  if (modal) {
    modal.classList.remove("hidden");
    // 写真がない場合のメッセージ
    const grid = document.getElementById("gallery-grid");
    if (grid && grid.children.length === 0) {
      grid.innerHTML = `<p style="color:#a0b0d0;text-align:center;padding:40px;">
        まだ写真がありません。<br>サビのタイミングでシャッターが切られます！
      </p>`;
    }
  }
}

// ──────────────────────────────────────────────
// UIヘルパー
// ──────────────────────────────────────────────
function updateGameHUD(): void {
  const scoreEl = document.getElementById("hud-score");
  const perfEl = document.getElementById("hud-perf-count");
  const goodEl = document.getElementById("hud-good-count");
  const missEl = document.getElementById("hud-miss-count");

  if (scoreEl) scoreEl.textContent = score.toString();
  if (perfEl) perfEl.textContent = perfectCount.toString();
  if (goodEl) goodEl.textContent = goodCount.toString();
  if (missEl) missEl.textContent = missCount.toString();
}

function showRatingPop(rating: "PERFECT" | "GOOD" | "MISS"): void {
  const el = document.getElementById("game-rating");
  if (!el) return;
  el.className = `rating-pop animate ${rating.toLowerCase()}`;
  el.textContent = rating + "!";
  
  setTimeout(() => {
    el.classList.remove("animate");
  }, 800);
}

function triggerBeatPulse(): void {
  // Pulse the lyric word
  const lyricWord = document.getElementById("lyric-word");
  if (lyricWord) {
    lyricWord.classList.remove("beat-pulse");
    void lyricWord.offsetWidth; // Force reflow
    lyricWord.classList.add("beat-pulse");
  }

  // Pulse the viewfinder frame (glow effect)
  const vfFrame = document.querySelector(".vf-frame") as HTMLElement;
  if (vfFrame) {
    vfFrame.classList.remove("beat-pulse-glow");
    void vfFrame.offsetWidth; // Force reflow
    vfFrame.classList.add("beat-pulse-glow");
  }
}

function setStatusMessage(msg: string): void {
  const el = document.getElementById("status-message");
  if (el) el.textContent = msg;
}

function showLoadingBar(visible: boolean): void {
  const el = document.getElementById("loading-bar");
  if (el) el.style.display = visible ? "flex" : "none";
}

function updateLoadingProgress(pct: number): void {
  const el = document.getElementById("loading-progress");
  if (el) el.style.width = `${pct}%`;
}

function showMainUI(): void {
  document.getElementById("main-ui")?.classList.remove("hidden");
  document.getElementById("loading")?.classList.add("hidden");
}

// ──────────────────────────────────────────────
// エントリ
// ──────────────────────────────────────────────
init();
