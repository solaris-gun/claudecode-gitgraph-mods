import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { commitDate } from '../hooks/git'
import { assignOwners, layout, legend, parseLog } from '../hooks/layout'

const S = '\x1f'
const NOW = Date.UTC(2026, 10, 14, 0, 30)

// What git answers in a repository on `main`, two ahead of origin/main,
// with a local `feature/x` that tracks nothing.
const GIT: Record<string, string> = {
  'rev-parse': 'true\n',
  'for-each-ref': [
    ['', 'refs/heads/feature/x', 'feature/x', '', '', 'e4'].join(S),
    ['*', 'refs/heads/main', 'main', 'origin/main', 'ahead 2', 'a1'].join(S),
    ['', 'refs/remotes/origin/HEAD', 'origin/HEAD', '', '', '0c'].join(S),
    ['', 'refs/remotes/origin/main', 'origin/main', '', '', '0c'].join(S),
  ].join('\n'),
  log: [
    ['a1', '0c', 'a1b2c3d', NOW / 1000 - 2 * 3600, 'Sora', 'HEAD -> main', 'Add graph pane'].join(S),
    ['e4', '0c', 'e4f5a6b', NOW / 1000 - 30 * 3600, 'Sora', 'feature/x', 'Try feature'].join(S),
    ['0c', '', '0c0ffee', NOW / 1000 - 3 * 86400, 'Sora', 'origin/main', 'Initial commit'].join(S),
  ].join('\n'),
}

const GITGRAPH = {
  command: 'gitgraph',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
} as const

const PANE = {
  plugin: 'claudecode-gitgraph-mods',
  component: 'Pane',
  requestId: 'gitgraph',
  props: {
    title: 'Git Graph',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const engine = (on: On, seen: string[][], opens: unknown[] = []) => {
  on('command.register', () => ({ value: { command: 'gitgraph' } }))
  on('ui.open', (_, e) => {
    opens.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('process.run', (_, e) => {
    seen.push([...e.argv])
    return {
      value: {
        exitCode: 0,
        stdout: GIT[e.argv[1] ?? ''] ?? '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
}

test('/gitgraph opens on the graph; the branches have their own view', async ($, on) => {
  const seen: string[][] = []
  const opens: unknown[] = []
  engine(on, seen, opens)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(GITGRAPH)
  // It takes the keys, so the hotkeys work at once, and asks for room.
  expect(opens.at(-1)).toMatchObject({ focus: true, closeOnEscape: true, rows: 30 })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // The graph is right under the summary: no branch rows push it away.
    expect(await ui.find({ type: 'Text', text: /Add graph pane/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\* main/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /現在: main → origin\/main ↑2 ↓0/ })).toBeDefined()

    await ui.press({ key: 'view-branches' })
    expect(await ui.find({ type: 'Text', text: /\* main/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Add graph pane/ })).toBeUndefined()
    // Local scope by default: remote branches are not listed.
    expect(await ui.find({ type: 'Text', text: /^\s*origin\/main$/ })).toBeUndefined()
    await ui.press({ key: 'view-graph' })
    await ui.unmount()
  }
  const log = seen.find(argv => argv[1] === 'log')
  expect(log).toContain('--branches')
  expect(log).not.toContain('--remotes')
})

test('the scope button switches to local and remote', async ($, on) => {
  const seen: string[][] = []
  engine(on, seen)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(GITGRAPH)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'scope-all' })
  expect(await ui.find({ type: 'Text', text: /origin\/main/ })).toBeDefined()
  const logs = seen.filter(argv => argv[1] === 'log')
  expect(logs.at(-1)).toContain('--remotes')
  await ui.unmount()
})

test('a git command Claude runs refreshes; others do not', async ($, on) => {
  const seen: string[][] = []
  engine(on, seen)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const logs = () => seen.filter(argv => argv[1] === 'log').length
  // /gitgraph waits for any read in flight, so the counts below are settled.
  await $.command.run(GITGRAPH)

  let before = logs()
  await $.tool.call({ tool: 'Bash', command: 'ls -la' })
  await $.command.run(GITGRAPH)
  expect(logs() - before).toBe(1)

  before = logs()
  await $.tool.call({ tool: 'Bash', command: 'git checkout -b topic' })
  await $.command.run(GITGRAPH)
  expect(logs() - before).toBe(2)
})

test('Git History lists hash, date, author and message without lines', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(GITGRAPH)
  const date = commitDate(NOW / 1000 - 2 * 3600)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'view-history' })
    expect(await ui.find({ type: 'Text', text: /^ハッシュ\s+日時\s+作成者\s+メッセージ$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: new RegExp(`^${date}`) })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Sora/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Add graph pane/ })).toBeDefined()
    // No table: no Markdown, no pipes, no branch labels.
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /HEAD -> main/ })).toBeUndefined()
    await ui.press({ key: 'view-graph' })
    expect(await ui.find({ type: 'Text', text: /^━┛$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a long message is cut with … to fit the pane, never wrapped', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(GITGRAPH)
  const narrow = { ...PANE, props: { ...PANE.props, bodyColumns: 45 } }

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...narrow, surface })
    await ui.press({ key: 'view-history' })
    // 45 - 39 columns of hash, date and author leave 6 cells.
    expect(await ui.find({ type: 'Text', text: 'Add g…' })).toBeDefined()
    await ui.press({ key: 'view-graph' })
    // "● " + "a1b2c3d " + "(HEAD -> main) " leave 45 - 2 - 8 - 15 = 20.
    expect(await ui.find({ type: 'Text', text: 'Add graph pane' })).toBeDefined()
    await ui.unmount()
  }
})

