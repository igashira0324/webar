/**
 * lyric3d.ts
 * 3D空間用歌詞演出モジュール
 *
 * 改善点（v2）:
 *  - 同時表示数を4個に制限し、重なり防止ロジックを追加
 *  - 表示寿命を2000msに短縮してテンポに合わせる
 *  - タップ（クリック）で歌詞が弾ける演出を実装
 *  - サビ区間ではフォントを大きく・より明るく表示
 *  - triggerBeatPulse() で全アクティブ単語を一瞬拡大
 */
import {
  Scene, MeshBuilder, Mesh, Vector3, TransformNode, StandardMaterial,
  Color3, PointerEventTypes
} from "@babylonjs/core";
import { AdvancedDynamicTexture, TextBlock } from "@babylonjs/gui";

interface ActiveWord {
  mesh: Mesh;
  texture: AdvancedDynamicTexture;
  textBlock: TextBlock;
  material: StandardMaterial;
  basePosition: Vector3;
  spawnTime: number;   // 登場した実時刻 (ms)
  duration: number;   // 表示寿命 (ms)
  exploded: boolean;  // タップ弾け済みフラグ
  beatScale: number;  // ビートパルスによる一時的なスケール加算
}

export class Lyric3D {
  private scene: Scene;
  private activeWords: ActiveWord[] = [];
  private readonly MAX_WORDS = 4;      // 同時に画面に出す単語数の上限
  private readonly LIFETIME_MS = 2000; // 通常の表示寿命
  private readonly LIFETIME_CHORUS_MS = 2200; // サビでは少し長め
  private readonly MIN_SPACING = 1.2;  // 歌詞パネル間の最小距離
  private lyricContainer: TransformNode;

  constructor(scene: Scene) {
    this.scene = scene;

    // 歌詞をまとめるコンテナノード
    this.lyricContainer = new TransformNode("lyric3DContainer", this.scene);
    this._syncContainerParent();

    // タップ（ポインター）で歌詞を弾ける演出
    this.scene.onPointerObservable.add((pi) => {
      if (pi.type !== PointerEventTypes.POINTERTAP) return;
      const pickedMesh = pi.pickInfo?.pickedMesh;
      if (!pickedMesh) return;
      const hit = this.activeWords.find(w => w.mesh === pickedMesh);
      if (hit && !hit.exploded) {
        this._explodeWord(hit);
      }
    });
  }

  /** ARモード切り替え時にコンテナ親を同期 */
  private _syncContainerParent(): void {
    const xrData = (this.scene as any)._xrData;
    if (xrData?.arRoot) {
      this.lyricContainer.parent = xrData.arRoot;
    }
  }

  /**
   * 新しい歌詞単語を3D空間に出現させる
   * @param text 歌詞テキスト
   * @param _duration 未使用（内部で固定値を使用）
   * @param isChorus サビ区間かどうか
   */
  spawnWord(text: string, _duration: number, isChorus: boolean): void {
    if (!text || text.trim() === "") return;

    this._syncContainerParent();

    // 最大表示数を超えたら最も古い単語を即削除
    while (this.activeWords.length >= this.MAX_WORDS) {
      const oldest = this.activeWords.shift();
      if (oldest) this._dispose(oldest);
    }

    // ── 1. 配置座標の決定（重なり防止） ──
    const position = this._findFreePosition();

    // ── 2. Plane メッシュの生成 ──
    // サビは少し大きく、通常は文字数に応じた幅
    const charCount = [...text].length; // 日本語対応のため spread
    const baseWidth = Math.max(1.0, charCount * (isChorus ? 0.6 : 0.45));
    const baseHeight = isChorus ? 1.1 : 0.9;

    const plane = MeshBuilder.CreatePlane(
      "lyric-word",
      { width: baseWidth, height: baseHeight },
      this.scene
    );
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.parent = this.lyricContainer;
    plane.position.copyFrom(position);
    plane.scaling.setAll(0); // 出現アニメ用

    // ── 3. マテリアル（透過・自発光・両面描画） ──
    const mat = new StandardMaterial("lyric-mat", this.scene);
    mat.disableLighting = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.backFaceCulling = false;
    mat.emissiveColor = isChorus ? new Color3(0.9, 0.3, 1.0) : new Color3(0.0, 0.9, 1.0);
    plane.material = mat;

    // ── 4. テクスチャ / テキストブロック ──
    const texW = Math.max(512, charCount * 128);
    const texH = isChorus ? 320 : 256;
    const texture = AdvancedDynamicTexture.CreateForMesh(plane, texW, texH, false);

    const tb = new TextBlock();
    tb.text = text;
    tb.fontFamily = "'Orbitron', 'Noto Sans JP', sans-serif";
    tb.fontSize = isChorus ? "140px" : "120px";
    tb.fontWeight = "bold";
    tb.color = isChorus ? "#f0abfc" : "#67e8f9";
    tb.shadowColor = isChorus ? "rgba(240,171,252,1)" : "rgba(103,232,249,1)";
    tb.shadowBlur = isChorus ? 24 : 16;
    tb.shadowOffsetX = 0;
    tb.shadowOffsetY = 0;
    texture.addControl(tb);

    // ── 5. ActiveWord として登録 ──
    const lifetime = isChorus ? this.LIFETIME_CHORUS_MS : this.LIFETIME_MS;
    const activeWord: ActiveWord = {
      mesh: plane, texture, textBlock: tb, material: mat,
      basePosition: position.clone(),
      spawnTime: Date.now(),
      duration: lifetime,
      exploded: false,
      beatScale: 0,
    };
    this.activeWords.push(activeWord);
  }

