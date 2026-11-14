import type { Branch, GraphLine, GraphSegment, Scope, Snapshot } from '../types'

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

/**
 * Splits graph glyphs into runs of one lane. git draws lane n at column 2n;
 * a `/`, `\\` or `_` between two lanes belongs to the one on its right,
 * the lane that forks off or merges in.
 */
export const laneSegments = (glyphs: string): GraphSegment[] => {
  const out: GraphSegment[] = []
  ;[...glyphs].forEach((ch, col) => {
    const lane = ch === ' ' ? undefined : Math.ceil(col / 2)
    const last = out[out.length - 1]
    if (last !== undefined && last.lane === lane) last.text += ch
    else out.push(lane === undefined ? { text: ch } : { text: ch, lane })
  })
  return out
}

/** Parses `git log --graph` lines written with this module's format. */
export const parseGraph = (stdout: string): GraphLine[] =>
  stdout
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => {
      if (!line.includes(SEP)) {
        const glyphs = line.trimEnd()
        return { graph: glyphs, segments: laneSegments(glyphs) }
      }
      const [graph = '', hash = '', time = '', author = '', refs = '', subject = ''] =
        line.split(SEP)
      return {
        graph,
        segments: laneSegments(graph),
        hash,
        time: Number(time),
        author,
        refs,
        subject,
      }
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
    `--format=${SEP}%h${SEP}%at${SEP}%an${SEP}%D${SEP}%s`,
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

/** A commit's date as Japanese absolute text in local time: `11月14日 09:30`. */
export const commitDate = (seconds: number): string => {
  const d = new Date(seconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}



/** Branch names in a `%D` decoration: `HEAD -> main, origin/main, tag: v1` → main, origin/main. */
export const branchNames = (refs: string): string[] =>
  refs
    .split(', ')
    .map(ref => ref.replace(/^HEAD -> /, '').trim())
    .filter(ref => ref !== '' && ref !== 'HEAD' && !ref.startsWith('tag: ') && !ref.endsWith('/HEAD'))

export type LegendEntry = { name: string; lane: number }

/** Each branch shown in the graph with the lane its tip sits on. */
export const legend = (lines: GraphLine[]): LegendEntry[] => {
  const seen = new Set<string>()
  const out: LegendEntry[] = []
  for (const line of lines) {
    if (line.refs === undefined || line.refs === '') continue
    const col = [...line.graph].indexOf('*')
    if (col < 0) continue
    for (const name of branchNames(line.refs)) {
      if (seen.has(name)) continue
      seen.add(name)
      out.push({ name, lane: Math.ceil(col / 2) })
    }
  }
  return out
}
