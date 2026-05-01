import { Scene, AbstractMesh, WebXRSessionManager, WebXRFeatureName, Vector3 } from "@babylonjs/core";

export const setupWebXR = async (scene: Scene, meshes: AbstractMesh[]) => {
    console.log("Setting up WebXR...");
    try {
        const xr = await scene.createDefaultXRExperienceAsync({
            uiOptions: {
                sessionMode: "immersive-ar",
                referenceSpaceType: "local"
            },
            optionalFeatures: ["image-tracking"]
        });

        xr.baseExperience.onStateChangedObservable.add((state) => {
            console.log("WebXR State Changed:", state);
        });

        const featuresManager = xr.baseExperience.featuresManager;
        const markerUrl = window.location.origin + "/assets/marker_qr.png";
        
        const imageTrackingOptions: any = {
            images: [
                {
                    src: markerUrl,
                    estimatedRealWorldWidth: 0.15 // 15cm (QR code size)
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
                    // Apply position and rotation from the tracked image
                    image.getWorldMatrix().decompose(mesh.scaling, mesh.rotationQuaternion!, mesh.position);
                    // Adjust rotation if needed (depends on marker orientation)
                    mesh.rotate(Vector3.Right(), -Math.PI / 2);
                });
            });
            console.log("WebXR Image Tracking Feature Enabled");
        } catch (featureError: any) {
            console.warn("Image tracking could not be enabled", featureError);
        }

        const isSupported = await WebXRSessionManager.IsSessionSupportedAsync("immersive-ar");
        console.log("WebXR Initialized. Immersive-AR Supported:", isSupported);

        return xr;
    } catch (e: any) {
        console.error("WebXR Setup Failed:", e.message || e);
        return null;
    }
};
