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
                // Resume audio context and ensure playback starts
                const engine = scene.getEngine();
                if (engine.getAudioContext()) {
                    engine.getAudioContext()?.resume().then(() => {
                        // We use the runtime already initialized in the scene
                        (scene as any).mmdRootRuntime?.playAnimation();
                    });
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
