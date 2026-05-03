import { createScene } from './app/createScene';
import { createMmdRuntime } from './app/mmdRuntime';
import { loadMmdModel, loadMmdModelFromFiles } from './app/loadMmdModel';
import { setupUI } from './app/setupUI';
import { setupWebXR } from './app/setupWebXR';
import { setupPerformanceControls } from './app/performance';
import { MmdModel, StreamAudioPlayer } from 'babylon-mmd';
// Note: Do NOT import @babylonjs/core/Audio/audioSceneComponent
// babylon-mmd's StreamAudioPlayer uses HTML Audio elements, not Babylon.js AudioV2.
// Importing audioSceneComponent causes "Class extends value undefined" errors
// due to Vite code-splitting breaking the AudioV2 module chain.

async function init() {
    console.log("App Initialization - Version 2.8");
    
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    if (!canvas) return;

    // 1. Initialize Scene
    const { scene, shadowGenerator } = await createScene(canvas);

    // 2. Initialize MMD Runtime
    const mmdRuntime = createMmdRuntime(scene);
    (scene as any).mmdRootRuntime = mmdRuntime; // Explicitly store for AR access

    // 2.1 Initialize Audio Player
    const audioPlayer = new StreamAudioPlayer(scene);

    let currentModel: MmdModel | null = null;

    // Helper to get current model for UI
    const getCurrentModel = () => currentModel;

    // 3. Load Default Model (Phase 2)
    const loadingScreen = document.getElementById("loading-screen") as HTMLDivElement;
    const loadingStatus = document.getElementById("loading-status") as HTMLSpanElement;
    try {
        currentModel = await loadMmdModel(
            scene, 
            mmdRuntime, 
            "assets/model/miku.pmx", 
            "assets/motion/dance.vmd",
            shadowGenerator,
            undefined,
            (event) => {
                if (event.lengthComputable && event.total > 0) {
                    const percentage = Math.floor((event.loaded / event.total) * 100);
                    if (loadingStatus) loadingStatus.textContent = `${percentage}%`;
                } else {
                    if (loadingStatus) loadingStatus.textContent = "読み込み中... (v2.8)";
                }
            }
        );
        if (currentModel) {
            currentModel.mesh.scaling.setAll(0.07); // Default scale 0.07 (approx 1/3 of original 0.2)
            currentModel.mesh.position.set(0, 0, 0); 
            
            // Start animation only after user interaction (handled by UI)
            // mmdRuntime.playAnimation();

            // Initialize WebXR Native UI immediately
            setupWebXR(scene, [currentModel.mesh as any], audioPlayer);
        }
    } catch (e: any) {
        console.error("Default assets loading failed:", e);
        if (loadingStatus) {
            loadingStatus.style.color = "#ff4444";
            loadingStatus.textContent = `エラー: ${e.message || "ファイルの読み込みに失敗しました"}`;
        }
        // Return early to keep the error visible
        return;
    } finally {
        // Hide loading screen
        if (loadingScreen) {
            loadingScreen.style.opacity = "0";
            setTimeout(() => loadingScreen.classList.add("hidden"), 500);
        }
    }

    // 4. Setup UI
    setupUI(
        scene, 
        mmdRuntime, 
        audioPlayer,
        getCurrentModel,
        async (pmx, vmd, textures) => {
            // Clean up old model if exists
            if (currentModel) {
                mmdRuntime.destroyMmdModel(currentModel);
                currentModel.mesh.dispose();
            }
            // Load new model from files
            currentModel = await loadMmdModelFromFiles(
                scene,
                mmdRuntime,
                pmx,
                vmd,
                textures,
                shadowGenerator
            );
            if (currentModel) {
                currentModel.mesh.scaling.setAll(0.07); 
            }
        }
    );

    // 5. Performance Controls
    setupPerformanceControls(scene, mmdRuntime, shadowGenerator);

    // 6. WebXR AR (Now handled via native UI initialized above)


    // 7. Initialize Audio Player Sync and Source (Non-blocking)
    const setupAudio = async () => {
        try {
            await mmdRuntime.setAudioPlayer(audioPlayer);
            audioPlayer.source = "assets/audio/music.mp3";
            console.log("Audio player initialized successfully.");
        } catch (e) {
            console.warn("Audio failed to load", e);
        }
    };
    setupAudio();

    // ===== 音声アンロック（ブラウザの自動再生ポリシー対策）=====
    const unlockAudio = () => {
        try {
            // HTMLAudio を取り出して短く再生→停止することで unlock
            const internalAudio = (audioPlayer as any)._audio as HTMLAudioElement | undefined;
            if (internalAudio) {
                internalAudio.muted = true;
                const playPromise = internalAudio.play();
                if (playPromise && typeof playPromise.then === "function") {
                    playPromise.then(() => {
                        internalAudio.pause();
                        internalAudio.currentTime = 0;
                        internalAudio.muted = false;
                        console.log("Audio unlocked via interaction");
                    }).catch((err) => {
                        console.warn("Audio unlock failed:", err);
                    });
                }
            }
            // Babylon側のAudioContextも resume
            const ctx = (window as any).BABYLON?.Engine?.audioEngine?.audioContext;
            if (ctx && ctx.state === "suspended") {
                ctx.resume();
            }
        } catch (e) {
            console.warn("Audio unlock error:", e);
        }
        // 一度実行したら解除
        document.removeEventListener("click", unlockAudio);
        document.removeEventListener("touchstart", unlockAudio);
    };

    document.addEventListener("click", unlockAudio);
    document.addEventListener("touchstart", unlockAudio);
}

