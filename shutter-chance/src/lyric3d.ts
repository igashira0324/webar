/**
 * lyric3d.ts
 * 3D空間用歌詞演出モジュール
 * TextAliveの再生位置と同期し、ミクの周囲（3D空間）に歌詞をポップアップさせる。
 * ユーザーが3D歌詞をタップ（クリック）することで、文字が弾けて光の破片が飛び散るインタラクションをサポート。
 */
import { Scene, MeshBuilder, Mesh, Vector3, TransformNode, Color3, PointerEventTypes, StandardMaterial } from "@babylonjs/core";
import { AdvancedDynamicTexture, TextBlock } from "@babylonjs/gui";

interface ActiveWord {
  mesh: Mesh;
  texture: AdvancedDynamicTexture;
  textBlock: TextBlock;
  startTime: number;
  duration: number;
  basePosition: Vector3;
  targetScale: Vector3;
  isChorus: boolean;
  spawnTime: number; // 登場した実時刻
  isExploding: boolean; // タップされて弾け中か
  explodeTime?: number; // 弾け開始時刻
}

interface SparkParticle {
  mesh: Mesh;
  velocity: Vector3;
  spawnTime: number;
  duration: number;
  material: StandardMaterial;
}

export class Lyric3D {
  private scene: Scene;
  private activeWords: ActiveWord[] = [];
  private particles: SparkParticle[] = [];
  private maxWords = 15; // 画面内に同時に表示する単語の上限
  private lyricContainer: TransformNode;

