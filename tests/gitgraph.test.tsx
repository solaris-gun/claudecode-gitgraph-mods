import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const S = '\x1f'

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
    `* ${S}a1b2c3d${S}HEAD -> main${S}Add graph pane`,
    `| * ${S}e4f5a6b${S}feature/x${S}Try feature`,
    '|/',
    `* ${S}0c0ffee${S}origin/main${S}Initial commit`,
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
  on('clock.now', () => ({ value: Date.UTC(2026, 10, 14, 0, 30) }))
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
