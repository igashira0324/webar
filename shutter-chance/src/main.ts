/**
 * main.ts  — shutter-chance/src/main.ts
 * 「Lyric Spark AR ― 手のひらの中で歌詞が弾ける」エントリポイント
 *
 * 処理フロー:
 *   1. AR可否判定
 *   2. モード選択UI表示
 *   3. ユーザー選択 → Babylon.js シーン初期化
 *   4. ミク(MMD)モデル + VMDロード
 *   5. TextAlive Player 初期化・楽曲ロード
 *   6. TextAlive position をマスタークロックとしてレンダーループに注入
 *   7. 歌詞演出・ビートパルス制御
 */
import { Scene } from "@babylonjs/core";
import { MmdRuntime } from "babylon-mmd";
import { loadMmdModel } from "../../src/app/loadMmdModel";

import { createStudioScene, createARScene } from "./sceneSetup";
import { TextAliveSync } from "./textAliveSync";
import { LyricDisplay } from "./lyricDisplay";
import { ShutterSystem } from "./shutterSystem";
import { Lyric3D } from "./lyric3d";
import { checkARSupport, setupFallbackBanner, showARCapableMessage } from "./arFallback";

// ──────────────────────────────────────────────
// 定数
// ──────────────────────────────────────────────
const MIKU_PMX = "/assets/model/miku.pmx";
const DANCE_VMD = "/assets/motion/dindondan.vmd";
const AR_URL = "https://webar-coral.vercel.app/shutter-chance/";

// ──────────────────────────────────────────────
// グローバル状態
// ──────────────────────────────────────────────
let taSync: TextAliveSync | null = null;
let lyricDisplay: LyricDisplay | null = null;
let lyric3d: Lyric3D | null = null;
let shutterSystem: ShutterSystem | null = null;
let mmdRuntime: MmdRuntime | null = null;
let glowLayer: any = null;
let currentPosition = 0;      // TextAlive再生位置(ms) — マスタークロック
let isPlaying = false;
let lastBeatIndex = -1;
let lastWordStartTime = -1; // 3D歌詞の重複ポップアップ防止用単語開始時刻トラッキング
let finaleTriggered = false;   // 曲終わりのフィナーレ演出が発火したかどうかのフラグ

// ── フリーズモード（光のシャッターで時を止める）
let isFrozen = false;          // フリーズ中フラグ
let frozenPosition = 0;        // フリーズ時に保存した再生位置

// 時止め・撮影ボタンの DOM参照（startApp内で取得後に代入）
let freezeShootBtnEl: HTMLButtonElement | null = null;

// 撮影枚数（コレクション型の記念記録）
let photoCount = 0;

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

  document.getElementById("loading")?.classList.add("hidden");
  modeSelect.classList.remove("hidden");

  arBtn.addEventListener("click", () => {
    modeSelect.classList.add("hidden");
    document.getElementById("loading")?.classList.remove("hidden");
    startApp("ar");
  });
  studioBtn.addEventListener("click", () => {
    modeSelect.classList.add("hidden");
    document.getElementById("loading")?.classList.remove("hidden");
    startApp("studio");
  });
}

