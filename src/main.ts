import { createScene } from './app/createScene';
import { createMmdRuntime } from './app/mmdRuntime';
import { loadMmdModel, loadMmdModelFromFiles, loadVmdToModel } from './app/loadMmdModel';
import { setupUI } from './app/setupUI';
import { setupWebXR } from './app/setupWebXR';
import { setupPerformanceControls } from './app/performance';
import { StreamAudioPlayer } from 'babylon-mmd';
import { setupExpressions } from './app/setupExpressions';
import { appState } from './app/state';
import { initAudioController, togglePlayback, setupAudio, DANCE_PRESETS } from './app/audioController';
import { showLoading, hideLoading, updateLoadingProgress } from './app/loadingController';
import { setupModals } from './app/modalController';

async function init() {
    console.log("MMD WebXR Player - Refactored v3.0 (Modular Controllers)");
    
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    if (!canvas) return;

    const { scene, shadowGenerator } = await createScene(canvas);
    const mmdRuntime = createMmdRuntime(scene);
    
    appState.scene = scene;
    appState.shadowGenerator = shadowGenerator;
    appState.mmdRuntime = mmdRuntime;
    (scene as any).mmdRootRuntime = mmdRuntime;

    const audioPlayer = new StreamAudioPlayer(scene);
    appState.audioPlayer = audioPlayer;

    initAudioController();

    let expressionCleanup: (() => void) | null = null;

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
            appState.currentModel.mesh.scaling.setAll(0.07);
            appState.currentModel.mesh.position.y = 0.5;
            expressionCleanup = setupExpressions(scene, appState.currentModel);
            await setupWebXR(scene, [appState.currentModel.mesh as any]);
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
        }
    } catch (e) {
        console.error("Initialization failed", e);
    } finally {
        hideLoading();
        console.log("Initialization flow complete.");
    }

    const danceSelect = document.getElementById("danceSelect") as HTMLSelectElement;
    danceSelect?.addEventListener("change", async () => {
        const newId = danceSelect.value;
        if (newId === appState.currentDanceId || !appState.currentModel) return;
        appState.currentDanceId = newId;
        showLoading("Loading...");
        try {
            const motion = await loadVmdToModel(scene, mmdRuntime, appState.currentModel, DANCE_PRESETS[newId].vmd);
            showLoading("Loading Audio...");
            await setupAudio(newId);
            if (motion) mmdRuntime.setManualAnimationDuration(motion.endFrame);
        } finally {
            hideLoading();
        }
    });

    setupUI(scene, async (pmx, vmd, textures) => {
        const wasPlaying = appState.bgmStarted && appState.internalAudio !== null && !appState.internalAudio.paused;
        const savedAudioTime = appState.internalAudio?.currentTime || 0;
        mmdRuntime.pauseAnimation();
        if (appState.currentModel) {
            mmdRuntime.destroyMmdModel(appState.currentModel);
            appState.currentModel.mesh.dispose();
            if (expressionCleanup) expressionCleanup();
        }
        showLoading("Loading...");
        try {
            const result = await loadMmdModelFromFiles(scene, mmdRuntime, pmx, vmd, textures, shadowGenerator);
            appState.currentModel = result.model;
            if (appState.currentModel) {
                appState.currentModel.mesh.scaling.setAll(0.07);
                appState.currentModel.mesh.position.y = 0.5;
                expressionCleanup = setupExpressions(scene, appState.currentModel);
                if (result.motion) mmdRuntime.setManualAnimationDuration(result.motion.endFrame);
                if ((window as any).__updateXRTargetMeshes) (window as any).__updateXRTargetMeshes([appState.currentModel.mesh]);
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
        if (!pmxPath || !appState.currentModel) return;
        const wasPlaying = appState.bgmStarted && appState.internalAudio !== null && !appState.internalAudio.paused;
        const savedAudioTime = appState.internalAudio?.currentTime || 0;
        mmdRuntime.pauseAnimation();
        showLoading("0%");
        try {
            mmdRuntime.destroyMmdModel(appState.currentModel);
            appState.currentModel.mesh.dispose();
            if (expressionCleanup) expressionCleanup();
            const result = await loadMmdModel(
                scene, mmdRuntime, pmxPath, DANCE_PRESETS[appState.currentDanceId].vmd, shadowGenerator, 
                undefined, 
                (event) => {
                    if (event.lengthComputable && event.total > 0) {
                        updateLoadingProgress(Math.floor((event.loaded / event.total) * 100));
                    }
                }
            );
            appState.currentModel = result.model;
            if (appState.currentModel) {
                appState.currentModel.mesh.scaling.setAll(0.07);
                appState.currentModel.mesh.position.y = 0.5;
                expressionCleanup = setupExpressions(scene, appState.currentModel);
                if (result.motion) mmdRuntime.setManualAnimationDuration(result.motion.endFrame);
                if ((window as any).__updateXRTargetMeshes) (window as any).__updateXRTargetMeshes([appState.currentModel.mesh]);
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
        appState.loopEnabled = (e.target as HTMLInputElement).checked;
    });

    scene.onPointerObservable.add((pointerInfo) => {
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
