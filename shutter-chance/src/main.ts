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
import { MmdRuntime, StreamAudioPlayer } from "babylon-mmd";
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
let audioPlayer: StreamAudioPlayer | null = null;
let currentPosition = 0; // TextAlive再生位置(ms) — マスタークロック
let isPlaying = false;

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

  modeSelect.classList.remove("hidden");

  arBtn.addEventListener("click", () => {
    modeSelect.classList.add("hidden");
    startApp("ar");
  });
  studioBtn.addEventListener("click", () => {
    modeSelect.classList.add("hidden");
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
  }

  // ④ MMDランタイム + ミクモデル + VMDロード
  mmdRuntime = new MmdRuntime(scene);
  mmdRuntime.register(scene);
  audioPlayer = new StreamAudioPlayer(scene);
  await mmdRuntime.setAudioPlayer(audioPlayer);

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
  // StreamAudioPlayerの内部HTMLAudioElementをTextAliveのmediaElementとして使用する
  const audio = (audioPlayer as any)._audio || (audioPlayer as any).audio;

  taSync = new TextAliveSync({
    onReady: () => {
      setStatusMessage("準備完了");
      showLoadingBar(false);
      showMainUI();
    },
    onPlay: () => {
      isPlaying = true;
      const btn = document.getElementById("play-btn");
      if (btn) btn.textContent = "⏸ 一時停止";
      mmdRuntime?.playAnimation();
    },
    onPause: () => {
      isPlaying = false;
      const btn = document.getElementById("play-btn");
      if (btn) btn.textContent = "▶ 再生";
      mmdRuntime?.pauseAnimation();
    },
    onStop: () => {
      isPlaying = false;
      mmdRuntime?.pauseAnimation();
      // 曲終了 → ギャラリー表示
      setTimeout(() => openGallery(), 1500);
    },
    onTimeUpdate: (pos) => {
      currentPosition = pos;
      onTick(pos);
    },
    onError: (e) => {
      console.error("[TextAlive]", e);
      setStatusMessage("⚠ 楽曲の読み込みに失敗しました（ネットワーク確認）");
      showLoadingBar(false);
      showMainUI(); // エラーでもUI表示
    },
  });

  if (audio) {
    await taSync.init(audio as any);
  } else {
    // フォールバックとしてDOM上の要素を使用
    const mediaEl = document.getElementById("textalive-media")!;
    await taSync.init(mediaEl);
  }

  // ⑥ 毎フレーム、オーディオプレイヤーのcurrentTimeに基づいて演出と歌詞を同期
  scene.onBeforeRenderObservable.add(() => {
    if (!isPlaying || !audioPlayer) return;
    const pos = audioPlayer.currentTime * 1000;
    currentPosition = pos;
    onTick(pos);
  });

  // ⑦ サブシステム初期化
  lyricDisplay = new LyricDisplay("lyric-word", "lyric-phrase");
  shutterSystem = new ShutterSystem("viewfinder", "flash", "photo-stack", canvas);

  // 手動撮影コールバック
  shutterSystem.setManualShutterCallback(() => {
    const lyric = lyricDisplay ? (document.getElementById("lyric-word")?.textContent ?? "") : "";
    shutterSystem?.shoot(lyric);
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

  // 歌詞表示
  const word = taSync.getCurrentWord(position);
  const phrase = taSync.getCurrentPhrase(position);
  lyricDisplay?.update(word, phrase);

  // シャッターシステム
  const isInChorus = taSync.isInChorus(position);
  const nextChorus = taSync.getNextChorusStart(position);
  shutterSystem?.update(position, isInChorus, nextChorus, word ?? "");
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
