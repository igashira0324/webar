/**
 * sceneSetup.ts
 * Babylon.js シーンのセットアップ
 * スタジオモード（仮想背景）と AR モード（WebXR）の両方に対応する。
 */
import {
  Engine, Scene, ArcRotateCamera, Vector3,
  HemisphericLight, DirectionalLight, ShadowGenerator,
  Color4, MeshBuilder, StandardMaterial, Color3,
  WebXRState, TransformNode, Quaternion
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import "babylon-mmd/esm/Loader/pmxLoader";
import "babylon-mmd/esm/Loader/vmdLoader";

export type SceneBundle = {
  engine: Engine;
  scene: Scene;
  shadowGenerator: ShadowGenerator;
  contentRoot: TransformNode;
  enterAR?: () => Promise<void>;
};

/** スタジオモード（AR非対応環境）でシーンを構築する */
export async function createStudioScene(canvas: HTMLCanvasElement): Promise<SceneBundle> {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
  });

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.03, 0.03, 0.12, 1.0);

  // モデルや歌詞をグループ化して制御するためのルートノード
  const contentRoot = new TransformNode("contentRoot", scene);

  // カメラ
  const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.5, 3.5, new Vector3(0, 0.8, 0), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 1.0;
  camera.upperRadiusLimit = 7;

  // 環境光
  const light = new HemisphericLight("light", new Vector3(0, 1, 0), scene);
  light.intensity = 1.0;

  // 方向光（シャドウ用）
  const dirLight = new DirectionalLight("dirLight", new Vector3(-0.5, -1, 0.5), scene);
  dirLight.position = new Vector3(5, 10, -5);
  dirLight.intensity = 0.7;

  const shadowGenerator = new ShadowGenerator(1024, dirLight);
  shadowGenerator.useBlurExponentialShadowMap = true;
  shadowGenerator.blurKernel = 24;

  // スタジオ床（グリッド）
  _buildStudioFloor(scene);

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());

  return { engine, scene, shadowGenerator, contentRoot };
}

/** AR モード（WebXR immersive-ar）でシーンを構築する */
export async function createARScene(canvas: HTMLCanvasElement): Promise<SceneBundle> {
  const { engine, scene, shadowGenerator, contentRoot } = await createStudioScene(canvas);

  // WebXR セッションを開始する関数を返す
  const enterAR = async () => {
    try {
      // contentRoot のスケールを AR 向けに縮小
      contentRoot.scaling.setAll(0.15);
      contentRoot.setEnabled(false); // 開始するまで非表示

      const xr = await scene.createDefaultXRExperienceAsync({
        uiOptions: { sessionMode: "immersive-ar", referenceSpaceType: "local-floor" },
        optionalFeatures: ["hit-test", "dom-overlay"],
        disableDefaultUI: true,
      });

      const featuresManager = xr.baseExperience.featuresManager;
      const hitTest = featuresManager.enableFeature("xr-hit-test" as any, "latest") as any;
      featuresManager.enableFeature("xr-dom-overlay" as any, "latest", {
        element: document.getElementById("ar-overlay")!,
      });

      (scene as any)._xrData = { xr, hitTest, contentRoot };

      xr.baseExperience.onStateChangedObservable.add((state) => {
        const arOverlay = document.getElementById("ar-overlay");
        const guide = document.getElementById("ar-place-guide");
        if (state === WebXRState.IN_XR) {
          scene.clearColor = new Color4(0, 0, 0, 0);
          contentRoot.setEnabled(false); // タップ配置されるまで非表示に
          // ar-overlay を有効化してタップ配置を受け付ける
          arOverlay?.classList.add("active");
          guide?.classList.remove("placed"); // 配置ガイドをリセット
        } else if (state === WebXRState.NOT_IN_XR) {
          scene.clearColor = new Color4(0.03, 0.03, 0.12, 1.0);
          arOverlay?.classList.remove("active");
        }
      });

      // タップで配置
      const overlay = document.getElementById("ar-overlay");
      if (overlay) {
        overlay.addEventListener("pointerup", () => {
          if (xr.baseExperience.state !== WebXRState.IN_XR) return;
          contentRoot.setEnabled(true);
          const camera = xr.baseExperience.camera;
          if (hitTest?.lastHitTestResults?.length) {
            const tmpQuat = new Quaternion();
            hitTest.lastHitTestResults[0].transformationMatrix.decompose(undefined, tmpQuat, contentRoot.position);
          } else {
            const fwd = camera.getForwardRay().direction;
            contentRoot.position.copyFrom(camera.position).addInPlace(fwd.scale(1.5));
            contentRoot.position.y -= 0.8;
          }
          
          // 配置完了でガイドを消す
          const guide = document.getElementById("ar-place-guide");
          if (guide) {
            guide.classList.add("placed");
          }
        });
      }

      await xr.baseExperience.enterXRAsync("immersive-ar", "local-floor");
    } catch (e) {
      console.error("AR entry failed:", e);
      throw e;
    }
  };

  return { engine, scene, shadowGenerator, contentRoot, enterAR };
}

/** スタジオ用フロアを構築 */
function _buildStudioFloor(scene: Scene): void {
  const floor = MeshBuilder.CreateGround("floor", { width: 10, height: 10 }, scene);
  const mat = new StandardMaterial("floorMat", scene);
  mat.diffuseColor = new Color3(0.04, 0.04, 0.14);
  mat.specularColor = new Color3(0.02, 0.05, 0.10);
  floor.material = mat;
  floor.position.y = -0.01;
  floor.receiveShadows = true;
}
