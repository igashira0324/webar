/**
 * lyric3d.ts
 * 3D空間用歌詞演出モジュール
 * TextAliveの再生位置と同期し、ミクの周囲（3D空間）に歌詞をポップアップさせる。
 */
import { Scene, MeshBuilder, Mesh, Vector3, TransformNode, Color3 } from "@babylonjs/core";
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
}

export class Lyric3D {
  private scene: Scene;
  private activeWords: ActiveWord[] = [];
  private maxWords = 15; // 画面内に同時に表示する単語の上限
  private lyricContainer: TransformNode;

  constructor(scene: Scene) {
    this.scene = scene;
    
    // 歌詞をまとめるためのコンテナノードを作成
    // ARモードの場合、arRoot が見つかればその子要素にする
    this.lyricContainer = new TransformNode("lyric3DContainer", this.scene);
    this.updateContainerParent();
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
   * @param duration 表示時間 (ms)
   * @param isChorus サビ区間かどうか
   */
  spawnWord(text: string, duration: number, isChorus: boolean): void {
    if (!text || text.trim() === "") return;

    // ARの親ノードの状況を毎度チェックして更新
    this.updateContainerParent();

    // 最大数を超えたら古い単語を即座に消す
    while (this.activeWords.length >= this.maxWords) {
      const oldest = this.activeWords.shift();
      if (oldest) this.disposeWord(oldest);
    }

    // 単語パネル用Planeを作成
    // 文字の長さに合わせてアスペクト比を微調整
    const width = Math.max(1.0, text.length * 0.25);
    const height = 0.5;
    const plane = MeshBuilder.CreatePlane("lyric-word-3d", { width, height }, this.scene);
    
    // 常にカメラを向くように設定
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.parent = this.lyricContainer;

    // 配置座標の決定
    // ミクの周囲（ミクの身長約1.6mを基準に、頭上や左右にランダムに散らす）
    // サビのときはよりダイナミックに拡散させる
    const rangeX = isChorus ? 1.5 : 0.8;
    const rangeY = isChorus ? 0.8 : 0.4;
    const rangeZ = isChorus ? 1.2 : 0.6;
    
    const posX = (Math.random() - 0.5) * rangeX;
    const posY = 1.6 + (Math.random() - 0.2) * rangeY; // 頭上周辺
    const posZ = (Math.random() - 0.5) * rangeZ;
    const basePosition = new Vector3(posX, posY, posZ);
    plane.position.copyFrom(basePosition);

    // テクスチャとGUIテキストブロックの作成
    // 文字の鮮明さを保つため高解像度にする
    const textureWidth = 512;
    const textureHeight = 128;
    const texture = AdvancedDynamicTexture.CreateForMesh(
      plane,
      textureWidth,
      textureHeight,
      false
    );

    const textBlock = new TextBlock();
    textBlock.text = text;
    textBlock.fontFamily = "Orbitron, Noto Sans JP, sans-serif";
    textBlock.fontSize = isChorus ? "54px" : "40px";
    textBlock.fontWeight = "bold";
    
    // サビのときはピンク/イエロー系のネオン、それ以外はシアン/ホワイト系のネオン
    textBlock.color = isChorus ? "#e879f9" : "#22d3ee";
    textBlock.shadowColor = isChorus ? "rgba(232, 121, 249, 0.8)" : "rgba(34, 211, 238, 0.8)";
    textBlock.shadowBlur = 12;
    textBlock.shadowOffsetX = 0;
    textBlock.shadowOffsetY = 0;
    
    texture.addControl(textBlock);

    // マテリアル設定（裏面を非表示、エミッシブカラーで自己発光させる）
    const material = plane.material as any;
    if (material) {
      material.backFaceCulling = true;
      // 完全に発光させるためにマテリアルを微調整
      if (material.emissiveColor) {
        material.emissiveColor = isChorus
          ? new Color3(0.9, 0.3, 0.9)
          : new Color3(0.1, 0.8, 0.9);
      }
      material.useAlphaFromDiffuseTexture = true;
    }

    // 初期スケール（閃光アニメーション用に最初は少し小さくしておき、急拡大させる）
    plane.scaling.setAll(0.1);

    const activeWord: ActiveWord = {
      mesh: plane,
      texture,
      textBlock,
      startTime: Date.now(),
      duration: Math.max(500, duration), // 最低500msは残す
      basePosition,
      targetScale: new Vector3(1, 1, 1),
      isChorus,
      spawnTime: Date.now()
    };

    this.activeWords.push(activeWord);
  }

  /**
   * 毎フレームの描画更新処理
   * アニメーション（出現時の拡大・発光、消滅時のフェードアウト・上昇）を制御する
   */
  update(): void {
    const now = Date.now();

    for (let i = this.activeWords.length - 1; i >= 0; i--) {
      const item = this.activeWords[i];
      const elapsed = now - item.spawnTime;
      const progress = elapsed / item.duration;

      if (progress >= 1.0) {
        // 表示期間終了 → 消去
        this.disposeWord(item);
        this.activeWords.splice(i, 1);
        continue;
      }

      // 1. 出現演出 (最初の150msで閃光のように急拡大)
      const introDuration = 150;
      if (elapsed < introDuration) {
        const t = elapsed / introDuration;
        // 0.1 から 1.4 まで拡大して少しバウンドさせて 1.0 にする演出
        const scaleVal = 0.1 + (1.3 * Math.sin(t * Math.PI / 2));
        item.mesh.scaling.setAll(scaleVal);
        
        // 登場時の一瞬のフラッシュ（シャドウブラー強化）
        item.textBlock.shadowBlur = 24 * (1.0 - t);
      } else {
        // 2. 通常時・退場演出
        // 時間経過に合わせて少しずつ上方に浮遊させる（上昇演出）
        const driftY = (elapsed - introDuration) * 0.0003;
        item.mesh.position.y = item.basePosition.y + driftY;

        // 残り200msからフェードアウト＆縮小
        const remaining = item.duration - elapsed;
        if (remaining < 200) {
          const fadeT = remaining / 200; // 1.0 -> 0.0
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
   * リソースのクリーンアップ
   */
  private disposeWord(item: ActiveWord): void {
    item.texture.dispose();
    item.mesh.dispose();
  }

  /**
   * すべての3D歌詞をクリアする（曲のシークや停止時用）
   */
  clear(): void {
    this.activeWords.forEach(w => this.disposeWord(w));
    this.activeWords = [];
  }
}
