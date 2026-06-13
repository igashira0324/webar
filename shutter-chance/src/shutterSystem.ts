/**
 * shutterSystem.ts
 * サビ判定・ビューファインダー演出・シャッター撮影・ポラロイドスタック管理
 */

export type ShutterPhoto = {
  dataUrl: string;
  timestamp: number;
  lyric: string;
  // rating は廃止 — コレクション型のため判定なし
};

export class ShutterSystem {
  private viewfinderEl: HTMLElement;
  private flashEl: HTMLElement;
  private photoStackEl: HTMLElement;
  private photos: ShutterPhoto[] = [];
  private babylonCanvas: HTMLCanvasElement;

  // サビ演出の状態管理
  private viewfinderVisible = false;
  private lastChorusStart = -1;
  private shutterCooldown = false; // 連続撮影防止

  // ユーザー手動撮影（サビ中タップ/スペース）
  private onManualShutter: (() => void) | null = null;
  private onPhotoCaptured: ((photo: ShutterPhoto) => void) | null = null;

  constructor(
    viewfinderId: string,
    flashId: string,
    photoStackId: string,
    canvas: HTMLCanvasElement
  ) {
    this.viewfinderEl = document.getElementById(viewfinderId)!;
    this.flashEl = document.getElementById(flashId)!;
    this.photoStackEl = document.getElementById(photoStackId)!;
    this.babylonCanvas = canvas;

    // キーボード（スペース）とタップで手動撮影
    document.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !e.repeat) this.triggerManualShutter();
    });
    document.addEventListener("pointerup", (e) => {
      const target = e.target as HTMLElement;
      if (
        target.closest("#controls") ||
        target.closest(".ctrl-btn") ||
        target.closest("#mode-select") ||
        target.closest("#gallery-modal") ||
        target.closest("#credits-modal")
      ) {
        return;
      }
      this.triggerManualShutter();
    });
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
   * nextChorusStart: 次のサビ開始時刻(ms)
   * currentLyric: 現在表示中の歌詞テキスト
   */
  update(
    position: number,
    isInChorus: boolean,
    currentChorusStart: number,
    nextChorusStart: number,
    currentLyric: string
  ): void {
    // シークやループ等で時間が巻き戻った場合は判定用キーをリセット
    if (position < this.lastChorusStart) {
      this.lastChorusStart = -1;
    }

    const timeToChorus = nextChorusStart - position;

    // サビ3秒前: ビューファインダー表示
    if (timeToChorus > 0 && timeToChorus <= 3000 && !this.viewfinderVisible) {
      this.showViewfinder();
    }

    // サビ中: 自動撮影は廃止。ビューファインダー枠の表示のみ行う。
    // 撮影はプレイヤーのタップ/スペースキーのみで発生する（スコアを操作と直結させるため）
    if (isInChorus && currentChorusStart !== -1) {
      // 新しいサビに入ったときにだけ lastChorusStart を更新（状態管理のため残す）
      if (currentChorusStart !== this.lastChorusStart) {
        this.lastChorusStart = currentChorusStart;
      }
      // ビューファインダー枠はサビ中も表示し続ける（「チャンス区間」の視覚的提示）
    } else if (!isInChorus) {
      // サビ外でビューファインダーを非表示
      if (this.viewfinderVisible) {
        this.hideViewfinder();
      }
    }
  }

  /** ビューファインダーフレームをフェードイン表示 */
  private showViewfinder(): void {
    this.viewfinderVisible = true;
    this.viewfinderEl.classList.add("visible");
    // AFロック演出（段階的に色が変わる）
    setTimeout(() => this.viewfinderEl.classList.add("locked"), 1500);
  }

  /** ビューファインダーを非表示 */
  private hideViewfinder(): void {
    this.viewfinderVisible = false;
    this.viewfinderEl.classList.remove("visible", "locked");
  }

  /** シャッターを切る：フラッシュ → Canvas合成 → ポラロイド生成（記念コレクション用） */
  async shoot(currentLyric: string): Promise<void> {
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
        // rating なし — 思い出コレクションとして保存
      };
      this.photos.push(photo);
      this.addPolaroidToStack(photo);

      // コールバック通知
      if (this.onPhotoCaptured) {
        this.onPhotoCaptured(photo);
      }
    }

    // ④ ビューファインダーを閉じる
    this.hideViewfinder();

    // ⑤ クールダウン（2秒）
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
    caption.textContent = photo.lyric || "♪";

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
      cap.textContent = photo.lyric || "♪";

      item.appendChild(img);
      item.appendChild(cap);
      item.appendChild(saveBtn);
      grid.appendChild(item);
    });
  }
}
