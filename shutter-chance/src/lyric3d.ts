/**
 * lyric3d.ts — Lyric Spark AR 歌詞3D演出エンジン v3
 *
 * 「歌詞が降り積もる世界」
 *  - 歌詞が足元あたりから閃光で出現し、ゆっくり上昇（発声フェーズ）
 *  - 発声が終わると重力的に床へ降りていく（降下フェーズ）
 *  - 床付近で停止し、積もった歌詞として淡く光り続ける（堆積フェーズ）
 *  - 堆積上限(MAX_SETTLED)を超えた分は古いものからFIFOで静かに消える
 *  - タップで歌詞が弾ける演出（既存）
 *  - ビートパルスで全アクティブ単語が一瞬拡大（既存）
 */
import {
  Scene, MeshBuilder, Mesh, Vector3, TransformNode,
  StandardMaterial, Color3, PointerEventTypes
} from "@babylonjs/core";
import { AdvancedDynamicTexture, TextBlock } from "@babylonjs/gui";

/** 歌詞の3段階ライフサイクル */
type WordPhase =
  | "rising"   // 発声中: 下から出現 → 上昇
  | "falling"  // 降下中: 上から床へゆっくり落ちる
  | "settled"; // 堆積中: 床付近で静止して残る

interface LyricWord {
  mesh: Mesh;
  texture: AdvancedDynamicTexture;
  textBlock: TextBlock;
  material: StandardMaterial;
  /** spawnしたときのワールド座標 */
  spawnPos: Vector3;
  /** 床に降りたときのワールド座標 */
  settledPos: Vector3;
  spawnTime: number;   // 登場した実時刻(ms)
  phase: WordPhase;
  isChorus: boolean;
  exploded: boolean;   // タップ弾け済みフラグ
  beatScale: number;   // ビートパルスによる一時的なスケール加算
  /** フリーズモード中は update() を止めるために参照 */
  frozenAt: number | null;
}

interface SparkParticle {
  mesh: Mesh;
  velocity: Vector3;
  spawnTime: number;
  duration: number;
}



export class Lyric3D {
  private scene: Scene;
  private container: TransformNode;

  // ── 同時に「発声・降下中」で持てる単語数の上限
  private readonly MAX_ACTIVE = 4;
  // ── 床に積もった歌詞の最大保持数（超えたらFIFOで古い方から消す）
  private readonly MAX_SETTLED = 50;

  private activeWords: LyricWord[] = [];   // rising / falling
  private settledWords: LyricWord[] = [];  // settled

  // ── フィナーレ演出（舞い上がり）関連
  private finaleWords: LyricWord[] = [];
  private finaleActive = false;
  private finaleStartTime = 0;

  // ── タップエフェクト（光の粒）関連
  private sparks: SparkParticle[] = [];

  // ── 発声フェーズの継続時間 (ms)
  private readonly RISE_DURATION = 2000;
  private readonly RISE_DURATION_CHORUS = 2400;

  // ── 降下フェーズの継続時間 (ms)
  private readonly FALL_DURATION = 1800;

  // ── 配置時の重なり防止距離
  private readonly MIN_SPACING = 1.0;

  /** フリーズモードが有効かどうか（外部から操作される） */
  isFrozen = false;

  constructor(scene: Scene) {
    this.scene = scene;
    this.container = new TransformNode("lyric3DContainer", this.scene);
    this._syncContainerParent();

    // タップ弾け・堆積歌詞タップ演出: PointerObservable でピックされたメッシュを判定
    this.scene.onPointerObservable.add((pi) => {
      if (pi.type !== PointerEventTypes.POINTERTAP) return;
      const pickedMesh = pi.pickInfo?.pickedMesh;
      if (!pickedMesh) return;

      // 堆積（settled）状態の歌詞をタップした場合
      const settledHit = this.settledWords.find(w => w.mesh === pickedMesh);
      if (settledHit) {
        this._triggerSettledTapEffect(settledHit);
        return;
      }

      // 発声・降下（active）状態の歌詞をタップした場合
      const activeHit = this.activeWords.find(w => w.mesh === pickedMesh);
      if (activeHit && !activeHit.exploded) {
        this._explode(activeHit);
      }
    });
  }

