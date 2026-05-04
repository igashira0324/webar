import { createScene } from './app/createScene';
import { createMmdRuntime } from './app/mmdRuntime';
import { loadMmdModel, loadMmdModelFromFiles } from './app/loadMmdModel';
import { setupUI } from './app/setupUI';
import { setupWebXR } from './app/setupWebXR';
import { setupPerformanceControls } from './app/performance';
import { MmdModel, StreamAudioPlayer } from 'babylon-mmd';
import { setupExpressions } from './app/setupExpressions';
import { setupAudioLipSync } from './app/setupAudioLipSync';

async function init() {
    console.log("App Initialization - Version 2.15 (No Overlay)");
    
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    if (!canvas) return;

    // 1. Initialize Scene
    const { scene, shadowGenerator } = await createScene(canvas);

    // 2. Initialize MMD Runtime
    const mmdRuntime = createMmdRuntime(scene);
    (scene as any).mmdRootRuntime = mmdRuntime;

    // 表情制御のクリーンアップ関数を保持
    let expressionCleanup: (() => void) | null = null;

    // 2.1 Initialize Audio Player
    const audioPlayer = new StreamAudioPlayer(scene);

    // ===== 再生開始ロジック（早期定義 & Android 最適化 v2.15）=====
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

            // 2. HTMLAudioElement を直接 play
            if (internalAudio) {
                // ★ 音楽連動リップシンクをアタッチ
                lipSync.attach(internalAudio);

                internalAudio.muted = false;
                internalAudio.volume = 1.0;
                if (internalAudio.paused) {
                    const p = internalAudio.play();
                    if (p && typeof p.then === "function") {
                        p.then(() => {
                            console.log("✅ HTMLAudio playing");
                            bgmStarted = true;
                        }).catch((err) => {
                            console.error("❌ HTMLAudio play failed:", err.name, err.message);
                        });
                    }
                }
            }
            
            // 3. アニメーションを再生
            mmdRuntime.playAnimation();
            
            bgmStarted = true;
            console.log("Playback started (v2.15)");
            return true;
        } catch (e) {
            console.warn("Playback start failed:", e);
            return false;
        }
    };
    (window as any).__startPlayback = startPlayback;

    // キャンバスタップでも再生開始するように追加
    const onCanvasTap = () => {
        startPlayback();
        canvas.removeEventListener("click", onCanvasTap);
        canvas.removeEventListener("touchend", onCanvasTap);
    };
    canvas.addEventListener("click", onCanvasTap);
    canvas.addEventListener("touchend", onCanvasTap);

    let currentModel: MmdModel | null = null;
    const getCurrentModel = () => currentModel;

    // ===== 音楽ファイルからのリップシンク初期化 =====
    const lipSync = setupAudioLipSync(scene, getCurrentModel);

    // ===== 繰り返し再生機能の状態管理 =====
    let isLooping = false;
    let loopTimer: number | null = null;
    let loopEnabled = true;

    scene.onBeforeRenderObservable.add(() => {
        // 再生開始前 or ループ設定OFF or すでにループ処理中はスキップ
        if (!bgmStarted || !loopEnabled || isLooping) return;

        const duration = mmdRuntime.animationFrameTimeDuration;
        const current = mmdRuntime.currentFrameTime;

        // 終端に到達したか（0.5フレーム手前で判定して取りこぼし防止）
        if (duration > 0 && current >= duration - 0.5) {
            isLooping = true;
            console.log("🔁 Animation ended, looping in 2s...");

            // 一時停止（音声・アニメ両方）
            try {
                mmdRuntime.pauseAnimation();
                if (internalAudio && !internalAudio.paused) {
                    internalAudio.pause();
                }
            } catch (e) {
                console.warn("Loop pause failed:", e);
            }

            // 2秒後にリセット & 再生
            loopTimer = window.setTimeout(() => {
                try {
                    // アニメーションを先頭に
                    mmdRuntime.seekAnimation(0, true);
                    // 音声も先頭に
                    if (internalAudio) {
                        internalAudio.currentTime = 0;
                        const p = internalAudio.play();
                        if (p && typeof p.then === "function") {
                            p.catch(err => console.warn("Loop audio play failed:", err));
                        }
                    }
                    // アニメ再開
                    mmdRuntime.playAnimation();
                    console.log("🔁 Loop restarted");
                } catch (e) {
                    console.warn("Loop restart failed:", e);
                } finally {
                    isLooping = false;
                    loopTimer = null;
                }
            }, 2000);
        }
    });

    // 3. Load Default Model
    const loadingScreen = document.getElementById("loading-screen") as HTMLDivElement;
    const loadingStatus = document.getElementById("loading-status") as HTMLSpanElement;
    const arLaunchBtn = document.getElementById("arLaunchBtn") as HTMLButtonElement | null;

    // 音声ロード完了までボタンを無効化する保険
    if (arLaunchBtn) {
        arLaunchBtn.disabled = true;
        arLaunchBtn.style.opacity = "0.5";
        arLaunchBtn.style.pointerEvents = "none";
    }
    
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

            // 表情制御を有効化
            if (expressionCleanup) (expressionCleanup as any)();
            expressionCleanup = setupExpressions(scene, currentModel);

            setupWebXR(scene, [currentModel.mesh as any], audioPlayer);
        }
    } catch (e: any) {
        console.error("Loading failed:", e);
        if (loadingStatus) loadingStatus.textContent = "Error loading assets";
        return;
    }

    // 4. Setup Audio Source
    const setupAudio = async () => {
        try {
            await mmdRuntime.setAudioPlayer(audioPlayer);
            audioPlayer.source = "assets/audio/music.mp3";

            internalAudio = (audioPlayer as any)._audio || (audioPlayer as any).audio || null;
            if (internalAudio) {
                internalAudio.preload = "auto";
                internalAudio.load();
                await new Promise<void>((resolve) => {
                    if (!internalAudio || internalAudio.readyState >= 3) return resolve();
                    const onReady = () => {
                        internalAudio?.removeEventListener("canplaythrough", onReady);
                        resolve();
                    };
                    internalAudio.addEventListener("canplaythrough", onReady);
                    setTimeout(resolve, 8000);
                });
            }
        } catch (e) {
            console.warn("Audio failed", e);
        }
    };
    await setupAudio();

    // 5. Finalize UI
    if (arLaunchBtn) {
        arLaunchBtn.disabled = false;
        arLaunchBtn.style.opacity = "1";
        arLaunchBtn.style.pointerEvents = "auto";
    }

    if (loadingScreen) {
        loadingScreen.style.opacity = "0";
        setTimeout(() => loadingScreen.classList.add("hidden"), 500);
    }
    
    // 6. Setup UI & Performance
    setupUI(scene, mmdRuntime, audioPlayer, getCurrentModel, async (pmx, vmd, textures) => {
        if (currentModel) {
            mmdRuntime.destroyMmdModel(currentModel);
            currentModel.mesh.dispose();
        }
        currentModel = await loadMmdModelFromFiles(scene, mmdRuntime, pmx, vmd, textures, shadowGenerator);
        if (currentModel) {
            currentModel.mesh.scaling.setAll(0.07);
            // 表情制御を再設定
            if (expressionCleanup) (expressionCleanup as any)();
            expressionCleanup = setupExpressions(scene, currentModel);
        }
    }, async (presetId) => {
        const presets: Record<string, string> = {
            "original": "assets/model/miku.pmx",
            "v_miku_full": "assets/model/presets/v_miku_full/model.pmx",
            "sour_snow": "assets/model/presets/snow/model.pmx",
            "onasu": "assets/model/presets/sakura/model.pmx",
            "riverside": "assets/model/presets/riverside/model.pmx"
        };
        const pmxPath = presets[presetId];
        if (!pmxPath) return;

        console.log(`🔄 Attempting to switch to preset: ${presetId} (${pmxPath})`);

        if (loadingScreen) {
            loadingScreen.style.opacity = "1";
            loadingScreen.classList.remove("hidden");
        }
        if (loadingStatus) loadingStatus.textContent = "Loading...";

        try {
            // 前のモデルを破棄（ただし保険のため直ぐには破棄せず、ロード成功後に破棄するのが理想だが、メモリ管理上先に消す）
            if (currentModel) {
                mmdRuntime.destroyMmdModel(currentModel);
                currentModel.mesh.dispose();
                currentModel = null;
            }

            currentModel = await loadMmdModel(
                scene, mmdRuntime, 
                pmxPath, "assets/motion/dance.vmd",
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
                if (expressionCleanup) (expressionCleanup as any)();
                expressionCleanup = setupExpressions(scene, currentModel);
                console.log(`✅ Successfully switched to preset: ${presetId}`);
            }
        } catch (e: any) {
            console.error(`❌ Failed to switch to ${presetId}:`, e);
            alert(`モデル「${presetId}」の読み込みに失敗しました。\n${e.message || e}\nデフォルトモデルに戻します。`);
            
            // フォールバック：デフォルトモデルへ復帰
            try {
                currentModel = await loadMmdModel(
                    scene, mmdRuntime, "assets/model/presets/v_miku_full/model.pmx", "assets/motion/dance.vmd",
                    shadowGenerator
                );
                if (currentModel) {
                    currentModel.mesh.scaling.setAll(0.07);
                    currentModel.mesh.position.set(0, 0, 0); 
                    if (expressionCleanup) (expressionCleanup as any)();
                    expressionCleanup = setupExpressions(scene, currentModel);
                }
            } catch (fallbackError) {
                console.error("Critical: Fallback also failed", fallbackError);
            }
        }

        if (loadingScreen) {
            loadingScreen.style.opacity = "0";
            setTimeout(() => loadingScreen.classList.add("hidden"), 500);
        }
    });

    setupPerformanceControls(scene, mmdRuntime, shadowGenerator);

    // ===== 新規トグルのイベントリスナー追加 =====
    document.getElementById("loopToggle")?.addEventListener("change", (e) => {
        loopEnabled = (e.target as HTMLInputElement).checked;
        if (!loopEnabled && loopTimer !== null) {
            window.clearTimeout(loopTimer);
            loopTimer = null;
            isLooping = false;
        }
    });

    document.getElementById("lipsyncToggle")?.addEventListener("change", (e) => {
        lipSync.setEnabled((e.target as HTMLInputElement).checked);
    });
}

// ===== UIモーダル制御 =====
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
