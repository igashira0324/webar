/**
 * shutterSystem.ts
 * サビ判定・ビューファインダー演出・シャッター撮影・ポラロイドスタック管理
 */

export type ShutterPhoto = {
  dataUrl: string;
  timestamp: number;
  lyric: string;
  rating?: string; // タイミング評価 (PERFECT, SPARK, BEAT, CAPTURED)
};

export class ShutterSystem {
  private flashEl: HTMLElement;
  private photoStackEl: HTMLElement;
  private photos: ShutterPhoto[] = [];
  private babylonCanvas: HTMLCanvasElement;

  // サビ演出の状態管理
  private lastChorusStart = -1;
  private shutterCooldown = false; // 連続撮影防止

  // ユーザー手動撮影（サビ中タップ/スペース）
  private onManualShutter: (() => void) | null = null;
  private onPhotoCaptured: ((photo: ShutterPhoto) => void) | null = null;

  constructor(
    flashId: string,
    photoStackId: string,
    canvas: HTMLCanvasElement
  ) {
    this.flashEl = document.getElementById(flashId)!;
    this.photoStackEl = document.getElementById(photoStackId)!;
    this.babylonCanvas = canvas;
    // 撮影は専用ボタン（#freeze-shoot-btn）経由でのみ発動するため、トリガーリスナーは main.ts 側で管理する
  }

  setManualShutterCallback(cb: () => void): void {
    this.onManualShutter = cb;
  }

  setOnPhotoCapturedCallback(cb: (photo: ShutterPhoto) => void): void {
    this.onPhotoCaptured = cb;
  }

  private triggerManualShutter(): void {
    if (this.onManualShutter && !this.shutterCooldown) {
      this.onManualShutter();
    }
  }

  /**
   * TextAliveのonTimeUpdateから毎フレーム呼ばれる。
   * position: 現在再生位置(ms)
   * isInChorus: 現在サビ区間内か
   * currentChorusStart: 現在のサビ開始時刻(ms)。サビ外なら -1
   * nextChorusStart: 次のサビ開始時刻(ms)（未使用：将来の拡張用に残す）
   * currentLyric: 現在表示中の歌詞テキスト
   */
  update(
    position: number,
    isInChorus: boolean,
    currentChorusStart: number,
    _nextChorusStart: number,
    _currentLyric: string
  ): void {
    // シークやループ等で時間が巻き戻った場合は判定用キーをリセット
    if (position < this.lastChorusStart) {
      this.lastChorusStart = -1;
    }

    // サビ中: lastChorusStart を更新して状態を管理（撮影はボタン経由のみ）
    if (isInChorus && currentChorusStart !== -1) {
      if (currentChorusStart !== this.lastChorusStart) {
        this.lastChorusStart = currentChorusStart;
      }
    }
  }


  /** シャッターを切る：フラッシュ → Canvas合成 → ポラロイド生成（記念コレクション用） */
  async shoot(currentLyric: string, rating?: string): Promise<void> {
    if (this.shutterCooldown) return;
    this.shutterCooldown = true;

    // ① フラッシュ演出
    this.triggerFlash();

    // ② シャッター音（Web Audio API で簡易合成）
    this.playShutterSound();

    // ③ Canvasキャプチャ & ポラロイド生成（少し遅延してフラッシュと重ねる）
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    const dataUrl = this.captureCanvas();
    if (dataUrl) {
      const photo: ShutterPhoto = {
        dataUrl,
        timestamp: Date.now(),
        lyric: currentLyric,
        rating,
      };
      this.photos.push(photo);
      this.addPolaroidToStack(photo);

      // コールバック通知
      if (this.onPhotoCaptured) {
        this.onPhotoCaptured(photo);
      }
    }

    // ④ クールダウン（2秒）
    setTimeout(() => {
      this.shutterCooldown = false;
    }, 2000);
  }

  /** ホワイトフラッシュアニメーション */
  private triggerFlash(): void {
    this.flashEl.classList.add("active");
    setTimeout(() => this.flashEl.classList.remove("active"), 400);
  }

  /** シャッター音をWeb Audio APIで合成 */
  private playShutterSound(): void {
    try {
      const ctx = new AudioContext();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
      const data = buf.getChannelData(0);
      // クリック音 → フェードアウト
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.02));
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
    } catch (e) {
      console.warn("Shutter sound failed:", e);
    }
  }

  /** Babylon.js の canvas を PNG としてキャプチャ */
  private captureCanvas(): string | null {
    try {
      return this.babylonCanvas.toDataURL("image/png");
    } catch (e) {
      console.warn("Canvas capture failed:", e);
      return null;
    }
  }

  /** ポラロイド風画像をスタックに追加 */
  private addPolaroidToStack(photo: ShutterPhoto): void {
    const polaroid = document.createElement("div");
    polaroid.className = "polaroid";

    // ランダムな傾き
    const angle = (Math.random() - 0.5) * 12;
    polaroid.style.transform = `rotate(${angle}deg)`;

    const img = document.createElement("img");
    img.src = photo.dataUrl;
    img.alt = "Shutter moment";

    const caption = document.createElement("div");
    caption.className = "polaroid-caption";
    
    // 評価テキストの成形
    let ratingStr = "";
    if (photo.rating === "PERFECT") ratingStr = "✨ PERFECT SHOT! ✨\n";
    else if (photo.rating === "SPARK") ratingStr = "⚡ SPARK BONUS ⚡\n";
    else if (photo.rating === "BEAT") ratingStr = "🎵 BEAT BONUS 🎵\n";
    
    caption.innerText = `${ratingStr}${photo.lyric || "♪"}\n\n© 夜未アガリ / Piapro`;

    polaroid.appendChild(img);
    polaroid.appendChild(caption);

    // 新しい写真は一番上に
    this.photoStackEl.insertBefore(polaroid, this.photoStackEl.firstChild);

    // 枚数が多すぎたら古いものをフェードアウト（メモリ節約）
    if (this.photoStackEl.children.length > 5) {
      const last = this.photoStackEl.lastChild;
      if (last) (last as HTMLElement).style.opacity = "0.3";
    }
  }

  /** 全写真を返す（ギャラリー表示用）*/
  getPhotos(): ShutterPhoto[] {
    return [...this.photos];
  }

  /** ギャラリーモーダルに写真を展開（思い出コレクション表示） */
  showGallery(galleryGridId: string): void {
    const grid = document.getElementById(galleryGridId);
    if (!grid) return;
    grid.innerHTML = "";
    this.photos.forEach((photo, i) => {
      const item = document.createElement("div");
      item.className = "gallery-item";

      const img = document.createElement("img");
      img.src = photo.dataUrl;
      img.alt = `Shot ${i + 1}`;

      const saveBtn = document.createElement("a");
      saveBtn.className = "save-btn";
      saveBtn.href = photo.dataUrl;
      saveBtn.download = `lyric-spark-${i + 1}.png`;
      saveBtn.textContent = "💾 保存";

      const cap = document.createElement("div");
      cap.className = "gallery-caption";
      
      let ratingStr = "";
      if (photo.rating === "PERFECT") ratingStr = "[PERFECT] ";
      else if (photo.rating === "SPARK") ratingStr = "[SPARK] ";
      else if (photo.rating === "BEAT") ratingStr = "[BEAT] ";
      
      cap.innerText = `${ratingStr}${photo.lyric || "♪"}\n© 夜未アガリ / Piapro`;

      item.appendChild(img);
      item.appendChild(cap);
      item.appendChild(saveBtn);
      grid.appendChild(item);
    });
  }
}
