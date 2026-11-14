import type { Branch, Scope, Snapshot } from '../types'
import { assignOwners, layout, legend, parseLog, type Tip } from './layout'

export type Run = (
  argv: string[],
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

export const COMMITS = 50
const SEP = '\x1f'

/** True for a shell command that runs git (or gh, which can move branches). */
export const isGitCommand = (command: string): boolean =>
  /(^|[\s;&|(`])(git|gh)(\s|$)/.test(command)

/** Parses `%(upstream:track,nobracket)`: "ahead 2, behind 1", "gone", "". */
export const parseTrack = (
  track: string,
): { ahead: number; behind: number; isGone: boolean } => ({
  ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
  behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
  isGone: track.trim() === 'gone',
})

/** Parses the for-each-ref lines this module asks for. */
export const parseBranches = (stdout: string): Branch[] =>
  stdout
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => {
      const [head = '', ref = '', name = '', upstream = '', track = '', tip = ''] =
        line.split(SEP)
      return { head, ref, name, upstream, track, tip }
    })
    // `origin/HEAD` is a pointer, not a branch.
    .filter(row => !(row.ref.startsWith('refs/remotes/') && row.ref.endsWith('/HEAD')))
    .map(row => ({
      name: row.name,
      isCurrent: row.head === '*',
      isRemote: row.ref.startsWith('refs/remotes/'),
      ...(row.tip === '' ? {} : { tip: row.tip }),
      ...(row.upstream === '' ? {} : { upstream: row.upstream }),
      ...parseTrack(row.track),
    }))

// Long-lived branches claim their line first, so a topic branch forked from
// one does not take its history.
const TRUNKS = ['main', 'master', 'develop', 'dev', 'trunk']
const trunkRank = (name: string): number => {
  const i = TRUNKS.indexOf(name.replace(/^[^/]+\//, ''))
  return i < 0 ? TRUNKS.length : i
}

/**
 * The order branches claim their lines in: trunk branches (local before
 * remote), then the current branch, then the rest as git listed them.
 */
export const tipOrder = (branches: Branch[], scope: Scope): Tip[] => {
  const shown = branches.filter(b => b.tip !== undefined && (scope === 'all' || !b.isRemote))
  const rank = (b: Branch) =>
    trunkRank(b.name) < TRUNKS.length ? trunkRank(b.name) * 2 + (b.isRemote ? 1 : 0) : b.isCurrent ? TRUNKS.length * 2 : TRUNKS.length * 2 + 1 + (b.isRemote ? 1 : 0)
  return shown
    .map((b, i) => ({ b, i }))
    .sort((x, y) => rank(x.b) - rank(y.b) || x.i - y.i)
    .map(({ b }) => ({ name: b.name, hash: b.tip ?? '' }))
}

/** The status line text: `⎇ main ↑2 ↓0`, or `⎇ main` with no upstream. */
export const statusText = (snapshot: Snapshot): string => {
  const current = snapshot.branches.find(b => b.isCurrent)
  if (current === undefined || current.upstream === undefined) {
    return `⎇ ${snapshot.head}`
  }
  if (current.isGone) {
    return `⎇ ${snapshot.head} (upstream gone)`
  }
  return `⎇ ${snapshot.head} ↑${current.ahead} ↓${current.behind}`
}

/** Reads the repository with git: branches, ahead/behind and the graph. */
export const collect = async (
  run: Run,
  scope: Scope,
  now: number,
): Promise<Snapshot> => {
  const empty: Snapshot = {
    isRepo: false,
    head: '',
    branches: [],
    graph: [],
    legend: [],
    scope,
    updatedAt: now,
  }
  const inside = await run(['git', 'rev-parse', '--is-inside-work-tree'])
  if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') {
    return empty
  }

  const refs = await run([
    'git',
    'for-each-ref',
    '--format=%(HEAD)%1f%(refname)%1f%(refname:short)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(objectname)',
    'refs/heads',
    'refs/remotes',
  ])
  const branches = refs.exitCode === 0 ? parseBranches(refs.stdout) : []

  let head = branches.find(b => b.isCurrent)?.name
  if (head === undefined) {
    const short = await run(['git', 'rev-parse', '--short', 'HEAD'])
    head = short.exitCode === 0 ? `HEAD (${short.stdout.trim()})` : 'HEAD'
  }

  const log = await run([
    'git',
    'log',
    '--date-order',
    `-n${COMMITS}`,
    '--format=%H%x1f%P%x1f%h%x1f%at%x1f%an%x1f%D%x1f%s',
    ...(scope === 'all' ? ['--branches', '--remotes'] : ['--branches']),
    'HEAD',
  ])
  // A repository with no commits yet has no HEAD to log: an empty graph.
  const shown = log.exitCode === 0 ? parseLog(log.stdout) : []
  const tips = tipOrder(branches, scope)
  if (!branches.some(b => b.isCurrent) && shown[0] !== undefined) {
    tips.push({ name: 'HEAD', hash: shown[0].hash })
  }
  const others = branches
    .filter(b => b.isRemote && scope !== 'all' && b.tip !== undefined)
    .map(b => ({ name: b.name, hash: b.tip ?? '' }))
  const owners = assignOwners(shown, tips, others)
  const { lines: graph, colors } = layout(shown, owners)

  return {
    ...empty,
    isRepo: true,
    head,
    branches,
    graph,
    legend: legend(shown, tips, owners, colors),
    ...(refs.exitCode === 0 ? {} : { error: refs.stderr.trim() }),
  }
}

/** A commit's date in local time as `YYYY.MM.DD-hh:mm`: `2026.11.14-09:30`. */
export const commitDate = (seconds: number): string => {
  const d = new Date(seconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}-${pad(d.getHours())}:${pad(d.getMinutes())}`
}



/** Branch names in a `%D` decoration: `HEAD -> main, origin/main, tag: v1` → main, origin/main. */
export const branchNames = (refs: string): string[] =>
  refs
    .split(', ')
    .map(ref => ref.replace(/^HEAD -> /, '').trim())
    .filter(ref => ref !== '' && ref !== 'HEAD' && !ref.startsWith('tag: ') && !ref.endsWith('/HEAD'))
