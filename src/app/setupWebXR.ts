import {
    Scene, AbstractMesh, WebXRState, WebXRFeatureName,
    Quaternion, Vector3, TransformNode, Color4, ShadowGenerator,
} from "@babylonjs/core";
import type {
    WebXRDefaultExperience, WebXRHitTest, IWebXRHitResult,
    WebXRAnchorSystem, IWebXRAnchor, WebXRDepthSensing, DirectionalLight,
} from "@babylonjs/core";
import { appState } from "./state";
import {
    enableLightEstimation, enableDepthOcclusion, isDepthOcclusionActive,
    enableAnchors, createPlacementReticle, createOcclusionToggleButton,
    type PlacementReticle, type LightEstimationHandle, type OcclusionToggle,
} from "./arFeatures";
import { tryConsumeTap, setGameActive, setChanceReady, cancelActiveChance } from "./gameMode";
import { togglePlayback } from "./audioController";

// ===== AR ルート管理 =====
// モデルを arRoot 配下へ付け替え、セッション終了時に元の親子関係と変形へ戻す

interface ArRootController {
    arRoot: TransformNode;
    baseScale: number;
    attachAll: () => void;
    detachAll: () => void;
    setTargets: (meshes: AbstractMesh[], attachNow: boolean) => void;
}

