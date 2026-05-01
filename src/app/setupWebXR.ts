import { Scene, AbstractMesh, WebXRState, WebXRFeatureName, Quaternion, Vector3 } from "@babylonjs/core";
import { StreamAudioPlayer } from "babylon-mmd";

export const setupWebXR = async (scene: Scene, meshes: AbstractMesh[], audioPlayer: StreamAudioPlayer) => {
    console.log("Setting up WebXR...");
    const controlPanel = document.getElementById("control-panel");
    const showSettingsBtn = document.getElementById("showSettingsBtn");
    const runtime = (scene as any).mmdRootRuntime;

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

        // Forced Playback Guard during AR
        scene.onBeforeRenderObservable.add(() => {
            if (xr.baseExperience.state === WebXRState.IN_XR) {
                if (runtime && !runtime.isAnimationPlaying) {
                    runtime.playAnimation();
                    audioPlayer.play();
                }
            }
        });

        xr.baseExperience.onStateChangedObservable.add((state) => {
            if (state === WebXRState.IN_XR) {
                // Hide UI for AR
                if (controlPanel) controlPanel.style.display = "none";
                if (showSettingsBtn) showSettingsBtn.style.display = "none";

                // Resume audio and play
                const engine = scene.getEngine();
                if (engine.getAudioContext()) {
                    engine.getAudioContext()?.resume().then(() => {
                        audioPlayer.play();
                        runtime?.playAnimation();
                    });
                }
                // Hide meshes until tapped
                meshes.forEach(m => m.isVisible = false);
            } else if (state === WebXRState.NOT_IN_XR) {
                // Show UI back
                if (controlPanel) controlPanel.style.display = "block";
                if (showSettingsBtn) showSettingsBtn.style.display = "block";
            }
        });

        // Tap to place and face
        scene.onPointerDown = () => {
            if (xr.baseExperience.state === WebXRState.IN_XR && hitTest.lastHitTestResults.length > 0) {
                const hit = hitTest.lastHitTestResults[0];
                const camera = xr.baseExperience.camera;
                
                meshes.forEach(mesh => {
                    mesh.isVisible = true;
                    // Position from hit test
                    hit.transformationMatrix.decompose(undefined, mesh.rotationQuaternion!, mesh.position);
                    
                    // Direct LookAt (Y-axis only)
                    const targetPos = camera.position.clone();
                    targetPos.y = mesh.position.y;
                    mesh.lookAt(targetPos);
                    mesh.rotate(Vector3.Up(), Math.PI); // Adjust for MMD model default orientation
                });

                audioPlayer.play();
                runtime?.playAnimation();
            }
        };

        return xr;
    } catch (e: any) {
        console.error("WebXR Setup Failed", e);
        return null;
    }
};
