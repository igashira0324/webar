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
        }
    };
    let currentDanceId = "dindondan";

    let currentModel: MmdModel | null = null;
    const getCurrentModel = () => currentModel;

    // ===== 音楽ファイルからのリップシンク初期化 =====
    // startPlayback() 内で参照されるため、先に定義します
    const lipSync = setupAudioLipSync(scene, getCurrentModel);

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
                // ★ 歌声のみのトラックをリップシンクに使用（精度向上のため）
                //    - muted/volume には触らない（解析データが 0 になるため）
                //    - silent=true で destination 非接続にして無音再生を実現
                if (vocalAudio) {
                    lipSync.attach(vocalAudio, true); // ★ silent=true
                    vocalAudio.play().catch(e => console.warn("Vocal play failed", e));
                    console.log("✅ Vocal track attached for analysis (silent)");
                } else {
                    // フォールバック
                    lipSync.attach(internalAudio, false);
                }

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

    // 3. Load Default Model
    let isLooping = false;
    let loopTimer: number | null = null;
    let loopEnabled = true;

    // ===== アイドル時の自然な表情（歌声がない時用） =====
    let idleMouthTimer = 0;
    let idleSmileTimer = 0;
    scene.onBeforeRenderObservable.add(() => {
        if (!bgmStarted || !currentModel) return;
        
        // 歌声トラックがある場合はスキップ
        if (DANCE_PRESETS[currentDanceId].vocal) return;

        const deltaTime = scene.getEngine().getDeltaTime();
        
        // 1. 時々口を少し動かす（自然な仕草）
        idleMouthTimer += deltaTime;
        if (idleMouthTimer > 2000) { // 2秒おき
            if (Math.random() > 0.7) {
                const weight = Math.random() * 0.2; // 控えめに
                try {
                    currentModel.morph.setMorphWeight("あ", weight);
                    currentModel.morph.setMorphWeight("a", weight);
                } catch(e) {}
            }
            idleMouthTimer = 0;
        }

        // 2. 笑顔を時々強調
        idleSmileTimer += deltaTime;
        if (idleSmileTimer > 5000) { // 5秒おき
            if (Math.random() > 0.5) {
                try {
                    currentModel.morph.setMorphWeight("笑い", 0.5 + Math.random() * 0.5);
                } catch(e) {}
            }
            idleSmileTimer = 0;
        }
    });

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
                if (vocalAudio && !vocalAudio.paused) {
                    vocalAudio.pause();
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
                        internalAudio.play().catch(err => console.warn("Loop audio play failed:", err));
                    }
                    if (vocalAudio) {
                        vocalAudio.currentTime = 0;
                        vocalAudio.play().catch(err => console.warn("Loop vocal play failed:", err));
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
            "assets/model/miku.pmx", DANCE_PRESETS[currentDanceId].vmd,
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
    const setupAudio = async (danceId: string) => {
        try {
            await mmdRuntime.setAudioPlayer(audioPlayer);
            const preset = DANCE_PRESETS[danceId];
            audioPlayer.source = preset.music;

            internalAudio = (audioPlayer as any)._audio || (audioPlayer as any).audio || null;
            if (internalAudio) {
                internalAudio.preload = "auto";
                internalAudio.load();
                
                // ★ リップシンク用ボーカル音声のセットアップ
                if (preset.vocal) {
                    vocalAudio = new Audio(preset.vocal);
                    vocalAudio.preload = "auto";
                    vocalAudio.load();
                } else {
                    vocalAudio = null;
                }

                const promises = [];
                promises.push(new Promise<void>((resolve) => {
                    if (!internalAudio || internalAudio.readyState >= 3) return resolve();
                    const onReady = () => {
                        internalAudio?.removeEventListener("canplaythrough", onReady);
                        resolve();
                    };
                    internalAudio.addEventListener("canplaythrough", onReady);
                    setTimeout(resolve, 5000);
                }));

                if (vocalAudio) {
                    promises.push(new Promise<void>((resolve) => {
                        if (!vocalAudio || vocalAudio.readyState >= 3) return resolve();
                        const onReady = () => {
                            vocalAudio?.removeEventListener("canplaythrough", onReady);
                            resolve();
                        };
                        vocalAudio.addEventListener("canplaythrough", onReady);
                        setTimeout(resolve, 5000);
                    }));
                }

                await Promise.all(promises);
            }
        } catch (e) {
            console.warn("Audio failed", e);
        }
    };
    await setupAudio(currentDanceId);

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
    // ダンス切り替えリスナー
    const danceSelect = document.getElementById("danceSelect") as HTMLSelectElement;
    if (danceSelect) {
        danceSelect.addEventListener("change", async () => {
            const newId = danceSelect.value;
            if (newId === currentDanceId || !currentModel) return;

            console.log("Switching Dance to:", newId);
            currentDanceId = newId;

            // 1. 再生状態の保存と停止
            const wasPlaying = bgmStarted;
            mmdRuntime.pauseAnimation();
            if (internalAudio) internalAudio.pause();
            if (vocalAudio) vocalAudio.pause();
            bgmStarted = false;

            // 2. モーション読み込み
            if (loadingStatus) loadingStatus.textContent = "Loading Motion...";
            await loadVmdToModel(scene, mmdRuntime, currentModel, DANCE_PRESETS[newId].vmd);
            
            // 3. 音声読み込み
            if (loadingStatus) loadingStatus.textContent = "Loading Audio...";
            await setupAudio(newId);

            // 4. 自動再生（切り替え前が再生中だった場合）
            if (wasPlaying) {
                startPlayback();
            }

            if (loadingStatus) loadingStatus.textContent = "";
            console.log("Dance Switch Complete");
        });
    }

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
                pmxPath, DANCE_PRESETS[currentDanceId].vmd,
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
                    scene, mmdRuntime, "assets/model/presets/v_miku_full/model.pmx", DANCE_PRESETS[currentDanceId].vmd,
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
