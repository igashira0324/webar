import { Scene, WebXRFeatureName, IWebXRImageTrackingOptions, AbstractMesh, Vector3 } from "@babylonjs/core";

export const setupWebXR = async (scene: Scene, meshes: AbstractMesh[]) => {
    try {
        const xr = await scene.createDefaultXRExperienceAsync({
            uiOptions: {
                sessionMode: "immersive-ar",
                referenceSpaceType: "local-floor"
            }
        });

        const featuresManager = xr.baseExperience.featuresManager;

        // Image Tracking Configuration
        const imageTrackingOptions: IWebXRImageTrackingOptions = {
            images: [
                {
                    src: "assets/marker_qr.png", // Path to the QR code marker
                    estimatedRealWorldWidth: 0.15 // Estimated width in meters (15cm)
                }
            ]
        };

        try {
            const imageTracking = featuresManager.enableFeature(
                WebXRFeatureName.IMAGE_TRACKING,
                "latest",
                imageTrackingOptions
            ) as any;

            // When a tracked image is found or updated
            imageTracking.onTrackedImageUpdatedObservable.add((image: any) => {
                meshes.forEach(mesh => {
                    mesh.isVisible = true;
                    image.getWorldMatrix().decompose(mesh.scaling, mesh.rotationQuaternion!, mesh.position);
                    mesh.rotate(Vector3.Right(), -Math.PI / 2);
                });
            });
            console.log("WebXR Image Tracking Enabled");
        } catch (featureError) {
            console.warn("Image tracking could not be enabled", featureError);
            alert("画像認識機能がサポートされていません。通常のARとして起動します。");
        }

        console.log("WebXR Initialized. Waiting for user to press AR button.");

        return xr;
    } catch (e: any) {
        console.error("WebXR not supported", e);
        alert("WebXR初期化エラー: " + (e.message || e));
        return null;
    }
};
