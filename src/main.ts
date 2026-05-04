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

    const startPlayback = async (): Promise<boolean> => {
        if (!currentModel) return false;

        console.log("startPlayback triggered (v2.16)");
        try {
            // 1. UIの更新（円形ボタンを一時停止アイコンに）
            const btn = document.getElementById("playPauseBtn");
            if (btn) btn.textContent = "||";

            // 2. アニメーション再生
            mmdRuntime.playAnimation();

            if (!bgmStarted) {
                // 初回再生時の初期化
                const ctx = (window as any).BABYLON?.Engine?.audioEngine?.audioContext;
                if (ctx && ctx.state === "suspended") {
                    await ctx.resume();
                }

                if (internalAudio) {
                    // リップシンクの紐付け（歌声優先、なければBGM）
                    const analysisAudio = vocalAudio || internalAudio;
                    const isSilent = !!vocalAudio; // 歌声のみの場合は無音で解析
                    lipSync.attach(analysisAudio, isSilent);
                    
                    if (vocalAudio) {
                        console.log("✅ Vocal track attached for analysis (silent)");
                        vocalAudio.play().catch(e => console.warn("Vocal play failed", e));
                    }

                    internalAudio.muted = false;
                    internalAudio.volume = 1.0;
                    await internalAudio.play();
                }
                bgmStarted = true;
            } else {
                // 一時停止からの再開
                if (internalAudio && internalAudio.paused) internalAudio.play();
                if (vocalAudio && vocalAudio.paused) vocalAudio.play();
            }
            return true;
        } catch (e) {
            console.warn("Playback failed:", e);
            return false;
        }
    };
    (window as any).__startPlayback = startPlayback;

    // キャンバスタップでも再生開始するように追加
    let arEntered = false;
    const onCanvasTap = () => {
        if (!arEntered) return; // ★ ARに入る前は何もしない
        startPlayback();
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

    // 3. Load Default Model
    let isLooping = false;
    let loopTimer: number | null = null;
    let loopEnabled = true;

    // ===== アイドル時の自然な表情（歌声がない時用） ＆ ループ再生検知 =====
    let idleMouthTimer = 0;
    scene.onBeforeRenderObservable.add(() => {
        if (!bgmStarted || !currentModel) return;
        
        // 歌声トラックがある場合はスキップ
        if (DANCE_PRESETS[currentDanceId].vocal) return;

        const deltaTime = scene.getEngine().getDeltaTime();
        
        // 1. 時々口や表情を少し動かす（自然な仕草 / アイドル表現エンジン）
        idleMouthTimer += deltaTime;
        if (idleMouthTimer > 2000) { // 2秒おき
            if (Math.random() > 0.7) {
                const weight = Math.random() * 0.2; // 控えめに
                try {
                    currentModel.morph.setMorphWeight("あ", weight);
                    currentModel.morph.setMorphWeight("a", weight);
                    
                    // 笑顔（笑いモーフ）を時々混ぜる
                    if (Math.random() > 0.5) {
                        currentModel.morph.setMorphWeight("笑い", weight * 1.5);
                    }
                } catch(e) {}
            }
            idleMouthTimer = 0;
        }

        // --- ループ再生検知 ---
        if (!loopEnabled || isLooping) return;

        let duration = mmdRuntime.animationFrameTimeDuration;
        // durationが未取得なら音楽から算出(30fps)
        if (duration <= 0 && internalAudio && internalAudio.duration) {
            duration = internalAudio.duration * 30;
        }
        
        const current = mmdRuntime.currentFrameTime;

        // 再生中かつ終端付近に到達したか
        if (mmdRuntime.isAnimationPlaying && duration > 0 && current >= duration - 2.0) {
            if (!isLooping) {
                console.log(`🔁 Loop condition met: ${current.toFixed(1)} / ${duration.toFixed(1)}`);
                (window as any).__triggerLoop();
            }
        }
    });

    // 3. Load Default Model
    const loadingScreen = document.getElementById("loading-screen") as HTMLDivElement;
    const loadingStatus = document.getElementById("loading-status") as HTMLSpanElement;
    const arLaunchBtn = document.getElementById("arLaunchBtn") as HTMLButtonElement | null;

    if (arLaunchBtn) {
        arLaunchBtn.disabled = true;
        arLaunchBtn.style.opacity = "0.5";
        arLaunchBtn.style.pointerEvents = "none";
    }
    
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

    // グローバルにループ発火関数を公開
    (window as any).__triggerLoop = () => {
        if (isLooping || !loopEnabled) return;
        isLooping = true;
        console.log("🔁 Hybrid Loop Triggered (Frame or Audio)");
        
        mmdRuntime.pauseAnimation();
        if (internalAudio) internalAudio.pause();
        if (vocalAudio) vocalAudio.pause();
        
        const btn = document.getElementById("playPauseBtn");
        if (btn) btn.textContent = "▶";

        if (loopTimer) clearTimeout(loopTimer);
        loopTimer = window.setTimeout(() => {
            try {
                mmdRuntime.seekAnimation(0, true);
                if (internalAudio) { 
                    internalAudio.currentTime = 0; 
                    internalAudio.play().catch(e => console.warn(e));
                }
                if (vocalAudio) { 
                    vocalAudio.currentTime = 0; 
                    vocalAudio.play().catch(e => console.warn(e));
                }
                mmdRuntime.playAnimation();
                if (btn) btn.textContent = "||";
                console.log("🔁 Loop restarted successfully");
            } catch(e) {
                console.warn("Loop restart failed:", e);
            } finally {
                isLooping = false; // ★ 必ずリセットする
            }
        }, 1000);
    };

    // 4. Setup Audio Source
    const setupAudio = async (danceId: string) => {
        try {
            await mmdRuntime.setAudioPlayer(audioPlayer);
            const preset = DANCE_PRESETS[danceId];
            audioPlayer.source = preset.music;
            
            // ★ ループ用の音声終了検知を追加
            if ((audioPlayer as any)._audio) {
                const audio = (audioPlayer as any)._audio;
                audio.addEventListener("ended", () => {
                    if (loopEnabled && !isLooping) {
                        // ループ処理を発火
                        (window as any).__triggerLoop();
                    }
                });
            }

            internalAudio = (audioPlayer as any)._audio || (audioPlayer as any).audio || null;
            if (!internalAudio) {
                console.log("Fallback: Creating new Audio element");
                internalAudio = new Audio(preset.music);
            }

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
                    setTimeout(resolve, 10000); // 5000 -> 10000
                }));

                if (vocalAudio) {
                    promises.push(new Promise<void>((resolve) => {
                        if (!vocalAudio || vocalAudio.readyState >= 3) return resolve();
                        const onReady = () => {
                            vocalAudio?.removeEventListener("canplaythrough", onReady);
                            resolve();
                        };
                        vocalAudio?.addEventListener("canplaythrough", onReady);
                        setTimeout(resolve, 10000); // 5000 -> 10000
                    }));
                }

                await Promise.all(promises);
            }
        } catch (e) {
            console.warn("Audio failed", e);
        }
    };
    await setupAudio(currentDanceId);
    
    // 音声セットアップ後に Duration を再設定（上書き対策）
    if (currentMotion) {
        mmdRuntime.setManualAnimationDuration(currentMotion.endFrame);
    }

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
            currentMotion = await loadVmdToModel(scene, mmdRuntime, currentModel, DANCE_PRESETS[newId].vmd);
            
            // 3. 音声読み込み
            if (loadingStatus) loadingStatus.textContent = "Loading Audio...";
            await setupAudio(newId);

            // 音声セットアップ後に Duration を再設定（上書き対策）
            if (currentMotion) {
                mmdRuntime.setManualAnimationDuration(currentMotion.endFrame);
            }

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
        const result = await loadMmdModelFromFiles(scene, mmdRuntime, pmx, vmd, textures, shadowGenerator);
        currentModel = result.model;
        currentMotion = result.motion;
        
        if (currentModel) {
            currentModel.mesh.scaling.setAll(0.07);
            currentModel.mesh.position.set(0, 0, 0); 
            if (expressionCleanup) (expressionCleanup as any)();
            expressionCleanup = setupExpressions(scene, currentModel);

            // ロード完了後に Duration を再設定
            if (currentMotion) {
                mmdRuntime.setManualAnimationDuration(currentMotion.endFrame);
            }

            // ★ AR操作対象を更新
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

            const result = await loadMmdModel(
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
            currentModel = result.model;
            currentMotion = result.motion;

            if (currentModel) {
                currentModel.mesh.scaling.setAll(0.07);
                currentModel.mesh.position.set(0, 0, 0); 
                if (expressionCleanup) (expressionCleanup as any)();
                expressionCleanup = setupExpressions(scene, currentModel);

                // ロード完了後に Duration を再設定
                if (currentMotion) {
                    mmdRuntime.setManualAnimationDuration(currentMotion.endFrame);
                }

                // ★ AR操作対象を更新
                if (typeof (window as any).__updateXRTargetMeshes === "function") {
                    (window as any).__updateXRTargetMeshes([currentModel.mesh]);
                }
                console.log(`✅ Successfully switched to preset: ${presetId}`);
            }
        } catch (e: any) {
            console.error(`❌ Failed to switch to ${presetId}:`, e);
            alert(`モデル「${presetId}」の読み込みに失敗しました。\n${e.message || e}\nデフォルトモデルに戻します。`);
            
            // フォールバック：デフォルトモデルへ復帰
            try {
                const fallbackResult = await loadMmdModel(
                    scene, mmdRuntime, "assets/model/presets/v_miku_full/model.pmx", DANCE_PRESETS[currentDanceId].vmd,
                    shadowGenerator
                );
                currentModel = fallbackResult.model;
                currentMotion = fallbackResult.motion;
                if (currentModel) {
                    currentModel.mesh.scaling.setAll(0.07);
                    currentModel.mesh.position.set(0, 0, 0); 
                    if (expressionCleanup) (expressionCleanup as any)();
                    expressionCleanup = setupExpressions(scene, currentModel);

                    // フォールバック後も Duration を再設定
                    if (currentMotion) {
                        mmdRuntime.setManualAnimationDuration(currentMotion.endFrame);
                    }
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
} // ★ init 関数の閉じカッコを復元

// ===== UIモーダル制御 =====
function setupModals() {
  const open = (id: string) => document.getElementById(id)?.classList.remove("hidden");
  const close = (id: string) => document.getElementById(id)?.classList.add("hidden");
  const bindBackdrop = (id: string) => {
    const m = document.getElementById(id);
    m?.addEventListener("click", (e) => { if (e.target === m) m.classList.add("hidden"); });
  };

  // ENTER AR ボタン
  document.getElementById("arLaunchBtn")?.addEventListener("click", async () => {
    console.log("AR Launch Button Clicked");

    const xr = (window as any).__xrHelper;

    // 1) xrHelper がまだ準備できていない
    if (!xr || !xr.baseExperience) {
      console.warn("xrHelper not ready yet");
      alert("AR システムの準備がまだ整っていません。数秒待ってから再度お試しください。");
      return;
    }

    // 2) ブラウザ自体が AR 非対応
    if (!navigator.xr || typeof navigator.xr.isSessionSupported !== "function") {
      console.warn("navigator.xr not available");
      open("ar-unavailable-modal");
      return;
    }

    const supported = await navigator.xr.isSessionSupported("immersive-ar");
    console.log("immersive-ar supported:", supported);
    if (!supported) {
      console.warn("immersive-ar not supported by browser/device");
      open("ar-unavailable-modal");
      return;
    }

    // 3) user activation 内で直接セッション開始
    try {
      await xr.baseExperience.enterXRAsync(
        "immersive-ar",
        "local-floor",
        xr.renderTarget
      );
      console.log("✅ AR session started");
    } catch (e: any) {
      console.error("❌ enterXRAsync failed:", e?.name, e?.message);
      // 詳細なエラーをアラートで表示してデバッグしやすくする
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
