# WebAR MMD Viewer

MMD (PMX) モデルと VMD モーションをブラウザ上で再生し、WebAR で表示できるローカル Web アプリです。
`babylon-mmd` を使用して、PMX + VMD を直接読み込みます。

## 技術スタック

- Vite
- TypeScript
- Babylon.js
- babylon-mmd
- WebXR AR (ARCore / Android Chrome)

## WebXR AR 機能 (v3.1)

すべて optional feature として要求するため、未対応端末では自動的にフォールバックします。

| 機能 | 内容 |
|---|---|
| Hit Test + 配置レティクル | 画面中央の床面にリングを表示し、タップした位置へモデルを配置 |
| Light Estimation (照明推定) | 実空間の光の向き・色・強さをモデルの照明と影に反映 |
| Depth Sensing (深度オクルージョン) | 手前の人や家具でモデルが隠れる。AR 画面左上のボタンで ON/OFF 切替可 |
| Anchors (空間アンカー) | 配置位置を ARCore アンカーに固定し、歩き回った際の位置ずれを補正 |
| DOM Overlay | AR 中のジェスチャー操作 (回転/ピンチ拡縮/タップ再配置) と各種ボタン表示 |

## セットアップ

1.  **初期設定 (Makefile 推奨):**
    ```bash
    make setup
    ```
    ※ 依存関係のインストールに加え、`npmmirror` レジストリの設定と Havok 物理演算 WASM の配備を自動で行います。

2.  **アセットの配置:**
    `public/assets/` 配下に以下のようにファイルを配置してください。
    - `public/assets/model/miku.pmx` (モデル本体: デフォルト設定)
    - `public/assets/motion/dance.vmd` (モーションファイル)

## 起動方法

### 開発用 (HTTP)
PC ブラウザでのデバッグ用です。
```bash
make dev
```

### 展示用 / AR 用 (HTTPS / LAN)
スマホからアクセスして WebAR を使用するために、HTTPS で起動します。
```bash
make dev-https
```
起動後、表示される LAN IP アドレス (例: `https://192.168.x.x:5173`) にスマホからアクセスしてください。
※ HTTPS が必須です（Vite の `basic-ssl` プラグインを使用）。

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
