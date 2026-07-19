import { createScene } from './app/createScene';
import { createMmdRuntime } from './app/mmdRuntime';
import { loadMmdModel, loadMmdModelFromFiles, loadVmdToModel } from './app/loadMmdModel';
import { setupUI } from './app/setupUI';
import { setupWebXR } from './app/setupWebXR';
import { setupPerformanceControls } from './app/performance';
import { StreamAudioPlayer } from 'babylon-mmd';
import type { MmdModel } from 'babylon-mmd';
import { setupExpressions } from './app/setupExpressions';
import {
    initGameMode, openChanceWindow, isGameActive, cancelActiveChance,
    getExpressionTuning, registerChanceTrigger,
} from './app/gameMode';
import { appState } from './app/state';
import { initAudioController, togglePlayback, setupAudio, setLipSyncEnabled, DANCE_PRESETS } from './app/audioController';
import { showLoading, hideLoading, updateLoadingProgress, showError, showFatalError } from './app/loadingController';
import { setupModals } from './app/modalController';

async function init() {
    console.log("MMD WebXR Player - v3.1 (WebXR Light Estimation / Depth Occlusion / Anchors)");

    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    if (!canvas) return;

    initGameMode(canvas);

    const { scene, shadowGenerator } = await createScene(canvas);
    const mmdRuntime = createMmdRuntime(scene);

    appState.scene = scene;
    appState.shadowGenerator = shadowGenerator;
    appState.mmdRuntime = mmdRuntime;
    (scene as any).mmdRootRuntime = mmdRuntime;

    // WebXR は必ずモデル読込より前に初期化する:
    // 深度オクルージョンのマテリアルプラグインは「機能有効化後に生成されたマテリアル」
    // にのみ適用されるため、モデルのマテリアル生成より先に登録する必要がある
    await setupWebXR(scene, shadowGenerator);

    const audioPlayer = new StreamAudioPlayer(scene);
    appState.audioPlayer = audioPlayer;

    initAudioController();

    let expressionCleanup: (() => void) | null = null;
    let isSwitching = false;

    const DEFAULT_SCALE = 0.07;
    const DEFAULT_Y = 0.5;

    // 現在のスライダー値を新しいモデルへ反映（ユーザー調整をモデル切替後も維持する）
    const applyModelTransform = (model: MmdModel) => {
        const scaleEl = document.getElementById("sideScaleSlider") as HTMLInputElement | null;
        const yEl = document.getElementById("sideYPosSlider") as HTMLInputElement | null;
        const sc = scaleEl ? parseFloat(scaleEl.value) : NaN;
        const yy = yEl ? parseFloat(yEl.value) : NaN;
        model.mesh.scaling.setAll(Number.isFinite(sc) ? sc : DEFAULT_SCALE);
        model.mesh.position.y = Number.isFinite(yy) ? yy : DEFAULT_Y;
    };

    // モデル差し替えの共通処理：
    //  - 新モデルの読み込みに成功してから旧モデルを破棄（失敗時は旧モデルを維持）
    //  - 多重実行をガード、再生位置とボーカルトラックを復元
    const swapModel = async (
        load: () => Promise<{ model: MmdModel | null; motion: any }>
    ) => {
        if (isSwitching || !appState.currentModel) return;
        isSwitching = true;
        cancelActiveChance(); // 旧モデルの表情が開いた進行中チャンスを無効化（新モデルに引き継がない）

        const wasPlaying = appState.bgmStarted && appState.internalAudio !== null && !appState.internalAudio.paused;
        const savedAudioTime = appState.internalAudio?.currentTime || 0;

        // 音楽/モーションはランタイム経由、ボーカルは個別要素なので個別に止める
        mmdRuntime.pauseAnimation();
        if (appState.vocalAudio) { try { appState.vocalAudio.pause(); } catch (e) {} }

        const prevModel = appState.currentModel;
        const prevCleanup = expressionCleanup;

        showLoading("Loading...");
        try {
            const result = await load();
            if (!result.model) throw new Error("model load returned empty result");

            // ここまで来たら成功。旧モデルを破棄する
            mmdRuntime.destroyMmdModel(prevModel);
            prevModel.mesh.dispose();
            if (prevCleanup) prevCleanup();

            appState.currentModel = result.model;
            applyModelTransform(result.model);
            expressionCleanup = setupExpressions(scene, result.model, openChanceWindow, getExpressionTuning, registerChanceTrigger);
            if (result.motion) mmdRuntime.setManualAnimationDuration(result.motion.endFrame);
            if ((window as any).__updateXRTargetMeshes) (window as any).__updateXRTargetMeshes([result.model.mesh]);

            if (wasPlaying) {
                mmdRuntime.seekAnimation(savedAudioTime * 30, true);
                if (appState.vocalAudio) { try { appState.vocalAudio.currentTime = savedAudioTime; } catch (e) {} }
                await togglePlayback(true);
            }
        } catch (e) {
            console.error("Model switch failed", e);
            showError("モデルの読み込みに失敗しました。前のモデルを維持します。");
            // 旧モデルは破棄していないので継続利用可能。再生中だったら再開する
            if (wasPlaying) { try { await togglePlayback(true); } catch (e2) {} }
        } finally {
            hideLoading();
            isSwitching = false;
        }
    };

    let initOk = false;
    try {
        showLoading("0%");
        const result = await loadMmdModel(
            scene, mmdRuntime, "assets/model/miku.pmx", DANCE_PRESETS[appState.currentDanceId].vmd, shadowGenerator,
            undefined,
            (event: any) => {
                if (event.lengthComputable && event.total > 0) {
                    updateLoadingProgress(Math.floor((event.loaded / event.total) * 100));
                }
            }
        );
        appState.currentModel = result.model;
        if (appState.currentModel) {
            applyModelTransform(appState.currentModel);
            expressionCleanup = setupExpressions(scene, appState.currentModel, openChanceWindow, getExpressionTuning, registerChanceTrigger);
            (window as any).__updateXRTargetMeshes?.([appState.currentModel.mesh]);
            if (result.motion) mmdRuntime.setManualAnimationDuration(result.motion.endFrame);
            showLoading("Loading Audio...");
            await mmdRuntime.setAudioPlayer(audioPlayer);
            await setupAudio(appState.currentDanceId);

            // Wait for shaders and meshes to be ready for rendering (with 10s timeout)
            console.log("Waiting for scene readiness...");
            await Promise.race([
                new Promise<void>(resolve => {
                    scene.executeWhenReady(() => {
                        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
                    });
                }),
                new Promise<void>((_, reject) => setTimeout(() => reject(new Error("Scene ready timeout")), 10000))
            ]).catch(err => console.warn("Scene readiness warning:", err));
            initOk = true;
        }
    } catch (e) {
        console.error("Initialization failed", e);
    } finally {
        console.log("Initialization flow complete.");
        if (initOk) {
            hideLoading();
        } else {
            // 暗い画面のまま放置せず、失敗をユーザーへ明示する
            showFatalError("初期化に失敗しました。通信環境を確認し、ページを再読み込みしてください。");
        }
    }

    const danceSelect = document.getElementById("danceSelect") as HTMLSelectElement;
    danceSelect?.addEventListener("change", async () => {
        const newId = danceSelect.value;
        if (newId === appState.currentDanceId || !appState.currentModel || isSwitching) return;
        const prevId = appState.currentDanceId;
        appState.currentDanceId = newId;
        isSwitching = true;
        showLoading("Loading...");
        try {
            const motion = await loadVmdToModel(scene, mmdRuntime, appState.currentModel, DANCE_PRESETS[newId].vmd);
            showLoading("Loading Audio...");
            await setupAudio(newId);
            if (motion) mmdRuntime.setManualAnimationDuration(motion.endFrame);
            document.getElementById("music-modal")?.classList.add("hidden");
        } catch (e) {
            console.error("Dance switch failed", e);
            appState.currentDanceId = prevId; // 失敗時は選択を元に戻す
            danceSelect.value = prevId;
            showError("ダンス/曲の読み込みに失敗しました");
        } finally {
            hideLoading();
            isSwitching = false;
        }
    });

    setupUI(scene, async (pmx, vmd, textures) => {
        await swapModel(() => loadMmdModelFromFiles(scene, mmdRuntime, pmx, vmd, textures, shadowGenerator));
    }, async (presetId) => {
        const presets: Record<string, string> = {
            "original": "assets/model/miku.pmx",
            "v_miku_full": "assets/model/presets/v_miku_full/model.pmx",
            "sour_snow": "assets/model/presets/snow/model.pmx",
            "onasu": "assets/model/presets/sakura/model.pmx",
            "riverside": "assets/model/presets/riverside/model.pmx",
            "crown_knight": "assets/model/presets/crown_knight/model.pmx",
            "vampire_lolita": "assets/model/presets/vampire_lolita/model.pmx",
            "onasu_whiterose": "assets/model/presets/onasu_whiterose/model.pmx",
            "onasu_v04": "assets/model/presets/onasu_v04/model.pmx",
            "onasu_cosmos": "assets/model/presets/onasu_cosmos/model.pmx",
            "higanbana": "assets/model/presets/higanbana/model.pmx",
            "snow_miku_2011": "assets/model/presets/snow_miku_2011/model.pmx",
            "euphonie": "assets/model/presets/euphonie/model.pmx"
        };
        const pmxPath = presets[presetId];
        if (!pmxPath || !appState.currentModel) return;
        await swapModel(() => loadMmdModel(
            scene, mmdRuntime, pmxPath, DANCE_PRESETS[appState.currentDanceId].vmd, shadowGenerator,
            undefined,
            (event) => {
                if (event.lengthComputable && event.total > 0) {
                    updateLoadingProgress(Math.floor((event.loaded / event.total) * 100));
                }
            }
        ));
    });

    setupPerformanceControls(scene, mmdRuntime, shadowGenerator);
    
    document.getElementById("loopToggle")?.addEventListener("change", (e) => {
        appState.loopEnabled = (e.target as HTMLInputElement).checked;
    });

    document.getElementById("lipsyncToggle")?.addEventListener("change", (e) => {
        setLipSyncEnabled((e.target as HTMLInputElement).checked);
    });

    scene.onPointerObservable.add((pointerInfo) => {
        // AR中のタップは配置/ゲーム判定専用。WebXRのタップもシーンのポインタイベントに
        // 変換されてここに届くため、AR中にミクへタップが当たると再生停止してしまうのを防ぐ
        if (isGameActive()) return;
        if (pointerInfo.type === 32 && pointerInfo.pickInfo?.hit) {
            const pickedMesh = pointerInfo.pickInfo.pickedMesh;
            if (pickedMesh && appState.currentModel && (pickedMesh === appState.currentModel.mesh || pickedMesh.isDescendantOf(appState.currentModel.mesh))) {
                togglePlayback();
            }
        }
    });

    (window as any).__startPlayback = () => togglePlayback(true);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupModals);
} else {
    setupModals();
}

init();
