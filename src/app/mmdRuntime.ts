import { Scene } from "@babylonjs/core";
import { MmdRuntime } from "babylon-mmd";

export const createMmdRuntime = (scene: Scene) => {
    const mmdRuntime = new MmdRuntime(scene);
    mmdRuntime.register(scene);
    
    // Initial settings
    // Do not autoplay animation so it starts perfectly synced with audio when user clicks play
    // mmdRuntime.playAnimation();
    
    return mmdRuntime;
};
