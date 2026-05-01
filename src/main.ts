import { createScene } from './app/createScene';
import { createMmdRuntime } from './app/mmdRuntime';
import { loadMmdModel, loadMmdModelFromFiles } from './app/loadMmdModel';
import { setupUI } from './app/setupUI';
import { setupWebXR } from './app/setupWebXR';
import { setupPerformanceControls } from './app/performance';
import { MmdModel, StreamAudioPlayer } from 'babylon-mmd';
import "@babylonjs/core/Audio/audioSceneComponent";

async function init() {
    console.log("App Initialization - Version 1.9");
    
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    if (!canvas) return;

    // 1. Initialize Scene
    const { scene, shadowGenerator } = await createScene(canvas);

    // 2. Initialize MMD Runtime
    const mmdRuntime = createMmdRuntime(scene);

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
                    if (loadingStatus) loadingStatus.textContent = "読み込み中...";
                }
            }
        );
        if (currentModel) {
            // Adjust scale and position for AR (0.04 is a very safe tabletop size)
            currentModel.mesh.scaling.setAll(0.04); 
            currentModel.mesh.position.set(0, 0, 0); 
            
            // Start animation immediately
            mmdRuntime.playAnimation();

            // Initialize WebXR Native UI immediately
            setupWebXR(scene, [currentModel.mesh as any]);
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
                currentModel.mesh.scaling.setAll(0.04);
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
}

init();
