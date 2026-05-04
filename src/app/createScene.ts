import { Engine, Scene, ArcRotateCamera, Vector3, HemisphericLight, DirectionalLight, ShadowGenerator, Color4 } from "@babylonjs/core";

export const createScene = async (canvas: HTMLCanvasElement) => {
    const engine = new Engine(canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true,
        disableWebGL2Support: false
    });

    const scene = new Scene(engine);
    // プレビュー時は不透明な濃紺、AR 入室時に setupWebXR が透明化する
    scene.clearColor = new Color4(0.04, 0.04, 0.10, 1.0);

    const camera = new ArcRotateCamera(
        "camera",
        -Math.PI / 2,
        Math.PI / 2.2,
        1.5,                          // 距離を 1.5m に近づける
        new Vector3(0, 0.7, 0),       // ミクの胸元あたり
        scene
    );
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 0.5;
    camera.upperRadiusLimit = 8;

    // 環境光を強めにしてミクが暗く沈まないように調整
    const light = new HemisphericLight("light", new Vector3(0, 1, 0), scene);
    light.intensity = 1.1;

    const dirLight = new DirectionalLight("dirLight", new Vector3(0, -1, 1), scene);
    dirLight.position = new Vector3(0, 10, -10);
    dirLight.intensity = 0.6;

    const shadowGenerator = new ShadowGenerator(1024, dirLight);
    shadowGenerator.useBlurExponentialShadowMap = true;
    shadowGenerator.blurKernel = 32;

    engine.runRenderLoop(() => {
        scene.render();
    });

    window.addEventListener("resize", () => {
        engine.resize();
    });

    return { engine, scene, camera, shadowGenerator };
};
