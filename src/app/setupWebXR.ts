import { Scene, AbstractMesh, WebXRState, WebXRFeatureName, Quaternion, Vector3 } from "@babylonjs/core";
import { StreamAudioPlayer } from "babylon-mmd";

export const setupWebXR = async (scene: Scene, meshes: AbstractMesh[], _audioPlayer: StreamAudioPlayer) => {
    console.log("Setting up WebXR...");
    const controlPanel = document.getElementById("control-panel");
    const showSettingsBtn = document.getElementById("showSettingsBtn");
    const runtime = (scene as any).mmdRootRuntime;

    // Track whether the model has been placed at least once
    let modelPlaced = false;

    const setupBehaviors = (mesh: AbstractMesh) => {
        if ((mesh as any)._hasManualTransform) return;
        (mesh as any)._hasManualTransform = true;

        let touchStartX = 0;
        let isDragging = false;
        let initialPinchDist = 0;
        let initialScale = Vector3.One();

        document.addEventListener("touchstart", (e) => {
            if ((scene as any)._xrExperience?.baseExperience.state !== WebXRState.IN_XR) return;
            if (e.touches.length === 1) {
                isDragging = true;
                touchStartX = e.touches[0].clientX;
            } else if (e.touches.length === 2) {
                isDragging = false;
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                initialPinchDist = Math.sqrt(dx * dx + dy * dy);
                initialScale = mesh.scaling.clone();
            }
        }, { passive: true });

        document.addEventListener("touchmove", (e) => {
            if ((scene as any)._xrExperience?.baseExperience.state !== WebXRState.IN_XR) return;
            
            if (e.touches.length === 1 && isDragging) {
                // 1 Finger Drag -> Rotate
                const currentX = e.touches[0].clientX;
                const deltaX = currentX - touchStartX;
                touchStartX = currentX;
                mesh.rotate(Vector3.Up(), deltaX * -0.01);
            } else if (e.touches.length === 2) {
                // 2 Finger Pinch -> Scale
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (initialPinchDist > 0) {
                    const scaleRatio = dist / initialPinchDist;
                    mesh.scaling.copyFrom(initialScale.scale(scaleRatio));
                }
            }
        }, { passive: true });

        document.addEventListener("touchend", (e) => {
            if (e.touches.length < 1) isDragging = false;
        }, { passive: true });
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
                    // Do NOT call audioPlayer.play() manually, it conflicts with MmdRuntime
                    runtime?.playAnimation();
                } catch (e) {
                    console.warn("Animation play failed:", e);
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
            
            // We removed the runtime.playAnimation() here to avoid freezing issues.
            // The animation plays automatically when entering AR.
        };

        return xr;
    } catch (e: any) {
        console.error("WebXR Setup Failed", e);
        return null;
    }
};
