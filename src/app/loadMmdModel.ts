import { Scene, ShadowGenerator, SceneLoader } from "@babylonjs/core";
import { MmdRuntime, VmdLoader } from "babylon-mmd";

// Ensure side effects are loaded
// @ts-ignore
import "@babylonjs/loaders/glTF";
import "babylon-mmd/esm/Loader/pmxLoader";
import "babylon-mmd/esm/Loader/vmdLoader";

export const loadMmdModel = async (
    scene: Scene, 
    mmdRuntime: MmdRuntime,
    pmxPath: string | File, 
    vmdPath: string | File,
    shadowGenerator?: ShadowGenerator,
    referenceFiles?: File[],
    onProgress?: (event: any) => void
) => {
    // Load PMX
    const onActivated = SceneLoader.OnPluginActivatedObservable.add((plugin) => {
        if (plugin.name === "pmx" && referenceFiles) {
            (plugin as any).referenceFiles = referenceFiles;
        }
    });

    // Split path to handle rootUrl and sceneFilename correctly for texture resolution
    let rootUrl = "";
    let sceneFilename: string | File = "";

    if (typeof pmxPath === "string") {
        const lastSlashIndex = pmxPath.lastIndexOf("/");
        rootUrl = pmxPath.substring(0, lastSlashIndex + 1);
        sceneFilename = pmxPath.substring(lastSlashIndex + 1);
    } else {
        sceneFilename = pmxPath;
    }

    console.log("Loading MMD Model:", { rootUrl, sceneFilename });

    const mmdMesh = await SceneLoader.ImportMeshAsync(
        undefined,
        rootUrl,
        sceneFilename,
        scene,
        onProgress,
        ".pmx"
    );

    SceneLoader.OnPluginActivatedObservable.remove(onActivated);

    const mesh = mmdMesh.meshes[0];
    
    if (shadowGenerator) {
        shadowGenerator.addShadowCaster(mesh, true);
        mesh.receiveShadows = true;
    }

    // Create MMD Model in runtime
    const mmdModel = mmdRuntime.createMmdModel(mesh as any);

    // Load VMD
    const vmdLoader = new VmdLoader(scene);
    const motion = await vmdLoader.loadAsync("motion", vmdPath);
    
    // Add motion to model
    const handle = mmdModel.createRuntimeAnimation(motion);
    mmdModel.setRuntimeAnimation(handle);

    // Force set duration to allow seeking
    mmdRuntime.setManualAnimationDuration(motion.endFrame);

    return mmdModel;
};

export const loadMmdModelFromFiles = async (
    scene: Scene,
    mmdRuntime: MmdRuntime,
    pmxFile: File,
    vmdFile: File,
    textureFiles: FileList,
    shadowGenerator?: ShadowGenerator,
    onProgress?: (event: any) => void
) => {
    const files: File[] = [];
    for (let i = 0; i < textureFiles.length; i++) {
        files.push(textureFiles[i]);
    }

    return await loadMmdModel(scene, mmdRuntime, pmxFile, vmdFile, shadowGenerator, files, onProgress);
};

