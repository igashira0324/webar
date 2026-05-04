import { StreamAudioPlayer } from "babylon-mmd";
import { appState } from "./state";
import { setupAudioLipSync } from "./setupAudioLipSync";

let lipSync: any = null;
let loopTimer: any = null;
let idleMouthTimer = 0;

export const DANCE_PRESETS: Record<string, { vmd: string, music: string, vocal: string | null }> = {
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

export const initAudioController = () => {
    if (!appState.scene) return;
    lipSync = setupAudioLipSync(appState.scene, () => appState.currentModel);
    
    appState.scene.onBeforeRenderObservable.add(() => {
        handleLoopDetection();
        handleIdleMouth();
    });
};

export const togglePlayback = async (forceState?: boolean): Promise<boolean> => {
    if (!appState.currentModel || !appState.internalAudio || !appState.mmdRuntime) return false;
    
    const shouldPlay = forceState !== undefined ? forceState : appState.internalAudio.paused;
    const btn = document.getElementById("playPauseBtn");

    try {
        if (shouldPlay) {
            const ctx = (window as any).BABYLON?.Engine?.audioEngine?.audioContext;
            if (ctx && ctx.state === "suspended") await ctx.resume();

            const promises: Promise<any>[] = [appState.internalAudio.play()];
            if (appState.vocalAudio) {
                lipSync.attach(appState.vocalAudio, true);
                promises.push(appState.vocalAudio.play());
            }
            await Promise.all(promises);
            appState.mmdRuntime.playAnimation();
            if (btn) btn.textContent = "||";
            appState.bgmStarted = true;
        } else {
            appState.internalAudio.pause();
            if (appState.vocalAudio) appState.vocalAudio.pause();
            appState.mmdRuntime.pauseAnimation();
            if (btn) btn.textContent = "▶";
        }
        return true;
    } catch (e) {
        console.warn("Playback failed", e);
        return false;
    }
};

export const triggerLoop = () => {
    if (appState.isLooping || !appState.loopEnabled) return;
    appState.isLooping = true;
    togglePlayback(false);
    
    if (loopTimer) clearTimeout(loopTimer);
    loopTimer = setTimeout(async () => {
        try {
            if (appState.mmdRuntime) appState.mmdRuntime.seekAnimation(0, true);
            if (appState.internalAudio) appState.internalAudio.currentTime = 0;
            if (appState.vocalAudio) appState.vocalAudio.currentTime = 0;
            appState.lastCurrentFrame = 0;
            await togglePlayback(true);
        } catch(e) {
            console.warn("Loop error", e);
        } finally {
            appState.isLooping = false;
        }
    }, 2000);
};

export const onAudioEnded = () => {
    console.log("🔁 audio ended fired");
    if (appState.loopEnabled && !appState.isLooping && appState.bgmStarted) {
        triggerLoop();
    }
};

const handleLoopDetection = () => {
    if (!appState.mmdRuntime || !appState.bgmStarted || !appState.loopEnabled || appState.isLooping) return;
    if (appState.internalAudio && appState.internalAudio.ended) return;

    const duration = appState.mmdRuntime.animationFrameTimeDuration;
    const current = appState.mmdRuntime.currentFrameTime;
    
    if (duration > 0 && current >= duration - 0.5 && appState.lastCurrentFrame < current) {
        console.log("🔁 frame-based end detected");
        triggerLoop();
    }
    appState.lastCurrentFrame = current;
};

const handleIdleMouth = () => {
    if (!appState.bgmStarted || !appState.currentModel || !appState.scene || DANCE_PRESETS[appState.currentDanceId].vocal) return;
    
    const deltaTime = appState.scene.getEngine().getDeltaTime();
    idleMouthTimer += deltaTime;
    
    if (idleMouthTimer > 2000) {
        if (Math.random() > 0.7) {
            const weight = Math.random() * 0.2;
            try {
                appState.currentModel.morph.setMorphWeight("あ", weight);
                appState.currentModel.morph.setMorphWeight("a", weight);
                if (Math.random() > 0.5) appState.currentModel.morph.setMorphWeight("笑い", weight * 1.5);
            } catch(e) {}
        }
        idleMouthTimer = 0;
    }
};

export const setupAudio = async (danceId: string) => {
    if (!appState.audioPlayer) return;
    
    try {
        const preset = DANCE_PRESETS[danceId];
        appState.audioPlayer.source = preset.music;
        const audio = (appState.audioPlayer as any)._audio || (appState.audioPlayer as any).audio;
        
        if (audio) {
            audio.loop = false;
            audio.removeEventListener("ended", onAudioEnded);
            audio.addEventListener("ended", onAudioEnded);
            appState.internalAudio = audio;
            audio.preload = "auto";
            
            appState.vocalAudio = preset.vocal ? new Audio(preset.vocal) : null;
            if (appState.vocalAudio) {
                appState.vocalAudio.loop = false;
                appState.vocalAudio.preload = "auto";
            }
            
            await Promise.race([
                new Promise<void>(resolve => {
                    if (audio.readyState >= 3) resolve();
                    else audio.oncanplaythrough = () => resolve();
                }),
                new Promise<void>(resolve => setTimeout(resolve, 5000))
            ]);
        }
    } catch (e) {
        console.warn("Audio setup failed", e);
    }
};
