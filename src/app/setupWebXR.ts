import { Scene, AbstractMesh, WebXRState, WebXRFeatureName, Quaternion, PointerDragBehavior, MultiPointerScaleBehavior, Vector3 } from "@babylonjs/core";
import { StreamAudioPlayer } from "babylon-mmd";

export const setupWebXR = async (scene: Scene, meshes: AbstractMesh[], audioPlayer: StreamAudioPlayer) => {
    console.log("Setting up WebXR...");
    const controlPanel = document.getElementById("control-panel");
    const showSettingsBtn = document.getElementById("showSettingsBtn");
    const runtime = (scene as any).mmdRootRuntime;

    // Track whether the model has been placed at least once
    let modelPlaced = false;

    const setupBehaviors = (mesh: AbstractMesh) => {
        if ((mesh as any)._hasManualTransform) return;
        (mesh as any)._hasManualTransform = true;

        // Pinch to scale
        const scaleBehavior = new MultiPointerScaleBehavior();
        mesh.addBehavior(scaleBehavior);

        // 1-finger drag on the mesh to rotate around Y axis
        const rotateBehavior = new PointerDragBehavior({ dragAxis: new Vector3(1, 0, 0) });
        rotateBehavior.moveAttached = false; // Don't move position
        rotateBehavior.onDragObservable.add((event) => {
            // event.delta.x is horizontal screen movement. Rotate around Y axis.
            mesh.rotate(Vector3.Up(), event.delta.x * -2);
        });
        mesh.addBehavior(rotateBehavior);
    };

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
        // - Tap on floor updates position.
        // - Dragging the mesh rotates it (handled by behaviors).
        // - Pinching the mesh scales it (handled by behaviors).
        let lastTapTime = 0;
        scene.onPointerDown = (_evt, pickInfo) => {
            const now = Date.now();
            if (now - lastTapTime < 300) return; // Debounce double-fires from WebXR transient pointers
            lastTapTime = now;

            if (xr.baseExperience.state !== WebXRState.IN_XR) return;

            // If we tapped directly on the mesh, don't move it. Let the drag/scale behaviors handle it.
            if (pickInfo.hit && meshes.includes(pickInfo.pickedMesh as AbstractMesh)) {
                return;
            }

            // --- PLACEMENT or MOVE: tap on a detected surface ---
            if (hitTest.lastHitTestResults.length === 0) return;

            const hit = hitTest.lastHitTestResults[0];
            const camera = xr.baseExperience.camera;

            meshes.forEach(mesh => {
                mesh.isVisible = true;

                const currentScale = mesh.scaling.clone();
                const currentRotation = mesh.rotationQuaternion ? mesh.rotationQuaternion.clone() : null;

                const tmpQuat = new Quaternion();
                hit.transformationMatrix.decompose(undefined, tmpQuat, mesh.position);
                mesh.scaling.copyFrom(currentScale);

                if (!modelPlaced) {
                    // Initial facing: calculate angle to look at camera only on first placement
                    const diff = camera.position.subtract(mesh.position);
                    const angle = Math.atan2(diff.x, diff.z);
                    mesh.rotationQuaternion = Quaternion.FromEulerAngles(0, angle, 0);
                    
                    // Attach manual transformation behaviors
                    setupBehaviors(mesh);
                } else {
                    // Keep the user's manual rotation when moving the model
                    if (currentRotation) {
                        mesh.rotationQuaternion = currentRotation;
                    }
                }
            });

            modelPlaced = true;

            // Ensure animation is playing
            if (runtime && !runtime.isAnimationPlaying) {
                runtime.playAnimation();
            }
        };

        return xr;
    } catch (e: any) {
        console.error("WebXR Setup Failed", e);
        return null;
    }
};
