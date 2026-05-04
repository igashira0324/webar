import { Scene, ShadowGenerator, WebXRDefaultExperience } from "@babylonjs/core";
import { MmdModel, MmdRuntime, StreamAudioPlayer } from "babylon-mmd";

export interface AppState {
    scene: Scene | null;
    shadowGenerator: ShadowGenerator | null;
    mmdRuntime: MmdRuntime | null;
    audioPlayer: StreamAudioPlayer | null;
    xrHelper: WebXRDefaultExperience | null;

    currentModel: MmdModel | null;
    internalAudio: HTMLAudioElement | null;
    vocalAudio: HTMLAudioElement | null;
    
    bgmStarted: boolean;
    isLooping: boolean;
    loopEnabled: boolean;
    currentDanceId: string;
    lastCurrentFrame: number;
    
    loadingProgress: number;
}

export const appState: AppState = {
    scene: null,
    shadowGenerator: null,
    mmdRuntime: null,
    audioPlayer: null,
    xrHelper: null,

    currentModel: null,
    internalAudio: null,
    vocalAudio: null,

    bgmStarted: false,
    isLooping: false,
    loopEnabled: true,
    currentDanceId: "dindondan",
    lastCurrentFrame: 0,

    loadingProgress: 0,
};

// Global accessor for debug/legacy if needed, but preferred via import
(window as any).appState = appState;
