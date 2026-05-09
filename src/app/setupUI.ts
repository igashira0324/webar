import { Scene } from "@babylonjs/core";
import type { StreamAudioPlayer } from "babylon-mmd";
import { appState } from "./state";
import { togglePlayback } from "./audioController";

export const setupUI = (
    scene: Scene, 
    onLoadFiles: (pmx: File, vmd: File, textures: FileList) => void,
    onPresetSelect: (presetId: string) => void
) => {
    const playPauseBtn = document.getElementById("playPauseBtn") as HTMLButtonElement | null;
    const fpsDiv = document.getElementById("fps") as HTMLDivElement | null;
    
    const fileSelectToggle = document.getElementById("fileSelectToggle") as HTMLButtonElement | null;
    const fileModal = document.getElementById("file-modal") as HTMLDivElement | null;
    const closeModalBtn = document.getElementById("closeModalBtn") as HTMLButtonElement | null;
    const loadFilesBtn = document.getElementById("loadFilesBtn") as HTMLButtonElement | null;
    
    const pmxInput = document.getElementById("pmxInput") as HTMLInputElement | null;
    const vmdInput = document.getElementById("vmdInput") as HTMLInputElement | null;
    const textureDirInput = document.getElementById("textureDirInput") as HTMLInputElement | null;

    const seekSlider = document.getElementById("seekSlider") as HTMLInputElement | null;
    const seekVal = document.getElementById("seekVal") as HTMLSpanElement | null;
    const durationVal = document.getElementById("durationVal") as HTMLSpanElement | null;

    const controlPanel = document.getElementById("control-panel") as HTMLDivElement | null;
    const minimizeBtn = document.getElementById("minimizeBtn") as HTMLButtonElement | null;
    const showSettingsBtn = document.getElementById("showSettingsBtn") as HTMLButtonElement | null;
    const closeMarkerBtn = document.getElementById("closeQrBtn") as HTMLButtonElement | null;

    const S_BASE = 1.0;
    const Y_BASE = -5.0;

    // ===== Play/Pause =====
    playPauseBtn?.addEventListener("click", () => {
        togglePlayback();
    });

    const sideScaleSlider = document.getElementById("sideScaleSlider") as HTMLInputElement | null;
    const sideYPosSlider = document.getElementById("sideYPosSlider") as HTMLInputElement | null;

    // ===== Scale (Side Bar) =====
    sideScaleSlider?.addEventListener("input", () => {
        const val = parseFloat(sideScaleSlider.value);
        if (appState.currentModel) appState.currentModel.mesh.scaling.setAll(val * S_BASE);
    });

    // ===== Y Position (Side Bar) =====
    sideYPosSlider?.addEventListener("input", () => {
        const val = parseFloat(sideYPosSlider.value);
        if (appState.currentModel) appState.currentModel.mesh.position.y = val + Y_BASE;
    });

    // ===== Seek =====
    let isSeeking = false;
    if (seekSlider) {
        seekSlider.addEventListener("input", () => {
            isSeeking = true;
            const frame = parseFloat(seekSlider.value);
            if (seekVal) seekVal.textContent = Math.floor(frame).toString();
        });
        seekSlider.addEventListener("change", () => {
            if (!appState.mmdRuntime) return;
            const frame = parseFloat(seekSlider.value);
            appState.mmdRuntime.seekAnimation(frame, true);
            isSeeking = false;
        });
    }

    // ===== Duration =====
    const updateDuration = () => {
        if (!appState.mmdRuntime) return;
        let duration = appState.mmdRuntime.animationFrameTimeDuration;
        if (duration <= 0 && appState.mmdRuntime.audioPlayer) {
            duration = (appState.mmdRuntime.audioPlayer as StreamAudioPlayer).duration * 30;
        }
        if (duration > 0) {
            if (durationVal) durationVal.textContent = Math.floor(duration).toString();
            if (seekSlider) {
                seekSlider.max = duration.toString();
                seekSlider.step = "1";
            }
        }
    };

    if (appState.mmdRuntime) {
        appState.mmdRuntime.onAnimationDurationChangedObservable.add(updateDuration);
    }
    if (appState.audioPlayer) {
        appState.audioPlayer.onDurationChangedObservable.add(updateDuration);
    }

    scene.onBeforeRenderObservable.add(() => {
        if (!isSeeking && seekSlider && appState.mmdRuntime) {
            const currentFrame = appState.mmdRuntime.currentFrameTime;
            const duration = appState.mmdRuntime.animationFrameTimeDuration;
            if (duration > 0 && (parseFloat(seekSlider.max) === 0 || Math.abs(parseFloat(seekSlider.max) - duration) > 10)) {
                updateDuration();
            }
            seekSlider.value = currentFrame.toString();
            if (seekVal) seekVal.textContent = Math.floor(currentFrame).toString();
        }
    });

    // ===== File Modal =====
    fileSelectToggle?.addEventListener("click", () => fileModal?.classList.remove("hidden"));
    closeModalBtn?.addEventListener("click", () => fileModal?.classList.add("hidden"));
    
    const presetModelSelect = document.getElementById("presetModelSelect") as HTMLSelectElement | null;
    const characterModal = document.getElementById("character-modal") as HTMLDivElement | null;
    const musicModal = document.getElementById("music-modal") as HTMLDivElement | null;
    
    presetModelSelect?.addEventListener("change", () => {
        const val = presetModelSelect.value;
        onPresetSelect(val);
        characterModal?.classList.add("hidden");
    });



    loadFilesBtn?.addEventListener("click", () => {
        const pmx = pmxInput?.files?.[0];
        const vmd = vmdInput?.files?.[0];
        const textures = textureDirInput?.files;
        if (pmx && vmd && textures) {
            onLoadFiles(pmx, vmd, textures);
            fileModal?.classList.add("hidden");
        } else {
            alert("PMX, VMD, and Texture folder are required.");
        }
    });

    // ===== UI toggles =====
    minimizeBtn?.addEventListener("click", () => {
        controlPanel?.classList.add("collapsed");
        showSettingsBtn?.classList.remove("hidden");
    });
    showSettingsBtn?.addEventListener("click", () => {
        controlPanel?.classList.remove("collapsed");
        showSettingsBtn?.classList.add("hidden");
    });



    // ===== Initial Duration Update =====
    setTimeout(updateDuration, 1000);

    // ===== FPS =====
    if (fpsDiv) {
        scene.getEngine().onBeginFrameObservable.add(() => {
            fpsDiv.textContent = `FPS: ${scene.getEngine().getFps().toFixed(0)}`;
        });
    }
};
