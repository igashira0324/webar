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
  console.log("Setting up WebXR... (v2.7)");
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

  // ===== ジェスチャー操作（DOM Overlay版・確実に動く方式）=====
  const overlay = document.getElementById("ar-overlay");
  
  const handleTapPlace = () => {
    if (!inXR) return;
    arRoot.setEnabled(true);
    const camera = (scene as any)._xrExperience.baseExperience.camera;
    const hitTest = (scene as any)._hitTestFeature;

    if (hitTest?.lastHitTestResults?.length) {
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
      arRoot.rotationQuaternion = Quaternion.FromEulerAngles(0, angle + Math.PI, 0);
      modelPlaced = true;
    }
  };

  if (overlay) {
    let activeTouches = new Map<number, { x: number, y: number }>();
    let gestureMode: "none" | "rotate" | "pinch" = "none";
    let lastSingleX = 0;
    let initialPinchDist = 0;
    let initialScale = baseScale;
    let touchStartTime = 0;
    let movedDistance = 0;
    const TAP_MAX_MOVE = 15;
    const TAP_MAX_TIME = 400;

    overlay.addEventListener("touchstart", (e: TouchEvent) => {
      if (!inXR) return;
      // We don't call preventDefault here to allow tap events to flow if needed,
      // but we manage our own tap logic.
      
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
      }

      if (activeTouches.size === 1) {
        const t = Array.from(activeTouches.values())[0];
        gestureMode = "rotate";
        lastSingleX = t.x;
        touchStartTime = Date.now();
        movedDistance = 0;
      } else if (activeTouches.size === 2) {
        const pts = Array.from(activeTouches.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        initialPinchDist = Math.hypot(dx, dy);
        initialScale = arRoot.scaling.y;
        gestureMode = "pinch";
      }
    }, { passive: true });

    overlay.addEventListener("touchmove", (e: TouchEvent) => {
      if (!inXR || !modelPlaced) return;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (activeTouches.has(t.identifier)) {
          activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
        }
      }

      if (gestureMode === "rotate" && activeTouches.size === 1) {
        const t = Array.from(activeTouches.values())[0];
        const dx = t.x - lastSingleX;
        lastSingleX = t.x;
        movedDistance += Math.abs(dx);
        if (movedDistance > TAP_MAX_MOVE) {
          arRoot.rotate(Vector3.Up(), dx * -0.005);
        }
      } else if (gestureMode === "pinch" && activeTouches.size >= 2) {
        const pts = Array.from(activeTouches.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        const dist = Math.hypot(dx, dy);
        if (initialPinchDist > 10) {
          const ratio = dist / initialPinchDist;
          const next = Math.min(0.5, Math.max(0.005, initialScale * ratio));
          if (Number.isFinite(next)) arRoot.scaling.setAll(next);
        }
      }
    }, { passive: true });

    const onTouchEnd = (e: TouchEvent) => {
      if (!inXR) return;

      const elapsed = Date.now() - touchStartTime;
      const sizeBefore = activeTouches.size;
      for (let i = 0; i < e.changedTouches.length; i++) {
        activeTouches.delete(e.changedTouches[i].identifier);
      }

      if (gestureMode === "rotate" && sizeBefore === 1 && (activeTouches as any).size === 0 && elapsed < TAP_MAX_TIME && movedDistance < TAP_MAX_MOVE) {
        handleTapPlace();
      }

      if (activeTouches.size === 0) {
        gestureMode = "none";
        movedDistance = 0;
      } else if (activeTouches.size === 1) {
        const t = Array.from(activeTouches.values())[0];
        gestureMode = "rotate";
        lastSingleX = t.x;
        movedDistance = 999;
      }
    };

    overlay.addEventListener("touchend", onTouchEnd, { passive: true });
    overlay.addEventListener("touchcancel", onTouchEnd, { passive: true });
  }

  try {
    const xr = await scene.createDefaultXRExperienceAsync({
      uiOptions: {
        sessionMode: "immersive-ar",
        referenceSpaceType: "local-floor"
      },
      optionalFeatures: ["hit-test", "dom-overlay"]
    });

    const featuresManager = xr.baseExperience.featuresManager;
    const hitTest = featuresManager.enableFeature(
      WebXRFeatureName.HIT_TEST, "latest"
    ) as any;

    featuresManager.enableFeature(WebXRFeatureName.DOM_OVERLAY, "latest", {
      element: overlay!
    });

    (scene as any)._xrExperience = xr;
    (scene as any)._hitTestFeature = hitTest;

    xr.baseExperience.onStateChangedObservable.add((state) => {
      if (state === WebXRState.IN_XR) {
        inXR = true;
        overlay?.classList.add("active");
        if (controlPanel) controlPanel.style.display = "none";
        if (showSettingsBtn) showSettingsBtn.style.display = "none";
        try { runtime?.playAnimation(); } catch (e) { console.warn(e); }
        modelPlaced = false;
        attachToArRoot();
        arRoot.setEnabled(false);
      } else if (state === WebXRState.NOT_IN_XR) {
        inXR = false;
        overlay?.classList.remove("active");
        if (controlPanel) controlPanel.style.display = "block";
        if (showSettingsBtn) showSettingsBtn.style.display = "block";
        modelPlaced = false;
        detachFromArRoot();
      }
    });

    return xr;
  } catch (e: any) {
    console.error("WebXR Setup Failed", e);
    return null;
  }
};