// ===== UIモーダル制御（init とは独立して登録）=====
function setupModals() {
  // 共通：モーダルの開閉ヘルパ
  const open = (id: string) => document.getElementById(id)?.classList.remove("hidden");
  const close = (id: string) => document.getElementById(id)?.classList.add("hidden");
  const bindBackdrop = (id: string) => {
    const m = document.getElementById(id);
    m?.addEventListener("click", (e) => {
      if (e.target === m) m.classList.add("hidden");
    });
  };

  // ENTER AR ボタン
  document.getElementById("arLaunchBtn")?.addEventListener("click", () => {
    // ★ AR起動と同時に音声アンロックを試みる
    try {
        const ctx = (window as any).BABYLON?.Engine?.audioEngine?.audioContext;
        if (ctx && ctx.state === "suspended") {
            ctx.resume();
        }
    } catch (e) {}

    const xrBtn = document.querySelector(".babylonVRicon") as HTMLElement | null;
    if (xrBtn) {
      xrBtn.click();
    } else {
      open("ar-unavailable-modal");
    }
  });

  // 情報モーダル
  document.getElementById("infoFab")?.addEventListener("click", () => open("info-modal"));
  document.getElementById("closeInfoBtn")?.addEventListener("click", () => close("info-modal"));
  bindBackdrop("info-modal");

  // 設定モーダル
  document.getElementById("settingsFab")?.addEventListener("click", () => open("settings-modal"));
  document.getElementById("closeSettingsBtn")?.addEventListener("click", () => close("settings-modal"));
  bindBackdrop("settings-modal");

  // QRモーダル
  document.getElementById("qrFab")?.addEventListener("click", () => open("qr-modal"));
  document.getElementById("closeQrBtn")?.addEventListener("click", () => close("qr-modal"));
  bindBackdrop("qr-modal");

  // AR非対応モーダル
  document.getElementById("closeArUnavailableBtn")?.addEventListener("click", () => close("ar-unavailable-modal"));
  bindBackdrop("ar-unavailable-modal");

  console.log("Modals initialized");
}

// DOMContentLoaded を待ってモーダル登録（init() より先でもOK）
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupModals);
} else {
  setupModals();
}

init();
