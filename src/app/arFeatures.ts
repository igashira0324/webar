import {
    Scene, Vector3, Quaternion, MeshBuilder, StandardMaterial, Color3,
    WebXRFeatureName,
} from "@babylonjs/core";
import type {
    WebXRDefaultExperience, WebXRLightEstimation, WebXRDepthSensing,
    WebXRAnchorSystem, IWebXRHitResult, DirectionalLight,
} from "@babylonjs/core";

// 2026 年時点の WebXR AR 主要機能（照明推定 / 深度オクルージョン / 空間アンカー）を
// まとめて有効化するモジュール。全て optional feature として要求するため、
// 未対応端末ではセッション自体は従来どおり成立し自動的にフォールバックする。

// ===== 照明推定 (WebXR Light Estimation) =====
// 実空間の光源方向・色・強度を既存の DirectionalLight へ反映し、影の向きも実光源に追従させる

export interface LightEstimationHandle {
    feature: WebXRLightEstimation;
    /** セッション終了時にプレビュー用の既定ライト設定へ戻す */
    restore: () => void;
}

export const enableLightEstimation = (
    xr: WebXRDefaultExperience,
    dirLight: DirectionalLight
): LightEstimationHandle | null => {
    try {
        const feature = xr.baseExperience.featuresManager.enableFeature(
            WebXRFeatureName.LIGHT_ESTIMATION, "latest",
            {
                createDirectionalLightSource: false,
                // MMD マテリアル(StandardMaterial 系)は環境キューブマップを使わないため反射は省略し、
                // ポーリング間隔も 500ms に間引いてモバイル GPU への負荷を抑える
                disableCubeMapReflection: true,
                lightEstimationPollInterval: 500,
            },
            true, false
        ) as WebXRLightEstimation;

        const saved = {
            direction: dirLight.direction.clone(),
            intensity: dirLight.intensity,
            diffuse: dirLight.diffuse.clone(),
        };
        feature.directionalLight = dirLight;

        return {
            feature,
            restore: () => {
                dirLight.direction.copyFrom(saved.direction);
                dirLight.intensity = saved.intensity;
                dirLight.diffuse.copyFrom(saved.diffuse);
            },
        };
    } catch (e) {
        console.warn("Light Estimation は利用できません(未対応環境):", e);
        return null;
    }
};

// ===== 深度オクルージョン (WebXR Depth Sensing) =====
// 実世界の深度マップで手前の人・家具にモデルが隠れるようにする。
// 注意: マテリアルプラグインは「機能有効化後に生成されたマテリアル」にのみ適用されるため、
// この関数はモデル読込より前に呼ぶこと（main.ts の初期化順序に依存）。

export const enableDepthOcclusion = (xr: WebXRDefaultExperience): WebXRDepthSensing | null => {
    try {
        return xr.baseExperience.featuresManager.enableFeature(
            WebXRFeatureName.DEPTH_SENSING, "latest",
            {
                usagePreference: ["gpu"],
                dataFormatPreference: ["luminance-alpha", "float", "ushort"],
            },
            true, false
        ) as WebXRDepthSensing;
    } catch (e) {
        console.warn("Depth Sensing は利用できません(未対応環境):", e);
        return null;
    }
};

/** セッション中に深度データが実際に取得できているか（GPU 経路のみオクルージョン描画が効く） */
export const isDepthOcclusionActive = (depth: WebXRDepthSensing | null): boolean => {
    try {
        return !!depth && depth.attached && depth.depthUsage === "gpu";
    } catch {
        return false;
    }
};

// ===== 空間アンカー (WebXR Anchors) =====
// 配置位置を ARCore のアンカーへ固定し、歩き回った際のトラッキングドリフトを補正する

export const enableAnchors = (xr: WebXRDefaultExperience): WebXRAnchorSystem | null => {
    try {
        return xr.baseExperience.featuresManager.enableFeature(
            WebXRFeatureName.ANCHOR_SYSTEM, "latest",
            { clearAnchorsOnSessionInit: true },
            true, false
        ) as WebXRAnchorSystem;
    } catch (e) {
        console.warn("Anchors は利用できません(未対応環境):", e);
        return null;
    }
};

// ===== 配置レティクル =====
// ヒットテスト結果（床）にリングを表示し、タップでどこに配置されるかを可視化する

export interface PlacementReticle {
    update: (hit: IWebXRHitResult) => void;
    setVisible: (v: boolean) => void;
    dispose: () => void;
}

export const createPlacementReticle = (scene: Scene): PlacementReticle => {
    const ring = MeshBuilder.CreateTorus(
        "arReticle", { diameter: 0.35, thickness: 0.015, tessellation: 48 }, scene
    );
    const mat = new StandardMaterial("arReticleMat", scene);
    mat.emissiveColor = Color3.FromHexString("#00e5ff");
    mat.disableLighting = true;
    mat.alpha = 0.85;
    ring.material = mat;
    ring.isPickable = false;
    ring.rotationQuaternion = Quaternion.Identity();
    ring.setEnabled(false);

    return {
        update: (hit: IWebXRHitResult) => {
            hit.transformationMatrix.decompose(undefined, ring.rotationQuaternion!, ring.position);
            // 床面と Z ファイティングしないよう僅かに浮かせる
            ring.position.addInPlace(Vector3.Up().scale(0.005));
        },
        setVisible: (v: boolean) => ring.setEnabled(v),
        dispose: () => {
            ring.dispose();
            mat.dispose();
        },
    };
};

// ===== オクルージョン切替ボタン (DOM Overlay 上) =====
// 深度マップが粗い端末で見た目が乱れる場合に、その場で OFF にできる逃げ道を用意する

export interface OcclusionToggle {
    setVisible: (v: boolean) => void;
    /** セッション開始時に ON 表示へ戻す（機能自体は featuresManager が自動で再アタッチする） */
    reset: () => void;
}

export const createOcclusionToggleButton = (
    overlay: HTMLElement,
    onToggle: (enabled: boolean) => void
): OcclusionToggle => {
    const btn = document.createElement("button");
    btn.id = "ar-occlusion-btn";
    btn.style.cssText =
        "position:absolute;top:14px;left:14px;z-index:20;padding:10px 16px;border:none;" +
        "border-radius:22px;background:rgba(0,0,0,0.55);color:#fff;font-size:0.9rem;font-weight:600;" +
        "backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);pointer-events:auto;display:none;";

    let enabled = true;
    const render = () => {
        btn.textContent = enabled ? "🫥 オクルージョン ON" : "🫥 オクルージョン OFF";
        btn.style.opacity = enabled ? "1" : "0.55";
    };
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        enabled = !enabled;
        render();
        onToggle(enabled);
    });
    // ボタン上のタッチはジェスチャー（回転/配置）に伝播させない
    btn.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
    btn.addEventListener("touchend", (e) => e.stopPropagation(), { passive: true });
    overlay.appendChild(btn);
    render();

    return {
        setVisible: (v: boolean) => { btn.style.display = v ? "block" : "none"; },
        reset: () => {
            if (!enabled) {
                enabled = true;
                render();
            }
        },
    };
};
