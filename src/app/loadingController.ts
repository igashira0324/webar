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
