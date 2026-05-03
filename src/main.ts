import { createScene } from './app/createScene';
import { createMmdRuntime } from './app/mmdRuntime';
import { loadMmdModel, loadMmdModelFromFiles } from './app/loadMmdModel';
import { setupUI } from './app/setupUI';
import { setupWebXR } from './app/setupWebXR';
import { setupPerformanceControls } from './app/performance';
import { MmdModel, StreamAudioPlayer } from 'babylon-mmd';

async function init() {
    console.log("App Initialization - Version 2.14 (Android Fixed)");
    
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    if (!canvas) return;

    // 1. Initialize Scene
    const { scene, shadowGenerator } = await createScene(canvas);

    // 2. Initialize MMD Runtime
    const mmdRuntime = createMmdRuntime(scene);
    (scene as any).mmdRootRuntime = mmdRuntime;

    // 2.1 Initialize Audio Player
    const audioPlayer = new StreamAudioPlayer(scene);

    // ===== 再生開始ロジック（早期定義 & Android 最適化 v2.14）=====
    let internalAudio: HTMLAudioElement | null = null;
    let bgmStarted = false;

    const startPlayback = (): boolean => {
        if (bgmStarted) return true;
        console.log("startPlayback triggered");

        try {
            // 1. AudioContext を必ず resume
            const ctx = (window as any).BABYLON?.Engine?.audioEngine?.audioContext;
            if (ctx && ctx.state === "suspended") {
                ctx.resume().then(() => console.log("AudioContext resumed:", ctx.state));
            }

            // 2. HTMLAudioElement を直接 play（これが Android で最も確実）
            if (internalAudio) {
                internalAudio.muted = false;
                internalAudio.volume = 1.0;
                // 停止状態から確実に頭出し再生
                if (internalAudio.paused) {
                    const p = internalAudio.play();
                    if (p && typeof p.then === "function") {
                        p.then(() => {
                            console.log("✅ HTMLAudio playing on Android");
                            bgmStarted = true;
                        }).catch((err) => {
                            console.error("❌ HTMLAudio play failed:", err.name, err.message);
                            if (err.name === "NotAllowedError") {
                                alert("音声再生にはタップが必要です。画面をもう一度タップしてください。");
                            }
                        });
                    }
                }
            } else {
                console.warn("internalAudio is null");
            }
            
            // 3. アニメーションを再生（音とは独立）
            mmdRuntime.playAnimation();
            
            bgmStarted = true;
            console.log("Playback started (v2.14)");
            return true;
        } catch (e) {
            console.warn("Playback start failed:", e);
            return false;
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
    }

    // 4. Setup Audio Source (Await for Android robustness)
    const setupAudio = async () => {
        try {
            await mmdRuntime.setAudioPlayer(audioPlayer);
            audioPlayer.source = "assets/audio/music.mp3";

            // StreamAudioPlayer の内部 HTMLAudioElement を取得
            internalAudio = (audioPlayer as any)._audio || (audioPlayer as any).audio || null;
            if (!internalAudio) {
                console.warn("Falling back to manual Audio creation");
                internalAudio = new Audio("assets/audio/music.mp3");
                (audioPlayer as any)._audio = internalAudio;
            }

            if (internalAudio) {
                internalAudio.preload = "auto";
                internalAudio.muted = false;
                internalAudio.volume = 1.0;
                internalAudio.load();

                // ロード完了（再生可能状態）を待機
                await new Promise<void>((resolve) => {
                    if (!internalAudio || internalAudio.readyState >= 3) return resolve();
                    const onReady = () => {
                        console.log("✅ Audio ready (canplaythrough)");
                        internalAudio?.removeEventListener("canplaythrough", onReady);
                        resolve();
                    };
                    internalAudio.addEventListener("canplaythrough", onReady);
                    setTimeout(() => {
                        console.warn("⚠️ Audio load timeout");
                        resolve();
                    }, 8000);
                });
            }
            console.log("Audio player initialized.");
        } catch (e) {
            console.warn("Audio failed", e);
        }
    };
    await setupAudio();

    // 5. Loading Finish UI Handling
    if (loadingScreen) {
        loadingScreen.style.opacity = "0";
        setTimeout(() => loadingScreen.classList.add("hidden"), 500);
    }
    
    // ★ 全リソース完了後に TAP TO START を表示
    setTimeout(() => {
        const tapToStart = document.getElementById("tap-to-start");
        if (tapToStart) {
            tapToStart.classList.remove("hidden");
            const handleStart = () => {
                startPlayback();
                tapToStart.classList.add("hidden");
                tapToStart.removeEventListener("click", handleStart);
                tapToStart.removeEventListener("touchend", handleStart);
            };
            // Android では touchend がより確実なケースがある
            tapToStart.addEventListener("click", handleStart);
            tapToStart.addEventListener("touchend", handleStart);
        }
    }, 600);

    // 6. Setup UI & Performance
    setupUI(scene, mmdRuntime, audioPlayer, getCurrentModel, async (pmx, vmd, textures) => {
        if (currentModel) {
            mmdRuntime.destroyMmdModel(currentModel);
            currentModel.mesh.dispose();
        }
        currentModel = await loadMmdModelFromFiles(scene, mmdRuntime, pmx, vmd, textures, shadowGenerator);
        if (currentModel) currentModel.mesh.scaling.setAll(0.07);
    });

    setupPerformanceControls(scene, mmdRuntime, shadowGenerator);
}

// ===== UIモーダル制御（v2.14）=====
function setupModals() {
  const open = (id: string) => document.getElementById(id)?.classList.remove("hidden");
  const close = (id: string) => document.getElementById(id)?.classList.add("hidden");
  const bindBackdrop = (id: string) => {
    const m = document.getElementById(id);
    m?.addEventListener("click", (e) => { if (e.target === m) m.classList.add("hidden"); });
  };

  // ENTER AR ボタン
  document.getElementById("arLaunchBtn")?.addEventListener("click", () => {
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
