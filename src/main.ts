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
    console.log("MMD WebXR Player - Final Build v2.80 (Restored UX)");
    
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    if (!canvas) return;

    const { scene, shadowGenerator } = await createScene(canvas);
    const mmdRuntime = createMmdRuntime(scene);
    (scene as any).mmdRootRuntime = mmdRuntime;

    let expressionCleanup: (() => void) | null = null;
    const audioPlayer = new StreamAudioPlayer(scene);

    let internalAudio: HTMLAudioElement | null = null;
    let vocalAudio: HTMLAudioElement | null = null;
    let bgmStarted = false;
    let isLooping = false;
    let loopTimer: any = null;
    let loopEnabled = true;

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
    const lipSync = setupAudioLipSync(scene, getCurrentModel);

    // --- 統合再生・一時停止ロジック ---
    const togglePlayback = async (forceState?: boolean): Promise<boolean> => {
        if (!currentModel || !internalAudio) return false;
        const shouldPlay = forceState !== undefined ? forceState : internalAudio.paused;
        const btn = document.getElementById("playPauseBtn");

        try {
            if (shouldPlay) {
                const ctx = (window as any).BABYLON?.Engine?.audioEngine?.audioContext;
                if (ctx && ctx.state === "suspended") await ctx.resume();

                const promises: Promise<any>[] = [internalAudio.play()];
                if (vocalAudio) {
                    lipSync.attach(vocalAudio, true);
                    promises.push(vocalAudio.play());
                }
                await Promise.all(promises);
                mmdRuntime.playAnimation();
                if (btn) btn.textContent = "||";
                bgmStarted = true;
            } else {
                internalAudio.pause();
                if (vocalAudio) vocalAudio.pause();
                mmdRuntime.pauseAnimation();
                if (btn) btn.textContent = "▶";
            }
            return true;
        } catch (e) {
            console.warn("Playback failed", e);
            return false;
        }
    };
    (window as any).__startPlayback = () => togglePlayback(true);

    // --- インタラクション ---
    scene.onPointerObservable.add((pointerInfo) => {
        if (pointerInfo.type === 1 && pointerInfo.pickInfo?.hit) {
            const pickedMesh = pointerInfo.pickInfo.pickedMesh;
            if (pickedMesh && currentModel && (pickedMesh === currentModel.mesh || pickedMesh.isDescendantOf(currentModel.mesh))) {
                togglePlayback();
            }
        }
    });

    // --- ループ再生イベントハンドラ ---
    const onAudioEnded = () => {
        console.log("🔁 audio ended fired");
        if (loopEnabled && !isLooping) (window as any).__triggerLoop();
    };

    (window as any).__triggerLoop = () => {
        if (isLooping || !loopEnabled) return;
        isLooping = true;
        togglePlayback(false);
        if (loopTimer) clearTimeout(loopTimer);
        loopTimer = setTimeout(async () => {
            try {
                mmdRuntime.seekAnimation(0, true);
                if (internalAudio) internalAudio.currentTime = 0;
                if (vocalAudio) vocalAudio.currentTime = 0;
                await togglePlayback(true);
            } catch(e) {
                console.warn("Loop error", e);
            } finally {
                isLooping = false;
            }
        }, 2000);
    };

    const setupAudio = async (danceId: string) => {
        try {
            await mmdRuntime.setAudioPlayer(audioPlayer);
            const preset = DANCE_PRESETS[danceId];
            audioPlayer.source = preset.music;
            
            const audio = (audioPlayer as any)._audio || (audioPlayer as any).audio;
            if (audio) {
                audio.loop = false;
                audio.removeEventListener("ended", onAudioEnded);
                audio.addEventListener("ended", onAudioEnded);

                internalAudio = audio;
                audio.preload = "auto";
                vocalAudio = preset.vocal ? new Audio(preset.vocal) : null;
                if (vocalAudio) {
                    vocalAudio.loop = false;
                    vocalAudio.preload = "auto";
                }
                
                await new Promise<void>(resolve => {
                    if (audio.readyState >= 3) resolve();
                    else audio.oncanplaythrough = () => resolve();
                    setTimeout(resolve, 5000);
                });
            }
        } catch (e) {
            console.warn("Audio setup failed", e);
        }
    };

    // --- 初期ロード ---
    const loadingScreen = document.getElementById("loading-screen");
    const loadingStatus = document.getElementById("loading-status");
    const arLaunchBtn = document.getElementById("arLaunchBtn") as HTMLButtonElement;

    const showLoading = (text?: string) => {
        if (loadingScreen) {
            loadingScreen.style.opacity = "1";
            loadingScreen.classList.remove("hidden");
        }
        if (loadingStatus && text) loadingStatus.textContent = text;
    };

    const hideLoading = () => {
        if (loadingScreen) {
            loadingScreen.style.opacity = "0";
            setTimeout(() => loadingScreen.classList.add("hidden"), 500);
        }
    };

    try {
        showLoading("0%");
        const result = await loadMmdModel(
            scene, mmdRuntime, "assets/model/miku.pmx", DANCE_PRESETS[currentDanceId].vmd, shadowGenerator,
            undefined,
            (event: any) => {
                if (event.lengthComputable && event.total > 0) {
                    const pct = Math.floor((event.loaded / event.total) * 100);
                    if (loadingStatus) loadingStatus.textContent = `${pct}%`;
                }
            }
        );
        currentModel = result.model;
        if (currentModel) {
            currentModel.mesh.scaling.setAll(0.07); // 以前の正常なスケールに戻す
            expressionCleanup = setupExpressions(scene, currentModel);
            await setupWebXR(scene, [currentModel.mesh as any], audioPlayer);
            if (result.motion) mmdRuntime.setManualAnimationDuration(result.motion.endFrame);
            if (loadingStatus) loadingStatus.textContent = "Loading Audio...";
            await setupAudio(currentDanceId);
        }
    } catch (e) {
        console.error("Load failed", e);
    }

    if (arLaunchBtn) {
        arLaunchBtn.disabled = false;
        arLaunchBtn.style.opacity = "1";
    }

    // シーン準備完了 → モデル描画完了まで待ってからフェードアウト
    scene.executeWhenReady(() => {
        let frameCount = 0;
        const observer = scene.onAfterRenderObservable.add(() => {
            frameCount++;
            if (frameCount >= 2 && currentModel && currentModel.mesh.isReady(true)) {
                scene.onAfterRenderObservable.remove(observer);
                hideLoading();
                console.log("✅ Render complete, loading hidden");
            }
        });
        setTimeout(() => {
            scene.onAfterRenderObservable.remove(observer);
            hideLoading();
        }, 5000);
    });

    // --- UI/ダンス切り替え ---
    const danceSelect = document.getElementById("danceSelect") as HTMLSelectElement;
    danceSelect?.addEventListener("change", async () => {
        const newId = danceSelect.value;
        if (newId === currentDanceId || !currentModel) return;
        currentDanceId = newId;
        
        showLoading("Loading...");
        try {
            const motion = await loadVmdToModel(scene, mmdRuntime, currentModel, DANCE_PRESETS[newId].vmd);
            if (loadingStatus) loadingStatus.textContent = "Loading Audio...";
            await setupAudio(newId);
            if (motion) mmdRuntime.setManualAnimationDuration(motion.endFrame);
        } finally {
            hideLoading();
        }
    });

    setupUI(scene, mmdRuntime, audioPlayer, getCurrentModel, togglePlayback, async (pmx, vmd, textures) => {
        const wasPlaying = bgmStarted && internalAudio !== null && !internalAudio.paused;
        const savedAudioTime = internalAudio?.currentTime || 0;
        mmdRuntime.pauseAnimation();

        if (currentModel) {
            mmdRuntime.destroyMmdModel(currentModel);
            currentModel.mesh.dispose();
            if (expressionCleanup) expressionCleanup();
        }
        showLoading("Loading...");
        try {
            const result = await loadMmdModelFromFiles(scene, mmdRuntime, pmx, vmd, textures, shadowGenerator);
            currentModel = result.model;
            if (currentModel) {
                currentModel.mesh.scaling.setAll(0.07);
                expressionCleanup = setupExpressions(scene, currentModel);
                if (result.motion) mmdRuntime.setManualAnimationDuration(result.motion.endFrame);
                if ((window as any).__updateXRTargetMeshes) (window as any).__updateXRTargetMeshes([currentModel.mesh]);
                
                if (wasPlaying) {
                    mmdRuntime.seekAnimation(savedAudioTime * 30, true);
                    mmdRuntime.playAnimation();
                }
            }
        } finally {
            hideLoading();
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

        const wasPlaying = bgmStarted && internalAudio !== null && !internalAudio.paused;
        const savedAudioTime = internalAudio?.currentTime || 0;
        mmdRuntime.pauseAnimation();

        showLoading("0%");
        try {
            mmdRuntime.destroyMmdModel(currentModel);
            currentModel.mesh.dispose();
            if (expressionCleanup) expressionCleanup();
            const result = await loadMmdModel(
                scene, mmdRuntime, pmxPath, DANCE_PRESETS[currentDanceId].vmd, shadowGenerator, 
                undefined, 
                (event) => {
                    if (event.lengthComputable && event.total > 0) {
                        const pct = Math.floor((event.loaded / event.total) * 100);
                        if (loadingStatus) loadingStatus.textContent = `${pct}%`;
                    }
                }
            );
            currentModel = result.model;
            if (currentModel) {
                currentModel.mesh.scaling.setAll(0.07);
                expressionCleanup = setupExpressions(scene, currentModel);
                if (result.motion) mmdRuntime.setManualAnimationDuration(result.motion.endFrame);
                if ((window as any).__updateXRTargetMeshes) (window as any).__updateXRTargetMeshes([currentModel.mesh]);
                
                if (wasPlaying) {
                    mmdRuntime.seekAnimation(savedAudioTime * 30, true);
                    mmdRuntime.playAnimation();
                }
            }
        } finally {
            hideLoading();
        }
    });

    setupPerformanceControls(scene, mmdRuntime, shadowGenerator);
    document.getElementById("loopToggle")?.addEventListener("change", (e) => {
        loopEnabled = (e.target as HTMLInputElement).checked;
    });
    document.getElementById("lipsyncToggle")?.addEventListener("change", (e) => {
        lipSync.setEnabled((e.target as HTMLInputElement).checked);
    });

    // アイドル表現 & ループフォールバック
    let idleMouthTimer = 0;
    let lastCurrentFrame = 0;
    scene.onBeforeRenderObservable.add(() => {
        // 1. ループフォールバック
        if (bgmStarted && loopEnabled && !isLooping) {
            const duration = mmdRuntime.animationFrameTimeDuration;
            const current = mmdRuntime.currentFrameTime;
            if (duration > 0 && current >= duration - 0.5 && lastCurrentFrame < current) {
                console.log("🔁 frame-based end detected");
                (window as any).__triggerLoop();
            }
            lastCurrentFrame = current;
        }

        // 2. アイドル表情
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
        if (!xr || !xr.baseExperience) return alert("準備中...");
        try {
            await xr.baseExperience.enterXRAsync("immersive-ar", "local-floor", xr.renderTarget);
        } catch (e: any) {
            alert(`AR起動失敗: ${e.message}`);
            open("ar-unavailable-modal");
        }
    });

    document.getElementById("infoFab")?.addEventListener("click", () => open("info-modal"));
    document.getElementById("closeInfoBtn")?.addEventListener("click", () => close("info-modal"));
    document.getElementById("settingsFab")?.addEventListener("click", () => open("settings-modal"));
    document.getElementById("closeSettingsBtn")?.addEventListener("click", () => close("settings-modal"));
    document.getElementById("qrFab")?.addEventListener("click", () => open("qr-modal"));
    document.getElementById("closeQrBtn")?.addEventListener("click", () => close("qr-modal"));
    document.getElementById("closeArUnavailableBtn")?.addEventListener("click", () => close("ar-unavailable-modal"));
    bindBackdrop("info-modal");
    bindBackdrop("settings-modal");
    bindBackdrop("qr-modal");
    bindBackdrop("ar-unavailable-modal");
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupModals);
else setupModals();

init();
