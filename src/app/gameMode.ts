// 「表情チャンス」ゲーム — AR中にミクの表情が変わった瞬間（ウィンク/びっくり）を狙ってタップするミニゲーム。
// setupExpressions.ts の表情発火をチャンスとして受け取り、setupWebXR.ts のタップ経路から判定を横取りする。
// スコア/コンボはモジュール内で完結させ、共有 AppState (state.ts) は汚さない。

const HIGH_SCORE_KEY = "webar-expression-chance-highscore";

type Rating = "PERFECT" | "GOOD" | "OK";

interface GameState {
    active: boolean;
    ready: boolean;             // モデル配置済み＝チャンスを開いてよい状態か
    chanceOpen: boolean;
    chanceStartedAt: number;
    chanceWindowMs: number;
    score: number;
    combo: number;
    highScore: number;
}

const state: GameState = {
    active: false,
    ready: false,
    chanceOpen: false,
    chanceStartedAt: 0,
    chanceWindowMs: 0,
    score: 0,
    combo: 0,
    highScore: 0,
};

// チャンス失効直後の「遅れタップ」を再配置に流さず吸収するための猶予期限（performance.now()基準）
const MISS_GRACE_MS = 400;
let missGraceUntil = 0;

let canvasRef: HTMLCanvasElement | null = null;
let chanceTimer: number | null = null;
let photoCooldown = false;

const els = {
    hud: null as HTMLElement | null,
    hudScore: null as HTMLElement | null,
    hudCombo: null as HTMLElement | null,
    hudHighScore: null as HTMLElement | null,
    ring: null as HTMLElement | null,
    flash: null as HTMLElement | null,
    ratingPopup: null as HTMLElement | null,
    photoStack: null as HTMLElement | null,
};

export const initGameMode = (canvas: HTMLCanvasElement): void => {
    canvasRef = canvas;
    els.hud = document.getElementById("game-hud");
    els.hudScore = document.getElementById("hud-score");
    els.hudCombo = document.getElementById("hud-combo");
    els.hudHighScore = document.getElementById("hud-highscore");
    els.ring = document.getElementById("chance-ring");
    els.flash = document.getElementById("game-flash");
    els.ratingPopup = document.getElementById("rating-popup");
    els.photoStack = document.getElementById("game-photo-stack");

    state.highScore = Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0;
    updateHud();
};

export const isGameActive = (): boolean => state.active;

// AR入退室と連動。入室のたびにスコア/コンボをリセットして新ラウンドとして扱う（ハイスコアのみ保持）
export const setGameActive = (active: boolean): void => {
    state.active = active;
    state.ready = false; // モデルが配置されるまでチャンスは開かない
    missGraceUntil = 0;
    closeChanceWindow(false);
    if (active) {
        state.score = 0;
        state.combo = 0;
        if (els.photoStack) els.photoStack.innerHTML = "";
    }
    els.hud?.classList.toggle("hidden", !active);
    updateHud();
};

// setupWebXR.ts の配置処理から呼ばれる：モデル配置後にのみチャンスを許可する
export const setChanceReady = (ready: boolean): void => {
    state.ready = ready;
    if (!ready) closeChanceWindow(false);
};

// main.ts の swapModel から呼ばれる：キャラ切替で表示モデルが変わる瞬間、
// 旧モデルの表情が開いた進行中チャンスを無効化する（ready状態自体は維持し、新モデルの表情ですぐ再開できるようにする）
export const cancelActiveChance = (): void => {
    closeChanceWindow(false);
};

// setupExpressions.ts の onChanceExpression から呼ばれる：チャンスウィンドウを開く
export const openChanceWindow = (_name: string, windowMs: number): void => {
    if (!state.active || !state.ready) return;
    state.chanceOpen = true;
    state.chanceStartedAt = performance.now();
    state.chanceWindowMs = windowMs;

    els.ring?.classList.remove("hidden");
    els.ring?.classList.add("pulsing");

    clearChanceTimer();
    chanceTimer = window.setTimeout(() => closeChanceWindow(true), windowMs);
};

// setupWebXR.ts の onTap から呼ばれる。チャンス中なら処理してtrueを返し、
// そうでなければ何もせずfalseを返す（呼び出し元は従来のhandleTapPlaceにフォールスルーする）
export const tryConsumeTap = (): boolean => {
    if (!state.active) return false;

    if (!state.chanceOpen) {
        // 失効直後の遅れタップは「MISS」として吸収する（再配置に流れてモデルが飛ぶ誤操作を防ぐ）
        if (performance.now() < missGraceUntil) {
            showMissPopup();
            return true;
        }
        return false;
    }

    const elapsed = performance.now() - state.chanceStartedAt;
    const windowMs = state.chanceWindowMs;
    closeChanceWindow(false);
    registerHit(rateHit(elapsed, windowMs));
    return true;
};

const clearChanceTimer = (): void => {
    if (chanceTimer !== null) {
        window.clearTimeout(chanceTimer);
        chanceTimer = null;
    }
};

// missed=true: タイムアウトによる自動クローズ（コンボをリセット）。false: タップ成功による正常クローズ
const closeChanceWindow = (missed: boolean): void => {
    state.chanceOpen = false;
    clearChanceTimer();
    els.ring?.classList.remove("pulsing");
    els.ring?.classList.add("hidden");
    if (missed) {
        missGraceUntil = performance.now() + MISS_GRACE_MS;
        state.combo = 0;
        updateHud();
    }
};