  constructor(scene: Scene) {
    this.scene = scene;
    
    // 歌詞をまとめるためのコンテナノードを作成
    this.lyricContainer = new TransformNode("lyric3DContainer", this.scene);
    this.updateContainerParent();

    // タップ・クリックによるインタラクション監視
    this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        const pickResult = pointerInfo.pickInfo;
        if (pickResult && pickResult.hit && pickResult.pickedMesh) {
          const pickedMesh = pickResult.pickedMesh;
          // タップされたメッシュが歌詞メッシュであるか探す
          const index = this.activeWords.findIndex(w => w.mesh === pickedMesh);
          if (index !== -1) {
            const word = this.activeWords[index];
            if (!word.isExploding) {
              this.triggerExplosion(word);
            }
          }
        }
      }
    });
  }

  /**
   * ARモード等で親ノード(arRoot)が変化した場合に追従させる
   */
  private updateContainerParent(): void {
    const xrData = (this.scene as any)._xrData;
    if (xrData && xrData.arRoot) {
      this.lyricContainer.parent = xrData.arRoot;
    }
  }

  /**
   * 新しい単語を3D空間にポップアップ表示する
   */
  spawnWord(text: string, duration: number, isChorus: boolean): void {
    if (!text || text.trim() === "") return;

    this.updateContainerParent();

    // 最大数を超えたら古い単語を即座に消す
    while (this.activeWords.length >= this.maxWords) {
      const oldest = this.activeWords.shift();
      if (oldest) this.disposeWord(oldest);
    }

    const width = Math.max(1.0, text.length * 0.25);
    const height = 0.5;
    const plane = MeshBuilder.CreatePlane("lyric-word-3d", { width, height }, this.scene);
    
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.parent = this.lyricContainer;

    // 配置座標の決定 (ミクの周囲にランダムに散らす)
    const rangeX = isChorus ? 1.5 : 0.8;
    const rangeY = isChorus ? 0.8 : 0.4;
    const rangeZ = isChorus ? 1.2 : 0.6;
    
    const posX = (Math.random() - 0.5) * rangeX;
    const posY = 1.6 + (Math.random() - 0.2) * rangeY;
    const posZ = (Math.random() - 0.5) * rangeZ;
    const basePosition = new Vector3(posX, posY, posZ);
    plane.position.copyFrom(basePosition);

    const textureWidth = 512;
    const textureHeight = 128;
    const texture = AdvancedDynamicTexture.CreateForMesh(plane, textureWidth, textureHeight, false);

    const textBlock = new TextBlock();
    textBlock.text = text;
    textBlock.fontFamily = "Orbitron, Noto Sans JP, sans-serif";
    textBlock.fontSize = isChorus ? "54px" : "40px";
    textBlock.fontWeight = "bold";
    
    textBlock.color = isChorus ? "#e879f9" : "#22d3ee";
    textBlock.shadowColor = isChorus ? "rgba(232, 121, 249, 0.8)" : "rgba(34, 211, 238, 0.8)";
    textBlock.shadowBlur = 12;
    
    texture.addControl(textBlock);

    const material = plane.material as any;
    if (material) {
      material.backFaceCulling = true;
      if (material.emissiveColor) {
        material.emissiveColor = isChorus ? new Color3(0.9, 0.3, 0.9) : new Color3(0.1, 0.8, 0.9);
      }
      material.useAlphaFromDiffuseTexture = true;
    }

    plane.scaling.setAll(0.1);

    const activeWord: ActiveWord = {
      mesh: plane,
      texture,
      textBlock,
      startTime: Date.now(),
      duration: Math.max(500, duration),
      basePosition,
      targetScale: new Vector3(1, 1, 1),
      isChorus,
      spawnTime: Date.now(),
      isExploding: false
    };

    this.activeWords.push(activeWord);
  }

  /**
   * タップされた際の弾け（エクスプロージョン）トリガー
   */
  private triggerExplosion(word: ActiveWord): void {
    word.isExploding = true;
    word.explodeTime = Date.now();
    
    // 弾けた瞬間にカラーを緑系のネオンに変化させ発光を強める
    word.textBlock.color = "#00ff88";
    word.textBlock.shadowColor = "rgba(0, 255, 136, 0.9)";
    word.textBlock.shadowBlur = 32;

    // 四散するキラキラの破片（パーティクル）を生成
    const particleCount = word.isChorus ? 8 : 5;
    const colors = word.isChorus 
      ? [new Color3(1, 0, 1), new Color3(1, 1, 0), new Color3(0, 1, 1)]
      : [new Color3(0, 1, 1), new Color3(1, 1, 1)];

    for (let i = 0; i < particleCount; i++) {
      const pSize = 0.05 + Math.random() * 0.05;
      const p = MeshBuilder.CreatePlane("lyric-particle", { width: pSize, height: pSize }, this.scene);
      p.billboardMode = Mesh.BILLBOARDMODE_ALL;
      p.parent = this.lyricContainer;
      p.position.copyFrom(word.mesh.position);

      const mat = new StandardMaterial("particle-mat", this.scene);
      const randomColor = colors[Math.floor(Math.random() * colors.length)];
      mat.emissiveColor = randomColor;
      mat.diffuseColor = randomColor;
      mat.disableLighting = true;
      p.material = mat;

      // ランダムな放出ベクトル（放射状かつやや上向き）
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.8 + Math.random() * 1.5;
      const velocity = new Vector3(
        Math.cos(angle) * speed,
        1.0 + Math.random() * 1.5,
        Math.sin(angle) * speed
      );

      this.particles.push({
        mesh: p,
        velocity,
        spawnTime: Date.now(),
        duration: 400 + Math.random() * 300, // 寿命 400~700ms
        material: mat
      });
    }
  }

  /**
   * 毎フレームの描画更新処理
   */
  update(): void {
    const now = Date.now();

    // 1. パーティクル（破片）の更新
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      const elapsed = now - p.spawnTime;
      const progress = elapsed / p.duration;

      if (progress >= 1.0) {
        p.mesh.dispose();
        p.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }

      // 重力を少し受けて放物線を描きつつ四散移動
      p.mesh.position.addInPlace(p.velocity.scale(0.016)); // 約60fps想定のデルタ
      p.velocity.y -= 0.05; // 重力加速度

      p.mesh.visibility = 1.0 - progress;
      p.mesh.scaling.setAll(1.0 - progress * 0.5);
    }

    // 2. 歌詞テキストの更新
    for (let i = this.activeWords.length - 1; i >= 0; i--) {
      const item = this.activeWords[i];

      // 弾けている最中の処理
      if (item.isExploding) {
        const explodeElapsed = now - item.explodeTime!;
        const explodeProgress = explodeElapsed / 300; // 300msで弾けて消える

        if (explodeProgress >= 1.0) {
          this.disposeWord(item);
          this.activeWords.splice(i, 1);
          continue;
        }

        // 急拡大しつつ回転し、フェードアウト
        const scaleVal = 1.0 + explodeProgress * 2.0; // 1.0 -> 3.0
        item.mesh.scaling.setAll(scaleVal);
        item.textBlock.alpha = 1.0 - explodeProgress;
        
        // 少し浮上させる
        item.mesh.position.y += 0.02;
        continue;
      }

      const elapsed = now - item.spawnTime;
      const progress = elapsed / item.duration;

      if (progress >= 1.0) {
        this.disposeWord(item);
        this.activeWords.splice(i, 1);
        continue;
      }

      // 出現演出 (最初の150msで閃光のように急拡大)
      const introDuration = 150;
      if (elapsed < introDuration) {
        const t = elapsed / introDuration;
        const scaleVal = 0.1 + (1.2 * Math.sin(t * Math.PI / 2));
        item.mesh.scaling.setAll(scaleVal);
        item.textBlock.shadowBlur = 24 * (1.0 - t);
      } else {
        // 通常の浮遊とフェードアウト
        const driftY = (elapsed - introDuration) * 0.0003;
        item.mesh.position.y = item.basePosition.y + driftY;

        // 残り200msからフェードアウト＆縮小
        const remaining = item.duration - elapsed;
        if (remaining < 200) {
          const fadeT = remaining / 200;
          item.mesh.scaling.setAll(fadeT);
          item.textBlock.alpha = fadeT;
        } else {
          item.mesh.scaling.setAll(1.0);
          item.textBlock.alpha = 1.0;
        }
      }
    }
  }

  private disposeWord(item: ActiveWord): void {
    item.texture.dispose();
    item.mesh.dispose();
  }

  /**
   * サビ長押し時に空間にネオン火花を散らす
   */
  spawnHoldSparks(): void {
    if (Math.random() > 0.3) return;

    const pSize = 0.03 + Math.random() * 0.03;
    const p = MeshBuilder.CreatePlane("hold-particle", { width: pSize, height: pSize }, this.scene);
    p.billboardMode = Mesh.BILLBOARDMODE_ALL;
    p.parent = this.lyricContainer;

    // ミクの周囲のランダム位置に配置
    const posX = (Math.random() - 0.5) * 1.6;
    const posY = 0.5 + Math.random() * 1.8;
    const posZ = (Math.random() - 0.5) * 1.6;
    p.position.set(posX, posY, posZ);

    const mat = new StandardMaterial("hold-particle-mat", this.scene);
    const colors = [new Color3(1, 0, 1), new Color3(0, 1, 1), new Color3(1, 1, 0)];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    mat.emissiveColor = randomColor;
    mat.diffuseColor = randomColor;
    mat.disableLighting = true;
    p.material = mat;

    // 上方向へゆっくり漂う速度ベクトル
    const velocity = new Vector3(
      (Math.random() - 0.5) * 0.4,
      0.3 + Math.random() * 0.5,
      (Math.random() - 0.5) * 0.4
    );

    this.particles.push({
      mesh: p,
      velocity,
      spawnTime: Date.now(),
      duration: 600 + Math.random() * 400,
      material: mat
    });
  }

  /**
   * すべての3D歌詞およびパーティクルをクリアする
   */
  clear(): void {
    this.activeWords.forEach(w => this.disposeWord(w));
    this.activeWords = [];
    this.particles.forEach(p => {
      p.mesh.dispose();
      p.material.dispose();
    });
    this.particles = [];
  }
}