  /** ARモード切り替え時にコンテナ親を同期 */
  private _syncContainerParent(): void {
    const xrData = (this.scene as any)._xrData;
    if (xrData?.arRoot) this.container.parent = xrData.arRoot;
  }

  // ────────────────────────────────────────
  // 公開 API
  // ────────────────────────────────────────

  /**
   * 新しい歌詞単語を3D空間に出現させる
   * @param text 歌詞テキスト
   * @param _duration 未使用（内部固定値を使用）
   * @param isChorus サビ区間かどうか
   */
  spawnWord(text: string, _duration: number, isChorus: boolean): void {
    if (!text || text.trim() === "") return;
    this._syncContainerParent();

    // active が上限を超えたら最も古い単語を降下フェーズへ移行
    if (this.activeWords.length >= this.MAX_ACTIVE) {
      const oldest = this.activeWords[0];
      if (oldest.phase === "rising") {
        oldest.phase = "falling";
        oldest.spawnTime = Date.now(); // 降下タイマーをリセット
      }
    }

    // ── 出現座標（ミクの足元〜腰: y=0.6〜1.2）
    const pos = this._findFreeSpawnPos();

    // ── Plane メッシュ
    const charCount = [...text].length;
    // 長いフレーズが来ても巨大になりすぎないよう制限（幅最大2.8m）
    const pw = Math.max(0.8, Math.min(2.8, charCount * (isChorus ? 0.22 : 0.18)));
    const ph = isChorus ? 0.7 : 0.55;
    const plane = MeshBuilder.CreatePlane("lyric", { width: pw, height: ph }, this.scene);
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.parent = this.container;
    plane.position.copyFrom(pos);
    plane.scaling.setAll(0);

    // ── マテリアル（透過・非ライティング・両面）
    const mat = new StandardMaterial("lyric-mat", this.scene);
    mat.disableLighting = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.backFaceCulling = false;
    mat.emissiveColor = isChorus
      ? new Color3(0.95, 0.3, 1.0)   // マゼンタ（サビ）
      : new Color3(0.0, 0.85, 1.0);  // シアン（通常）
    plane.material = mat;

    // ── テクスチャ / テキスト
    // 解像度も大きくなりすぎないように制限（最大1024）
    const texW = Math.max(512, Math.min(1024, charCount * 60));
    const texH = isChorus ? 200 : 160;
    const tex = AdvancedDynamicTexture.CreateForMesh(plane, texW, texH, false);
    const tb = new TextBlock();
    tb.text = text;
    tb.fontFamily = "'Orbitron', 'Noto Sans JP', sans-serif";
    // 文字数に応じてフォントサイズを動的に縮小する
    const baseFontSize = isChorus ? 100 : 80;
    const calculatedFontSize = Math.max(36, Math.min(baseFontSize, Math.floor((texW / charCount) * 1.3)));
    tb.fontSize = `${calculatedFontSize}px`;
    tb.fontWeight = "bold";
    tb.color = isChorus ? "#f0abfc" : "#67e8f9";
    tb.shadowColor = isChorus ? "rgba(240,171,252,0.9)" : "rgba(103,232,249,0.9)";
    tb.shadowBlur = isChorus ? 22 : 16;
    tb.shadowOffsetX = 0;
    tb.shadowOffsetY = 0;
    tex.addControl(tb);

    const word: LyricWord = {
      mesh: plane, texture: tex, textBlock: tb, material: mat,
      spawnPos: pos.clone(),
      // 堆積座標は360度ランダムに分散させる（ミクを囲む歌詞の海）
      //  - angle: 0〜2π でランダム方向
      //  - radius: 0.8〜2.5m でランダム距離
      //  - y: 床すれすれ（0.02〜0.10m）
      settledPos: (() => {
        const angle  = Math.random() * Math.PI * 2;
        const radius = 0.8 + Math.random() * 1.7;
        return new Vector3(
          Math.cos(angle) * radius,
          0.02 + Math.random() * 0.08,
          Math.sin(angle) * radius,
        );
      })(),
      spawnTime: Date.now(),
      phase: "rising",
      isChorus,
      exploded: false,
      beatScale: 0,
      frozenAt: null,
    };

    this.activeWords.push(word);
  }

