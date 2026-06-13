/**
 * lyric3d.ts
 * 3D空間用歌詞演出モジュール (可読性・基本表示重視版)
 * TextAliveの再生位置と同期し、ミクの頭上周辺に歌詞を大きくはっきりとポップアップ表示する。
 */
import { Scene, MeshBuilder, Mesh, Vector3, TransformNode, Color3, StandardMaterial } from "@babylonjs/core";
import { AdvancedDynamicTexture, TextBlock } from "@babylonjs/gui";

interface ActiveWord {
  mesh: Mesh;
  texture: AdvancedDynamicTexture;
  textBlock: TextBlock;
  material: StandardMaterial;
  basePosition: Vector3;
  spawnTime: number; // 登場した実時刻
  duration: number;  // 表示時間 (ms)
}

export class Lyric3D {
  private scene: Scene;
  private activeWords: ActiveWord[] = [];
  private maxWords = 10; // 画面内に同時に表示する単語の上限
  private lyricContainer: TransformNode;

  constructor(scene: Scene) {
    this.scene = scene;
    
    // 歌詞をまとめるためのコンテナノードを作成
    this.lyricContainer = new TransformNode("lyric3DContainer", this.scene);
    this.updateContainerParent();

    // 【一時無効化】タップ・ホールドなどのインタラクションは、視認性安定化のため一旦コメントアウト
    /*
    this.scene.onPointerObservable.add((pointerInfo) => { ... });
    */
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
   * @param text 単語のテキスト
   * @param duration 表示時間 (ms) - 基本3000ms固定
   * @param isChorus サビ区間かどうか
   */
  spawnWord(text: string, duration: number, isChorus: boolean): void {
    if (!text || text.trim() === "") return;

    this.updateContainerParent();

    // 最大数を超えたら古い単語を即座に消す
    while (this.activeWords.length >= this.maxWords) {
      const oldest = this.activeWords.shift();
      if (oldest) this.disposeWord(oldest);
    }

    // 1. 文字数に応じた Plane サイズを設定 (確実に見えるよう大きめに設計)
    const width = Math.max(1.5, text.length * 0.5);
    const height = 1.0;
    const plane = MeshBuilder.CreatePlane("lyric-word-3d", { width, height }, this.scene);
    
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.parent = this.lyricContainer;

    // 2. 配置座標の決定 (ミクの上方に十分離して配置し、被らないようにする)
    const posX = (Math.random() - 0.5) * 1.5;
    const posY = 2.0 + Math.random() * 0.5; // y=2.0〜2.5m の高めの位置
    const posZ = (Math.random() - 0.5) * 0.8;
    const basePosition = new Vector3(posX, posY, posZ);
    plane.position.copyFrom(basePosition);

    // 3. 専用 StandardMaterial の新規作成 (透過と非ライト適用を明示的に指定)
    const mat = new StandardMaterial("lyric-word-mat", this.scene);
    mat.disableLighting = true; // 光源の影響を無視して発光感を出す
    mat.useAlphaFromDiffuseTexture = true; // テクスチャのアルファチャンネル（透明部分）を使用
    mat.backFaceCulling = false; // 裏側からも文字が見えるようにする
    plane.material = mat;

    // 4. 高解像度 (1024x256) のテクスチャを割り当て
    const texture = AdvancedDynamicTexture.CreateForMesh(plane, 1024, 256, false);

    // 5. テキストブロックの作成
    const textBlock = new TextBlock();
    textBlock.text = text;
    textBlock.fontFamily = "Orbitron, Noto Sans JP, sans-serif";
    textBlock.fontSize = "120px"; // 高解像度に対してはっきり見えるサイズ
    textBlock.fontWeight = "bold";
    
    // サビのときはマゼンタ、通常時はシアンネオン
    textBlock.color = isChorus ? "#e879f9" : "#22d3ee";
    textBlock.shadowColor = isChorus ? "rgba(232, 121, 249, 0.9)" : "rgba(34, 211, 238, 0.9)";
    textBlock.shadowBlur = 15;
    textBlock.shadowOffsetX = 0;
    textBlock.shadowOffsetY = 0;
    
    texture.addControl(textBlock);

    // 初期スケールは 0 (アニメーションで拡大)
    plane.scaling.setAll(0);

    const activeWord: ActiveWord = {
      mesh: plane,
      texture,
      textBlock,
      material: mat,
      basePosition,
      spawnTime: Date.now(),
      duration: duration
    };

    this.activeWords.push(activeWord);
  }

  /**
   * 毎フレームの描画更新処理 (出現・浮遊・フェードアウトのアニメーション)
   */
  update(): void {
    const now = Date.now();

    for (let i = this.activeWords.length - 1; i >= 0; i--) {
      const item = this.activeWords[i];
      const elapsed = now - item.spawnTime;
      const progress = elapsed / item.duration;

      if (progress >= 1.0) {
        this.disposeWord(item);
        this.activeWords.splice(i, 1);
        continue;
      }

      // 出現演出 (最初の 150ms で 0 から 1.0 に急拡大)
      const introDuration = 150;
      if (elapsed < introDuration) {
        const t = elapsed / introDuration;
        const scaleVal = Math.sin(t * Math.PI / 2); // 0 -> 1.0 (イージング)
        item.mesh.scaling.setAll(scaleVal);
        item.textBlock.alpha = t;
      } else {
        // ゆっくりと上昇浮遊させる
        const driftY = (elapsed - introDuration) * 0.00015; // 控えめな上昇速度
        item.mesh.position.y = item.basePosition.y + driftY;

        // 残り 500ms から徐々にフェードアウト＆縮小
        const remaining = item.duration - elapsed;
        const fadeDuration = 500;
        if (remaining < fadeDuration) {
          const fadeT = remaining / fadeDuration; // 1.0 -> 0.0
          item.mesh.scaling.setAll(fadeT);
          item.textBlock.alpha = fadeT;
        } else {
          item.mesh.scaling.setAll(1.0);
          item.textBlock.alpha = 1.0;
        }
      }
    }
  }

  /**
   * リソースの破棄処理
   */
  private disposeWord(item: ActiveWord): void {
    item.texture.dispose();
    item.material.dispose();
    item.mesh.dispose();
  }

  /**
   * 【一時無効化】ホールド火花のダミー定義 (main.tsでエラーにならないよう空メソッドにする)
   */
  spawnHoldSparks(): void {
    // 視認性重視のため現在は何もしない
  }

  /**
   * すべての3D歌詞をクリアする
   */
  clear(): void {
    this.activeWords.forEach(w => this.disposeWord(w));
    this.activeWords = [];
  }
}