// ──────────────────────────────────────────────
// アプリ本体起動
// ──────────────────────────────────────────────
async function startApp(mode: "ar" | "studio"): Promise<void> {
  setStatusMessage("シーンを初期化中...");

  // ① シーン作成
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  let scene: Scene;
  let shadowGenerator: any = null;
  let enterAR: (() => void) | null = null;

  if (mode === "ar") {
    const result = await createARScene(canvas);
    scene = result.scene;
    shadowGenerator = result.shadowGenerator;
    enterAR = result.enterAR ?? null;
    setupFallbackBanner(AR_URL, "fallback-banner", "qr-code", "qr-url-text");
  } else {
    const result = await createStudioScene(canvas);
    scene = result.scene;
    shadowGenerator = result.shadowGenerator;
    setupFallbackBanner(AR_URL, "fallback-banner", "qr-code", "qr-url-text");
  }

  // ② GlowLayer（歌詞の発光演出用）
  try {
    const { GlowLayer } = await import("@babylonjs/core");
    glowLayer = new GlowLayer("glow", scene);
    glowLayer.intensity = 0.8;
  } catch (e) {
    console.warn("GlowLayer unavailable:", e);
  }

  // ③ MMDランタイム + ミクモデル + VMDロード
  mmdRuntime = new MmdRuntime(scene);
  mmdRuntime.register(scene); // シーンの毎フレーム更新サイクルに組み込む

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
    // ミクのスケール・位置をデフォルト値に確実に設定（カメラとの比率を正常に保つ）
    mmdModel.mesh.scaling.setAll(0.07);
    mmdModel.mesh.position.y = 0.5;
    setStatusMessage("ミク読み込み完了");
  } catch (e) {
    console.error("MMD load failed:", e);
    setStatusMessage("⚠ モデルの読み込みに失敗しました");
  }

  // ④ TextAlive 初期化
  setStatusMessage("楽曲を読み込み中...");
  const mediaEl = document.getElementById("textalive-media")!;

  taSync = new TextAliveSync({
    onReady: () => {
      setStatusMessage("準備完了");
      showLoadingBar(false);
      showMainUI();
      // 歌詞表示を有効化
      lyricDisplay?.show();
      // ウェルカムオーバーレイを表示（3秒後に自動消える）
      showWelcomeOverlay();
    },
    onPlay: () => {
      isPlaying = true;
      const btn = document.getElementById("play-btn");
      if (btn) btn.textContent = "⏸ 一時停止";
      // 時止めボタンを表示
      freezeShootBtnEl?.classList.remove("hidden");
      updateFreezeShootBtn();
      // 再生開始時にフィナーレフラグをリセット
      finaleTriggered = false;
    },
    onPause: () => {
      isPlaying = false;
      const btn = document.getElementById("play-btn");
      if (btn) btn.textContent = "▶ 再生";
      // 停止中は時止めボタンを非表示（フリーズ中はのぞいてたまま）
      if (!isFrozen) freezeShootBtnEl?.classList.add("hidden");
    },
    onStop: () => {
      isPlaying = false;
      // フリーズモード中だった場合も解除
      if (isFrozen) exitFreezeMode();
      // 時止めボタンを非表示
      freezeShootBtnEl?.classList.add("hidden");
      // 3D歌詞をクリア（フィナーレ演出中であれば消去をスキップして余韻を残す）
      if (!finaleTriggered) {
        lyric3d?.clear();
      }
      // 曲終了 → ギャラリー表示
      setTimeout(() => openGallery(), 1500);
    },
    onTimeUpdate: (pos) => {
      // onTimeUpdate は TextAlive が再生進行に合わせて確実に発火するコールバック
      currentPosition = pos;
    },
    onError: (e) => {
      console.error("[TextAlive]", e);
      setStatusMessage("⚠ 楽曲の読み込みに失敗しました（ネットワーク確認）");
      showLoadingBar(false);
      showMainUI();
    },
  });

  await taSync.init(mediaEl);

  // ⑤ currentPosition をマスタークロックとして毎フレームMMD同期
  scene.onBeforeRenderObservable.add(() => {
    if (!taSync?.isReady) return;

    const pos = currentPosition;
    onTick(pos);

    // フリーズ中はMMDアニメーションを進めない（その瞬間のポーズで静止）
    if (!isPlaying || !mmdRuntime || isFrozen) return;
    mmdRuntime.seekAnimation((pos / 1000) * 30, true);
  });

  // ⑥ サブシステム初期化
  lyricDisplay = new LyricDisplay("lyric-word", "lyric-phrase");
  lyric3d = new Lyric3D(scene);
  shutterSystem = new ShutterSystem("flash", "photo-stack", canvas);

  // 撮影コールバック（shutterSystem.shoot（）のラッパー— 直接撮影のみ）
  shutterSystem.setManualShutterCallback(() => {
    const lyric = document.getElementById("lyric-word")?.textContent ?? "";
    shutterSystem?.shoot(lyric);
  });

  // 写真追加時に枚数カウントを更新
  shutterSystem.setOnPhotoCapturedCallback(() => {
    photoCount++;
    updatePhotoCount();
  });

  // ── #freeze-shoot-btn: 時止め・撮影の切り替わりボタン ──
  const freezeShootBtn = document.getElementById("freeze-shoot-btn") as HTMLButtonElement | null;
  freezeShootBtn?.addEventListener("click", () => {
    if (!isFrozen) {
      // 「時を止める」→ フリーズモードへ
      enterFreezeMode();
    } else {
      // 「撮影」→ 決定的瞬間を撮影して自動再開
      const lyric = document.getElementById("lyric-word")?.textContent ?? "";
      shutterSystem?.shoot(lyric);
      exitFreezeMode();
    }
  });
  // freezeShootBtnElにDOM参照を保持（enterFreezeMode/exitFreezeModeから参照可能にする）
  freezeShootBtnEl = freezeShootBtn;


  // ⑦ 再生ボタン
  const playBtn = document.getElementById("play-btn");
  playBtn?.addEventListener("click", () => {
    if (isPlaying) {
      taSync?.pause();
    } else {
      taSync?.play();
    }
  });

  // ⑧ ギャラリーボタン
  document.getElementById("gallery-btn")?.addEventListener("click", openGallery);
  document.getElementById("gallery-close")?.addEventListener("click", () => {
    document.getElementById("gallery-modal")?.classList.add("hidden");
  });

  // ⑨ クレジットボタン
  document.getElementById("credits-btn")?.addEventListener("click", () => {
    document.getElementById("credits-modal")?.classList.remove("hidden");
  });
  document.getElementById("credits-close")?.addEventListener("click", () => {
    document.getElementById("credits-modal")?.classList.add("hidden");
  });

  // ⑩ フリーズ「▶ 再開」ボタン
  document.getElementById("freeze-resume-btn")?.addEventListener("click", () => {
    exitFreezeMode();
  });

  // ⑪ Fキーによるフィナーレ演出（舞い上がり）のデバッグ強制発火用ショートカット
  document.addEventListener("keydown", (e) => {
    if (e.code === "KeyF" && !e.repeat) {
      console.log("[main] Debug key F: Triggering finale manually");
      triggerFinale();
    }
  });

  // ⑩ AR起動ボタン（ARモード時）
  if (mode === "ar" && enterAR) {
    const arStartBtn = document.getElementById("ar-start-btn");
    if (arStartBtn) {
      arStartBtn.classList.remove("hidden");
      arStartBtn.addEventListener("click", () => enterAR!());
    }
  }
}

