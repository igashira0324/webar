/**
 * lyricDisplay.ts
 * 歌詞オーバーレイ表示モジュール
 * TextAliveの onTimeUpdate から呼ばれ、発声中の単語/フレーズをDOMに表示する。
 * CSS3アニメーションでボケ→シャープのフォーカス演出を行う。
 */

export class LyricDisplay {
  private wordEl: HTMLElement;
  private phraseEl: HTMLElement;
  private lastWord = "";
  private lastPhrase = "";

  constructor(wordElementId: string, phraseElementId: string) {
    this.wordEl = document.getElementById(wordElementId)!;
    this.phraseEl = document.getElementById(phraseElementId)!;
  }

  /** position(ms) における歌詞状態を更新する */
  update(word: string | null, phrase: string | null): void {
    // ── 単語 ──
    const newWord = word ?? "";
    if (newWord !== this.lastWord) {
      this.lastWord = newWord;
      this.animateText(this.wordEl, newWord);
    }

    // ── フレーズ ──
    const newPhrase = phrase ?? "";
    if (newPhrase !== this.lastPhrase) {
      this.lastPhrase = newPhrase;
      this.animatePhraseText(this.phraseEl, newPhrase);
    }
  }

  /** 単語をボケ→シャープで出現させる */
  private animateText(el: HTMLElement, text: string): void {
    el.classList.remove("lyric-focus");
    el.textContent = text;
    if (text) {
      // 次フレームでクラスを付与してアニメーション開始
      requestAnimationFrame(() => {
        requestAnimationFrame(() => el.classList.add("lyric-focus"));
      });
    }
  }

  /** フレーズをフェードイン/アウトで切り替える */
  private animatePhraseText(el: HTMLElement, text: string): void {
    el.classList.add("lyric-fade-out");
    setTimeout(() => {
      el.textContent = text;
      el.classList.remove("lyric-fade-out");
      el.classList.add("lyric-fade-in");
      setTimeout(() => el.classList.remove("lyric-fade-in"), 400);
    }, 200);
  }

  show(): void {
    this.wordEl.style.display = "block";
    this.phraseEl.style.display = "block";
  }

  hide(): void {
    this.wordEl.style.display = "none";
    this.phraseEl.style.display = "none";
  }
}
