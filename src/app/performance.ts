import { Scene, ShadowGenerator } from "@babylonjs/core";
import { MmdRuntime } from "babylon-mmd";

export const setupPerformanceControls = (
    scene: Scene,
    _mmdRuntime: MmdRuntime,
    _shadowGenerator: ShadowGenerator
) => {
    const physicsToggle = document.getElementById("physicsToggle") as HTMLInputElement;
    const shadowToggle = document.getElementById("shadowToggle") as HTMLInputElement;

    physicsToggle.addEventListener("change", () => {
        // Toggle physics in MMD Runtime
        // Note: babylon-mmd uses a separate physics solver if enabled
        // For simplicity, we can enable/disable the solver
        // However, initial setup might need Havok.
        // If physics is not enabled at start, this might do nothing without re-initialization.
        // We'll keep it as a placeholder or implement if possible.
        console.log("Physics toggle:", physicsToggle.checked);
    });

    shadowToggle.addEventListener("change", () => {
        const enabled = shadowToggle.checked;
        scene.meshes.forEach(mesh => {
            if (mesh.metadata && mesh.metadata.isMmdModel) {
                mesh.receiveShadows = enabled;
            }
        });
        // Directional light intensity can also be adjusted
    });

    // Initial state: Shadow OFF
    shadowToggle.checked = false;
};
