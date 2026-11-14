import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GraphLine, Scope, Snapshot, View } from '../types'
import { COMMITS, collect, isGitCommand, commitDate, statusText } from './git'

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
  { shape: 'snapshot-2' },
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
      description: 'Open the Git branch graph pane',
    })
    const started = await next(e)
    if (showStatus) {
      void refresh($).catch(() => undefined)
    }
    return started
  })

  on('command.run', { command: 'gitgraph' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })
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

    return (
      <Box flexDirection="column">
        {toolbar}
        {viewbar}
        <Text dimColor>
          現在: {snap.head} ・ 更新 {clockText(snap.updatedAt)}
        </Text>

        <Text bold>ブランチ（{branches.length}）</Text>
        {branches.map(b => (
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

        <Text bold>
          {mode === 'graph' ? 'Git Graph' : 'Git History'}（直近{COMMITS}件）
        </Text>
        {snap.scope !== shown && <Text dimColor>切り替え中…</Text>}
        {snap.graph.length === 0 && <Text dimColor>コミットがまだありません。</Text>}
        {mode === 'history' &&
          commits(snap.graph).map(line => (
            <Box flexDirection="row">
              <Text color="warning" mono>
                {line.hash}{' '}
              </Text>
              <Text dimColor mono>
                {padCells(line.time === undefined ? '' : commitDate(line.time), 14)}
              </Text>
              <Text color="suggestion" mono>
                {padCells(line.author ?? '', 12)}
              </Text>
              <Text wrap="truncate">{line.subject ?? ''}</Text>
            </Box>
          ))}
        {mode === 'graph' && snap.graph.map(line => (
          <Box flexDirection="row">
            <Text color="suggestion" mono>
              {line.graph}
            </Text>
            {line.hash !== undefined && (
              <Text color="warning" mono>
                {line.hash}{' '}
              </Text>
            )}
            {line.refs !== undefined && line.refs !== '' && (
              <Text color="success" bold>
                ({line.refs}){' '}
              </Text>
            )}
            {line.subject !== undefined && <Text wrap="truncate">{line.subject}</Text>}
          </Box>
        ))}
      </Box>
    )
  })
}