test('each branch keeps one color, and the legend matches it', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(GITGRAPH)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // feature/x forks off main's first commit in its own color, the second.
    expect((await ui.find({ type: 'Text', text: '━┛' }))?.props.color).toBe('success')
    expect((await ui.find({ type: 'Text', text: '●' }))?.props.color).toBe('error')
    const text = (await ui.find({ key: 'legend' }))?.text ?? ''
    expect(text).toContain('凡例')
    expect(text).toContain('main')
    expect(text).toContain('feature/x')
    // Local scope: the remote branch stays out of the legend.
    expect(text).not.toContain('origin/main')
    await ui.unmount()
  }
})

// develop (current) with two merged report branches, as in a real repo: each
// branch's line and its legend entry get the same color.
const merged = parseLog(
  [
    ['m2', 'm1 g1', 'm2', '9', 'S', 'HEAD -> develop', "Merge branch 'guardian' into develop"],
    ['g1', 'm1', 'g1', '8', 'S', 'guardian', 'g1'],
    ['m1', 'd1 v1', 'm1', '7', 'S', '', "Merge branch 'verifier' into develop"],
    ['v1', 'd1', 'v1', '6', 'S', 'verifier', 'v1'],
    ['d1', 'r0', 'd1', '5', 'S', '', 'd1'],
    ['r0', '', 'r0', '4', 'S', 'main', 'init'],
  ]
    .map(row => row.join(S))
    .join('\n'),
)
const mergedTips = [
  { name: 'main', hash: 'r0' },
  { name: 'develop', hash: 'm2' },
  { name: 'guardian', hash: 'g1' },
  { name: 'verifier', hash: 'v1' },
]

test('a merged branch keeps its own line and color, and the legend says which', () => {
  const owners = assignOwners(merged, mergedTips)
  const { lines, colors } = layout(merged, owners)
  // main on the left; develop right of it; each merged branch right of develop.
  expect(lines.map(l => l.graph.trimEnd())).toEqual([
    '  ●━┓',
    '  ┃ ●',
    '  ●━┛━┓',
    '  ┃   ●',
    '  ●━━━┛',
    '●━┛',
  ])
  const entries = legend(merged, mergedTips, owners, colors)
  expect(entries.map(e => e.name)).toEqual(['main', 'develop', 'guardian', 'verifier'])
  // Four branches, four colors.
  expect(new Set(entries.map(e => e.lane)).size).toBe(4)
  // Each tip's ● has its legend color.
  for (const e of entries.slice(1)) {
    const line = lines.find(l => l.refs?.includes(e.name))
    expect(line?.segments.find(seg => seg.text.includes('●'))?.lane).toBe(e.lane)
  }
})

