import { Scene, WebXRFeatureName, IWebXRImageTrackingOptions, AbstractMesh, Vector3, WebXRSessionManager, WebXRState } from "@babylonjs/core";
import "@babylonjs/core/Audio/audioSceneComponent";

// Global Error Listeners for Debugging
window.addEventListener("error", (e) => {
    alert("Global Error: " + e.message);
});
window.addEventListener("unhandledrejection", (e) => {
    alert("Unhandled Rejection: " + e.reason);
});

export const setupWebXR = async (scene: Scene, meshes: AbstractMesh[]) => {
    console.log("Setting up WebXR...");
    try {
        const xr = await scene.createDefaultXRExperienceAsync({
            uiOptions: {
                sessionMode: "immersive-ar",
                referenceSpaceType: "local" // Changed from local-floor for better compatibility
            },
            optionalFeatures: ["image-tracking"]
        });

        // Add error listener for session entry failures
        xr.baseExperience.onStateChangedObservable.add((state) => {
            console.log("WebXR State Changed:", state);
            if (state === WebXRState.NOT_IN_XR) {
                const lastError = (xr.baseExperience as any).lastSessionError;
                if (lastError) {
                    alert("AR開始エラー (State): " + lastError);
                }
            }
        });

        const featuresManager = xr.baseExperience.featuresManager;

        // Image Tracking Configuration - Use absolute URL
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
            alert("画像認識機能の有効化に失敗: " + featureError.message);
        }

        const isSupported = await WebXRSessionManager.IsSessionSupportedAsync("immersive-ar");
        if (!isSupported) {
            alert("このブラウザはAR(immersive-ar)をサポートしていません。");
        }

        return xr;
    } catch (e: any) {
        console.error("WebXR Setup Failed", e);
        alert("WebXRセットアップ失敗: " + (e.message || e));
        return null;
    }
};
