import { Scene, WebXRFeatureName, IWebXRImageTrackingOptions, AbstractMesh, Vector3 } from "@babylonjs/core";

export const setupWebXR = async (scene: Scene, meshes: AbstractMesh[]) => {
    try {
        const xr = await scene.createDefaultXRExperienceAsync({
            uiOptions: {
                sessionMode: "immersive-ar",
                referenceSpaceType: "local"
            },
            optionalFeatures: true
        });

        const featuresManager = xr.baseExperience.featuresManager;

        // Image Tracking Configuration
        const imageTrackingOptions: IWebXRImageTrackingOptions = {
            images: [
                {
                    src: "assets/marker_qr.png", // Path to the QR code marker
                    estimatedRealWorldWidth: 0.15 // Estimated width in meters (15cm for a typical screen/print)
                }
            ]
        };

        const imageTracking = featuresManager.enableFeature(
            WebXRFeatureName.IMAGE_TRACKING,
            "latest",
            imageTrackingOptions
        ) as any;

        // When a tracked image is found or updated
        imageTracking.onTrackedImageUpdatedObservable.add((image: any) => {
            // image.transformationMatrix contains the position and rotation
            meshes.forEach(mesh => {
                mesh.isVisible = true;
                image.getWorldMatrix().decompose(mesh.scaling, mesh.rotationQuaternion!, mesh.position);
                
                // Adjust: MMD models usually need some scaling and rotation adjustment
                // The marker is on the floor, so we might need to rotate the model to stand upright
                mesh.rotate(Vector3.Right(), -Math.PI / 2);
            });
        });

        console.log("WebXR Image Tracking Enabled");

        // Enter AR immediately
        await xr.baseExperience.enterXRAsync("immersive-ar", "local-floor");

        return xr;
    } catch (e) {
        console.error("WebXR not supported", e);
        document.getElementById("ar-unsupported")?.classList.remove("hidden");
        return null;
    }
};
