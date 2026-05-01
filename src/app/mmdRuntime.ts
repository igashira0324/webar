import { Scene } from "@babylonjs/core";
import { MmdRuntime } from "babylon-mmd";

export const createMmdRuntime = (scene: Scene) => {
    const mmdRuntime = new MmdRuntime(scene);
    mmdRuntime.register(scene);
    
    // Initial settings
    mmdRuntime.playAnimation();
    
    return mmdRuntime;
};