// ──────────────────────────────────────────────
// レンダーループ毎 of サブシステム更新
// ──────────────────────────────────────────────
function onTick(position: number): void {
  if (!taSync?.isReady) return;

  const isInChorus = taSync.isInChorus(position);

  // サビ区間の発光強度制御
  if (glowLayer) {
    glowLayer.intensity = isInChorus ? 1.2 : 0.8;
  }

  // 1. 3D空間の歌詞ポップアップ制御（自立語＋助詞結合した単語ベースでのポップ）
  const wordInfo = taSync.getMergedWordInfo(position);
  if (wordInfo) {
    if (wordInfo.startTime !== lastWordStartTime) {
      lastWordStartTime = wordInfo.startTime;
      const text = wordInfo.text.trim();
      if (text.length > 0) {
        // 3D空間に単語を表示（表示時間は lyric3d 内部で管理）
        lyric3d?.spawnWord(text, 0, isInChorus);
      }
    }
  } else {
    // 現在再生位置で単語が得られない場合はトラッキングをリセット
    // ※ 助詞でスキップされている間は lastWordStartTime をリセットせず維持する
    if (!taSync.getCurrentWord(position)) {
      lastWordStartTime = -1;
    }
  }

  // 毎フレーム 3D歌詞のアニメーション（フェードアウト、上昇等）を更新
  lyric3d?.update();

  // 2. 既存の平面DOM歌詞表示（補助）
  const word = taSync.getCurrentWord(position);
  const phrase = taSync.getCurrentPhrase(position);
  lyricDisplay?.update(word, phrase);

  // ビート検出とパルス演出（歌詞とビューファインダーをビートに合わせて光らせる）
  const beat = taSync.getCurrentBeat(position);
  if (beat && beat.index !== lastBeatIndex) {
    lastBeatIndex = beat.index;
    triggerBeatPulse();         // DOM歌詞 / ビューファインダーのパルス
    lyric3d?.triggerBeatPulse(); // 3D歌詞パネルも一瞬拡大させる
  }

  // シャッターシステム（ビューファインダー表示制御）
  const currentChorusStart = taSync.getCurrentChorusStart(position);
  const nextChorus = taSync.getNextChorusStart(position);
  shutterSystem?.update(position, isInChorus, currentChorusStart, nextChorus, word ?? "");

  // 3. 曲終わりの舞い上がりエンディング演出の監視
  if (taSync?.isReady && !finaleTriggered) {
    const duration = taSync.getDuration();
    if (duration > 0 && (duration - position) < 2500) {
      triggerFinale();
    }
  }
}

/** 曲終わりの舞い上がりフィナーレ演出をトリガーする */
function triggerFinale(): void {
  if (finaleTriggered) return;
  finaleTriggered = true;
  console.log("[main] Triggering Finale Lyric Rise...");
  lyric3d?.triggerFinale();
}

// ──────────────────────────────────────────────
// ギャラリー
// ──────────────────────────────────────────────
function openGallery(): void {
  shutterSystem?.showGallery("gallery-grid");
  const modal = document.getElementById("gallery-modal");
  if (modal) {
    modal.classList.remove("hidden");
    const grid = document.getElementById("gallery-grid");
    if (grid && grid.children.length === 0) {
      grid.innerHTML = `<p style="color:#a0b0d0;text-align:center;padding:40px;">
        まだ思い出がありません。<br>📷 画面をタップして歌詞の瞬間を残そう！
      </p>`;
    }
  }
}

