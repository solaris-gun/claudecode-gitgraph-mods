import type { Branch, GraphLine, Scope, Snapshot } from '../types'

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
      const [head = '', ref = '', name = '', upstream = '', track = ''] =
        line.split(SEP)
      return { head, ref, name, upstream, track }
    })
    // `origin/HEAD` is a pointer, not a branch.
    .filter(row => !(row.ref.startsWith('refs/remotes/') && row.ref.endsWith('/HEAD')))
    .map(row => ({
      name: row.name,
      isCurrent: row.head === '*',
      isRemote: row.ref.startsWith('refs/remotes/'),
      ...(row.upstream === '' ? {} : { upstream: row.upstream }),
      ...parseTrack(row.track),
    }))

/** Parses `git log --graph` lines written with this module's format. */
export const parseGraph = (stdout: string): GraphLine[] =>
  stdout
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => {
      if (!line.includes(SEP)) {
        return { graph: line.trimEnd() }
      }
      const [graph = '', hash = '', refs = '', subject = ''] = line.split(SEP)
      return { graph, hash, refs, subject }
    })

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
    '--format=%(HEAD)%1f%(refname)%1f%(refname:short)%1f%(upstream:short)%1f%(upstream:track,nobracket)',
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
    '--graph',
    '--date-order',
    '--color=never',
    `-n${COMMITS}`,
    `--format=${SEP}%h${SEP}%D${SEP}%s`,
    ...(scope === 'all' ? ['--branches', '--remotes'] : ['--branches']),
    'HEAD',
  ])
  // A repository with no commits yet has no HEAD to log: an empty graph.
  const graph = log.exitCode === 0 ? parseGraph(log.stdout) : []

  return {
    ...empty,
    isRepo: true,
    head,
    branches,
    graph,
    ...(refs.exitCode === 0 ? {} : { error: refs.stderr.trim() }),
  }
}
