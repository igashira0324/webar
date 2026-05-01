# WebAR MMD Viewer

MMD (PMX) モデルと VMD モーションをブラウザ上で再生し、WebAR で表示できるローカル Web アプリです。
`babylon-mmd` を使用して、PMX + VMD を直接読み込みます。

## 技術スタック

- Vite
- TypeScript
- Babylon.js
- babylon-mmd
- WebXR AR (ARCore / Android Chrome)

## セットアップ

1.  依存関係のインストール:
    ```bash
    npm install
    ```

2.  アセットの配置:
    `public/assets/` 配下に以下のようにファイルを配置してください。
    - `public/assets/model/model.pmx` (モデル本体)
    - `public/assets/model/textures/` (テクスチャ類)
    - `public/assets/motion/dance.vmd` (モーションファイル)
    - `public/assets/audio/music.mp3` (任意: 音声ファイル)

## 起動方法

### 開発用 (HTTP)
PC ブラウザでのプレビュー確認用です。
```bash
npm run dev
```

### 展示用 / AR 用 (HTTPS / LAN)
スマホからアクセスして WebAR を使用するために、HTTPS で起動します。
```bash
npm run dev:https
```
起動後、表示される IP アドレス (例: `https://192.168.x.x:5173`) にスマホからアクセスしてください。
※ 初回アクセス時に「この接続はプライベートではありません」と表示される場合は、「詳細設定」から「続行」を選択してください。

## WebAR の使い方 (Android)

1.  Android Chrome でアプリの URL を開きます。
2.  「AR 開始」ボタンをタップします。
3.  カメラの許可を求められたら「許可」します。
4.  モデルが現実空間に表示されます (初期位置はユーザーの 2m 前方)。

※ WebXR ARCore に対応した端末が必要です。

## 注意事項

- **iOS への対応**: 現時点では WebXR (immersive-ar) が Android Chrome (ARCore) 優先のため、iOS Safari では正常に動作しない可能性が高いです。
- **物理演算**: パフォーマンス安定のため、初期状態では OFF になっています。
- **ファイル選択**: `public/assets` にファイルを置かずに、画面上の「ファイル選択を表示」から手動で PMX/VMD/テクスチャフォルダを選択して読み込むことも可能です。

## よくあるエラーと対処法

- **モデルが表示されない**: PMX のパスやテクスチャの相対パスが正しいか確認してください。ブラウザのコンソールに 404 エラーが出ていないか確認してください。
- **AR が起動しない**: 端末が ARCore に対応しているか、Chrome が最新版か確認してください。
- **テクスチャが真っ黒**: ファイル選択モードでテクスチャフォルダを選択する際、PMX 内で指定されている相対パスと一致しているか確認してください。