// ──────────────────────────────────────────────
// UIヘルパー
// ──────────────────────────────────────────────

/** 撮影枚数表示を更新する */
function updatePhotoCount(): void {
  const el = document.getElementById("photo-count");
  if (el) el.textContent = `📷 ${photoCount}枚`;
}

/** ビートに合わせて歌詞とビューファインダーをパルス発光させる */
function triggerBeatPulse(): void {
  const lyricWord = document.getElementById("lyric-word");
  if (lyricWord) {
    lyricWord.classList.remove("beat-pulse");
    void lyricWord.offsetWidth;
    lyricWord.classList.add("beat-pulse");
  }

  const vfFrame = document.querySelector(".vf-frame") as HTMLElement;
  if (vfFrame) {
    vfFrame.classList.remove("beat-pulse-glow");
    void vfFrame.offsetWidth;
    vfFrame.classList.add("beat-pulse-glow");
  }
}

/**
 * #freeze-shoot-btnのラベル・アイコン・クラスを isFrozen の状態に合わせて更新
 * フリーズ中: マゼンタで「📷 撮影」
 * 通常時: シアンで「⏳ 時を止める」
 */
function updateFreezeShootBtn(): void {
  if (!freezeShootBtnEl) return;
  if (isFrozen) {
    freezeShootBtnEl.textContent = "📷 撮影";
    freezeShootBtnEl.classList.add("shooting");
  } else {
    freezeShootBtnEl.textContent = "⏳ 時を止める";
    freezeShootBtnEl.classList.remove("shooting");
  }
}

// ──────────────────────────────────────────────
// フリーズモード（光のシャッターで時を止める）
// ──────────────────────────────────────────────

/**
 * フリーズモードに入る
 * - TextAlive の再生を一時停止してミクのポーズを固定
 * - 3D歌詞のアニメーションも止める
 * - フリーズUI（撮影ボタン・再開ボタン・閃光）を表示
 */
function enterFreezeMode(): void {
  if (isFrozen) return;
  isFrozen = true;
  frozenPosition = currentPosition;

  // TextAlive 一時停止（ミクのポーズも onBeforeRender で止まる）
  taSync?.pause();
  isPlaying = false;

  // 3D歌詞を止める
  lyric3d?.setFrozen(true);

  // 閃光エフェクト
  const flash = document.getElementById("flash");
  if (flash) {
    flash.style.opacity = "1";
    flash.style.background = "radial-gradient(ellipse at center, rgba(200,240,255,0.95) 0%, rgba(100,200,255,0.6) 40%, transparent 70%)";
    setTimeout(() => { if (flash) flash.style.opacity = "0"; }, 300);
  }

  // フリーズUI を表示
  const freezeUi = document.getElementById("freeze-ui");
  if (freezeUi) freezeUi.classList.remove("hidden");

  // 再生ボタンテキストを「▶ 再生」に更新
  const playBtn = document.getElementById("play-btn");
  if (playBtn) playBtn.textContent = "▶ 再生";

  // 時止めボタンを「📷 撮影」表示に切り替え
  updateFreezeShootBtn();

  // GlowLayer を強めて「止まった世界」感を演出
  if (glowLayer) glowLayer.intensity = 2.0;
}

/**
 * フリーズモードを解除して再生を再開する
 */
function exitFreezeMode(): void {
  if (!isFrozen) return;
  isFrozen = false;

  // 3D歌詞を再開
  lyric3d?.setFrozen(false);

  // フリーズUI を隠す
  const freezeUi = document.getElementById("freeze-ui");
  if (freezeUi) freezeUi.classList.add("hidden");

  // 時止めボタンを「⏳ 時を止める」表示に戻す
  updateFreezeShootBtn();

  // TextAlive 再生を再開
  taSync?.play();

  // GlowLayer を通常輝度に戻す
  if (glowLayer) glowLayer.intensity = 0.8;
}

/**
 * ウェルカムオーバーレイを表示し、3秒後に自動フェードアウト。
 * リリックアプリの世界観をひと言で伝える。
 */
function showWelcomeOverlay(): void {
  const el = document.getElementById("rule-overlay");
  if (!el) return;
  el.classList.remove("hidden");
  el.classList.add("fade-in");
  setTimeout(() => {
    el.classList.add("fade-out");
    setTimeout(() => {
      el.classList.add("hidden");
      el.classList.remove("fade-in", "fade-out");
    }, 600);
  }, 3000);
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
