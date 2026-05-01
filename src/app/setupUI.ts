import { Scene } from "@babylonjs/core";
import { MmdRuntime, MmdModel, StreamAudioPlayer } from "babylon-mmd";

export const setupUI = (
    scene: Scene, 
    mmdRuntime: MmdRuntime, 
    audioPlayer: StreamAudioPlayer,
    getCurrentModel: () => MmdModel | null,
    onLoadFiles: (pmx: File, vmd: File, textures: FileList) => void
) => {
    const playPauseBtn = document.getElementById("playPauseBtn") as HTMLButtonElement;
    const scaleSlider = document.getElementById("scaleSlider") as HTMLInputElement;
    const scaleVal = document.getElementById("scaleVal") as HTMLSpanElement;
    const yPosSlider = document.getElementById("yPosSlider") as HTMLInputElement;
    const yPosVal = document.getElementById("yPosVal") as HTMLSpanElement;
    const fpsDiv = document.getElementById("fps") as HTMLDivElement;
    
    const fileSelectToggle = document.getElementById("fileSelectToggle") as HTMLButtonElement;
    const fileModal = document.getElementById("file-modal") as HTMLDivElement;
    const closeModalBtn = document.getElementById("closeModalBtn") as HTMLButtonElement;
    const loadFilesBtn = document.getElementById("loadFilesBtn") as HTMLButtonElement;
    
    const pmxInput = document.getElementById("pmxInput") as HTMLInputElement;
    const vmdInput = document.getElementById("vmdInput") as HTMLInputElement;
    const textureDirInput = document.getElementById("textureDirInput") as HTMLInputElement;

    const seekSlider = document.getElementById("seekSlider") as HTMLInputElement;
    const seekVal = document.getElementById("seekVal") as HTMLSpanElement;
    const durationVal = document.getElementById("durationVal") as HTMLSpanElement;

    const controlPanel = document.getElementById("control-panel") as HTMLDivElement;
    const minimizeBtn = document.getElementById("minimizeBtn") as HTMLButtonElement;
    const showSettingsBtn = document.getElementById("showSettingsBtn") as HTMLButtonElement;

    const S_BASE = 0.7;
    const Y_BASE = -5.0;

    // Play/Pause
    playPauseBtn.addEventListener("click", () => {
        if (mmdRuntime.isAnimationPlaying) {
            mmdRuntime.pauseAnimation();
        } else {
            mmdRuntime.playAnimation();
        }
    });

    // Scale
    scaleSlider.addEventListener("input", () => {
        const val = parseFloat(scaleSlider.value);
        scaleVal.textContent = val.toFixed(1);
        const model = getCurrentModel();
        if (model) {
            // Normalize: val 1.0 -> scale 0.7
            model.mesh.scaling.setAll(val * S_BASE);
        }
    });

    // Y Position
    yPosSlider.addEventListener("input", () => {
        const val = parseFloat(yPosSlider.value);
        yPosVal.textContent = val.toFixed(1);
        const model = getCurrentModel();
        if (model) {
            // Normalize: val 0.0 -> Y -5.0
            model.mesh.position.y = val + Y_BASE;
        }
    });

    // Seek
    let isSeeking = false;
    seekSlider.addEventListener("input", () => {
        isSeeking = true;
        const frame = parseFloat(seekSlider.value);
        seekVal.textContent = Math.floor(frame).toString();
    });

    seekSlider.addEventListener("change", () => {
        const frame = parseFloat(seekSlider.value);
        mmdRuntime.seekAnimation(frame, true);
        isSeeking = false;
    });

    // Update duration and seek bar
    const updateDuration = () => {
        let duration = mmdRuntime.animationFrameTimeDuration;
        
        // If runtime duration is 0, try to get it from audio player as fallback
        if (duration <= 0 && mmdRuntime.audioPlayer) {
            duration = (mmdRuntime.audioPlayer as StreamAudioPlayer).duration * 30; // seconds to 30fps frames
        }

        if (duration > 0) {
            durationVal.textContent = Math.floor(duration).toString();
            seekSlider.max = duration.toString();
        }
    };

    mmdRuntime.onAnimationDurationChangedObservable.add(updateDuration);

    audioPlayer.onDurationChangedObservable.add(updateDuration);

    scene.onBeforeRenderObservable.add(() => {
        if (!isSeeking) {
            const currentFrame = mmdRuntime.currentFrameTime;
            const duration = mmdRuntime.animationFrameTimeDuration;
            
            // Fallback for duration update
            if (duration > 0 && parseFloat(seekSlider.max) === 0) {
                updateDuration();
            }

            seekSlider.value = currentFrame.toString();
            seekVal.textContent = Math.floor(currentFrame).toString();
        }
    });

    // File Modal
    fileSelectToggle.addEventListener("click", () => fileModal.classList.remove("hidden"));
    closeModalBtn.addEventListener("click", () => fileModal.classList.add("hidden"));
    
    loadFilesBtn.addEventListener("click", () => {
        const pmx = pmxInput.files?.[0];
        const vmd = vmdInput.files?.[0];
        const textures = textureDirInput.files;
        
        if (pmx && vmd && textures) {
            onLoadFiles(pmx, vmd, textures);
            fileModal.classList.add("hidden");
        } else {
            alert("PMX, VMD, and Texture folder are required.");
        }
    });

    // UI Toggle
    minimizeBtn.addEventListener("click", () => {
        controlPanel.classList.add("collapsed");
        showSettingsBtn.classList.remove("hidden");
    });

    showSettingsBtn.addEventListener("click", () => {
        controlPanel.classList.remove("collapsed");
        showSettingsBtn.classList.add("hidden");
    });

    // Initial Duration Update
    setTimeout(updateDuration, 1000);

    // FPS
    scene.getEngine().onBeginFrameObservable.add(() => {
        fpsDiv.textContent = `FPS: ${scene.getEngine().getFps().toFixed(0)}`;
    });
};
