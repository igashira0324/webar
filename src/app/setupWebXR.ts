import { Scene, WebXRFeatureName, IWebXRImageTrackingOptions, AbstractMesh, Vector3, WebXRSessionManager, WebXRState } from "@babylonjs/core";

export const setupWebXR = async (scene: Scene, meshes: AbstractMesh[]) => {
    console.log("Setting up WebXR...");
    try {
        const xr = await scene.createDefaultXRExperienceAsync({
            uiOptions: {
                sessionMode: "immersive-ar",
                referenceSpaceType: "local"
            }
        });

        xr.baseExperience.onStateChangedObservable.add((state) => {
            console.log("WebXR State Changed:", state);
            if (state === WebXRState.NOT_IN_XR) {
                const lastError = (xr.baseExperience as any).lastSessionError;
                if (lastError) {
                    console.error("AR開始エラー (State):", lastError);
                }
            }
        });

        /* 
        // Temporarily disabled for basic AR testing
        const featuresManager = xr.baseExperience.featuresManager;
        const markerUrl = window.location.origin + "/assets/marker_qr.png";
        const imageTrackingOptions: IWebXRImageTrackingOptions = {
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
            console.log("WebXR Image Tracking Feature Enabled");
        } catch (featureError: any) {
            console.warn("Image tracking could not be enabled", featureError);
        }
        */

        const isSupported = await WebXRSessionManager.IsSessionSupportedAsync("immersive-ar");
        console.log("WebXR Initialized. Immersive-AR Supported:", isSupported);

        return xr;
    } catch (e: any) {
        console.error("WebXR Setup Failed:", e.message || e);
        return null;
    }
};
