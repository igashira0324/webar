import { Scene, WebXRFeatureName, IWebXRImageTrackingOptions, AbstractMesh, Vector3, WebXRSessionManager } from "@babylonjs/core";

export const setupWebXR = async (scene: Scene, meshes: AbstractMesh[]) => {
    try {
        const xr = await scene.createDefaultXRExperienceAsync({
            uiOptions: {
                sessionMode: "immersive-ar",
                referenceSpaceType: "local-floor"
            }
        });

        const featuresManager = xr.baseExperience.featuresManager;

        // Preload the image to ensure it's valid and accessible before passing to WebXR
        const markerImage = new Image();
        markerImage.crossOrigin = "anonymous";
        markerImage.src = "assets/marker_qr.png";
        
        await new Promise((resolve, reject) => {
            markerImage.onload = resolve;
            markerImage.onerror = () => reject(new Error("マーカー画像の読み込みに失敗しました"));
        });

        // WebXR expects string | ImageBitmap. Converting to ImageBitmap prevents runtime parsing errors.
        const markerBitmap = await createImageBitmap(markerImage);

        // Image Tracking Configuration
        const imageTrackingOptions: IWebXRImageTrackingOptions = {
            images: [
                {
                    src: markerBitmap, // Pass the parsed ImageBitmap
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
