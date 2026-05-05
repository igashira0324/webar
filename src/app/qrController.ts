import { QrCode, Ecc } from '../utils/qrcodegen';

/**
 * デザイン性の高いQRコードをキャンバスに描画する
 * @param canvas 描画対象のキャンバス
 * @param text QRコードの内容
 */
export async function generateCoolQRCode(canvas: HTMLCanvasElement, text: string) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width;
    const qr = QrCode.encodeText(text, Ecc.HIGH); // アイコンを置くため誤差訂正はHIGH
    
    const margin = 2; // QRモジュール単位の余白
    const modulesCount = qr.size + margin * 2;
    const moduleSize = size / modulesCount;

    // 背景塗りつぶし (白)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, size, size);

    // グラデーションの作成 (初音ミクカラー)
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, '#00e5ff'); // primary
    gradient.addColorStop(1, '#ff00aa'); // secondary

    // モジュールの描画
    ctx.fillStyle = gradient;
    for (let y = 0; y < qr.size; y++) {
        for (let x = 0; x < qr.size; x++) {
            if (qr.getModule(x, y)) {
                // 角丸ドット風のデザイン
                const dx = (x + margin) * moduleSize;
                const dy = (y + margin) * moduleSize;
                
                // アイコンが置かれる中央付近は描画をスキップ (excavate)
                // 読み取り精度を上げるため、スキップ範囲を最小限に抑える
                const centerLimit = 3; 
                const centerX = Math.floor(qr.size / 2);
                const centerY = Math.floor(qr.size / 2);
                if (x >= centerX - centerLimit && x <= centerX + centerLimit &&
                    y >= centerY - centerLimit && y <= centerY + centerLimit) {
                    continue;
                }

                // 通常のモジュール描画
                ctx.beginPath();
                ctx.roundRect(dx + 0.5, dy + 0.5, moduleSize - 1, moduleSize - 1, moduleSize / 4);
                ctx.fill();
            }
        }
    }

    // 中央にアイコンを描画
    const icon = new Image();
    icon.src = 'assets/chibi_01.png';
    icon.onload = () => {
        const iconSize = size * 0.22; // 19%から22%へ拡大
        const ix = (size - iconSize) / 2;
        const iy = (size - iconSize) / 2;

        // アイコン描画（背景の白抜きを削除し、透過を活かす）
        ctx.drawImage(icon, ix, iy, iconSize, iconSize);
    };
}
