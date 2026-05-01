import { Scene, WebXRFeatureName, IWebXRImageTrackingOptions, AbstractMesh, Vector3, WebXRSessionManager, WebXRState } from "@babylonjs/core";

export const setupWebXR = async (scene: Scene, meshes: AbstractMesh[]) => {
    try {
        const xr = await scene.createDefaultXRExperienceAsync({
            uiOptions: {
                sessionMode: "immersive-ar",
                referenceSpaceType: "local-floor"
            },
            optionalFeatures: ["image-tracking"]
        });

        // Add error listener for session entry failures
        xr.baseExperience.onStateChangedObservable.add((state) => {
            if (state === WebXRState.NOT_IN_XR) {
                // If we were trying to enter and it failed
                const lastError = (xr.baseExperience as any).lastSessionError;
                if (lastError) {
                    alert("AR開始エラー: " + lastError);
                }
            }
        });

        const featuresManager = xr.baseExperience.featuresManager;

        // Image Tracking Configuration
        const imageTrackingOptions: IWebXRImageTrackingOptions = {
            images: [
                {
                    src: "assets/marker_qr.png", // Path to the QR code marker
                    estimatedRealWorldWidth: 0.15 // 15cm
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
            console.log("WebXR Image Tracking Enabled");
        } catch (featureError) {
            console.warn("Image tracking could not be enabled", featureError);
        }

        const isSupported = await WebXRSessionManager.IsSessionSupportedAsync("immersive-ar");
        if (!isSupported) {
            console.warn("immersive-ar is not supported on this device/browser.");
            alert("お使いの端末（またはブラウザ）はAR機能（WebXR）に対応していません。\nスマホ（AndroidのChrome）で開き、Google Playで「Google Play 開発者サービス(AR)」がインストールされているか確認してください。");
        } else {
            console.log("WebXR Initialized. Waiting for user to press AR button.");
        }

        return xr;
    } catch (e: any) {
        console.error("WebXR not supported", e);
        alert("WebXR初期化エラー: " + (e.message || e));
        return null;
    }
};