  /**
   * 既存の単語から十分離れた配置座標を返す
   * 試行回数を超えたらランダム位置を返す
   */
  private _findFreePosition(): Vector3 {
    const MAX_TRIES = 20;
    for (let i = 0; i < MAX_TRIES; i++) {
      const candidate = new Vector3(
        (Math.random() - 0.5) * 2.0,   // x: -1.0 〜 +1.0
        2.0 + Math.random() * 0.8,      // y: 2.0 〜 2.8（ミク頭上）
        (Math.random() - 0.5) * 1.0,   // z: -0.5 〜 +0.5
      );
      // 既存の全単語と距離チェック
      const tooClose = this.activeWords.some(w =>
        Vector3.Distance(w.basePosition, candidate) < this.MIN_SPACING
      );
      if (!tooClose) return candidate;
    }
    // どうしても空きがなければランダム（フォールバック）
    return new Vector3(
      (Math.random() - 0.5) * 2.0,
      2.0 + Math.random() * 0.8,
      (Math.random() - 0.5) * 1.0,
    );
  }

  /**
   * 毎フレームの描画更新（出現拡大・浮遊・フェードアウトを管理）
   */
  update(): void {
    const now = Date.now();

    for (let i = this.activeWords.length - 1; i >= 0; i--) {
      const item = this.activeWords[i];
      const elapsed = now - item.spawnTime;

      // 寿命切れ → 削除
      if (elapsed >= item.duration) {
        this._dispose(item);
        this.activeWords.splice(i, 1);
        continue;
      }

      // ── 出現フェーズ（0〜150ms）: 0 → 1.0 に急拡大 ──
      const INTRO = 150;
      const FADE = 500;
      const remaining = item.duration - elapsed;

      let baseScale = 1.0;
      let alpha = 1.0;

      if (elapsed < INTRO) {
        const t = elapsed / INTRO;
        baseScale = Math.sin(t * Math.PI / 2); // イージング
        alpha = t;
      } else if (remaining < FADE) {
        const t = remaining / FADE; // 1.0 → 0.0
        baseScale = t;
        alpha = t;
      }

      // ビートパルス減衰（一瞬だけ大きくなり、すぐ戻る）
      item.beatScale *= 0.85; // 減衰係数
      const finalScale = baseScale + item.beatScale;

      item.mesh.scaling.setAll(Math.max(0, finalScale));
      item.textBlock.alpha = Math.max(0, alpha);

      // 浮遊：intro後にゆっくり上昇
      if (elapsed > INTRO) {
        const drift = (elapsed - INTRO) * 0.00018;
        item.mesh.position.y = item.basePosition.y + drift;
      }
    }
  }

  /**
   * タップで歌詞を弾ける演出
   */
  private _explodeWord(item: ActiveWord): void {
    item.exploded = true;
    // 即座に大きくスケールして消える（爆発エフェクト的に）
    item.textBlock.color = "#ffffff";
    item.textBlock.shadowColor = "rgba(255,255,255,1)";
    item.beatScale = 0.6;  // 一瞬だけ大きくなる
    // 短命化：残り時間を 300ms に強制
    item.spawnTime = Date.now() - (item.duration - 300);
  }

  /**
   * ビートに合わせて全アクティブ単語を一瞬だけ拡大させる
   */
  triggerBeatPulse(): void {
    for (const w of this.activeWords) {
      if (!w.exploded) {
        w.beatScale = 0.2; // 0.2 をプラスして減衰させる
      }
    }
  }

  /**
   * ホールド火花（将来実装用のスタブ）
   */
  spawnHoldSparks(): void {
    // Phase 2 で実装予定
  }

  /**
   * 全単語を破棄してクリア
   */
  clear(): void {
    this.activeWords.forEach(w => this._dispose(w));
    this.activeWords = [];
  }

  private _dispose(item: ActiveWord): void {
    item.texture.dispose();
    item.material.dispose();
    item.mesh.dispose();
  }
}
