import { Scene, AbstractMesh, WebXRState, WebXRFeatureName, Vector3 } from "@babylonjs/core";

export const setupWebXR = async (scene: Scene, meshes: AbstractMesh[]) => {
    console.log("Setting up WebXR...");
    try {
        const xr = await scene.createDefaultXRExperienceAsync({
            uiOptions: {
                sessionMode: "immersive-ar",
                referenceSpaceType: "local-floor" // Reverting to local-floor for better grounding
            },
            optionalFeatures: ["image-tracking", "hit-test"]
        });

        // Audio and Animation Resume on Enter
        xr.baseExperience.onStateChangedObservable.add((state) => {
            console.log("WebXR State:", state);
            if (state === WebXRState.IN_XR) {
                // Resume audio context which is often suspended by the browser
                if (scene.getEngine().getAudioContext()) {
                    scene.getEngine().getAudioContext()?.resume();
                }
                // Ensure meshes are visible
                meshes.forEach(m => m.isVisible = true);
            }
        });

        const featuresManager = xr.baseExperience.featuresManager;
        
        // Image Tracking Configuration
        const markerUrl = window.location.origin + "/assets/marker_qr.png";
        const imageTrackingOptions: any = {
            images: [
                {
                    src: markerUrl,
                    estimatedRealWorldWidth: 0.15
                }
            ]
        };

        try {
            const imageTracking = featuresManager.enableFeature(
                WebXRFeatureName.IMAGE_TRACKING,
                "latest",
                imageTrackingOptions
            ) as any;

            imageTracking.onTrackedImageUpdatedObservable.add((image: any) => {
                meshes.forEach(mesh => {
                    mesh.isVisible = true;
                    image.getWorldMatrix().decompose(mesh.scaling, mesh.rotationQuaternion!, mesh.position);
                    mesh.rotate(Vector3.Right(), -Math.PI / 2);
                });
            });
        } catch (featureError: any) {
            console.warn("Image tracking not supported, falling back to basic AR", featureError);
        }

        return xr;
    } catch (e: any) {
        console.error("WebXR Setup Failed", e);
        // Fallback to basic setup if the above fails
        return await scene.createDefaultXRExperienceAsync({
            uiOptions: { sessionMode: "immersive-ar" }
        });
    }
};