  /** 毎フレームの描画更新（出現・上昇・降下・堆積アニメーション） */
  update(): void {
    if (this.isFrozen) return; // フリーズ中は停止

    const now = Date.now();

    // ── Sparks の更新（タップ時の光の粒）
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      const elapsed = now - s.spawnTime;
      if (elapsed >= s.duration) {
        s.mesh.dispose();
        s.mesh.material?.dispose();
        this.sparks.splice(i, 1);
      } else {
        s.velocity.y -= 0.08; // 簡易重力
        s.mesh.position.addInPlace(s.velocity.scale(0.016));
        const t = elapsed / s.duration;
        s.mesh.visibility = 1 - t;
        s.mesh.scaling.setAll(1 - t * 0.5);
      }
    }

    // ── フィナーレ演出（舞い上がり）の更新
    if (this.finaleActive) {
      const elapsed = now - this.finaleStartTime;
      const DURATION = 3000; // 3秒間舞い上がる
      
      if (elapsed >= DURATION) {
        // フィナーレ終了、すべてのメッシュを破棄
        this.finaleWords.forEach(w => this._dispose(w));
        this.finaleWords = [];
        this.finaleActive = false;
        console.log("[Lyric3D] Finale ended, all words disposed.");
      } else {
        const t = elapsed / DURATION; // 0〜1
        const easedRise = Math.pow(t, 1.5); // 加速上昇
        
        for (const w of this.finaleWords) {
          // 上方へ舞い上がる
          const startY = (w as any)._finaleStartY ?? w.mesh.position.y;
          if ((w as any)._finaleStartY === undefined) {
            (w as any)._finaleStartY = startY;
          }
          w.mesh.position.y = startY + easedRise * 3.5;
          
          // 中心（0, 0）から少し外側に広がる
          const dir = new Vector3(w.mesh.position.x, 0, w.mesh.position.z).normalize();
          w.mesh.position.addInPlace(dir.scale(0.012)); // 徐々に広がる
          
          // フェードアウト
          w.textBlock.alpha = Math.max(0, (w.textBlock.alpha ?? 0.45) * (1 - t * 0.08));
          w.mesh.visibility = 1 - t;
          
          // 舞い上がり中もビートパルスは一応反応するように
          w.beatScale *= 0.85;
          w.mesh.scaling.setAll(Math.max(0, (0.55 + w.beatScale) * (1 - t * 0.4)));
        }
      }
      return; // フィナーレ中は通常の activeWords 等の更新はスキップ
    }

    // ── activeWords (rising / falling) の処理
    for (let i = this.activeWords.length - 1; i >= 0; i--) {
      const w = this.activeWords[i];
      const elapsed = now - w.spawnTime;

      if (w.phase === "rising") {
        const duration = w.isChorus ? this.RISE_DURATION_CHORUS : this.RISE_DURATION;
        // 寿命が来たら降下フェーズへ移行
        if (elapsed >= duration) {
          w.phase = "falling";
          w.spawnTime = now; // 降下タイマーをリセット
          continue;
        }
        this._updateRising(w, elapsed, duration);

      } else if (w.phase === "falling") {
        if (elapsed >= this.FALL_DURATION) {
          // 床に到達 → settled へ移行
          w.phase = "settled";
          w.mesh.position.copyFrom(w.settledPos);
          w.mesh.scaling.setAll(0.55); // 積もった感じで少し小さく
          w.textBlock.alpha = 0.45;    // 少し淡く

          // settled へ移動
          this.activeWords.splice(i, 1);
          this._addSettled(w);
          continue;
        }
        this._updateFalling(w, elapsed);
      }
    }

