// AR画面の写真撮影。
// WebXR (immersive-ar) ではカメラ映像はOS側で合成され、3D描画もXR専用フレームバッファへ
// 行われるため、canvas.toDataURL() ではどちらも写らない。そこでXRフレーム内で
//  (1) camera-access のカメラ画像テクスチャ (2) XRフレームバッファの3D描画（背景透明）
// をそれぞれ readPixels で取り出して合成し、保存できる写真を生成する。
// camera-access 未対応端末・権限拒否時は 3D描画のみ（暗背景）で保存する。
import { Scene } from "@babylonjs/core";
import { appState } from "./state";
import { playShutterSound } from "./gameMode";

let captureRequested = false;
let initialized = false;

export const requestArPhoto = (): void => {
    captureRequested = true;
};

export const setupArPhoto = (scene: Scene): void => {
    if (initialized) return;
    initialized = true;
    scene.onAfterRenderObservable.add(() => {
        if (!captureRequested) return;
        captureRequested = false;
        const sm = appState.xrHelper?.baseExperience.sessionManager as any;
        if (!sm?.session || !sm.currentFrame) return; // XRセッション中のみ有効
        try {
            capture(scene, sm);
        } catch (e) {
            console.warn("AR写真の撮影に失敗:", e);
        }
    });
};

// readPixels は左下原点なので行を上下反転する
const flipRows = (src: Uint8Array, w: number, h: number): Uint8ClampedArray<ArrayBuffer> => {
    const dst = new Uint8ClampedArray(src.length);
    const row = w * 4;
    for (let y = 0; y < h; y++) {
        dst.set(src.subarray(y * row, (y + 1) * row), (h - 1 - y) * row);
    }
    return dst;
};

const pixelsToCanvas = (pixels: Uint8Array, w: number, h: number): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.putImageData(new ImageData(flipRows(pixels, w, h), w, h), 0, 0);
    return canvas;
};

// XRフレームバッファ（3D描画結果、背景は透明）を読み出す
const readXrFramebuffer = (gl: WebGL2RenderingContext, session: any): HTMLCanvasElement | null => {
    const layer = session.renderState?.baseLayer;
    if (!layer) return null;
    const w = layer.framebufferWidth;
    const h = layer.framebufferHeight;
    const pixels = new Uint8Array(w * h * 4);
    const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
    return pixelsToCanvas(pixels, w, h);
};

// camera-access のカメラ画像テクスチャを読み出す（未対応端末・権限なしでは null）
const readCameraImage = (gl: WebGL2RenderingContext, sm: any): HTMLCanvasElement | null => {
    const view = sm.currentFrame.getViewerPose?.(sm.referenceSpace)?.views?.[0] as any;
    const cam = view?.camera;
    const Binding = (window as any).XRWebGLBinding;
    if (!cam || !Binding) return null;
    const tex = new Binding(sm.session, gl).getCameraImage(cam);
    if (!tex) return null;

    const fbo = gl.createFramebuffer();
    const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let canvas: HTMLCanvasElement | null = null;
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        const pixels = new Uint8Array(cam.width * cam.height * 4);
        gl.readPixels(0, 0, cam.width, cam.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        canvas = pixelsToCanvas(pixels, cam.width, cam.height);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
    gl.deleteFramebuffer(fbo);
    return canvas;
};

// アスペクト比を保ったまま全面を覆うように描画する
const drawCover = (ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, w: number, h: number): void => {
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
};

const capture = (scene: Scene, sm: any): void => {
    const gl = (scene.getEngine() as any)._gl as WebGL2RenderingContext;
    const content = readXrFramebuffer(gl, sm.session);
    if (!content) return;

    let camera: HTMLCanvasElement | null = null;
    try {
        camera = readCameraImage(gl, sm);
    } catch (e) {
        console.warn("カメラ画像の取得に失敗（3Dのみで保存します）:", e);
    }

    const out = document.createElement("canvas");
    out.width = content.width;
    out.height = content.height;
    const ctx = out.getContext("2d")!;
    if (camera) {
        drawCover(ctx, camera, out.width, out.height);
    } else {
        ctx.fillStyle = "#0a0a2a";
        ctx.fillRect(0, 0, out.width, out.height);
    }
    ctx.drawImage(content, 0, 0);

    triggerPhotoFlash();
    playShutterSound();
    showPhotoPreview(out.toDataURL("image/jpeg", 0.92));
};

const triggerPhotoFlash = (): void => {
    const flash = document.getElementById("game-flash");
    flash?.classList.add("active");
    window.setTimeout(() => flash?.classList.remove("active"), 400);
};

// 撮影結果のプレビュー（保存/閉じる）。AR DOM Overlay内に都度生成する
const showPhotoPreview = (dataUrl: string): void => {
    document.getElementById("ar-photo-preview")?.remove();
    const overlay = document.getElementById("ar-overlay");
    if (!overlay) return;

    const panel = document.createElement("div");
    panel.id = "ar-photo-preview";
    panel.style.cssText =
        "position:absolute;inset:0;z-index:300;background:rgba(0,0,0,0.82);" +
        "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
        "gap:14px;pointer-events:auto;";
    for (const t of ["touchstart", "touchend", "touchmove"]) {
        panel.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
    }

    const img = document.createElement("img");
    img.src = dataUrl;
    img.style.cssText = "max-width:86%;max-height:70%;border-radius:8px;box-shadow:0 0 30px rgba(0,229,255,0.4);";

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:12px;";
    const btnStyle =
        "padding:12px 24px;border:1px solid rgba(0,229,255,0.5);border-radius:24px;" +
        "background:rgba(0,0,0,0.6);color:#fff;font-size:1rem;font-weight:600;text-decoration:none;";

    const save = document.createElement("a");
    save.href = dataUrl;
    save.download = `miku-ar-${Date.now()}.jpg`;
    save.textContent = "💾 保存";
    save.style.cssText = btnStyle;

    const close = document.createElement("button");
    close.textContent = "✕ 閉じる";
    close.style.cssText = btnStyle;
    close.addEventListener("click", (e) => {
        e.stopPropagation();
        panel.remove();
    });

    row.append(save, close);
    panel.append(img, row);
    overlay.appendChild(panel);
};
