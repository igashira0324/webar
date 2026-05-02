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

        // Continuously rotate Miku to face the camera every frame while in AR
        scene.onBeforeRenderObservable.add(() => {
            if (xr.baseExperience.state === WebXRState.IN_XR && modelPlaced) {
                const camera = xr.baseExperience.camera;
                meshes.forEach(mesh => {
                    if (!mesh.isVisible) return;

                    // Calculate the direction from model to camera on the XZ plane
                    const cameraPos = camera.position.clone();
                    cameraPos.y = mesh.position.y; // Only rotate around Y axis

                    // Use atan2 to get the angle on the Y axis
                    const diff = cameraPos.subtract(mesh.position);
                    const angle = Math.atan2(diff.x, diff.z);

                    // Apply rotation: atan2 gives angle facing camera,
                    // add Math.PI because MMD models face -Z by default
                    mesh.rotationQuaternion = Quaternion.FromEulerAngles(0, angle + Math.PI, 0);
                });
            }
        });

        xr.baseExperience.onStateChangedObservable.add((state) => {
            if (state === WebXRState.IN_XR) {
                // Hide UI for AR
                if (controlPanel) controlPanel.style.display = "none";
                if (showSettingsBtn) showSettingsBtn.style.display = "none";

                // Resume audio context (required for mobile)
                const engine = scene.getEngine();
                if (engine.getAudioContext()) {
                    engine.getAudioContext()?.resume().then(() => {
                        // Start playback when entering AR
                        audioPlayer.play();
                        runtime?.playAnimation();
                    });
                }

                // Hide meshes until tapped
                modelPlaced = false;
                meshes.forEach(m => m.isVisible = false);
            } else if (state === WebXRState.NOT_IN_XR) {
                // Show UI back
                if (controlPanel) controlPanel.style.display = "block";
                if (showSettingsBtn) showSettingsBtn.style.display = "block";
                modelPlaced = false;
            }
        });

        // Tap to place Miku
        scene.onPointerDown = () => {
            if (xr.baseExperience.state === WebXRState.IN_XR && hitTest.lastHitTestResults.length > 0) {
                const hit = hitTest.lastHitTestResults[0];
                const camera = xr.baseExperience.camera;

                meshes.forEach(mesh => {
                    mesh.isVisible = true;

                    // Save current scale
                    const currentScale = mesh.scaling.clone();

                    // Get position from hit test result
                    const tmpQuat = new Quaternion();
                    hit.transformationMatrix.decompose(undefined, tmpQuat, mesh.position);

                    // Restore scale (decompose may overwrite it)
                    mesh.scaling.copyFrom(currentScale);

                    // Face the camera (will be continuously updated by the onBeforeRender above)
                    const cameraPos = camera.position.clone();
                    cameraPos.y = mesh.position.y;
                    const diff = cameraPos.subtract(mesh.position);
                    const angle = Math.atan2(diff.x, diff.z);
                    mesh.rotationQuaternion = Quaternion.FromEulerAngles(0, angle + Math.PI, 0);
                });

                modelPlaced = true;

                // Ensure audio + animation are playing after placement
                const engine = scene.getEngine();
                engine.getAudioContext()?.resume().then(() => {
                    audioPlayer.play();
                });
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
