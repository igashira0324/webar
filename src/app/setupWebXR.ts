import { Scene, AbstractMesh, WebXRState, WebXRFeatureName, Quaternion } from "@babylonjs/core";
import { StreamAudioPlayer } from "babylon-mmd";

export const setupWebXR = async (scene: Scene, meshes: AbstractMesh[], audioPlayer: StreamAudioPlayer) => {
    console.log("Setting up WebXR...");
    const controlPanel = document.getElementById("control-panel");
    const showSettingsBtn = document.getElementById("showSettingsBtn");

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
                // Hide UI for AR
                if (controlPanel) controlPanel.classList.add("hidden");
                if (showSettingsBtn) showSettingsBtn.classList.add("hidden");

                // Resume audio and play
                const engine = scene.getEngine();
                if (engine.getAudioContext()) {
                    engine.getAudioContext()?.resume().then(() => {
                        audioPlayer.play();
                    });
                }
                // Hide meshes until tapped
                meshes.forEach(m => m.isVisible = false);
            } else if (state === WebXRState.NOT_IN_XR) {
                // Show UI back
                if (showSettingsBtn) showSettingsBtn.classList.remove("hidden");
            }
        });

        // Tap to place Miku
        scene.onPointerDown = (_evt) => {
            if (xr.baseExperience.state === WebXRState.IN_XR && hitTest.lastHitTestResults.length > 0) {
                const hit = hitTest.lastHitTestResults[0];
                const camera = xr.baseExperience.camera;
                
                meshes.forEach(mesh => {
                    mesh.isVisible = true;
                    // Position from hit test
                    hit.transformationMatrix.decompose(undefined, mesh.rotationQuaternion!, mesh.position);
                    
                    // Rotate to face camera (XZ plane)
                    const diff = camera.position.subtract(mesh.position);
                    const angle = Math.atan2(diff.x, diff.z);
                    mesh.rotationQuaternion = Quaternion.FromEulerAngles(0, angle, 0);
                });

                // Force play to prevent stopping
                audioPlayer.play();
                const runtime = (scene as any).mmdRootRuntime;
                if (runtime && !runtime.isAnimationPlaying) {
                    runtime.playAnimation();
                }
            }
        };

        return xr;
    } catch (e: any) {
        console.error("WebXR Setup Failed", e);
        return null;
    }
};
