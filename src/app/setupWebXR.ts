import { Scene, AbstractMesh, WebXRState, WebXRFeatureName, Quaternion } from "@babylonjs/core";
import { StreamAudioPlayer } from "babylon-mmd";

export const setupWebXR = async (scene: Scene, meshes: AbstractMesh[], audioPlayer: StreamAudioPlayer) => {
    console.log("Setting up WebXR...");
    const controlPanel = document.getElementById("control-panel");
    const showSettingsBtn = document.getElementById("showSettingsBtn");
    const runtime = (scene as any).mmdRootRuntime;

    // Track whether the model has been placed at least once
    let modelPlaced = false;

    try {
        const xr = await scene.createDefaultXRExperienceAsync({
            uiOptions: {
                sessionMode: "immersive-ar",
                referenceSpaceType: "local-floor"
            },
            optionalFeatures: ["hit-test"]
        });

        const featuresManager = xr.baseExperience.featuresManager;
        const hitTest = featuresManager.enableFeature(WebXRFeatureName.HIT_TEST, "latest") as any;

        // Store the XR reference on scene so UI can check AR state
        (scene as any)._xrExperience = xr;



        xr.baseExperience.onStateChangedObservable.add((state) => {
            if (state === WebXRState.IN_XR) {
                // Hide UI for AR
                if (controlPanel) controlPanel.style.display = "none";
                if (showSettingsBtn) showSettingsBtn.style.display = "none";

                // Start playback when entering AR
                try {
                    audioPlayer.play();
                    runtime?.playAnimation();
                } catch (e) {
                    console.warn("Audio play failed:", e);
                }

                // Hide meshes until first tap
                modelPlaced = false;
                meshes.forEach(m => m.isVisible = false);
            } else if (state === WebXRState.NOT_IN_XR) {
                // Show UI back
                if (controlPanel) controlPanel.style.display = "block";
                if (showSettingsBtn) showSettingsBtn.style.display = "block";
                modelPlaced = false;
            }
        });

        // Tap handler in AR:
        // - Before placement: tap on a surface to place Miku
        // - After placement: toggle play/pause
        scene.onPointerDown = () => {
            if (xr.baseExperience.state !== WebXRState.IN_XR) return;

            if (!modelPlaced) {
                // --- PLACEMENT: first tap on a detected surface ---
                if (hitTest.lastHitTestResults.length === 0) return;

                const hit = hitTest.lastHitTestResults[0];
                const camera = xr.baseExperience.camera;

                meshes.forEach(mesh => {
                    mesh.isVisible = true;

                    const currentScale = mesh.scaling.clone();
                    const tmpQuat = new Quaternion();
                    hit.transformationMatrix.decompose(undefined, tmpQuat, mesh.position);
                    mesh.scaling.copyFrom(currentScale);

                    // Initial facing: calculate angle to look at camera
                    const diff = camera.position.subtract(mesh.position);
                    const angle = Math.atan2(diff.x, diff.z);
                    mesh.rotationQuaternion = Quaternion.FromEulerAngles(0, angle, 0);
                });

                modelPlaced = true;

                if (runtime && !runtime.isAnimationPlaying) {
                    runtime.playAnimation();
                }
            } else {
                // --- PLAY/PAUSE TOGGLE: subsequent taps ---
                if (runtime) {
                    if (runtime.isAnimationPlaying) {
                        runtime.pauseAnimation();
                    } else {
                        runtime.playAnimation();
                    }
                }
            }
        };

        return xr;
    } catch (e: any) {
        console.error("WebXR Setup Failed", e);
        return null;
    }
};