const rateHit = (elapsedMs: number, windowMs: number): Rating => {
    const ratio = elapsedMs / windowMs;
    if (ratio < 0.35) return "PERFECT";
    if (ratio < 0.7) return "GOOD";
    return "OK";
};

const RATING_SCORE: Record<Rating, number> = { PERFECT: 300, GOOD: 150, OK: 80 };
const RATING_LABEL: Record<Rating, string> = {
    PERFECT: "✨ PERFECT! ✨",
    GOOD: "GOOD!",
    OK: "OK!",
};

const registerHit = (rating: Rating): void => {
    state.combo += 1;
    state.score += RATING_SCORE[rating] + state.combo * 10;
    if (state.score > state.highScore) {
        state.highScore = state.score;
        localStorage.setItem(HIGH_SCORE_KEY, String(state.highScore));
    }
    updateHud();
    triggerFlash();
    playShutterSound();
    showRatingPopup(rating);
    void capturePolaroid(rating);
};

const updateHud = (): void => {
    if (els.hudScore) els.hudScore.textContent = `SCORE ${state.score}`;
    if (els.hudCombo) els.hudCombo.textContent = `COMBO ${state.combo}`;
    if (els.hudHighScore) els.hudHighScore.textContent = `HI ${state.highScore}`;
};

const triggerFlash = (): void => {
    els.flash?.classList.add("active");
    window.setTimeout(() => els.flash?.classList.remove("active"), 400);
};

const showRatingPopup = (rating: Rating): void => {
    const el = els.ratingPopup;
    if (!el) return;
    el.textContent = RATING_LABEL[rating];
    el.classList.remove("hidden", "pop", "miss");
    void el.offsetWidth; // reflowでアニメーションを再始動させる
    el.classList.add("pop");
    window.setTimeout(() => el.classList.add("hidden"), 650);
};

// 遅れタップへのフィードバック（マゼンタで「惜しい」を明示。スコア変動はない）
const showMissPopup = (): void => {
    const el = els.ratingPopup;
    if (!el) return;
    el.textContent = "MISS…";
    el.classList.remove("hidden", "pop");
    void el.offsetWidth;
    el.classList.add("pop", "miss");
    window.setTimeout(() => el.classList.add("hidden"), 650);
};

// シャッター音をWeb Audio APIで合成（外部音源不使用。shutter-chance/src/shutterSystem.tsから移植）
const playShutterSound = (): void => {
    try {
        const ctx = new AudioContext();
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.02));
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.onended = () => { ctx.close().catch(() => {}); };
        src.start();
    } catch (e) {
        console.warn("Shutter sound failed:", e);
    }
};

const capturePolaroid = async (rating: Rating): Promise<void> => {
    if (photoCooldown || !canvasRef) return;
    photoCooldown = true;
    window.setTimeout(() => { photoCooldown = false; }, 1500);

    // フラッシュの白さと重なるよう少し遅延してからキャプチャ（shutterSystem.tsのタイミングを踏襲）
    await new Promise<void>((resolve) => window.setTimeout(resolve, 80));
    const dataUrl = await captureCanvas();
    if (dataUrl) addPolaroidToStack(dataUrl, rating);
};

// Babylon.js の canvas を PNG としてキャプチャし、軽い透かしを合成する（shutterSystem.tsのcaptureCanvasを移植・簡略化）
const captureCanvas = (): Promise<string | null> => {
    return new Promise((resolve) => {
        if (!canvasRef) { resolve(null); return; }
        try {
            const rawDataUrl = canvasRef.toDataURL("image/png");
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                if (!ctx) { resolve(rawDataUrl); return; }
                ctx.drawImage(img, 0, 0);

                const padding = Math.max(10, Math.floor(img.width * 0.02));
                const fontSize = Math.max(9, Math.floor(img.height * 0.02));
                ctx.font = `${fontSize}px 'Orbitron', 'Noto Sans JP', sans-serif`;
                ctx.fillStyle = "rgba(103, 232, 249, 0.9)";
                ctx.textAlign = "right";
                ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
                ctx.shadowBlur = 6;
                ctx.shadowOffsetX = 1;
                ctx.shadowOffsetY = 1;
                ctx.fillText("MMD WebAR ✨ 表情チャンス", img.width - padding, img.height - padding);

                resolve(canvas.toDataURL("image/png"));
            };
            img.onerror = () => resolve(rawDataUrl);
            img.src = rawDataUrl;
        } catch (e) {
            console.warn("Canvas capture failed:", e);
            resolve(null);
        }
    });
};

// ポラロイド風画像をスタックに追加（shutterSystem.tsのaddPolaroidToStackを移植・簡略化）
const addPolaroidToStack = (dataUrl: string, rating: Rating): void => {
    const stack = els.photoStack;
    if (!stack) return;

    const polaroid = document.createElement("div");
    polaroid.className = "polaroid";
    polaroid.style.transform = `rotate(${(Math.random() - 0.5) * 12}deg)`;

    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = "Chance shot";

    const caption = document.createElement("div");
    caption.className = "polaroid-caption";
    caption.textContent = RATING_LABEL[rating];

    polaroid.appendChild(img);
    polaroid.appendChild(caption);
    stack.insertBefore(polaroid, stack.firstChild);

    // 表示上意味のある枚数だけ残し、それ以外はDOMごと破棄する（長時間セッションでのメモリ肥大化を防ぐ）
    while (stack.children.length > 5) {
        stack.lastChild?.remove();
    }
};
