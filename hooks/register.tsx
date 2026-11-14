import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeKey } from 'claude-code'

import type { GraphLine, Scope, Snapshot, View } from '../types'
import { COMMITS, collect, commitDate, isGitCommand, statusText } from './git'

const PANE = 'gitgraph'
const TITLE = 'Git Graph'

// Change a tag when that value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const scope = atom({ plugin: 'claudecode-gitgraph-mods', key: 'scope' } as const, 'local' as Scope, {
  shape: 'scope-1',
})
const snapshot = atom(
  { plugin: 'claudecode-gitgraph-mods', key: 'snapshot' } as const,
  null as Snapshot | null,
  { shape: 'snapshot-6' },
)
const view = atom({ plugin: 'claudecode-gitgraph-mods', key: 'view' } as const, 'graph' as View, {
  shape: 'view-1',
})

// Display width in terminal cells: CJK and full-width characters take two.
const cells = (text: string): number =>
  [...text].reduce((n, ch) => n + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1), 0)
const padCells = (text: string, width: number): string => {
  let out = ''
  for (const ch of text) {
    if (cells(out + ch) > width) break
    out += ch
  }
  return out + ' '.repeat(width - cells(out))
}
// One line that fits `width` cells: cut with … rather than wrapped.
const fit = (text: string, width: number): string => {
  const line = text.replace(/[\r\n]+/g, ' ')
  if (cells(line) <= width) return line
  if (width <= 1) return width === 1 ? '…' : ''
  return padCells(line, width - 1).trimEnd() + '…'
}
// One theme color per branch line, cycling, so they read in light and dark.
const LANES: ThemeKey[] = ['error', 'success', 'warning', 'suggestion', 'merged', 'planMode']
const lane = (index: number | undefined): { color?: ThemeKey } =>
  index === undefined ? {} : { color: LANES[index % LANES.length] }

const commits = (graph: GraphLine[]) => graph.filter(line => line.hash !== undefined)

const pad = (n: number): string => String(n).padStart(2, '0')
const clockText = (ms: number): string => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// Module state: starts over on each reload, which is fine for a lock.
let showStatus = true
let running: Promise<void> | undefined
let isQueued = false

// One git read at a time; a request while one runs reads once more after it.
async function refresh($: EngineInterface): Promise<void> {
  if (running !== undefined) {
    isQueued = true
    return running
  }
  running = (async () => {
    do {
      isQueued = false
      const now = await $.clock.now()
      const current = await read($, scope)
      let next: Snapshot
      try {
        next = await collect(argv => $.process.run(argv), current, now)
      } catch (error) {
        next = {
          isRepo: false,
          head: '',
          branches: [],
          graph: [],
          legend: [],
          scope: current,
          updatedAt: now,
          error: error instanceof Error ? error.message : String(error),
        }
      }
      await update($, snapshot, () => next)
      if (showStatus) {
        $.ui.status(next.isRepo ? statusText(next) : undefined)
      }
    } while (isQueued)
  })().finally(() => {
    running = undefined
  })
  return running
}