    // ── settledWords の更新
    for (const w of this.settledWords) {
      if ((w as any).tapEffectActive) {
        (w as any).tapEffectProgress += 0.06; // アニメーション速度
        const progress = (w as any).tapEffectProgress;
        if (progress >= 1.0) {
          (w as any).tapEffectActive = false;
          // 元の色に戻す
          w.material.emissiveColor = w.isChorus
            ? new Color3(0.95, 0.3, 1.0)
            : new Color3(0.0, 0.85, 1.0);
          w.textBlock.color = w.isChorus ? "#f0abfc" : "#67e8f9";
          w.beatScale = 0;
        } else {
          // スケールバウンド（一瞬大きく膨らんで戻る）
          w.beatScale = Math.sin(progress * Math.PI) * 0.45; // 最大+0.45
        }
      } else {
        w.beatScale *= 0.82;
      }
      const baseScale = 0.55;
      w.mesh.scaling.setAll(Math.max(0, baseScale + w.beatScale));
    }
  }

  /** ビートに合わせて全アクティブ単語を一瞬拡大 */
  triggerBeatPulse(): void {
    if (this.finaleActive) return;
    for (const w of this.activeWords) {
      if (!w.exploded) w.beatScale = 0.18;
    }
    // 積もっている単語もかすかに反応
    for (const w of this.settledWords) {
      if (!(w as any).tapEffectActive) {
        w.beatScale = 0.07;
      }
    }
  }

  /** フリーズモード（時を止める）のトグル */
  setFrozen(frozen: boolean): void {
    this.isFrozen = frozen;
  }

  /** ホールド火花（Phase 2 で実装予定のスタブ） */
  spawnHoldSparks(): void { /* Phase 2 で実装 */ }

  /** 曲終わりの舞い上がり演出をトリガーする */
  triggerFinale(): void {
    if (this.finaleActive) return;
    this.finaleActive = true;
    this.finaleStartTime = Date.now();
    
    // 全単語をフィナーレ用リストに退避
    this.finaleWords = [...this.activeWords, ...this.settledWords];
    this.activeWords = [];
    this.settledWords = [];
    
    console.log(`[Lyric3D] Finale triggered. Total words rising: ${this.finaleWords.length}`);
  }

  /** 全単語（active + settled + finale + sparks）を破棄してリセット */
  clear(): void {
    [...this.activeWords, ...this.settledWords, ...this.finaleWords].forEach(w => this._dispose(w));
    this.activeWords = [];
    this.settledWords = [];
    this.finaleWords = [];
    
    this.sparks.forEach(s => {
      s.mesh.dispose();
      s.mesh.material?.dispose();
    });
    this.sparks = [];
    this.finaleActive = false;
  }

  // ────────────────────────────────────────
  // プライベートヘルパー
  // ────────────────────────────────────────

  /** rising フェーズのアニメーション */
  private _updateRising(w: LyricWord, elapsed: number, duration: number): void {
    const INTRO = 140; // 出現拡大期間 (ms)
    const FADE  = 400; // フェードアウト開始までの残り時間 (ms)
    const remaining = duration - elapsed;

    // スケール計算
    w.beatScale *= 0.85;
    let baseScale = 1.0;
    let alpha     = 1.0;

    if (elapsed < INTRO) {
      const t = elapsed / INTRO;
      baseScale = Math.sin(t * Math.PI / 2); // 0→1 イージング
      alpha = t;
    } else if (remaining < FADE) {
      const t = remaining / FADE; // 1→0
      baseScale = 0.8 + t * 0.2; // 0.8〜1.0 の範囲で縮む（なめらか）
      alpha = t;
    }

    w.mesh.scaling.setAll(Math.max(0, baseScale + w.beatScale));
    w.textBlock.alpha = Math.max(0, alpha);

    // 上昇: 足元(0.6〜1.2)から最大2.5mくらいまでゆっくり上がる
    if (elapsed > INTRO) {
      const riseProgress = (elapsed - INTRO) / (duration - INTRO);
      const riseHeight = 1.6; // 上昇する高さ (m)
      w.mesh.position.y = w.spawnPos.y + riseProgress * riseHeight;
    }
  }

  /** falling フェーズのアニメーション */
  private _updateFalling(w: LyricWord, elapsed: number): void {
    const t = elapsed / this.FALL_DURATION; // 0→1
    // 落下イージング（最初はゆっくり、後半は少し速く）
    const eased = t * t;

    // 現在位置（降下開始時の高さ）から settledPos.y へ補間
    const startY = w.mesh.position.y;
    if (t === 0) {
      // 降下開始時の高さを保存
      (w as any)._fallStartY = startY;
    }
    const fallStartY: number = (w as any)._fallStartY ?? startY;
    const targetY = w.settledPos.y;
    w.mesh.position.y = fallStartY + (targetY - fallStartY) * eased;

    // x/z も settledPos に向かって収束
    w.mesh.position.x += (w.settledPos.x - w.mesh.position.x) * 0.04;
    w.mesh.position.z += (w.settledPos.z - w.mesh.position.z) * 0.04;

    // フェードイン → 安定（下降中は少し透けさせておく）
    w.textBlock.alpha = Math.max(0, 0.45 + 0.3 * (1 - eased));
    w.mesh.scaling.setAll(0.5 + 0.5 * (1 - eased)); // 縮みながら降りる
  }

  /**
   * settled に追加する。
   * 上限(MAX_SETTLED)を超えたら最も古い settled 歌詞をフェードアウトして dispose する。
   */
  private _addSettled(w: LyricWord): void {
    this.settledWords.push(w);

    // FIFO: 古いものを消す
    while (this.settledWords.length > this.MAX_SETTLED) {
      const oldest = this.settledWords.shift()!;
      this._fadeAndDispose(oldest);
    }
  }

  /** フェードアウトしてから dispose（GC 負担を分散） */
  private _fadeAndDispose(w: LyricWord): void {
    // 即時 dispose（シンプルに）
    this._dispose(w);
  }

  /** タップ弾け演出 */
  private _explode(w: LyricWord): void {
    w.exploded = true;
    w.textBlock.color = "#ffffff";
    w.textBlock.shadowColor = "rgba(255,255,255,1)";
    w.beatScale = 0.55;
    // 残り時間を 350ms に強制（すぐ消える）
    if (w.phase === "rising" || w.phase === "falling") {
      w.spawnTime = Date.now() - (w.isChorus ? this.RISE_DURATION_CHORUS : this.RISE_DURATION) + 350;
    } else {
      // settled の場合は settledWords から取り出してアクティブに戻し、すぐ消す
      const idx = this.settledWords.indexOf(w);
      if (idx !== -1) {
        this.settledWords.splice(idx, 1);
        w.phase = "falling";
        w.spawnTime = Date.now() - this.FALL_DURATION + 300;
        this.activeWords.push(w);
      }
    }
  }

  /** 既存の単語と重なりにくい出現座標を探す */
  private _findFreeSpawnPos(): Vector3 {
    const all = [...this.activeWords, ...this.settledWords];
    for (let i = 0; i < 20; i++) {
      const c = new Vector3(
        (Math.random() - 0.5) * 2.2,         // x: -1.1 〜 +1.1
        0.6 + Math.random() * 0.6,            // y: 0.6 〜 1.2（足元〜腰）
        (Math.random() - 0.5) * 1.2,          // z: -0.6 〜 +0.6
      );
      const tooClose = all.some(w =>
        Vector3.Distance(w.spawnPos, c) < this.MIN_SPACING
      );
      if (!tooClose) return c;
    }
    // フォールバック
    return new Vector3(
      (Math.random() - 0.5) * 2.2,
      0.6 + Math.random() * 0.6,
      (Math.random() - 0.5) * 1.2,
    );
  }

  /** メッシュ・テクスチャ・マテリアルを確実に解放 */
  private _dispose(w: LyricWord): void {
    w.texture.dispose();
    w.material.dispose();
    w.mesh.dispose();
  }

  /** 堆積した歌詞をタップしたときの光エフェクトとバウンド */
  private _triggerSettledTapEffect(w: LyricWord): void {
    if ((w as any).tapEffectActive) return;
    (w as any).tapEffectActive = true;
    (w as any).tapEffectProgress = 0;
    
    // 一時的に超発光マゼンタ（または白）に変更
    w.material.emissiveColor = new Color3(1.5, 0.4, 1.5);
    w.textBlock.color = "#ffffff";

    // 周囲に光の粒（Spark）を散らす
    const pos = w.mesh.position;
    for (let i = 0; i < 5; i++) {
      const spark = MeshBuilder.CreateBox("spark", { size: 0.04 }, this.scene);
      const mat = new StandardMaterial("spark-mat", this.scene);
      mat.disableLighting = true;
      // サビかどうかに応じて逆のネオン色に
      mat.emissiveColor = w.isChorus ? new Color3(0.0, 0.9, 1.0) : new Color3(1.0, 0.4, 0.9);
      spark.material = mat;
      spark.position.copyFrom(pos);

      // 3Dランダムな方向に速度を決定
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 0.8;
      const velocity = new Vector3(
        Math.cos(angle) * speed,
        0.4 + Math.random() * 0.9, // 上方向
        Math.sin(angle) * speed
      );

      this.sparks.push({
        mesh: spark,
        velocity,
        spawnTime: Date.now(),
        duration: 400 + Math.random() * 300
      });
    }
  }
}
