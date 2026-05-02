import {
  Scene, AbstractMesh, WebXRState, WebXRFeatureName,
  Quaternion, Vector3, TransformNode, PointerEventTypes
} from "@babylonjs/core";
import { StreamAudioPlayer } from "babylon-mmd";

export const setupWebXR = async (
  scene: Scene,
  meshes: AbstractMesh[],
  _audioPlayer: StreamAudioPlayer
) => {
  console.log("Setting up WebXR... (v2.6)");
  const controlPanel = document.getElementById("control-panel");
  const showSettingsBtn = document.getElementById("showSettingsBtn");
  const runtime = (scene as any).mmdRootRuntime;

  const arRoot = new TransformNode("arRoot", scene);
  const baseScale = 0.04;
  arRoot.scaling.setAll(baseScale);
  arRoot.setEnabled(false);

  const originalState = new Map<AbstractMesh, {
    parent: any, scaling: Vector3, position: Vector3, rotationQuaternion: Quaternion | null
  }>();

  const attachToArRoot = () => {
    meshes.forEach((m) => {
      originalState.set(m, {
        parent: m.parent,
        scaling: m.scaling.clone(),
        position: m.position.clone(),
        rotationQuaternion: m.rotationQuaternion ? m.rotationQuaternion.clone() : null,
      });
      m.parent = arRoot;
      m.position.set(0, 0, 0);
      m.scaling.setAll(1);
      if (!m.rotationQuaternion) m.rotationQuaternion = Quaternion.Identity();
    });
  };

  const detachFromArRoot = () => {
    meshes.forEach((m) => {
      const s = originalState.get(m);
      m.parent = s ? s.parent : null;
      if (s) {
        m.scaling.copyFrom(s.scaling);
        m.position.copyFrom(s.position);
        if (s.rotationQuaternion) m.rotationQuaternion = s.rotationQuaternion;
      }
      m.setEnabled(true);
      m.isVisible = true;
    });
    originalState.clear();
    arRoot.setEnabled(false);
  };

  let modelPlaced = false;
  let inXR = false;
  const tmpQuat = new Quaternion();

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

    // ===== ジェスチャー操作（Babylon Pointer Observable版）=====
    const activePointers = new Map<number, { x: number, y: number }>();
    let gestureMode: "none" | "rotate" | "pinch" = "none";
    let lastSingleX = 0;
    let initialPinchDist = 0;
    let initialScale = baseScale;
    const TAP_MOVE_THRESHOLD = 10;
    let pointerDownTime = 0;
    let movedDistance = 0;

    const handleTapPlace = (_evt: PointerEvent) => {
      if (!inXR) return;
      arRoot.setEnabled(true);
      const camera = xr.baseExperience.camera;

      if (hitTest.lastHitTestResults?.length) {
        const hit = hitTest.lastHitTestResults[0];
        hit.transformationMatrix.decompose(undefined, tmpQuat, arRoot.position);
      } else {
        const forward = camera.getForwardRay().direction;
        arRoot.position.copyFrom(camera.position).addInPlace(forward.scale(1.5));
        arRoot.position.y -= 0.8;
      }

      if (!modelPlaced) {
        const diff = camera.position.subtract(arRoot.position);
        const angle = Math.atan2(diff.x, diff.z);
        // 180度回転を加えて正面をカメラに向ける
        arRoot.rotationQuaternion = Quaternion.FromEulerAngles(0, angle + Math.PI, 0);
        modelPlaced = true;
      }
    };

    scene.onPointerObservable.add((pointerInfo) => {
      if (!inXR || !modelPlaced) return;

      const evt = pointerInfo.event as PointerEvent;
      const pid = evt.pointerId;

      switch (pointerInfo.type) {
        case PointerEventTypes.POINTERDOWN: {
          activePointers.set(pid, { x: evt.clientX, y: evt.clientY });
          if (activePointers.size === 1) {
            gestureMode = "rotate";
            lastSingleX = evt.clientX;
            pointerDownTime = Date.now();
            movedDistance = 0;
          } else if (activePointers.size === 2) {
            gestureMode = "pinch";
            const pts = Array.from(activePointers.values());
            const dx = pts[0].x - pts[1].x;
            const dy = pts[0].y - pts[1].y;
            initialPinchDist = Math.hypot(dx, dy);
            initialScale = arRoot.scaling.y;
          }
          break;
        }
        case PointerEventTypes.POINTERMOVE: {
          if (!activePointers.has(pid)) break;
          activePointers.set(pid, { x: evt.clientX, y: evt.clientY });
          if (gestureMode === "rotate" && activePointers.size === 1) {
            const dx = evt.clientX - lastSingleX;
            lastSingleX = evt.clientX;
            movedDistance += Math.abs(dx);
            if (movedDistance > TAP_MOVE_THRESHOLD) {
              arRoot.rotate(Vector3.Up(), dx * -0.005);
            }
          } else if (gestureMode === "pinch" && activePointers.size >= 2) {
            const pts = Array.from(activePointers.values());
            const dx = pts[0].x - pts[1].x;
            const dy = pts[0].y - pts[1].y;
            const dist = Math.hypot(dx, dy);
            if (initialPinchDist > 10) {
              const ratio = dist / initialPinchDist;
              const next = Math.min(0.5, Math.max(0.005, initialScale * ratio));
              if (Number.isFinite(next)) arRoot.scaling.setAll(next);
            }
          }
          break;
        }
        case PointerEventTypes.POINTERUP: {
          activePointers.delete(pid);
          const elapsed = Date.now() - pointerDownTime;
          const wasTap = gestureMode === "rotate" && activePointers.size === 0 && elapsed < 500 && movedDistance < TAP_MOVE_THRESHOLD;
          if (wasTap) {
            handleTapPlace(evt);
          }
          if (activePointers.size === 0) gestureMode = "none";
          else if (activePointers.size === 1) {
            gestureMode = "rotate";
            const remaining = Array.from(activePointers.values())[0];
            lastSingleX = remaining.x;
            movedDistance = 999;
          }
          break;
        }
      }
    });

    xr.baseExperience.onStateChangedObservable.add((state) => {
      if (state === WebXRState.IN_XR) {
        inXR = true;
        if (controlPanel) controlPanel.style.display = "none";
        if (showSettingsBtn) showSettingsBtn.style.display = "none";
        try { runtime?.playAnimation(); } catch (e) { console.warn(e); }
        modelPlaced = false;
        attachToArRoot();
        arRoot.setEnabled(false);
      } else if (state === WebXRState.NOT_IN_XR) {
        inXR = false;
        if (controlPanel) controlPanel.style.display = "block";
        if (showSettingsBtn) showSettingsBtn.style.display = "block";
        modelPlaced = false;
        detachFromArRoot();
      }
    });

    let lastTapTime = 0;
    scene.onPointerDown = (_evt, pickInfo) => {
      if (!inXR || modelPlaced) return;
      const now = Date.now();
      if (now - lastTapTime < 300) return;
      lastTapTime = now;
      if (pickInfo.hit && pickInfo.pickedMesh && meshes.includes(pickInfo.pickedMesh as AbstractMesh)) return;
      handleTapPlace(_evt as any);
    };

    return xr;
  } catch (e: any) {
    console.error("WebXR Setup Failed", e);
    return null;
  }
};



