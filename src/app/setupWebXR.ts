import { Scene, AbstractMesh, WebXRState, WebXRFeatureName } from "@babylonjs/core";
import { StreamAudioPlayer } from "babylon-mmd";

export const setupWebXR = async (scene: Scene, meshes: AbstractMesh[], audioPlayer: StreamAudioPlayer) => {
    console.log("Setting up WebXR...");
    try {
        const xr = await scene.createDefaultXRExperienceAsync({
            uiOptions: {
                sessionMode: "immersive-ar",
                referenceSpaceType: "local-floor"
            },
            optionalFeatures: ["hit-test"]
        });

        // Hit-test for floor placement
        const featuresManager = xr.baseExperience.featuresManager;
        const hitTest = featuresManager.enableFeature(WebXRFeatureName.HIT_TEST, "latest") as any;

        xr.baseExperience.onStateChangedObservable.add((state) => {
            if (state === WebXRState.IN_XR) {
                // Resume audio and play
                const engine = scene.getEngine();
                if (engine.getAudioContext()) {
                    engine.getAudioContext()?.resume().then(() => {
                        audioPlayer.play();
                    });
                }
                // Initial placement hint
                console.log("AR Session Started. Tap the floor to place Miku.");
                // Hide meshes until tapped
                meshes.forEach(m => m.isVisible = false);
            }
        });

        // Tap to place Miku
        scene.onPointerDown = () => {
            if (xr.baseExperience.state === WebXRState.IN_XR && hitTest.lastHitTestResults.length > 0) {
                const hit = hitTest.lastHitTestResults[0];
                meshes.forEach(mesh => {
                    mesh.isVisible = true;
                    // Preserving the current scaling while updating position and rotation
                    const currentScale = mesh.scaling.clone();
                    hit.transformationMatrix.decompose(undefined, mesh.rotationQuaternion!, mesh.position);
                    mesh.scaling.copyFrom(currentScale);
                });
                // Ensure music and animation keep playing
                audioPlayer.play();
            }
        };

        return xr;
    } catch (e: any) {
        console.error("WebXR Setup Failed", e);
        return null;
    }
};
