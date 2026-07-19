import { WebXRState } from "@babylonjs/core";
import { appState } from "./state";
import { generateCoolQRCode } from "./qrController";

// 展示・もくもく会等で他の人に読み取ってもらうための固定公開URL
// （window.location.href だとローカル/LAN IPで開いた場合にそのURLを埋め込んでしまうため固定する）
const SHARE_URL = "https://webar-git-feature-shutter-chance-igashira0324s-projects.vercel.app/";

export const openModal = (id: string) => {
    const el = document.getElementById(id);
    el?.classList.remove("hidden");
};

export const closeModal = (id: string) => {
    document.getElementById(id)?.classList.add("hidden");
};

const bindBackdrop = (id: string) => {
    const m = document.getElementById(id);
    m?.addEventListener("click", (e) => {
        if (e.target === m) closeModal(id);
    });
};

export const setupModals = () => {
    const infoFab = document.getElementById("infoFab");
    const musicFab = document.getElementById("musicFab");
    const characterFab = document.getElementById("characterFab");
    const qrFab = document.getElementById("qrFab");

    // エラー種別ごとに分かりやすい案内文へ変換する。
    // 注意: requestSession は1回失敗するとタップ由来の「ユーザー操作権」を消費するため、
    // コード側での自動リトライは必ず SecurityError になる。再試行は必ずユーザーの再タップに委ねる
    const arErrorText = (e: any): string => {
        if (e?.name === "SecurityError") {
            return "ブラウザの操作制限により起動できませんでした。もう一度「ENTER AR」をタップしてください。";
        }
        if (e?.name === "InvalidStateError") {
            return "前回のARセッションの終了処理が完了していません。数秒待ってからもう一度タップしてください。";
        }
        if (e?.message) return `${e.name ?? "Error"}: ${e.message}`;
        return "お使いの端末が WebXR に対応していないか、許可が拒否されました。";
    };

    const showArError = (e: any) => {
        const titleEl = document.getElementById("ar-error-title");
        const msgEl = document.getElementById("ar-error-msg");
        if (titleEl) titleEl.textContent = "AR 起動に失敗しました";
        if (msgEl) msgEl.textContent = arErrorText(e);
        openModal("ar-unavailable-modal");
    };

    document.getElementById("arLaunchBtn")?.addEventListener("click", async () => {
        const xr = appState.xrHelper;
        if (!xr || !xr.baseExperience) {
            const errEl = document.getElementById("ar-error-title");
            if (errEl) errEl.textContent = "準備中です";
            openModal("ar-unavailable-modal");
            return;
        }
        try {
            // 前回セッションの終了処理が残っている場合のみ、完了を待ってから入る
            if (xr.baseExperience.state !== WebXRState.NOT_IN_XR) {
                try { await xr.baseExperience.exitXRAsync(); } catch (e) { /* 既に終了済みなら無視 */ }
                await new Promise((r) => setTimeout(r, 300));
            }
            await xr.baseExperience.enterXRAsync("immersive-ar", "local-floor", xr.renderTarget);
        } catch (e: any) {
            console.error("AR起動失敗:", e);
            showArError(e);
        }
    });

    infoFab?.addEventListener("click", () => openModal("info-modal"));
    document.getElementById("closeInfoBtn")?.addEventListener("click", () => closeModal("info-modal"));
    
    musicFab?.addEventListener("click", () => openModal("music-modal"));
    document.getElementById("closeMusicBtn")?.addEventListener("click", () => closeModal("music-modal"));

    characterFab?.addEventListener("click", () => openModal("character-modal"));
    document.getElementById("closeCharacterBtn")?.addEventListener("click", () => closeModal("character-modal"));

    qrFab?.addEventListener("click", () => {
        openModal("qr-modal");
        const canvas = document.getElementById("qr-canvas") as HTMLCanvasElement;
        if (canvas) {
            generateCoolQRCode(canvas, SHARE_URL);
        }
    });
    document.getElementById("closeQrBtn")?.addEventListener("click", () => closeModal("qr-modal"));
    
    document.getElementById("closeArUnavailableBtn")?.addEventListener("click", () => closeModal("ar-unavailable-modal"));
    
    bindBackdrop("info-modal");
    bindBackdrop("music-modal");
    bindBackdrop("character-modal");
    bindBackdrop("qr-modal");
    bindBackdrop("ar-unavailable-modal");
};
