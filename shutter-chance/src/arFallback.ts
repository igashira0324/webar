/**
 * arFallback.ts
 * AR非対応環境（PC等）でのフォールバック処理
 * - スタジオモードへ誘導
 * - webar-coral.vercel.app へのQRコード表示
 * - 「フル体験はAndroidで」バナー
 */

/** AR 対応かどうかを非同期で判定する */
export async function checkARSupport(): Promise<boolean> {
  if (!navigator.xr) return false;
  try {
    return await navigator.xr.isSessionSupported("immersive-ar");
  } catch {
    return false;
  }
}

/** ARバナーと誘導QRコードをセットアップする（AR非対応時に呼ぶ） */
export function setupFallbackBanner(bannerId: string, arUrl: string): void {
  const banner = document.getElementById(bannerId);
  if (!banner) return;

  banner.innerHTML = `
    <div class="fallback-inner">
      <span class="fallback-icon">📱</span>
      <div class="fallback-text">
        <strong>フル体験は Android (ARCore) で！</strong><br>
        スマートフォンでスキャンするとAR撮影モードが有効になります
      </div>
      <div class="fallback-qr" id="fallback-qr-canvas"></div>
    </div>
  `;
  banner.classList.add("visible");

  // QRコードを動的生成（qrcode npm パッケージを使用）
  _generateQR("fallback-qr-canvas", arUrl);
}

/** AR対応端末向けの特別メッセージを表示する */
export function showARCapableMessage(containerId: string): void {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<span class="ar-badge">✨ この端末はAR撮影に対応しています</span>`;
}

/** QRコードを canvas に描画する */
async function _generateQR(canvasId: string, url: string): Promise<void> {
  try {
    // qrcode パッケージをダイナミックインポートで読み込む
    const QRCode = (await import("qrcode")).default;
    const canvas = document.createElement("canvas");
    canvas.id = canvasId + "-img";
    canvas.style.borderRadius = "8px";
    await QRCode.toCanvas(canvas, url, { width: 80, margin: 1 });
    const container = document.getElementById(canvasId);
    if (container) container.appendChild(canvas);
  } catch (e) {
    // qrcode が使えない場合はURLテキストでフォールバック
    const container = document.getElementById(canvasId);
    if (container) {
      container.style.fontSize = "0.55rem";
      container.style.wordBreak = "break-all";
      container.textContent = url;
    }
  }
}
