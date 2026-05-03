import { createScene } from './app/createScene';
import { createMmdRuntime } from './app/mmdRuntime';
import { loadMmdModel, loadMmdModelFromFiles } from './app/loadMmdModel';
import { setupUI } from './app/setupUI';
import { setupWebXR } from './app/setupWebXR';
import { setupPerformanceControls } from './app/performance';
import { MmdModel, StreamAudioPlayer } from 'babylon-mmd';

async function init() {
    console.log("App Initialization - Version 2.13 (Robust Audio)");
    
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    if (!canvas) return;

    // 1. Initialize Scene
    const { scene, shadowGenerator } = await createScene(canvas);

    // 2. Initialize MMD Runtime
    const mmdRuntime = createMmdRuntime(scene);
    (scene as any).mmdRootRuntime = mmdRuntime;

    // 2.1 Initialize Audio Player
    const audioPlayer = new StreamAudioPlayer(scene);

    // ===== 再生開始ロジック（早期定義 & Android 最適化）=====
    let playbackStarted = false;
    const startPlayback = () => {
        if (playbackStarted) return;
        console.log("startPlayback triggered");

        try {
            // AudioContext を resume
            const ctx = (window as any).BABYLON?.Engine?.audioEngine?.audioContext;
            if (ctx && ctx.state === "suspended") ctx.resume();

            // ★ 内部HTMLAudioを直接play（Androidで最も確実）
            const internalAudio = (audioPlayer as any)._audio as HTMLAudioElement | undefined;
            if (internalAudio) {
                internalAudio.muted = false;
                internalAudio.volume = 1.0;
                const p = internalAudio.play();
                if (p && typeof p.then === "function") {
                    p.then(() => console.log("✅ Internal HTMLAudio playing"))
                     .catch((err) => console.error("❌ Internal HTMLAudio error:", err));
                }
            }
            
            // babylon-mmd 経由でも再生（同期保持のため）
            audioPlayer.play();
            mmdRuntime.playAnimation();
            
            playbackStarted = true;
            console.log("Playback started (v2.7 style)");
        } catch (e) {
            console.error("Playback failed:", e);
        }
    };
    (window as any).__startPlayback = startPlayback;

    let currentModel: MmdModel | null = null;
    const getCurrentModel = () => currentModel;

    // 3. Load Default Model
    const loadingScreen = document.getElementById("loading-screen") as HTMLDivElement;
    const loadingStatus = document.getElementById("loading-status") as HTMLSpanElement;
    
    try {
        currentModel = await loadMmdModel(
            scene, mmdRuntime, 
            "assets/model/miku.pmx", "assets/motion/dance.vmd",
            shadowGenerator, undefined,
            (event) => {
                if (event.lengthComputable && event.total > 0) {
                    const percentage = Math.floor((event.loaded / event.total) * 100);
                    if (loadingStatus) loadingStatus.textContent = `${percentage}%`;
                }
            }
        );
        if (currentModel) {
            currentModel.mesh.scaling.setAll(0.07);
            currentModel.mesh.position.set(0, 0, 0); 
            setupWebXR(scene, [currentModel.mesh as any], audioPlayer);
        }
    } catch (e: any) {
        console.error("Loading failed:", e);
        if (loadingStatus) loadingStatus.textContent = "Error loading assets";
        return;
    } finally {
        if (loadingScreen) {
            loadingScreen.style.opacity = "0";
            setTimeout(() => loadingScreen.classList.add("hidden"), 500);
        }
        
        // ★ ローディング完了後に TAP TO START を表示
        setTimeout(() => {
            const tapToStart = document.getElementById("tap-to-start");
            if (tapToStart) {
                tapToStart.classList.remove("hidden");
                const handleStart = () => {
                    startPlayback();
                    tapToStart.classList.add("hidden");
                    tapToStart.removeEventListener("click", handleStart);
                    tapToStart.removeEventListener("touchstart", handleStart);
                };
                tapToStart.addEventListener("click", handleStart);
                tapToStart.addEventListener("touchstart", handleStart);
            }
        }, 600);
    }

    // 4. Setup UI
    setupUI(scene, mmdRuntime, audioPlayer, getCurrentModel, async (pmx, vmd, textures) => {
        if (currentModel) {
            mmdRuntime.destroyMmdModel(currentModel);
            currentModel.mesh.dispose();
        }
        currentModel = await loadMmdModelFromFiles(scene, mmdRuntime, pmx, vmd, textures, shadowGenerator);
        if (currentModel) currentModel.mesh.scaling.setAll(0.07);
    });

    setupPerformanceControls(scene, mmdRuntime, shadowGenerator);

    // 7. Audio Source Setup (Non-blocking as in v2.7)
    const setupAudio = async () => {
        try {
            await mmdRuntime.setAudioPlayer(audioPlayer);
            audioPlayer.source = "assets/audio/music.mp3";
            console.log("Audio player initialized.");
        } catch (e) {
            console.warn("Audio failed", e);
        }
    };
    setupAudio();
}

// ===== UIモーダル制御（v2.13）=====
function setupModals() {
  const open = (id: string) => document.getElementById(id)?.classList.remove("hidden");
  const close = (id: string) => document.getElementById(id)?.classList.add("hidden");
  const bindBackdrop = (id: string) => {
    const m = document.getElementById(id);
    m?.addEventListener("click", (e) => { if (e.target === m) m.classList.add("hidden"); });
  };

  // ENTER AR ボタン
  document.getElementById("arLaunchBtn")?.addEventListener("click", () => {
    // ★ AR起動時にも再生開始を試みる
    const startFn = (window as any).__startPlayback;
    if (typeof startFn === "function") startFn();

    const xrBtn = document.querySelector(".babylonVRicon") as HTMLElement | null;
    if (xrBtn) {
      xrBtn.click();
    } else {
      open("ar-unavailable-modal");
    }
  });

  document.getElementById("infoFab")?.addEventListener("click", () => open("info-modal"));
  document.getElementById("closeInfoBtn")?.addEventListener("click", () => close("info-modal"));
  bindBackdrop("info-modal");

  document.getElementById("settingsFab")?.addEventListener("click", () => open("settings-modal"));
  document.getElementById("closeSettingsBtn")?.addEventListener("click", () => close("settings-modal"));
  bindBackdrop("settings-modal");

  document.getElementById("qrFab")?.addEventListener("click", () => open("qr-modal"));
  document.getElementById("closeQrBtn")?.addEventListener("click", () => close("qr-modal"));
  bindBackdrop("qr-modal");

  document.getElementById("closeArUnavailableBtn")?.addEventListener("click", () => close("ar-unavailable-modal"));
  bindBackdrop("ar-unavailable-modal");

  console.log("Modals initialized");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupModals);
} else {
  setupModals();
}

init();