export const register: Register = (on, options) => {
  showStatus = options.statusLine !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'gitgraph',
      description: 'Open the Git branch graph pane (/gitgraph close to close it)',
    })
    const started = await next(e)
    if (showStatus) {
      void refresh($).catch(() => undefined)
    }
    return started
  })

  on('command.run', { command: 'gitgraph' }, async ($, e) => {
    if (e.args.trim() === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Git Graph pane closed.' }
    }
    await refresh($)
    // Take the keys so L/A/R/G/H/B work at once (Esc closes the pane), and
    // ask for room for the graph when seated inline above the prompt.
    await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true, rows: 30 })
    return { text: 'Git Graph pane opened.' }
  })

  // Refresh right after Claude runs a git command.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && isGitCommand(e.command)) {
      void refresh($).catch(() => undefined)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const shown = await read($, scope)
    const mode = await read($, view)
    const snap = await read($, snapshot)
    const columns = e.props.bodyColumns ?? 80

    const setScope = async (to: Scope) => {
      await update($, scope, () => to)
      await refresh($)
    }

    const toolbar = (
      <Box flexDirection="row" gap={1}>
        <Button
          key="scope-local"
          hotkey="l"
          variant={shown === 'local' ? 'primary' : 'secondary'}
          onPress={() => setScope('local')}
        >
          {shown === 'local' ? '● ' : '○ '}ローカル
        </Button>
        <Button
          key="scope-all"
          hotkey="a"
          variant={shown === 'all' ? 'primary' : 'secondary'}
          onPress={() => setScope('all')}
        >
          {shown === 'all' ? '● ' : '○ '}ローカル＋リモート
        </Button>
        <Button key="refresh" hotkey="r" onPress={() => refresh($)}>
          更新
        </Button>
      </Box>
    )
    const viewbar = (
      <Box flexDirection="row" gap={1}>
        <Button
          key="view-graph"
          hotkey="g"
          variant={mode === 'graph' ? 'primary' : 'secondary'}
          onPress={() => update($, view, () => 'graph')}
        >
          {mode === 'graph' ? '● ' : '○ '}Git Graph
        </Button>
        <Button
          key="view-history"
          hotkey="h"
          variant={mode === 'history' ? 'primary' : 'secondary'}
          onPress={() => update($, view, () => 'history')}
        >
          {mode === 'history' ? '● ' : '○ '}Git History
        </Button>
        <Button
          key="view-branches"
          hotkey="b"
          variant={mode === 'branches' ? 'primary' : 'secondary'}
          onPress={() => update($, view, () => 'branches')}
        >
          {mode === 'branches' ? '● ' : '○ '}ブランチ一覧
        </Button>
      </Box>
    )

    if (snap === null) {
      return (
        <Box flexDirection="column">
          {toolbar}
          <Text dimColor>読み込み中…「更新」を押してください。</Text>
        </Box>
      )
    }

    if (!snap.isRepo) {
      return (
        <Box flexDirection="column">
          {toolbar}
          <Text color="warning">このフォルダは Git リポジトリではありません。</Text>
          {snap.error !== undefined && <Text dimColor>{snap.error}</Text>}
        </Box>
      )
    }

    const branches = snap.branches.filter(b => shown === 'all' || !b.isRemote)
    const remotes = new Set(snap.branches.filter(b => b.isRemote).map(b => b.name))
    const current = snap.branches.find(b => b.isCurrent)

    return (
      <Box flexDirection="column">
        {toolbar}
        {viewbar}
        {!e.props.isFocused && (
          <Text dimColor>
            キー操作: ctrl+x tab でこのペインへ ・ 閉じる: ctrl+x x または /gitgraph close
          </Text>
        )}
        <Text dimColor>
          現在: {snap.head}
          {current?.upstream !== undefined
            ? ` → ${current.upstream} ↑${current.ahead} ↓${current.behind}`
            : ''}
          {' ・ '}ブランチ {branches.length} ・ 更新 {clockText(snap.updatedAt)}
        </Text>

        {mode === 'branches' && <Text bold>ブランチ（{branches.length}）</Text>}
        {mode === 'branches' &&
          branches.map(b => (
            <Box flexDirection="row">
              <Text color={b.isCurrent ? 'success' : undefined} bold={b.isCurrent} mono>
                {b.isCurrent ? '* ' : '  '}
                {b.name}
              </Text>
              {b.upstream !== undefined ? (
                <Text dimColor>
                  {' '}→ {b.upstream}
                  {b.isGone ? ' (gone)' : ` ↑${b.ahead} ↓${b.behind}`}
                </Text>
              ) : (
                !b.isRemote && <Text dimColor> (upstream なし)</Text>
              )}
            </Box>
          ))}

        {mode !== 'branches' && (
          <Text bold>
            {mode === 'graph' ? 'Git Graph' : 'Git History'}（直近{COMMITS}件）
          </Text>
        )}
        {snap.scope !== shown && <Text dimColor>切り替え中…</Text>}
        {mode !== 'branches' && snap.graph.length === 0 && (
          <Text dimColor>コミットがまだありません。</Text>
        )}
        {mode === 'history' && commits(snap.graph).length > 0 && (
          <Text bold dimColor mono>
            {padCells('ハッシュ', 9)}
            {padCells('日時', 18)}
            {padCells('作成者', 12)}
            メッセージ
          </Text>
        )}
        {mode === 'history' &&
          commits(snap.graph).map(line => (
            <Box flexDirection="row">
              <Text color="warning" mono>
                {padCells(line.hash ?? '', 9)}
              </Text>
              <Text dimColor mono>
                {padCells(line.time === undefined ? '' : commitDate(line.time), 18)}
              </Text>
              <Text color="suggestion" mono>
                {padCells(line.author ?? '', 12)}
              </Text>
              <Text wrap="truncate">{fit(line.subject ?? '', columns - 9 - 18 - 12)}</Text>
            </Box>
          ))}
        {mode === 'graph' && snap.graph.length > 0 && (
          <Box key="legend" flexDirection="row" flexWrap="wrap" columnGap={2}>
            <Text dimColor>凡例:</Text>
            {snap.legend
              .filter(entry => shown === 'all' || !remotes.has(entry.name))
              .map(entry => (
                <Box flexDirection="row">
                  <Text mono bold {...lane(entry.lane)}>
                    ┃{' '}
                  </Text>
                  {(entry.more ?? []).map(more => (
                    <Text mono bold {...lane(more)}>
                      ┃{' '}
                    </Text>
                  ))}
                  <Text bold {...lane(entry.lane)}>
                    {entry.name}
                  </Text>
                  {entry.on !== undefined && entry.isMerged === true && (
                    <Text dimColor>（{entry.on} に合流済み）</Text>
                  )}
                  {entry.on !== undefined && entry.isMerged !== true && (
                    <Text dimColor>（{entry.on} の線上）</Text>
                  )}
                  {entry.on === undefined && entry.isMerged === true && <Text dimColor>（合流済み）</Text>}
                </Box>
              ))}
          </Box>
        )}
        {mode === 'graph' && snap.graph.map(line => (
          <Box flexDirection="row">
            {line.segments.map(seg => (
              <Text mono bold {...lane(seg.lane)}>
                {seg.text}
              </Text>
            ))}
            {line.hash !== undefined && (
              <Text dimColor mono>
                {line.hash}{' '}
              </Text>
            )}
            {line.refs !== undefined && line.refs !== '' && (
              <Box key={`refs-${line.hash ?? ''}`} flexDirection="row">
                <Text color="claude" bold>
                  (
                </Text>
                {line.refs.split(', ').map((ref, i) => {
                  const name = ref.replace(/^HEAD -> /, '')
                  const entry = snap.legend.find(e => e.name === name)
                  return (
                    <Text bold {...(entry === undefined ? { color: 'claude' as ThemeKey } : lane(entry.lane))}>
                      {i > 0 ? ', ' : ''}
                      {ref}
                    </Text>
                  )
                })}
                <Text color="claude" bold>
                  ){' '}
                </Text>
              </Box>
            )}
            {line.subject !== undefined && (
              <Text wrap="truncate">
                {fit(
                  line.subject,
                  columns -
                    cells(line.graph) -
                    cells(line.hash ?? '') -
                    1 -
                    (line.refs ? cells(line.refs) + 3 : 0),
                )}
              </Text>
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
