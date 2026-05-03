import { Scene } from "@babylonjs/core";
import { MmdRuntime, MmdModel, StreamAudioPlayer } from "babylon-mmd";

export const setupUI = (
    scene: Scene, 
    mmdRuntime: MmdRuntime, 
    audioPlayer: StreamAudioPlayer,
    getCurrentModel: () => MmdModel | null,
    onLoadFiles: (pmx: File, vmd: File, textures: FileList) => void
) => {
    // null許容で取得
    const playPauseBtn = document.getElementById("playPauseBtn") as HTMLButtonElement | null;
    const scaleSlider = document.getElementById("scaleSlider") as HTMLInputElement | null;
    const scaleVal = document.getElementById("scaleVal") as HTMLSpanElement | null;
    const yPosSlider = document.getElementById("yPosSlider") as HTMLInputElement | null;
    const yPosVal = document.getElementById("yPosVal") as HTMLSpanElement | null;
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
    const showMarkerBtn = document.getElementById("showMarkerBtn") as HTMLButtonElement | null;
    // ★ marker-modal は qr-modal にリネームされた
    const markerModal = document.getElementById("qr-modal") as HTMLDivElement | null;
    const closeMarkerBtn = document.getElementById("closeQrBtn") as HTMLButtonElement | null;

    const S_BASE = 1.0;
    const Y_BASE = -5.0;

    // ===== Play/Pause =====
    playPauseBtn?.addEventListener("click", () => {
        const xr = (scene as any)._xrExperience;
        if (xr && xr.baseExperience && xr.baseExperience.state === 2) {
            return;
        }
        if (mmdRuntime.isAnimationPlaying) {
            mmdRuntime.pauseAnimation();
            audioPlayer.pause();
        } else {
            audioPlayer.play();
            mmdRuntime.playAnimation();
        }
    });

    // ===== Scale =====
    scaleSlider?.addEventListener("input", () => {
        const val = parseFloat(scaleSlider.value);
        if (scaleVal) scaleVal.textContent = val.toFixed(2);
        const model = getCurrentModel();
        if (model) model.mesh.scaling.setAll(val * S_BASE);
    });

    // ===== Y Position =====
    yPosSlider?.addEventListener("input", () => {
        const val = parseFloat(yPosSlider.value);
        if (yPosVal) yPosVal.textContent = val.toFixed(1);
        const model = getCurrentModel();
        if (model) model.mesh.position.y = val + Y_BASE;
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
            const frame = parseFloat(seekSlider.value);
            mmdRuntime.seekAnimation(frame, true);
            isSeeking = false;
        });
    }

    // ===== Duration =====
    const updateDuration = () => {
        let duration = mmdRuntime.animationFrameTimeDuration;
        if (duration <= 0 && mmdRuntime.audioPlayer) {
            duration = (mmdRuntime.audioPlayer as StreamAudioPlayer).duration * 30;
        }
        if (duration > 0) {
            if (durationVal) durationVal.textContent = Math.floor(duration).toString();
            if (seekSlider) seekSlider.max = duration.toString();
        }
    };

    mmdRuntime.onAnimationDurationChangedObservable.add(updateDuration);
    audioPlayer.onDurationChangedObservable.add(updateDuration);

    scene.onBeforeRenderObservable.add(() => {
        if (!isSeeking && seekSlider) {
            const currentFrame = mmdRuntime.currentFrameTime;
            const duration = mmdRuntime.animationFrameTimeDuration;
            if (duration > 0 && parseFloat(seekSlider.max) === 0) {
                updateDuration();
            }
            seekSlider.value = currentFrame.toString();
            if (seekVal) seekVal.textContent = Math.floor(currentFrame).toString();
        }
    });

    // ===== File Modal =====
    fileSelectToggle?.addEventListener("click", () => fileModal?.classList.remove("hidden"));
    closeModalBtn?.addEventListener("click", () => fileModal?.classList.add("hidden"));
    
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

    // ===== Old UI toggles (互換性のため残す。要素が無ければスキップ) =====
    minimizeBtn?.addEventListener("click", () => {
        controlPanel?.classList.add("collapsed");
        showSettingsBtn?.classList.remove("hidden");
    });
    showSettingsBtn?.addEventListener("click", () => {
        controlPanel?.classList.remove("collapsed");
        showSettingsBtn?.classList.add("hidden");
    });

    // ===== Marker (QR) Modal - 旧APIだがmain.ts側で再実装済みなのでスキップ可 =====
    showMarkerBtn?.addEventListener("click", () => markerModal?.classList.remove("hidden"));
    closeMarkerBtn?.addEventListener("click", () => markerModal?.classList.add("hidden"));

    // ===== Initial Duration Update =====
    setTimeout(updateDuration, 1000);

    // ===== FPS =====
    if (fpsDiv) {
        scene.getEngine().onBeginFrameObservable.add(() => {
            fpsDiv.textContent = `FPS: ${scene.getEngine().getFps().toFixed(0)}`;
        });
    }
};
