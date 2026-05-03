import { Scene, ShadowGenerator } from "@babylonjs/core";
import { MmdRuntime } from "babylon-mmd";

export const setupPerformanceControls = (
    scene: Scene,
    _mmdRuntime: MmdRuntime,
    _shadowGenerator: ShadowGenerator
) => {
    const physicsToggle = document.getElementById("physicsToggle") as HTMLInputElement | null;
    const shadowToggle = document.getElementById("shadowToggle") as HTMLInputElement | null;

    physicsToggle?.addEventListener("change", () => {
        console.log("Physics toggle:", physicsToggle?.checked);
    });

    shadowToggle?.addEventListener("change", () => {
        const enabled = shadowToggle?.checked ?? false;
        scene.meshes.forEach(mesh => {
            if (mesh.metadata && mesh.metadata.isMmdModel) {
                mesh.receiveShadows = enabled;
            }
        });
    });

    // Initial state: Shadow OFF
    if (shadowToggle) shadowToggle.checked = false;
};
