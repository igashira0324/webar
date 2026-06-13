/**
 * textAliveSync.ts
 * TextAlive App API ラッパー
 * 課題曲「シャッターチャンス」のバージョン固定IDを管理し、
 * beat / chorus / lyric のタイミングをコールバックで提供する。
 */
import { Player, PlayerEventListener } from "textalive-app-api";

// ──────────────────────────────────────────────
// TODO: ここにTextAlive App tokenを設定
// developer.textalive.jp でアカウント作成後に取得してください
// ──────────────────────────────────────────────
const APP_TOKEN = "";

// 楽曲バージョン固定値（変更しないこと）
const SONG_URL = "https://piapro.jp/t/PNpQ/20251209170719";
const VIDEO_CONFIG = {
  beatId: 4827295,
  chordId: 2963756,
  repetitiveSegmentId: 3086263,
  lyricId: 126542,
  lyricDiffId: 28628,
};

export type TextAliveCallbacks = {
  onReady: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onTimeUpdate: (position: number) => void;
  onError: (error: Error) => void;
};

export class TextAliveSync {
  private player: Player | null = null;
  private callbacks: TextAliveCallbacks;
  private _isReady = false;

  constructor(callbacks: TextAliveCallbacks) {
    this.callbacks = callbacks;
  }

  /** TextAlive Player を初期化して楽曲をロードする */
  async init(mediaElement: HTMLElement): Promise<void> {
    const listener: PlayerEventListener = {
      onAppReady: (app) => {
        if (!app.managed) {
          // スタンドアロン動作時に楽曲をロード
          this.player!.createFromSongUrl(SONG_URL, { video: VIDEO_CONFIG });
        }
      },
      onVideoReady: () => {
        console.log("[TextAlive] Video ready, duration:", this.player?.video?.duration);
        this._isReady = true;
        this.callbacks.onReady();
      },
      onPlay: () => this.callbacks.onPlay(),
      onPause: () => this.callbacks.onPause(),
      onStop: () => this.callbacks.onStop(),
      onTimeUpdate: (pos) => this.callbacks.onTimeUpdate(pos),
      onError: (err) => this.callbacks.onError(new Error(String(err))),
    };

    this.player = new Player({
      app: { token: APP_TOKEN },
      mediaElement,
      listener,
    });

    // App tokenが空の場合もローカルで楽曲URLを直接ロードする
    if (!APP_TOKEN) {
      console.warn("[TextAlive] APP_TOKEN is empty. Loading song directly (limited features).");
      try {
        this.player.createFromSongUrl(SONG_URL, { video: VIDEO_CONFIG });
      } catch (e) {
        console.error("[TextAlive] Failed to load song:", e);
      }
    }
  }

  get isReady(): boolean {
    return this._isReady;
  }

  play(): void {
    this.player?.requestPlay();
  }

  pause(): void {
    this.player?.requestPause();
  }

  /** 現在の発声中の単語テキストを返す（なければ null）*/
  getCurrentWord(position: number): string | null {
    if (!this.player?.video) return null;
    const word = this.player.video.findWord(position);
    return word?.text ?? null;
  }

  /** 現在の発声中のフレーズテキストを返す（なければ null）*/
  getCurrentPhrase(position: number): string | null {
    if (!this.player?.video) return null;
    const phrase = this.player.video.findPhrase(position);
    return phrase?.text ?? null;
  }

  /** 現在のビート情報を返す */
  getCurrentBeat(position: number): { startTime: number; duration: number; index: number } | null {
    if (!this.player?.video) return null;
    const beat = this.player.video.findBeat(position);
    if (!beat) return null;
    return {
      startTime: beat.startTime,
      duration: beat.duration,
      index: beat.position, // 小節内の拍番号
    };
  }

  /** 現在サビ区間内かどうかを返す */
  isInChorus(position: number): boolean {
    if (!this.player) return false;
    const choruses = this.player.getChoruses() || [];
    for (const seg of choruses) {
      if (position >= seg.startTime && position <= seg.endTime) {
        return true;
      }
    }
    return false;
  }

  /** 現在のサビの開始時間(ms)を返す。サビ区間外なら -1 */
  getCurrentChorusStart(position: number): number {
    if (!this.player) return -1;
    const choruses = this.player.getChoruses() || [];
    for (const seg of choruses) {
      if (position >= seg.startTime && position <= seg.endTime) {
        return seg.startTime;
      }
    }
    return -1;
  }

  /** 次のサビ開始時刻(ms)を返す。なければ Infinity */
  getNextChorusStart(position: number): number {
    if (!this.player) return Infinity;
    const choruses = this.player.getChoruses() || [];
    let nextStart = Infinity;
    for (const seg of choruses) {
      if (seg.startTime > position && seg.startTime < nextStart) {
        nextStart = seg.startTime;
      }
    }
    return nextStart;
  }

  /** 楽曲の総再生時間(ms)を返す */
  getDuration(): number {
    return this.player?.video?.duration ?? 0;
  }

  getPlayer(): Player | null {
    return this.player;
  }

  dispose(): void {
    this.player?.dispose();
    this.player = null;
  }
}
