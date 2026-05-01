import { Scene, WebXRState, Vector3, Quaternion, AbstractMesh } from "@babylonjs/core";

export const setupWebXR = async (scene: Scene, modelMesh: AbstractMesh) => {
    try {
        const xr = await scene.createDefaultXRExperienceAsync({
            uiOptions: {
                sessionMode: "immersive-ar",
                referenceSpaceType: "local-floor"
            },
            optionalFeatures: true
        });

        const featureManager = xr.baseExperience.featuresManager;
        
        // Hit Test (Optional but useful)
        featureManager.enableFeature("xr-hit-test", "latest");

        xr.baseExperience.onStateChangedObservable.add((state) => {
            if (state === WebXRState.IN_XR) {
                console.log("Entered AR");
                
                // Position model 2m in front of the camera initially if not using hit test
                // Or set it to a default position
                modelMesh.position = new Vector3(0, 0, 2);
                modelMesh.rotationQuaternion = Quaternion.FromEulerAngles(0, Math.PI, 0);
            }
        });

        // If hit test is enabled, we could use it to place the model
        // For now, keep it simple as per requirements (2m ahead)

        // Enter AR immediately
        await xr.baseExperience.enterXRAsync("immersive-ar", "local-floor");

        return xr;
    } catch (e) {
        console.error("WebXR not supported", e);
        document.getElementById("ar-unsupported")?.classList.remove("hidden");
        return null;
    }
};
