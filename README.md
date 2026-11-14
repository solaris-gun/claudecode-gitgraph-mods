# claudecode-gitgraph-mods
ClaudeCodeにGithubのGraphを表示するModsになります。

Claude Code のコンソール内に、Git のブランチ状況（ネットワークグラフ）を表示する mod です。

## できること
- `/gitgraph` でペインを開き、次の情報を表示します
  - ブランチ一覧と現在のブランチ（`*` 印、「ブランチ一覧」表示）
  - 追跡先（upstream）との差分 `↑ahead ↓behind`
  - コミットグラフ（直近50件）。ブランチごとに1本の太い線と1色を割り当て、凡例の色と線の色が一致。合流済みのブランチは自分の色のまま合流点まで描き、凡例はブランチごとに別の色で、グラフ上のブランチ名も同じ色で表示。早送りで別の線に載ったブランチは「（○○ に合流済み）」「（○○ の線上）」と表示
  - コミット履歴の一覧（直近50件：ハッシュ・日時（例 `2026.11.14-09:30`）・作成者・メッセージ）
- ペイン内のボタン
  - `ローカル`（L キー）/ `ローカル＋リモート`（A キー）：表示範囲の切り替え。初期表示はローカル
  - `更新`（R キー）：手動で読み直し
  - `Git Graph`（G キー）/ `Git History`（H キー）/ `ブランチ一覧`（B キー）：表示の切り替え
- Claude が `git` / `gh` コマンドを実行した直後に自動で更新します（一定間隔の自動更新はしません）
- ステータス行に `⎇ main ↑2 ↓0` の形で現在のブランチを表示します（設定でオフにできます）
  - `↑`：まだ push していないコミット数、`↓`：まだ pull していないコミット数（最後に fetch した時点）

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

### おすすめ：フルスクリーン表示で使う
ペインを**画面の右側**に表示し、**マウスでボタンを押せる**ようにするには、Claude Code をフルスクリーン表示にします。

| 操作 | 入力するもの |
|---|---|
| フルスクリーン表示にする | プロンプトで `/tui fullscreen`（設定が保存され、会話を保ったまま再起動します） |
| 元の表示に戻す | `/tui default` |
| 今の表示モードを確認する | `/tui` |
| その起動だけフルスクリーンにする | `CLAUDE_CODE_NO_FLICKER=1 claude` |

- フルスクリーンでない場合、ペインはプロンプトの上に表示され、マウスのクリックは使えません（キー操作は使えます）
- フルスクリーンでも画面の幅が狭いと、ペインはプロンプトの上に表示されます
- 参考：[Claude Code 公式ドキュメント「Fullscreen」](https://code.claude.com/docs/en/fullscreen.md)

### キー操作
| キー | 動作 |
|---|---|
| `L` / `A` | 表示範囲：ローカル / ローカル＋リモート |
| `G` / `H` / `B` | 表示：Git Graph / Git History / ブランチ一覧 |
| `R` | 更新 |
| `Esc` | ペインを閉じる（ペインにキー入力があるとき） |
| `ctrl+x` → `tab` | プロンプトからペインへ移動 |
| `ctrl+x` → `x` | ペインを閉じる |

- `/gitgraph` で開いた直後はペインがキー入力を受け取ります
- コマンドで閉じる場合は `/gitgraph close`

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