const createArRootController = (scene: Scene, initialMeshes: AbstractMesh[]): ArRootController => {
    const arRoot = new TransformNode("arRoot", scene);
    const baseScale = 0.2;
    arRoot.scaling.setAll(baseScale);
    arRoot.setEnabled(false);

    let targetMeshes = [...initialMeshes];
    const originalState = new Map<AbstractMesh, {
        parent: any; scaling: Vector3; position: Vector3; rotationQuaternion: Quaternion | null;
    }>();

    const attachAll = () => {
        targetMeshes.forEach((m) => {
            if (m.parent === arRoot) return; // 二重アタッチ防止（復元情報を壊さない）
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

    const detachAll = () => {
        targetMeshes.forEach((m) => {
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

    return {
        arRoot,
        baseScale,
        attachAll,
        detachAll,
        // AR セッション中にモデルが差し替わった場合は即座に arRoot 配下へ入れ直す
        setTargets: (meshes, attachNow) => {
            targetMeshes = [...meshes];
            if (attachNow) attachAll();
        },
    };
};

// ===== セッション共有状態 =====

interface ArSessionContext {
    scene: Scene;
    root: ArRootController;
    inXR: boolean;
    modelPlaced: boolean;
    latestHits: IWebXRHitResult[];
    anchorSystem: WebXRAnchorSystem | null;
    activeAnchor: IWebXRAnchor | null;
    reticle: PlacementReticle | null;
    lightEst: LightEstimationHandle | null;
    depthSensing: WebXRDepthSensing | null;
    occToggle: OcclusionToggle | null;
    overlay: HTMLElement | null;
    controlPanel: HTMLElement | null;
    showSettingsBtn: HTMLElement | null;
    tmpQuat: Quaternion;
}

const removeActiveAnchor = (ctx: ArSessionContext) => {
    if (!ctx.activeAnchor) return;
    try { ctx.activeAnchor.remove(); } catch (e) { /* セッション終了後の remove は無視 */ }
    ctx.activeAnchor = null;
};

// 空間アンカーで配置位置を固定（歩き回った際のドリフトを補正）。失敗しても通常配置で継続
const anchorToHit = async (ctx: ArSessionContext, hit: IWebXRHitResult) => {
    if (!ctx.anchorSystem) return;
    removeActiveAnchor(ctx);
    try {
        ctx.activeAnchor = await ctx.anchorSystem.addAnchorPointUsingHitTestResultAsync(hit);
    } catch (e) {
        console.warn("アンカー作成失敗（通常配置で継続）:", e);
    }
};

const handleTapPlace = (ctx: ArSessionContext) => {
    if (!ctx.inXR || !appState.xrHelper) return;
    const arRoot = ctx.root.arRoot;
    arRoot.setEnabled(true);
    const camera = appState.xrHelper.baseExperience.camera;
    const hit = ctx.latestHits[0];

    if (hit) {
        hit.transformationMatrix.decompose(undefined, ctx.tmpQuat, arRoot.position);
        void anchorToHit(ctx, hit);
    } else {
        removeActiveAnchor(ctx);
        const forward = camera.getForwardRay().direction;
        arRoot.position.copyFrom(camera.position).addInPlace(forward.scale(1.5));
        arRoot.position.y -= 0.8;
    }

    if (!ctx.modelPlaced) {
        const diff = camera.position.subtract(arRoot.position);
        const angle = Math.atan2(diff.x, diff.z);
        arRoot.rotationQuaternion = Quaternion.FromEulerAngles(0, angle + Math.PI, 0);
        ctx.modelPlaced = true;
    }
    setChanceReady(true); // モデルが見えている状態になったので表情チャンスを許可
    ctx.reticle?.setVisible(false);
};

// ===== ジェスチャー操作 (DOM Overlay) =====

interface GestureContext {
    isInXR: () => boolean;
    isPlaced: () => boolean;
    onTap: () => void;
    rotate: (dx: number, dy: number) => void;
    setScale: (v: number) => void;
    getScale: () => number;
}

interface ArGestureState {
    touches: Map<number, { x: number; y: number }>;
    mode: "none" | "rotate" | "pinch";
    lastX: number;
    lastY: number;
    pinchDist: number;
    pinchBaseScale: number;
    startTime: number;
    moved: number;
}

const TAP_MAX_MOVE = 15;
const TAP_MAX_TIME = 400;

const onArTouchStart = (st: ArGestureState, ctx: GestureContext, e: TouchEvent) => {
    if (!ctx.isInXR()) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        st.touches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    if (st.touches.size === 1) {
        const t = Array.from(st.touches.values())[0];
        st.mode = "rotate";
        st.lastX = t.x;
        st.lastY = t.y;
        st.startTime = Date.now();
        st.moved = 0;
    } else if (st.touches.size === 2) {
        const pts = Array.from(st.touches.values());
        st.pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        st.pinchBaseScale = ctx.getScale();
        st.mode = "pinch";
    }
};

const onArTouchMove = (st: ArGestureState, ctx: GestureContext, e: TouchEvent) => {
    if (!ctx.isInXR() || !ctx.isPlaced()) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (st.touches.has(t.identifier)) {
            st.touches.set(t.identifier, { x: t.clientX, y: t.clientY });
        }
    }
    if (st.mode === "rotate" && st.touches.size === 1) {
        const t = Array.from(st.touches.values())[0];
        const dx = t.x - st.lastX;
        const dy = t.y - st.lastY;
        st.lastX = t.x;
        st.lastY = t.y;
        st.moved += Math.abs(dx) + Math.abs(dy);
        if (st.moved > TAP_MAX_MOVE) ctx.rotate(dx, dy);
    } else if (st.mode === "pinch" && st.touches.size >= 2) {
        const pts = Array.from(st.touches.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (st.pinchDist > 10) {
            const next = Math.min(2.0, Math.max(0.005, st.pinchBaseScale * (dist / st.pinchDist)));
            if (Number.isFinite(next)) ctx.setScale(next);
        }
    }
};

const onArTouchEnd = (st: ArGestureState, ctx: GestureContext, e: TouchEvent) => {
    if (!ctx.isInXR()) return;
    const elapsed = Date.now() - st.startTime;
    const sizeBefore = st.touches.size;
    for (let i = 0; i < e.changedTouches.length; i++) {
        st.touches.delete(e.changedTouches[i].identifier);
    }
    if (st.mode === "rotate" && sizeBefore === 1 && st.touches.size === 0 &&
        elapsed < TAP_MAX_TIME && st.moved < TAP_MAX_MOVE) {
        ctx.onTap();
    }
    if (st.touches.size === 0) {
        st.mode = "none";
        st.moved = 0;
    } else if (st.touches.size === 1) {
        const t = Array.from(st.touches.values())[0];
        st.mode = "rotate";
        st.lastX = t.x;
        st.lastY = t.y; // 指を1本離してピンチ→回転へ移る際、Y の基準も更新（縦回転の飛びを防ぐ）
        st.moved = 999;
    }
};

const setupArGestures = (overlay: HTMLElement, ctx: GestureContext) => {
    const st: ArGestureState = {
        touches: new Map(), mode: "none", lastX: 0, lastY: 0,
        pinchDist: 0, pinchBaseScale: 1, startTime: 0, moved: 0,
    };
    overlay.addEventListener("touchstart", (e) => onArTouchStart(st, ctx, e), { passive: true });
    overlay.addEventListener("touchmove", (e) => onArTouchMove(st, ctx, e), { passive: true });
    const end = (e: TouchEvent) => onArTouchEnd(st, ctx, e);
    overlay.addEventListener("touchend", end, { passive: true });
    overlay.addEventListener("touchcancel", end, { passive: true });
};

// AR セッションを終了するためのボタン（DOM Overlay 上に表示）
// disableDefaultUI:true のためネイティブの退出ボタンが無く、これが唯一のアプリ内退出手段
const createArExitButton = (overlay: HTMLElement) => {
    const exitBtn = document.createElement("button");
    exitBtn.id = "ar-exit-btn";
    exitBtn.textContent = "✕ AR 終了";
    exitBtn.style.cssText =
        "position:absolute;top:14px;right:14px;z-index:20;padding:10px 16px;border:none;" +
        "border-radius:22px;background:rgba(0,0,0,0.55);color:#fff;font-size:0.9rem;font-weight:600;" +
        "backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);pointer-events:auto;";
    exitBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        try { appState.xrHelper?.baseExperience.exitXRAsync(); }
        catch (err) { console.warn("exitXR failed", err); }
    });
    // ボタン上のタッチはジェスチャー（回転/配置）に伝播させない
    exitBtn.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
    exitBtn.addEventListener("touchend", (e) => e.stopPropagation(), { passive: true });
    overlay.appendChild(exitBtn);
};

// AR中でも確実にダンスを一時停止/再開できる専用ボタン（画面下部中央、タップ判定とは完全分離）
const createArPauseButton = (overlay: HTMLElement) => {
    const btn = document.createElement("button");
    btn.id = "ar-pause-btn";
    btn.textContent = "⏸ 停止";
    btn.style.cssText =
        "position:absolute;bottom:28px;left:50%;transform:translateX(-50%);z-index:20;" +
        "padding:12px 28px;border:1px solid rgba(0,229,255,0.5);border-radius:26px;" +
        "background:rgba(0,0,0,0.55);color:#fff;font-size:1rem;font-weight:600;" +
        "backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);pointer-events:auto;";
    btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        cancelActiveChance(); // 停止/再開の瞬間に開いていたチャンスは無効化する
        await togglePlayback();
        const paused = !!appState.internalAudio?.paused;
        btn.textContent = paused ? "▶ 再生" : "⏸ 停止";
    });
    btn.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
    btn.addEventListener("touchend", (e) => e.stopPropagation(), { passive: true });
    overlay.appendChild(btn);
};

// ===== 2026 WebXR 拡張機能の有効化と結線 =====
// 全て optional feature として要求するため、未対応端末では自動フォールバックする

const wireArFeatures = (
    ctx: ArSessionContext, xr: WebXRDefaultExperience, shadowGenerator: ShadowGenerator | null
) => {
    const featuresManager = xr.baseExperience.featuresManager;
    const hitTest = featuresManager.enableFeature(WebXRFeatureName.HIT_TEST, "latest") as WebXRHitTest;
    featuresManager.enableFeature(WebXRFeatureName.DOM_OVERLAY, "latest", { element: ctx.overlay! });

    const dirLight = (shadowGenerator?.getLight() as DirectionalLight) ?? null;
    ctx.lightEst = dirLight ? enableLightEstimation(xr, dirLight) : null;
    ctx.depthSensing = enableDepthOcclusion(xr);
    ctx.anchorSystem = enableAnchors(xr);
    ctx.reticle = createPlacementReticle(ctx.scene);

    // 画面中央のヒットテスト結果を毎フレーム保持（配置・レティクル・アンカーで共用）
    hitTest.onHitTestResultObservable.add((results) => {
        ctx.latestHits = results;
        const show = ctx.inXR && !ctx.modelPlaced && results.length > 0;
        if (show) ctx.reticle!.update(results[0]);
        ctx.reticle?.setVisible(show);
    });

    // アンカーのポーズ更新で配置位置のみ補正（回転はユーザージェスチャー優先）
    ctx.anchorSystem?.onAnchorUpdatedObservable.add((anchor) => {
        if (anchor !== ctx.activeAnchor || !ctx.inXR) return;
        anchor.transformationMatrix.decompose(undefined, undefined, ctx.root.arRoot.position);
    });

    const depthSensing = ctx.depthSensing;
    ctx.occToggle = ctx.overlay && depthSensing
        ? createOcclusionToggleButton(ctx.overlay, (enabled) => {
            try { enabled ? depthSensing.attach(true) : depthSensing.detach(); }
            catch (e) { console.warn("オクルージョン切替失敗:", e); }
        })
        : null;
};

// ===== セッション状態遷移 =====

const onEnterXR = (ctx: ArSessionContext) => {
    ctx.scene.clearColor = new Color4(0, 0, 0, 0);
    ctx.inXR = true;
    ctx.overlay?.classList.add("active");
    setGameActive(true);
    if (ctx.controlPanel) ctx.controlPanel.style.display = "none";
    if (ctx.showSettingsBtn) ctx.showSettingsBtn.style.display = "none";
    try {
        appState.mmdRuntime?.playAnimation();
    } catch (e) { console.warn(e); }
    // 入室時は自動再生されるので停止ボタンのラベルを初期状態に戻す
    const pauseBtn = document.getElementById("ar-pause-btn");
    if (pauseBtn) pauseBtn.textContent = "⏸ 停止";
    ctx.modelPlaced = false;
    // セッション毎に arRoot の変形を初期状態へ戻す（前回のピンチ拡大/回転が持ち越されないように）
    const arRoot = ctx.root.arRoot;
    arRoot.scaling.setAll(ctx.root.baseScale);
    arRoot.rotationQuaternion = Quaternion.Identity();
    arRoot.position.setAll(0);
    ctx.root.attachAll();
    arRoot.setEnabled(false);
    // 深度データが実際に取得できる端末でのみトグルを表示（attach 完了を待つため遅延判定）
    ctx.occToggle?.reset();
    setTimeout(() => ctx.occToggle?.setVisible(isDepthOcclusionActive(ctx.depthSensing)), 600);
};

const onExitXR = (ctx: ArSessionContext) => {
    ctx.scene.clearColor = new Color4(0.04, 0.04, 0.10, 1.0);
    ctx.inXR = false;
    ctx.overlay?.classList.remove("active");
    setGameActive(false);
    if (ctx.controlPanel) ctx.controlPanel.style.display = "block";
    if (ctx.showSettingsBtn) ctx.showSettingsBtn.style.display = "block";
    ctx.modelPlaced = false;
    removeActiveAnchor(ctx);
    ctx.reticle?.setVisible(false);
    ctx.occToggle?.setVisible(false);
    ctx.lightEst?.restore(); // 照明をプレビュー用の既定値へ戻す
    ctx.root.detachAll();
};

// ===== メインセットアップ =====

export const setupWebXR = async (
    scene: Scene,
    shadowGenerator: ShadowGenerator | null,
    meshes: AbstractMesh[] = []
) => {
    console.log("Setting up WebXR... (v3.1 Light Estimation / Depth Occlusion / Anchors)");

    const ctx: ArSessionContext = {
        scene,
        root: createArRootController(scene, meshes),
        inXR: false,
        modelPlaced: false,
        latestHits: [],
        anchorSystem: null,
        activeAnchor: null,
        reticle: null,
        lightEst: null,
        depthSensing: null,
        occToggle: null,
        overlay: document.getElementById("ar-overlay"),
        controlPanel: document.getElementById("control-panel"),
        showSettingsBtn: document.getElementById("showSettingsBtn"),
        tmpQuat: new Quaternion(),
    };

    // ★ 外部から操作対象メッシュを更新できるようにする
    (window as any).__updateXRTargetMeshes = (newMeshes: AbstractMesh[]) => {
        console.log("Updating WebXR target meshes:", newMeshes.length);
        ctx.root.setTargets(newMeshes, ctx.inXR);
    };

    if (ctx.overlay) {
        createArExitButton(ctx.overlay);
        createArPauseButton(ctx.overlay);
        setupArGestures(ctx.overlay, {
            isInXR: () => ctx.inXR,
            isPlaced: () => ctx.modelPlaced,
            onTap: () => {
                // 配置前のタップは必ず配置に使う。配置済みならチャンス中のみゲーム側が先取りする
                if (ctx.modelPlaced && tryConsumeTap()) return;
                handleTapPlace(ctx);
            },
            rotate: (dx, dy) => {
                ctx.root.arRoot.rotate(Vector3.Up(), dx * -0.005, 1);
                ctx.root.arRoot.rotate(Vector3.Right(), dy * -0.005, 1);
            },
            setScale: (v) => ctx.root.arRoot.scaling.setAll(v),
            getScale: () => ctx.root.arRoot.scaling.y,
        });
    }

    try {
        const xr = await scene.createDefaultXRExperienceAsync({
            uiOptions: {
                sessionMode: "immersive-ar",
                referenceSpaceType: "local-floor"
            },
            optionalFeatures: ["hit-test", "dom-overlay"],
            disableDefaultUI: true
        });

        appState.xrHelper = xr;
        (window as any).__xrHelper = xr; // Keep global for external entry if needed

        wireArFeatures(ctx, xr, shadowGenerator);

        xr.baseExperience.onStateChangedObservable.add((state) => {
            if (state === WebXRState.IN_XR) onEnterXR(ctx);
            else if (state === WebXRState.NOT_IN_XR) onExitXR(ctx);
        });

        return xr;
    } catch (e: any) {
        console.error("WebXR Setup Failed", e);
        return null;
    }
};
