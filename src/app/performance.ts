import { Scene, ShadowGenerator } from "@babylonjs/core";
import { MmdRuntime } from "babylon-mmd";
import { appState } from "./state";

// 注意: #physicsToggle / #shadowToggle は現在の既定 UI（index.html）には配置していない任意コントロール。
// マークアップに追加すれば下記ハンドラがそのまま機能する。
export const setupPerformanceControls = (
    _scene: Scene,
    _mmdRuntime: MmdRuntime,
    _shadowGenerator: ShadowGenerator
) => {
    const physicsToggle = document.getElementById("physicsToggle") as HTMLInputElement | null;
    const shadowToggle = document.getElementById("shadowToggle") as HTMLInputElement | null;

    // 物理演算トグル: babylon-mmd の物理 API 実装は未対応のため、現状は状態ログのみ（プレースホルダ）
    physicsToggle?.addEventListener("change", () => {
        console.log("Physics toggle (not yet implemented):", physicsToggle.checked);
    });

    // 影トグル: 現在のモデルのメッシュ（＋子メッシュ）へ receiveShadows を適用
    shadowToggle?.addEventListener("change", () => {
        const enabled = shadowToggle.checked;
        const mesh = appState.currentModel?.mesh;
        if (!mesh) return;
        mesh.receiveShadows = enabled;
        mesh.getChildMeshes?.().forEach((m) => { m.receiveShadows = enabled; });
    });

    // Initial state: Shadow OFF
    if (shadowToggle) shadowToggle.checked = false;
};
