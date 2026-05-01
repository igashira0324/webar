import { Scene, AbstractMesh, WebXRState } from "@babylonjs/core";

export const setupWebXR = async (scene: Scene, meshes: AbstractMesh[]) => {
    console.log("Setting up WebXR...");
    try {
        const xr = await scene.createDefaultXRExperienceAsync({
            uiOptions: {
                sessionMode: "immersive-ar",
                referenceSpaceType: "local-floor"
            }
        });

        // Audio and Animation Resume on Enter
        xr.baseExperience.onStateChangedObservable.add((state) => {
            if (state === WebXRState.IN_XR) {
                // Resume audio context
                if (scene.getEngine().getAudioContext()) {
                    scene.getEngine().getAudioContext()?.resume();
                }
                // Ensure meshes are visible
                meshes.forEach(m => m.isVisible = true);
            }
        });

        return xr;
    } catch (e: any) {
        console.error("WebXR Setup Failed", e);
        return null;
    }
};
