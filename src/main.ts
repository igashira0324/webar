import { createScene } from './app/createScene';
import { createMmdRuntime } from './app/mmdRuntime';
import { loadMmdModel, loadMmdModelFromFiles, loadVmdToModel } from './app/loadMmdModel';
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

    let internalAudio: HTMLAudioElement | null = null;
    let vocalAudio: HTMLAudioElement | null = null;
    let bgmStarted = false;
    let isLooping = false;
    let loopTimer: number | null = null;
    let loopEnabled = true;

    // ダンスプリセット定義
    const DANCE_PRESETS: Record<string, { vmd: string, music: string, vocal: string | null }> = {
        dindondan: {
            vmd: "assets/motion/dindondan.vmd",
            music: "assets/audio/dindondan_full.mp3",
            vocal: "assets/audio/dindondan_vocal.mp3"
        },
        nightoffire: {
            vmd: "assets/motion/nightoffire.vmd",
            music: "assets/audio/nightoffire_full.mp3",
            vocal: null
        },
        trend2025_a: {
            vmd: "assets/motion/trend2025_a.vmd",
            music: "assets/audio/trend2025_a.mp3",
            vocal: null
        },
        trend2025_b: {
            vmd: "assets/motion/trend2025_b.vmd",
            music: "assets/audio/trend2025_b.mp3",
            vocal: null
        }
    };
    let currentDanceId = "dindondan";

    let currentModel: MmdModel | null = null;
    const getCurrentModel = () => currentModel;

    // ===== 音楽ファイルからのリップシンク初期化 =====
    // startPlayback() 内で参照されるため、先に定義します
    const lipSync = setupAudioLipSync(scene, getCurrentModel);


    let arEntered = false;
    const onCanvasTap = () => {
        if (!arEntered) return; // ★ ARに入る前は何もしない
        (window as any).__startPlayback();
        canvas.removeEventListener("click", onCanvasTap);
        canvas.removeEventListener("touchend", onCanvasTap);
    };
    canvas.addEventListener("click", onCanvasTap);
    canvas.addEventListener("touchend", onCanvasTap);
    
    // setupWebXR から呼ばれるコールバック
    (window as any).__onArEntered = () => { 
        console.log("AR Session Entered - Activating tap-to-play");
        arEntered = true; 
    };

    const loadingScreen = document.getElementById("loading-screen") as HTMLDivElement;
    const loadingStatus = document.getElementById("loading-status") as HTMLSpanElement;
    const arLaunchBtn = document.getElementById("arLaunchBtn") as HTMLButtonElement | null;

    if (arLaunchBtn) {
        arLaunchBtn.disabled = true;
        arLaunchBtn.style.opacity = "0.5";
        arLaunchBtn.style.pointerEvents = "none";
    }
    
    // --- 統合再生・一時停止ロジック ---
    const togglePlayback = async (forceState?: boolean): Promise<boolean> => {
        if (!currentModel || !internalAudio) return false;

        const shouldPlay = forceState !== undefined ? forceState : (internalAudio.paused);
        const btn = document.getElementById("playPauseBtn");

        try {
            if (shouldPlay) {
                // 再生開始
                const ctx = (window as any).BABYLON?.Engine?.audioEngine?.audioContext;
                if (ctx && ctx.state === "suspended") await ctx.resume();

                // 同期再生 (Promise.all でミリ秒単位のズレを防止)
                const promises = [];
                promises.push(internalAudio.play());
                if (vocalAudio) {
                    lipSync.attach(vocalAudio, true); // サイレント解析
                    promises.push(vocalAudio.play());
                }
                
                await Promise.all(promises);
                mmdRuntime.playAnimation();
                if (btn) btn.textContent = "||";
                bgmStarted = true;
            } else {
                // 一時停止
                internalAudio.pause();
                if (vocalAudio) vocalAudio.pause();
                mmdRuntime.pauseAnimation();
                if (btn) btn.textContent = "▶";
            }
            return true;
        } catch (e) {
            console.warn("Playback toggle failed:", e);
            return false;
        }
    };
    (window as any).__startPlayback = () => togglePlayback(true);

    // --- アバターを直接タップして再生/停止 ---
    scene.onPointerObservable.add((pointerInfo) => {
        if (pointerInfo.type === 1 && pointerInfo.pickInfo?.hit) { // PointerDown
            const pickedMesh = pointerInfo.pickInfo.pickedMesh;
            if (pickedMesh && currentModel && (pickedMesh === currentModel.mesh || pickedMesh.isDescendantOf(currentModel.mesh))) {
                console.log("Avatar tapped - toggling playback");
                togglePlayback();
            }
        }
    });

    let currentMotion: any = null;
    try {
        const result = await loadMmdModel(
            scene, mmdRuntime, 
            "assets/model/miku.pmx", DANCE_PRESETS[currentDanceId].vmd,
            shadowGenerator, undefined,
            (event) => {
                if (event.lengthComputable && event.total > 0) {
                    const percentage = Math.floor((event.loaded / event.total) * 100);
                    if (loadingStatus) loadingStatus.textContent = `${percentage}%`;
                }
            }
        );
        currentModel = result.model;
        currentMotion = result.motion; 

        if (currentModel) {
            currentModel.mesh.scaling.setAll(0.07);
            currentModel.mesh.position.set(0, 0, 0); 

            if (expressionCleanup) (expressionCleanup as any)();
            expressionCleanup = setupExpressions(scene, currentModel);

            await setupWebXR(scene, [currentModel.mesh as any], audioPlayer);
        }
    } catch (e: any) {
        console.error("Loading failed:", e);
        if (loadingStatus) loadingStatus.textContent = "Error loading assets";
        return;
    }

    // グローバルにループ発火関数を公開 (安定版)
    (window as any).__triggerLoop = () => {
        if (isLooping || !loopEnabled) return;
        isLooping = true;
        console.log("🔁 Hybrid Loop Triggered (Event-based)");
        
        togglePlayback(false); // 全て停止
        
        if (loopTimer) clearTimeout(loopTimer);
        loopTimer = window.setTimeout(async () => {
            try {
                mmdRuntime.seekAnimation(0, true);
                if (internalAudio) internalAudio.currentTime = 0;
                if (vocalAudio) vocalAudio.currentTime = 0;
                
                await togglePlayback(true); // 全て再開
                console.log("🔁 Loop restarted successfully");
            } catch(e) {
                console.warn("Loop restart failed:", e);
            } finally {
                isLooping = false;
            }
        }, 2000); // 2秒待機
    };

    // 4. Setup Audio Source
    const setupAudio = async (danceId: string) => {
        try {
            await mmdRuntime.setAudioPlayer(audioPlayer);
            const preset = DANCE_PRESETS[danceId];
            audioPlayer.source = preset.music;
            
            // 重要：以前のリスナーを解除できないため、フラグ等で管理
            if ((audioPlayer as any)._audio) {
                const audio = (audioPlayer as any)._audio;
                audio.onended = () => {
                    if (loopEnabled && !isLooping) (window as any).__triggerLoop();
                };
            }

            internalAudio = (audioPlayer as any)._audio || (audioPlayer as any).audio || null;
            if (internalAudio) {
                internalAudio.preload = "auto";
                if (preset.vocal) {
                    vocalAudio = new Audio(preset.vocal);
                    vocalAudio.preload = "auto";
                    vocalAudio.load();
                } else {
                    vocalAudio = null;
                }
                // プリロード待ち
                await new Promise<void>(resolve => {
                    if (internalAudio!.readyState >= 3) resolve();
                    else internalAudio!.oncanplaythrough = () => resolve();
                    setTimeout(resolve, 5000);
                });
            }
        } catch (e) {
            console.warn("Audio setup failed", e);
        }
    };
    await setupAudio(currentDanceId);
    
    if (currentMotion) mmdRuntime.setManualAnimationDuration(currentMotion.endFrame);

    // 5. Finalize UI
    if (arLaunchBtn) {
        arLaunchBtn.disabled = false;
        arLaunchBtn.style.opacity = "1";
        arLaunchBtn.style.pointerEvents = "auto";
    }

    // もたつき解消：シーンが完全に準備できてからローディングを消す
    scene.executeWhenReady(() => {
        if (loadingScreen) {
            loadingScreen.style.opacity = "0";
            setTimeout(() => loadingScreen.classList.add("hidden"), 500);
        }
        console.log("🚀 Scene is ready - Loading screen removed");
    });
    
    // 6. Setup UI & Interaction
    const danceSelect = document.getElementById("danceSelect") as HTMLSelectElement;
    danceSelect?.addEventListener("change", async () => {
        const newId = danceSelect.value;
        if (newId === currentDanceId || !currentModel) return;

        currentDanceId = newId;
        togglePlayback(false);

        if (loadingStatus) loadingStatus.textContent = "Loading...";
        currentMotion = await loadVmdToModel(scene, mmdRuntime, currentModel, DANCE_PRESETS[newId].vmd);
        await setupAudio(newId);
        if (currentMotion) mmdRuntime.setManualAnimationDuration(currentMotion.endFrame);
        if (loadingStatus) loadingStatus.textContent = "";
    });

    setupUI(scene, mmdRuntime, audioPlayer, getCurrentModel, togglePlayback, async (pmx, vmd, textures) => {
        if (currentModel) {
            mmdRuntime.destroyMmdModel(currentModel);
            currentModel.mesh.dispose();
        }
        const result = await loadMmdModelFromFiles(scene, mmdRuntime, pmx, vmd, textures, shadowGenerator);
        currentModel = result.model;
        currentMotion = result.motion;
        if (currentModel) {
            currentModel.mesh.scaling.setAll(0.07);
            if (expressionCleanup) (expressionCleanup as any)();
            expressionCleanup = setupExpressions(scene, currentModel);
            if (currentMotion) mmdRuntime.setManualAnimationDuration(currentMotion.endFrame);
            if (typeof (window as any).__updateXRTargetMeshes === "function") {
                (window as any).__updateXRTargetMeshes([currentModel.mesh]);
            }
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
        if (!pmxPath || !currentModel) return;

        togglePlayback(false);
        mmdRuntime.destroyMmdModel(currentModel);
        currentModel.mesh.dispose();

        const result = await loadMmdModel(scene, mmdRuntime, pmxPath, DANCE_PRESETS[currentDanceId].vmd, shadowGenerator);
        currentModel = result.model;
        currentMotion = result.motion;
        if (currentModel) {
            currentModel.mesh.scaling.setAll(0.07);
            if (expressionCleanup) (expressionCleanup as any)();
            expressionCleanup = setupExpressions(scene, currentModel);
            if (currentMotion) mmdRuntime.setManualAnimationDuration(currentMotion.endFrame);
            if (typeof (window as any).__updateXRTargetMeshes === "function") {
                (window as any).__updateXRTargetMeshes([currentModel.mesh]);
            }
        }
    });

    setupPerformanceControls(scene, mmdRuntime, shadowGenerator);

    document.getElementById("loopToggle")?.addEventListener("change", (e) => {
        loopEnabled = (e.target as HTMLInputElement).checked;
    });

    document.getElementById("lipsyncToggle")?.addEventListener("change", (e) => {
        lipSync.setEnabled((e.target as HTMLInputElement).checked);
    });

    // 自然な仕草（アイドル表現エンジン）をレンダリング前に統合
    let idleMouthTimer = 0;
    scene.onBeforeRenderObservable.add(() => {
        if (!bgmStarted || !currentModel || DANCE_PRESETS[currentDanceId].vocal) return;
        const deltaTime = scene.getEngine().getDeltaTime();
        idleMouthTimer += deltaTime;
        if (idleMouthTimer > 2000) {
            if (Math.random() > 0.7) {
                const weight = Math.random() * 0.2;
                try {
                    currentModel.morph.setMorphWeight("あ", weight);
                    currentModel.morph.setMorphWeight("a", weight);
                    if (Math.random() > 0.5) currentModel.morph.setMorphWeight("笑い", weight * 1.5);
                } catch(e) {}
            }
            idleMouthTimer = 0;
        }
    });
}

function setupModals() {
  const open = (id: string) => document.getElementById(id)?.classList.remove("hidden");
  const close = (id: string) => document.getElementById(id)?.classList.add("hidden");
  const bindBackdrop = (id: string) => {
    const m = document.getElementById(id);
    m?.addEventListener("click", (e) => { if (e.target === m) m.classList.add("hidden"); });
  };

  document.getElementById("arLaunchBtn")?.addEventListener("click", async () => {
    const xr = (window as any).__xrHelper;
    if (!xr || !xr.baseExperience) return alert("AR システムの準備が整っていません。数秒お待ちください。");
    try {
      await xr.baseExperience.enterXRAsync(
        "immersive-ar",
        "local-floor",
        xr.renderTarget
      );
      console.log("✅ AR session started");
    } catch (e: any) {
      console.error("❌ enterXRAsync failed:", e?.name, e?.message);
      alert(`AR起動失敗: ${e?.name || "Error"} - ${e?.message || e}`);
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
