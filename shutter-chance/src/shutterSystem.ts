/**
 * shutterSystem.ts
 * サビ判定・ビューファインダー演出・シャッター撮影・ポラロイドスタック管理
 */

export type ShutterPhoto = {
  dataUrl: string;
  timestamp: number;
  songPosition: number; // 楽曲内タイムスタンプ(ms)
  lyric: string;
  rating?: string; // タイミング評価 (PERFECT, SPARK, BEAT, CAPTURED)
};

/** 再生位置(ms)を MM:SS.mmm に整形する */
function formatTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.floor(ms % 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

export class ShutterSystem {
  private flashEl: HTMLElement;
  private photoStackEl: HTMLElement;
  private photos: ShutterPhoto[] = [];
  private babylonCanvas: HTMLCanvasElement;

  // サビ演出の状態管理
  private lastChorusStart = -1;
  private shutterCooldown = false; // 連続撮影防止

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

  setOnPhotoCapturedCallback(cb: (photo: ShutterPhoto) => void): void {
    this.onPhotoCaptured = cb;
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
  async shoot(songPosition: number, currentLyric: string, rating?: string): Promise<void> {
    if (this.shutterCooldown) return;
    this.shutterCooldown = true;

    // ① フラッシュ演出
    this.triggerFlash();

    // ② シャッター音（Web Audio API で簡易合成）
    this.playShutterSound();

    // ③ Canvasキャプチャ & ポラロイド生成（少し遅延してフラッシュと重ねる）
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    const dataUrl = await this.captureCanvas();
    if (dataUrl) {
      const photo: ShutterPhoto = {
        dataUrl,
        timestamp: Date.now(),
        songPosition,
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
      src.onended = () => {
        ctx.close().catch(() => {});
      };
      src.start();
    } catch (e) {
      console.warn("Shutter sound failed:", e);
    }
  }

  /** Babylon.js の canvas を PNG としてキャプチャし、著作権スタンプを合成する */
  private async captureCanvas(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      try {
        const rawDataUrl = this.babylonCanvas.toDataURL("image/png");
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(rawDataUrl);
            return;
          }
          // 元画像を描画
          ctx.drawImage(img, 0, 0);
          
          // 右下に小さくクレジットを描画
          const padding = Math.max(12, Math.floor(img.width * 0.025));
          const fontSize = Math.max(10, Math.floor(img.height * 0.024));
          ctx.font = `${fontSize}px 'Orbitron', 'Noto Sans JP', sans-serif`;
          ctx.fillStyle = "rgba(103, 232, 249, 0.9)"; // シアン
          ctx.textAlign = "right";
          
          // 文字シャドウ
          ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
          ctx.shadowBlur = 6;
          ctx.shadowOffsetX = 1;
          ctx.shadowOffsetY = 1;
          
          const text = "© 夜未アガリ / Piapro | Model: 602e | Motion: つるぺた";
          ctx.fillText(text, img.width - padding, img.height - padding);
          
          resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = () => {
          resolve(rawDataUrl);
        };
        img.src = rawDataUrl;
      } catch (e) {
        console.warn("Canvas watermark drawing failed:", e);
        resolve(null);
      }
    });
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
    
    const timeStr = formatTime(photo.songPosition);
    caption.innerText = `${ratingStr}${timeStr}\n“ ${photo.lyric || "♪"} ”\n\n© 夜未アガリ / Piapro`;

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
      
      let ratingClass = (photo.rating || "captured").toLowerCase();
      let ratingStr = photo.rating || "CAPTURED";
      const timeStr = formatTime(photo.songPosition);
      
      cap.innerHTML = `
        <div style="font-size: 0.7rem; color: var(--dim); margin-bottom: 2px;">[${timeStr}]</div>
        <div style="margin-bottom: 4px;">
          <span class="gallery-rating ${ratingClass}">${ratingStr}</span>
        </div>
      `;

      const lyricDiv = document.createElement("div");
      lyricDiv.style.fontWeight = "bold";
      lyricDiv.style.fontSize = "0.8rem";
      lyricDiv.style.color = "#a5f3fc";
      lyricDiv.style.whiteSpace = "nowrap";
      lyricDiv.style.overflow = "hidden";
      lyricDiv.style.textOverflow = "ellipsis";
      lyricDiv.textContent = `“ ${photo.lyric || "♪"} ”`;
      cap.appendChild(lyricDiv);

      item.appendChild(img);
      item.appendChild(cap);
      item.appendChild(saveBtn);
      grid.appendChild(item);
    });
  }
}
