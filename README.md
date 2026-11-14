# claudecode-gitgraph-mods
ClaudeCodeにGithubのGraphを表示するModsになります。

Claude Code のコンソール内に、Git のブランチ状況（ネットワークグラフ）を表示する mod です。

## できること（v1）
- `/gitgraph` でペインを開き、次の情報を表示します
  - ブランチ一覧と現在のブランチ（`*` 印）
  - 追跡先（upstream）との差分 `↑ahead ↓behind`
  - `git log --graph` 風のコミットグラフ（直近50件）。太い線で、列（レーン）ごとに色分けし、色とブランチ名の凡例を表示
  - コミット履歴の一覧（直近50件：ハッシュ・日時（例 `2026.11.14-09:30`）・作成者・メッセージ）
- ペイン内のボタン
  - `ローカル`（L キー）/ `ローカル＋リモート`（A キー）：表示範囲の切り替え。初期表示はローカル
  - `更新`（R キー）：手動で読み直し
  - `Git Graph`（G キー）/ `Git History`（H キー）：グラフ表示とコミット履歴一覧の切り替え
- Claude が `git` / `gh` コマンドを実行した直後に自動で更新します（一定間隔の自動更新はしません）
- ステータス行に `⎇ main ↑2 ↓0` の形で現在のブランチを表示します（設定でオフにできます）

## インストール
ターミナル版 Claude Code のプロンプトで次を入力します（マーケットプレイス追加の確認は `y`、続けてスコープを選択）。

```
/plugin install claudecode-gitgraph-mods --marketplace solaris-gun/claudecode-gitgraph-mods
```

シェルからインストールする場合：

```bash
claude plugin install claudecode-gitgraph-mods --marketplace solaris-gun/claudecode-gitgraph-mods
```

## 使い方
Git リポジトリのフォルダで Claude Code を起動し、プロンプトで `/gitgraph` と入力するとペインが開きます。

### 開発中のフォルダから直接読み込む場合

```bash
claude --plugin-dir /path/to/claudecode-gitgraph-mods
```

## 設定
| 項目 | 既定値 | 内容 |
|---|---|---|
| `statusLine` | `true` | ステータス行にブランチ情報を出すかどうか。`/config` から切り替えられます |

## 構成
| ファイル | 役割 |
|---|---|
| `.claude-plugin/plugin.json` | mod の定義と設定項目 |
| `hooks/register.tsx` | ペイン・コマンド・自動更新・ステータス行 |
| `hooks/git.ts` | git コマンドの実行と結果の解析 |
| `types/index.d.ts` | mod が保持する値の型 |
| `tests/gitgraph.test.tsx` | テスト（`claude plugin test .` で実行） |
