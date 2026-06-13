# Shutter Chance AR ― ミクと撮る一瞬

**マジカルミライ2026 プログラミング・コンテスト 応募作品**

---

## 🎵 概要

課題曲「シャッターチャンス / 夜未アガリ feat. 初音ミク、鏡音リン」の歌詞・ビート・サビに同期して、
WebAR空間で初音ミクが踊り、サビの決め瞬間に"シャッターを切って写真が溜まる"体験アプリです。

### コンセプト

曲名「シャッターチャンス」を文字通り体験に。
- サビ前にビューファインダーが現れ、AF合焦演出
- サビ頭のビートでフラッシュ＋シャッター音→ポラロイド写真が生成
- 曲が進むほど「ミクとの思い出の写真」が積み重なるギャラリー

---

## 🛠 技術スタック

| 技術 | 用途 |
|------|------|
| [TextAlive App API](https://developer.textalive.jp) | 歌詞・ビート・サビ同期 |
| [Babylon.js](https://www.babylonjs.com) | 3D/AR レンダリング |
| [babylon-mmd](https://github.com/noname0310/babylon-mmd) | MMD(PMX/VMD)再生 |
| WebXR Device API | AR体験（Android/ARCore） |
| Vite + TypeScript | ビルドツール |

---

## 📱 動作環境

| 環境 | 体験内容 |
|------|---------|
| **Android Chrome (ARCore対応)** | フル AR 体験 ★推奨★ |
| PC Chrome / Safari | スタジオモード（仮想背景で全機能動作） |
| iOS Safari | スタジオモード（WebXR非対応のためAR不可） |

> **AR体験は Android (ARCore 対応端末) + Chrome が最もリッチに動作します。**

---

## 🏗 ビルド・実行手順

```bash
# 依存関係インストール（初回のみ）
npm install

# 開発サーバー起動
npm run dev
# → http://localhost:5173/shutter-chance/ でアクセス

# 本番ビルド
npm run build
# → dist/shutter-chance/index.html が出力される
```

---

## 🔑 TextAlive App Token 設定

`shutter-chance/src/textAliveSync.ts` の以下の箇所に取得したトークンを設定してください：

```typescript
// TODO: ここにTextAlive App tokenを設定
const APP_TOKEN = "あなたのトークン";
```

App Token は [developer.textalive.jp](https://developer.textalive.jp) で取得できます。

---

## 🎵 楽曲情報（バージョン固定）

```typescript
Song URL: "https://piapro.jp/t/PNpQ/20251209170719"
beatId: 4827295
chordId: 2963756
repetitiveSegmentId: 3086263
lyricId: 126542
lyricDiffId: 28628
```

---

## 📝 クレジット・ライセンス

- **楽曲**: シャッターチャンス / 夜未アガリ feat. 初音ミク、鏡音リン © 夜未アガリ
- **TextAlive App API**: © Textalive, Inc.
- **3Dモデル**: 使用モデルの作者規約に従って使用
- **キャラクター**: 初音ミク、鏡音リン — © Crypton Future Media, INC. (ピアプロキャラクターズ)

---

## 📋 使い方

1. ページを開くとモード選択画面が表示されます
2. **ARモード**（Android/ARCoreのみ）または **スタジオモード** を選択
3. ▶ ボタンで楽曲再生開始
4. サビでビューファインダーが現れ、自動でシャッターが切れます
5. サビ中は画面タップ（PC: スペースキー）で追加撮影も可能
6. 🖼 ギャラリーボタンで撮れた写真を確認・保存
