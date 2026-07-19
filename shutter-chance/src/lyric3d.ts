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
  StandardMaterial, Color3, PointerEventTypes, Texture, Color4
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
  phraseId: number;    // 関連するフレーズの開始時間(ms)
  isCapturedPhoto?: boolean; // 撮影写真フラグ
}

interface SparkParticle {
  mesh: Mesh;
  texture: AdvancedDynamicTexture;
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

  // ── 舞い上がり後に漂い続ける歌詞（ホバリング）関連
  private hoveringWords: LyricWord[] = [];
  private hoveringActive = false;

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

  private linesMesh: any = null;

  constructor(scene: Scene, parentNode?: TransformNode) {
    this.scene = scene;
    this.container = new TransformNode("lyric3DContainer", this.scene);
    if (parentNode) {
      this.container.parent = parentNode;
    }

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

  /** 画質設定による堆積上限の動的設定 */
  setMaxSettled(max: number): void {
    (this as any).MAX_SETTLED_DYNAMIC = max;
    const limit = this._getMaxSettled();
    while (this.settledWords.length > limit) {
      const oldest = this.settledWords.shift()!;
      this._fadeAndDispose(oldest);
    }
  }

  private _getMaxSettled(): number {
    return (this as any).MAX_SETTLED_DYNAMIC !== undefined ? (this as any).MAX_SETTLED_DYNAMIC : this.MAX_SETTLED;
  }

  // ────────────────────────────────────────
  // 公開 API
  // ────────────────────────────────────────

  /**
   * 新しい歌詞単語を3D空間に出現させる
   * @param text 歌詞テキスト
   * @param _duration 未使用（内部固定値を使用）
   * @param isChorus サビ区間かどうか
   * @param phraseId 関連するフレーズID
   */
  spawnWord(text: string, _duration: number, isChorus: boolean, phraseId: number = 0): void {
    if (!text || text.trim() === "") return;

    // ── ミク・リンのデュエット振り分け（サビ以外）
    let isRin = false;
    if (!isChorus) {
      isRin = Math.random() > 0.5;
    }

    // active が上限を超えたら最も古い単語を降下フェーズへ移行
    if (this.activeWords.length >= this.MAX_ACTIVE) {
      const oldest = this.activeWords[0];
      if (oldest.phase === "rising") {
        oldest.phase = "falling";
        oldest.spawnTime = Date.now(); // 降下タイマーをリセット
      }
    }

    // ── 出現座標（Miku=左, Rin=右）
    const pos = this._findFreeSpawnPos(isChorus ? undefined : isRin);

    // ── Plane メッシュ
    const charCount = [...text].length;

    // 単語ベースでのサイズ計算。
    const pw = Math.max(0.6, Math.min(2.0, charCount * (isChorus ? 0.22 : 0.18)));
    const ph = isChorus ? 0.45 : 0.35;
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
    
    if (isChorus) {
      mat.emissiveColor = new Color3(0.95, 0.3, 1.0);  // サビ: マゼンタ
    } else if (isRin) {
      mat.emissiveColor = new Color3(1.0, 0.55, 0.0);  // リン: オレンジ
    } else {
      mat.emissiveColor = new Color3(0.0, 0.85, 1.0);  // ミク: シアン
    }
    plane.material = mat;

    // ── テクスチャ / テキスト
    const texW = Math.max(256, Math.min(512, charCount * 64));
    const texH = isChorus ? 100 : 80;
    const tex = AdvancedDynamicTexture.CreateForMesh(plane, texW, texH, false);
    const tb = new TextBlock();
    tb.text = text;
    tb.textWrapping = false;
    tb.fontFamily = "'Orbitron', 'Noto Sans JP', sans-serif";
    const baseFontSize = isChorus ? 56 : 46;
    const calculatedFontSize = Math.max(24, Math.min(baseFontSize, Math.floor((texW / charCount) * 1.15)));
    tb.fontSize = `${calculatedFontSize}px`;
    tb.fontWeight = "bold";

    if (isChorus) {
      tb.color = "#f0abfc";
      tb.shadowColor = "rgba(240,171,252,0.9)";
      tb.shadowBlur = 22;
    } else if (isRin) {
      tb.color = "#fed7aa"; // リン (薄いオレンジ)
      tb.shadowColor = "rgba(255,152,0,0.9)";
      tb.shadowBlur = 18;
    } else {
      tb.color = "#67e8f9"; // ミク (シアン)
      tb.shadowColor = "rgba(103,232,249,0.9)";
      tb.shadowBlur = 16;
    }
    tb.shadowOffsetX = 0;
    tb.shadowOffsetY = 0;
    tex.addControl(tb);

    const word: LyricWord = {
      mesh: plane, texture: tex, textBlock: tb, material: mat,
      spawnPos: pos.clone(),
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
      phraseId
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
        s.texture.dispose();
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

    // ── ホバリング歌詞（舞い上がり完了後）の更新
    if (this.hoveringActive) {
      for (const w of this.hoveringWords) {
        // 各単語に浮遊用パラメータの初期化
        if ((w as any)._hoverAngle === undefined) {
          const pos = w.mesh.position;
          (w as any)._hoverRadius = Math.max(0.8, Math.min(2.5, Math.sqrt(pos.x * pos.x + pos.z * pos.z)));
          (w as any)._hoverAngle = Math.atan2(pos.z, pos.x);
          (w as any)._hoverBaseY = pos.y;
          (w as any)._hoverPhaseOffset = Math.random() * Math.PI * 2;
          (w as any)._hoverSpeed = 0.2 + Math.random() * 0.4;
          (w as any)._hoverRotSpeed = (Math.random() > 0.5 ? 1 : -1) * (0.01 + Math.random() * 0.03);
        }

        // 極めてゆっくりと旋回
        (w as any)._hoverAngle += (w as any)._hoverRotSpeed * 0.005;
        const radius = (w as any)._hoverRadius;
        const angle = (w as any)._hoverAngle;
        w.mesh.position.x = Math.cos(angle) * radius;
        w.mesh.position.z = Math.sin(angle) * radius;

        // サイン波で上下にゆらゆら揺れる
        const phase = (w as any)._hoverPhaseOffset + now * 0.001 * (w as any)._hoverSpeed;
        w.mesh.position.y = (w as any)._hoverBaseY + Math.sin(phase) * 0.12;

        w.beatScale *= 0.85;
        if (w.isCapturedPhoto) {
          w.mesh.scaling.setAll(0.8 + w.beatScale * 0.25);
        } else {
          w.textBlock.alpha = 0.35 + w.beatScale * 0.5; // ビートで少し輝く
          w.mesh.visibility = 1.0;
          w.mesh.scaling.setAll(0.45 + w.beatScale * 0.25);
        }
      }
      this._updateConstellationLines();
      return; // ホバリング中も通常の更新はスキップ
    }

    // ── フィナーレ演出（舞い上がり）の更新
    if (this.finaleActive) {
      const elapsed = now - this.finaleStartTime;
      const DURATION = 3000; // 3秒間舞い上がる
      
      if (elapsed >= DURATION) {
        // フィナーレ終了 → ホバリング（星座モード）へ移行
        this.hoveringWords = [...this.finaleWords];
        this.finaleWords = [];
        this.finaleActive = false;
        this.hoveringActive = true;
        console.log(`[Lyric3D] Finale transition to hovering. Total words remaining: ${this.hoveringWords.length}`);
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
          
          if (w.isCapturedPhoto) {
            // スケールイン
            w.mesh.scaling.setAll(t * 0.8);
          } else {
            w.textBlock.alpha = Math.max(0.35, (w.textBlock.alpha ?? 0.45) * (1 - t * 0.5));
            w.mesh.visibility = 1.0;
            w.beatScale *= 0.85;
            w.mesh.scaling.setAll(Math.max(0.35, (0.55 + w.beatScale) * (1 - t * 0.2)));
          }
        }
      }
      this._updateConstellationLines();
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
    // ホバリング中の歌詞もビートで脈打つ
    if (this.hoveringActive) {
      for (const w of this.hoveringWords) {
        w.beatScale = 0.15;
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
  triggerFinale(photos: any[] = []): void {
    if (this.finaleActive) return;
    this.finaleActive = true;
    this.finaleStartTime = Date.now();
    
    // 全単語をフィナーレ用リストに退避
    this.finaleWords = [...this.activeWords, ...this.settledWords];
    this.activeWords = [];
    this.settledWords = [];
    
    // ポラロイド写真の3D生成と追加
    photos.forEach((photo, idx) => {
      try {
        const parentMesh = this._create3DPolaroid(photo);
        parentMesh.parent = this.container;
        
        // ミクを囲む円環状に配置、少し高さをずらす
        const angle = (idx / Math.max(1, photos.length)) * Math.PI * 2 + Math.random() * 0.5;
        const radius = 1.2 + Math.random() * 0.8;
        parentMesh.position.set(
          Math.cos(angle) * radius,
          0.1 + Math.random() * 0.2, // 下部から舞い上がる
          Math.sin(angle) * radius
        );
        
        (parentMesh as any)._finaleStartY = parentMesh.position.y;
        
        const word: LyricWord = {
          mesh: parentMesh as any,
          texture: null as any,
          textBlock: null as any,
          material: null as any,
          spawnPos: parentMesh.position.clone(),
          settledPos: parentMesh.position.clone(),
          spawnTime: Date.now(),
          phase: "settled",
          isChorus: false,
          exploded: false,
          beatScale: 0,
          frozenAt: null,
          phraseId: -999, // 写真オブジェクト特別ID
          isCapturedPhoto: true
        };
        
        parentMesh.scaling.setAll(0); // 縮小状態からスタート
        this.finaleWords.push(word);
      } catch (e) {
        console.warn("Failed to create 3D polaroid for finale:", e);
      }
    });
    
    console.log(`[Lyric3D] Finale triggered. Total items rising: ${this.finaleWords.length}`);
  }

  private _create3DPolaroid(photo: any): Mesh {
    const parent = new Mesh("polaroidParent", this.scene);
    
    // 1. 白背景プレート
    const back = MeshBuilder.CreatePlane("polaroidBack", { width: 0.6, height: 0.75 }, this.scene);
    const backMat = new StandardMaterial("polaroidBackMat", this.scene);
    backMat.disableLighting = true;
    backMat.emissiveColor = new Color3(1.0, 1.0, 1.0);
    back.material = backMat;
    back.parent = parent;
    
    // 2. 写真画像プレート
    const imgPlane = MeshBuilder.CreatePlane("polaroidImg", { width: 0.52, height: 0.52 }, this.scene);
    const imgMat = new StandardMaterial("polaroidImgMat", this.scene);
    imgMat.disableLighting = true;
    const tex = new Texture(photo.dataUrl, this.scene);
    imgMat.emissiveTexture = tex;
    imgPlane.material = imgMat;
    imgPlane.parent = parent;
    imgPlane.position.y = 0.08;
    imgPlane.position.z = -0.005; // z-fighting 防止
    
    parent.billboardMode = Mesh.BILLBOARDMODE_ALL;
    return parent;
  }

  /** フレーズ単位で歌詞同士を線で繋ぎ、また写真をその中心（ハブ）に繋ぐ */
  private _updateConstellationLines(): void {
    const words = this.finaleActive ? this.finaleWords : this.hoveringWords;
    const groups: Record<number, LyricWord[]> = {};
    
    for (const w of words) {
      if (w.isCapturedPhoto || w.exploded || w.phraseId === -999 || w.phraseId === 0) continue;
      if (!groups[w.phraseId]) {
        groups[w.phraseId] = [];
      }
      groups[w.phraseId].push(w);
    }
    
    const lines: Vector3[][] = [];
    
    // 1. 同じフレーズの単語同士を時系列順に接続
    for (const phraseId in groups) {
      const group = groups[phraseId];
      if (group.length < 2) continue;
      group.sort((a, b) => a.spawnTime - b.spawnTime);
      const points = group.map(w => w.mesh.position);
      lines.push(points);
    }
    
    // 2. 撮影写真を最寄りの歌詞ワードと接続して星座のハブ化する
    const photos = words.filter(w => w.isCapturedPhoto);
    const lyrics = words.filter(w => !w.isCapturedPhoto && !w.exploded);
    if (photos.length > 0 && lyrics.length > 0) {
      for (const p of photos) {
        let nearest: LyricWord | null = null;
        let minDist = Infinity;
        for (const l of lyrics) {
          const dist = Vector3.Distance(p.mesh.position, l.mesh.position);
          if (dist < minDist) {
            minDist = dist;
            nearest = l;
          }
        }
        if (nearest) {
          lines.push([p.mesh.position, nearest.mesh.position]);
        }
      }
    }
    
    // 既存の星座線をクリア
    if (this.linesMesh) {
      this.linesMesh.dispose();
      this.linesMesh = null;
    }
    
    if (lines.length === 0) return;
    
    try {
      const colors: Color4[][] = [];
      for (const line of lines) {
        const lineColor = new Color4(0.0, 0.9, 1.0, 0.35); // シアン半透明
        colors.push(line.map(() => lineColor));
      }
      
      this.linesMesh = MeshBuilder.CreateLineSystem("constellationLines", {
        lines,
        colors,
        useVertexAlpha: true
      }, this.scene);
      this.linesMesh.parent = this.container;
    } catch (e) {
      console.warn("Failed to create constellation lines:", e);
    }
  }

  /** 全単語（active + settled + finale + hovering + sparks）を破棄してリセット */
  clear(): void {
    if (this.linesMesh) {
      this.linesMesh.dispose();
      this.linesMesh = null;
    }
    
    [...this.activeWords, ...this.settledWords, ...this.finaleWords, ...this.hoveringWords].forEach(w => this._dispose(w));
    this.activeWords = [];
    this.settledWords = [];
    this.finaleWords = [];
    this.hoveringWords = [];
    this.hoveringActive = false;
    
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

    const limit = this._getMaxSettled();
    // FIFO: 古いものを消す
    while (this.settledWords.length > limit) {
      const oldest = this.settledWords.shift()!;
      this._fadeAndDispose(oldest);
    }
  }

  /** フェードアウトしてから dispose（GC 負担を分散） */
  private _fadeAndDispose(w: LyricWord): void {
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
  private _findFreeSpawnPos(isRin?: boolean): Vector3 {
    const all = [...this.activeWords, ...this.settledWords];
    const sideSign = isRin === undefined ? (Math.random() > 0.5 ? 1 : -1) : (isRin ? 1 : -1);
    for (let i = 0; i < 20; i++) {
      const c = new Vector3(
        (Math.random() * 1.1) * sideSign,         // x: Rin = right, Miku = left
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
      (Math.random() * 1.1) * sideSign,
      0.6 + Math.random() * 0.6,
      (Math.random() - 0.5) * 1.2,
    );
  }

  /** メッシュ・テクスチャ・マテリアルを確実に解放 */
  private _dispose(w: LyricWord): void {
    if (w.isCapturedPhoto) {
      w.mesh.getChildMeshes().forEach(m => {
        m.material?.dispose();
        m.dispose();
      });
      w.mesh.dispose();
      return;
    }
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

    // 周囲に記号（Spark）を散らす
    const pos = w.mesh.position;
    const symbols = ["♫", "♡", "✨", "🎵", "♥", "🎶", "⭐"];
    
    for (let i = 0; i < 7; i++) {
      const spark = MeshBuilder.CreatePlane("spark", { width: 0.16, height: 0.16 }, this.scene);
      spark.billboardMode = Mesh.BILLBOARDMODE_ALL;
      spark.parent = this.container;
      spark.position.copyFrom(pos);

      const mat = new StandardMaterial("spark-mat", this.scene);
      mat.disableLighting = true;
      mat.useAlphaFromDiffuseTexture = true;
      mat.backFaceCulling = false;
      mat.emissiveColor = w.isChorus ? new Color3(0.0, 0.9, 1.0) : new Color3(1.0, 0.4, 0.9);
      spark.material = mat;

      const tex = AdvancedDynamicTexture.CreateForMesh(spark, 64, 64, false);
      const tb = new TextBlock();
      tb.text = symbols[Math.floor(Math.random() * symbols.length)];
      tb.fontFamily = "'Orbitron', 'Noto Sans JP', sans-serif";
      tb.fontSize = "46px";
      tb.fontWeight = "bold";
      tb.color = "#ffffff";
      tb.shadowColor = w.isChorus ? "rgba(0,220,255,0.9)" : "rgba(255,100,220,0.9)";
      tb.shadowBlur = 10;
      tex.addControl(tb);

      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 0.9;
      const velocity = new Vector3(
        Math.cos(angle) * speed,
        0.5 + Math.random() * 1.0, // 上方向
        Math.sin(angle) * speed
      );

      this.sparks.push({
        mesh: spark,
        texture: tex,
        velocity,
        spawnTime: Date.now(),
        duration: 500 + Math.random() * 300
      });
    }
  }
}
