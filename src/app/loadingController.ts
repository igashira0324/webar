import { appState } from "./state";

const loadingScreen = document.getElementById("loading-screen");
const loadingStatus = document.getElementById("loading-status");

export const showLoading = (text?: string) => {
    if (loadingScreen) {
        loadingScreen.style.opacity = "1";
        loadingScreen.classList.remove("hidden");
    }
    if (loadingStatus && text) {
        loadingStatus.textContent = text;
    }
};

export const hideLoading = () => {
    if (loadingScreen) {
        loadingScreen.style.opacity = "0";
        setTimeout(() => loadingScreen.classList.add("hidden"), 500);
    }
};

export const updateLoadingProgress = (pct: number) => {
    appState.loadingProgress = pct;
    if (loadingStatus) {
        loadingStatus.textContent = `${pct}%`;
    }
};

// 一時的なエラートースト（読み込み失敗時などにユーザーへ通知）
let errorToast: HTMLDivElement | null = null;
let errorTimer: any = null;
export const showError = (message: string) => {
    if (!errorToast) {
        errorToast = document.createElement("div");
        errorToast.id = "error-toast";
        errorToast.style.cssText =
            "position:fixed;left:50%;bottom:32px;transform:translateX(-50%);max-width:88%;" +
            "background:rgba(255,0,80,0.92);color:#fff;padding:12px 18px;border-radius:12px;" +
            "font-size:0.9rem;line-height:1.5;z-index:20000;box-shadow:0 6px 24px rgba(0,0,0,0.4);" +
            "text-align:center;transition:opacity .3s;pointer-events:none;";
        document.body.appendChild(errorToast);
    }
    errorToast.textContent = message;
    errorToast.style.opacity = "1";
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => { if (errorToast) errorToast.style.opacity = "0"; }, 4500);
};

// 致命的エラー：ローディング画面をエラー表示のまま残す（暗い画面のまま放置しない）
export const showFatalError = (message: string) => {
    if (loadingScreen) {
        loadingScreen.style.opacity = "1";
        loadingScreen.classList.remove("hidden");
    }
    const lt = document.querySelector("#loading-screen .loading-text");
    if (lt) lt.textContent = "ERROR";
    if (loadingStatus) loadingStatus.textContent = message;
};