test('a branch at the same commit as another says whose line it sits on', () => {
  const tips = [...mergedTips, { name: 'origin/develop', hash: 'm2' }]
  const owners = assignOwners(merged, tips)
  const { colors } = layout(merged, owners)
  expect(legend(merged, tips, owners, colors).at(-1)).toMatchObject({
    name: 'origin/develop',
    on: 'develop',
  })
})

// develop fast-forwarded over guardian and verifier: their tips sit on
// develop's line. guardian's own line is named by its `into` merge; verifier
// has none. Each still gets a color of its own in the legend.
const forwarded = parseLog(
  [
    ['d3', 'v1', 'd3', '9', 'S', 'HEAD -> develop', 'd3'],
    ['v1', 'm2', 'v1', '8', 'S', 'verifier', 'v1'],
    ['m2', 'm1 x1', 'm2', '7', 'S', 'guardian', '合流: なにか'],
    ['x1', 'm1', 'x1', '6', 'S', '', 'x1'],
    ['m1', 'd2 g2', 'm1', '5', 'S', '', '取り込み: 番人役の判定書の枝'],
    ['g2', 'g1 d2', 'g2', '4', 'S', '', 'Merge develop into guardian'],
    ['d2', 'd1', 'd2', '3', 'S', '', 'd2'],
    ['g1', 'd1', 'g1', '2', 'S', '', 'g1'],
    ['d1', '', 'd1', '1', 'S', 'main', 'd1'],
  ]
    .map(row => row.join(S))
    .join('\n'),
)

test('every line in the graph has a legend row in its color', () => {
  const tips = [
    { name: 'main', hash: 'd1' },
    { name: 'develop', hash: 'd3' },
    { name: 'guardian', hash: 'm2' },
    { name: 'verifier', hash: 'v1' },
  ]
  const owners = assignOwners(forwarded, tips)
  const { lines, colors } = layout(forwarded, owners)
  const entries = legend(forwarded, tips, owners, colors)
  const by = (name: string) => entries.find(e => e.name === name)
  const dot = (hash: string) =>
    lines.find(l => l.hash === hash)?.segments.find(seg => seg.text.includes('●'))?.lane
  // guardian's own line is named by `Merge develop into guardian`.
  expect(by('guardian')).toMatchObject({ on: 'develop', isMerged: true, lane: dot('g2') })
  // verifier has no line of its own: it shares develop's color.
  expect(by('verifier')).toMatchObject({ on: 'develop', lane: dot('d3') })
  // The x1 line no name reaches is named by the merge that took it in.
  expect(entries.find(e => e.via === '合流: なにか')?.lane).toBe(dot('x1'))
  // Every color drawn has a legend row.
  const drawn = new Set(lines.flatMap(l => l.segments.flatMap(seg => (seg.lane === undefined ? [] : [seg.lane]))))
  for (const lane of drawn) expect(entries.some(e => e.lane === lane)).toBe(true)
})

test('hashes line up and branch names stay on one line', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(GITGRAPH)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // The graph is 4 cells wide at its widest ("●━┛ "): the main row pads 2.
  const top = await ui.find({ type: 'Text', text: 'a1b2c3d ' })
  expect(top).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}$/ })).toBeDefined()
  // origin/main sits with nothing local at 0c0ffee in local scope: kept;
  // a remote name next to its local twin is left out.
  expect(await ui.find({ type: 'Text', text: 'origin/main' })).toBeDefined()
  await ui.unmount()
})

test('commitDate reads YYYY.MM.DD-hh:mm', () => {
  expect(commitDate(0)).toMatch(/^\d{4}\.\d{2}\.\d{2}-\d{2}:\d{2}$/)
})

test('/gitgraph close closes the pane', async ($, on) => {
  const closes: unknown[] = []
  engine(on, [])
  on('ui.close', (_, e) => {
    closes.push(e)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(GITGRAPH)
  const done = await $.command.run({ ...GITGRAPH, args: 'close' })
  expect(done.text).toBe('Git Graph pane closed.')
  expect(closes.at(-1)).toMatchObject({ id: 'gitgraph' })
})
