import {
  Scene, AbstractMesh, WebXRState, WebXRFeatureName,
  Quaternion, Vector3, TransformNode
} from "@babylonjs/core";
import { StreamAudioPlayer } from "babylon-mmd";

export const setupWebXR = async (
  scene: Scene,
  meshes: AbstractMesh[],
  _audioPlayer: StreamAudioPlayer
) => {
  console.log("Setting up WebXR... (v2.4)");
  const controlPanel = document.getElementById("control-panel");
  const showSettingsBtn = document.getElementById("showSettingsBtn");
  const runtime = (scene as any).mmdRootRuntime;

  // ARコンテナ（親ノード）を1つ作り、ミクをその子にする
  const arRoot = new TransformNode("arRoot", scene);
  const baseScale = 0.04;
  arRoot.scaling.setAll(baseScale);

  meshes.forEach((m) => {
    m.parent = arRoot;
    m.position.set(0, 0, 0);   // 子なのでローカル原点に
    m.scaling.setAll(1);       // スケールは親で管理
    if (!m.rotationQuaternion) m.rotationQuaternion = Quaternion.Identity();
  });

  let modelPlaced = false;
  let inXR = false;

  // ジェスチャー用の状態（リスナーは1度だけ登録）
  let isDragging = false;
  let touchStartX = 0;
  let initialPinchDist = 0;
  let initialScaleY = baseScale;
  const upVector = Vector3.Up();
  const tmpQuat = new Quaternion();

  const onTouchStart = (e: TouchEvent) => {
    if (!inXR || !modelPlaced) return;
    if (e.touches.length === 1) {
      isDragging = true;
      touchStartX = e.touches[0].clientX;
    } else if (e.touches.length === 2) {
      isDragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      initialPinchDist = Math.hypot(dx, dy);
      initialScaleY = arRoot.scaling.y;
    }
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!inXR || !modelPlaced) return;

    if (e.touches.length === 1 && isDragging) {
      const currentX = e.touches[0].clientX;
      const deltaX = currentX - touchStartX;
      touchStartX = currentX;
      // 親ノードを回転（MMDの内部状態を壊さない）
      arRoot.rotate(upVector, deltaX * -0.005);
    } else if (e.touches.length === 2 && initialPinchDist > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / initialPinchDist;
      // 安全側に値域を制限（NaN・極端値ガード）
      const next = Math.min(0.5, Math.max(0.005, initialScaleY * ratio));
      if (Number.isFinite(next)) arRoot.scaling.setAll(next);
    }
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length < 1) isDragging = false;
    if (e.touches.length < 2) initialPinchDist = 0;
  };

  // 一度だけ登録
  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchmove", onTouchMove, { passive: true });
  document.addEventListener("touchend", onTouchEnd, { passive: true });
  document.addEventListener("touchcancel", onTouchEnd, { passive: true });

  try {
    const xr = await scene.createDefaultXRExperienceAsync({
      uiOptions: {
        sessionMode: "immersive-ar",
        referenceSpaceType: "local-floor",
      },
      optionalFeatures: ["hit-test"],
    });

    const featuresManager = xr.baseExperience.featuresManager;
    const hitTest = featuresManager.enableFeature(
      WebXRFeatureName.HIT_TEST, "latest"
    ) as any;

    (scene as any)._xrExperience = xr;

    xr.baseExperience.onStateChangedObservable.add((state) => {
      if (state === WebXRState.IN_XR) {
        inXR = true;
        if (controlPanel) controlPanel.style.display = "none";
        if (showSettingsBtn) showSettingsBtn.style.display = "none";
        try { runtime?.playAnimation(); } catch (e) { console.warn(e); }
        modelPlaced = false;
        arRoot.setEnabled(false); // メッシュ単位ではなく親ごと非表示
      } else if (state === WebXRState.NOT_IN_XR) {
        inXR = false;
        if (controlPanel) controlPanel.style.display = "block";
        if (showSettingsBtn) showSettingsBtn.style.display = "block";
        modelPlaced = false;
      }
    });

    let lastTapTime = 0;
    scene.onPointerDown = (_evt, pickInfo) => {
      const now = Date.now();
      if (now - lastTapTime < 300) return;
      lastTapTime = now;
      if (!inXR) return;

      // ミク自身をタップしたら移動しない（ジェスチャーに任せる）
      if (
        pickInfo.hit &&
        pickInfo.pickedMesh &&
        meshes.includes(pickInfo.pickedMesh as AbstractMesh)
      ) return;

      if (!hitTest.lastHitTestResults?.length) return;

      const hit = hitTest.lastHitTestResults[0];
      const camera = xr.baseExperience.camera;

      // 親ノードだけ動かす（MMDの位置/回転には触らない）
      arRoot.setEnabled(true);
      hit.transformationMatrix.decompose(undefined, tmpQuat, arRoot.position);

      if (!modelPlaced) {
        const diff = camera.position.subtract(arRoot.position);
        const angle = Math.atan2(diff.x, diff.z);
        arRoot.rotationQuaternion = Quaternion.FromEulerAngles(0, angle, 0);
        modelPlaced = true;
      }
      // 2回目以降はユーザーの回転を保持（何もしない）
    };

    return xr;
  } catch (e: any) {
    console.error("WebXR Setup Failed", e);
    return null;
  }
};

