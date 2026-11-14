import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { commitDate, laneSegments, legend } from '../hooks/git'

const S = '\x1f'
const NOW = Date.UTC(2026, 10, 14, 0, 30)

// What git answers in a repository on `main`, two ahead of origin/main,
// with a local `feature/x` that tracks nothing.
const GIT: Record<string, string> = {
  'rev-parse': 'true\n',
  'for-each-ref': [
    ['', 'refs/heads/feature/x', 'feature/x', '', ''].join(S),
    ['*', 'refs/heads/main', 'main', 'origin/main', 'ahead 2'].join(S),
    ['', 'refs/remotes/origin/HEAD', 'origin/HEAD', '', ''].join(S),
    ['', 'refs/remotes/origin/main', 'origin/main', '', ''].join(S),
  ].join('\n'),
  log: [
    `* ${S}a1b2c3d${S}${NOW / 1000 - 2 * 3600}${S}Sora${S}HEAD -> main${S}Add graph pane`,
    `| * ${S}e4f5a6b${S}${NOW / 1000 - 30 * 3600}${S}Sora${S}feature/x${S}Try feature`,
    '|/',
    `* ${S}0c0ffee${S}${NOW / 1000 - 3 * 86400}${S}Sora${S}origin/main${S}Initial commit`,
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

const engine = (on: On, seen: string[][]) => {
  on('command.register', () => ({ value: { command: 'gitgraph' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
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

test('/gitgraph draws branches, ahead/behind and the graph', async ($, on) => {
  const seen: string[][] = []
  engine(on, seen)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(GITGRAPH)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /\* main/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↑2 ↓0/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Add graph pane/ })).toBeDefined()
    // Local scope by default: remote branches are not listed.
    expect(await ui.find({ type: 'Text', text: /^\s*origin\/main$/ })).toBeUndefined()
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
    expect(await ui.find({ type: 'Text', text: /^╱$/ })).toBeDefined()
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
    // "* " + "a1b2c3d " + "(HEAD -> main) " leave 45 - 2 - 8 - 15 = 20.
    expect(await ui.find({ type: 'Text', text: 'Add graph pane' })).toBeDefined()
    await ui.unmount()
  }
})

test('each lane keeps one color, with a legend naming the branch on it', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(GITGRAPH)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // "|/": lane 0's line, and lane 1 merging back in, in heavy glyphs.
    expect((await ui.find({ type: 'Text', text: '╱' }))?.props.color).toBe('success')
    const text = (await ui.find({ key: 'legend' }))?.text ?? ''
    expect(text).toContain('凡例:')
    expect(text).toContain('main')
    expect(text).toContain('feature/x')
    // Local scope: the remote branch stays out of the legend.
    expect(text).not.toContain('origin/main')
    await ui.unmount()
  }
})

test('laneSegments puts a diagonal on the lane to its right', () => {
  expect(laneSegments('| * ')).toEqual([
    { text: '|', lane: 0 },
    { text: ' ' },
    { text: '*', lane: 1 },
    { text: ' ' },
  ])
  expect(laneSegments('|/')).toEqual([
    { text: '|', lane: 0 },
    { text: '/', lane: 1 },
  ])
})

test('the legend names each branch with the lane of its tip', () => {
  const lines = [
    { graph: '* ', segments: [], hash: 'a', refs: 'HEAD -> main, origin/main, tag: v1' },
    { graph: '| * ', segments: [], hash: 'b', refs: 'feature/x' },
  ]
  expect(legend(lines)).toEqual([
    { name: 'main', lane: 0 },
    { name: 'origin/main', lane: 0 },
    { name: 'feature/x', lane: 1 },
  ])
})

test('commitDate reads YYYY.MM.DD-hh:mm', () => {
  expect(commitDate(0)).toMatch(/^\d{4}\.\d{2}\.\d{2}-\d{2}:\d{2}$/)
})
