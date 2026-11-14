import type { GraphLine, GraphSegment, LegendEntry } from '../types'

/** One commit as `git log` printed it for the graph. */
export type Commit = {
  hash: string
  parents: string[]
  short: string
  time: number
  author: string
  refs: string
  subject: string
}

/** A branch tip the graph colors from: its name and full commit hash. */
export type Tip = { name: string; hash: string }

const SEP = '\x1f'
/** How many line colors the pane cycles through. */
export const COLORS = 6

/** Parses `--format=%H%x1f%P%x1f%h%x1f%at%x1f%an%x1f%D%x1f%s` lines. */
export const parseLog = (stdout: string): Commit[] =>
  stdout
    .split('\n')
    .filter(line => line.includes(SEP))
    .map(line => {
      const [hash = '', parents = '', short = '', time = '', author = '', refs = '', subject = ''] =
        line.split(SEP)
      return {
        hash,
        parents: parents.split(' ').filter(p => p !== ''),
        short,
        time: Number(time),
        author,
        refs,
        subject,
      }
    })

/** The branch a merge commit's subject names: `Merge branch 'x'`, `Merge pull request #1 from o/x`. */
export const mergedName = (subject: string): string | undefined =>
  /^Merge branch '([^']+)'/.exec(subject)?.[1] ??
  /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject)?.[1] ??
  /^Merge remote-tracking branch '([^']+)'/.exec(subject)?.[1]

/** The branch a merge commit's subject says it was made on: `Merge x into y` → y. */
export const intoName = (subject: string): string | undefined =>
  /^Merge .+ into (\S+)\s*$/.exec(subject)?.[1]

/** A branch name without its remote: `origin/x` → `x`. */
const local = (name: string): string => name.replace(/^origin\//, '')

export type Owners = {
  /** Commit hash → owner index; an owner's index is its color slot. */
  of: Map<string, number>
  /** Owner index → its name, `undefined` for a line no branch name reaches. */
  names: (string | undefined)[]
  /** Owner index → true when it is a merged branch found from a merge commit. */
  merged: boolean[]
}

/**
 * Gives each commit to one branch: each tip, in order, claims its first-parent
 * chain until it meets a commit already claimed. Commits no tip claims (the
 * side of a merge whose branch is gone or merged) go to a line of their own,
 * named from the merge commit's subject where it says.
 */
export const assignOwners = (commits: Commit[], tips: Tip[]): Owners => {
  const byHash = new Map(commits.map(c => [c.hash, c]))
  const of = new Map<string, number>()
  const names: (string | undefined)[] = []
  const merged: boolean[] = []
  const claim = (from: string, owner: number) => {
    let at: string | undefined = from
    while (at !== undefined && byHash.has(at) && !of.has(at)) {
      of.set(at, owner)
      at = byHash.get(at)?.parents[0]
    }
  }
  for (const tip of tips) {
    if (!byHash.has(tip.hash) || of.has(tip.hash)) continue
    names.push(tip.name)
    merged.push(false)
    claim(tip.hash, names.length - 1)
  }
  // Name the side of each merge after the branch its subject names.
  const sideName = new Map<string, string>()
  for (const c of commits) {
    const name = mergedName(c.subject)
    for (const p of c.parents.slice(1)) {
      if (name !== undefined && !sideName.has(p)) sideName.set(p, name)
    }
  }
  for (const c of commits) {
    if (of.has(c.hash)) continue
    names.push(sideName.get(c.hash))
    merged.push(true)
    claim(c.hash, names.length - 1)
  }
  // A line still unnamed takes the name its own merges give it:
  // `Merge develop into feature/x` sits on feature/x's line.
  for (const c of commits) {
    const o = of.get(c.hash)
    const into = intoName(c.subject)
    if (o !== undefined && merged[o] && names[o] === undefined && into !== undefined) names[o] = into
  }
  return { of, names, merged }
}

type Cell = { ch: string; lane?: number }

const toSegments = (cells: Cell[]): GraphSegment[] => {
  const out: GraphSegment[] = []
  for (const cell of cells) {
    const last = out[out.length - 1]
    if (last !== undefined && last.lane === cell.lane) last.text += cell.ch
    else out.push(cell.lane === undefined ? { text: cell.ch } : { text: cell.ch, lane: cell.lane })
  }
  return out
}

/**
 * Lays the commits out one row each, newest first. Each branch line gets one
 * column and one color for all its rows, from where it forks off to where it
 * is merged, in heavy glyphs: `●` a commit, `┃` the line, `┛`/`┗` where it
 * forks off, `┓`/`┏` where a merge takes it in (`┫`/`┣` when it goes on), and
 * `━` the joins. Long-lived branches claim the left columns first.
 */
export const layout = (
  commits: Commit[],
  owners: Owners,
): { lines: GraphLine[]; colors: number[] } => {
  const row = new Map(commits.map((c, i) => [c.hash, i]))
  const count = owners.names.length
  const top: number[] = Array.from({ length: count }, () => Infinity)
  const bottom: number[] = Array.from({ length: count }, () => -Infinity)
  const ownerOf = (hash: string) => owners.of.get(hash)

  commits.forEach((c, i) => {
    const o = ownerOf(c.hash)
    if (o === undefined) return
    top[o] = Math.min(top[o] ?? i, i)
    bottom[o] = Math.max(bottom[o] ?? i, i)
  })
  // A merge row takes the side line in; a fork row is where a line starts.
  const joins: { at: number; owner: number }[][] = commits.map(() => [])
  const forks: { at: number; owner: number }[][] = commits.map(() => [])
  // The line each line forks off from: it is drawn to that one's right.
  const base: (number | undefined)[] = []
  commits.forEach((c, i) => {
    const o = ownerOf(c.hash)
    c.parents.forEach((p, n) => {
      const q = ownerOf(p)
      if (n === 0) {
        if (o === undefined) return
        const at = row.get(p)
        if (q !== undefined && q !== o && at !== undefined) {
          bottom[o] = Math.max(bottom[o] ?? at, at)
          forks[at]?.push({ at: i, owner: o })
          base[o] = q
        } else if (at === undefined) {
          // The parent is older than the commits shown: run to the bottom.
          bottom[o] = commits.length - 1
        }
        return
      }
      if (q === undefined || q === o) return
      top[q] = Math.min(top[q] ?? i, i)
      joins[i]?.push({ at: i, owner: q })
    })
  })

  // Lowest column right of the line it forks off from whose lines do not
  // overlap these rows, in claim order.
  const column: number[] = []
  const taken: [number, number][][] = []
  for (let o = 0; o < count; o++) {
    const a = top[o] ?? 0
    const b = bottom[o] ?? 0
    if (a === Infinity) continue
    const from = base[o]
    let k = from === undefined ? 0 : (column[from] ?? -1) + 1
    while ((taken[k] ?? []).some(([x, y]) => a <= y && x <= b)) k++
    ;(taken[k] ??= []).push([a, b])
    column[o] = k
  }
  const width = taken.length

  // Each line gets its own color while six last; after that, lines on screen
  // together still differ.
  const color: number[] = []
  for (let o = 0; o < count; o++) {
    const a = top[o] ?? 0
    const b = bottom[o] ?? 0
    if (a === Infinity) continue
    const near = new Set<number>()
    for (let q = 0; q < o; q++) {
      const c = color[q]
      if (c !== undefined && a <= (bottom[q] ?? 0) + 1 && (top[q] ?? 0) - 1 <= b) near.add(c)
    }
    // Not next to a line of the same color, then the least used color.
    const used = (c: number) => color.filter(x => x === c).length
    const ranked = Array.from({ length: COLORS }, (_, c) => c).sort(
      (x, y) => Number(near.has(x)) - Number(near.has(y)) || used(x) - used(y) || x - y,
    )
    color[o] = ranked[0] ?? o % COLORS
  }
  const tint = (o: number) => color[o] ?? o % COLORS

  const lines = commits.map((c, i) => {
    const own = ownerOf(c.hash)
    const col = own === undefined ? 0 : (column[own] ?? 0)
    const cells: Cell[] = Array.from({ length: Math.max(width * 2 - 1, 1) }, () => ({ ch: ' ' }))
    for (let o = 0; o < count; o++) {
      const k = column[o]
      if (k === undefined || (top[o] ?? 0) > i || (bottom[o] ?? 0) < i) continue
      cells[k * 2] = { ch: '┃', lane: tint(o) }
    }
    const span = (k: number, lane: number) => {
      const [a, b] = k > col ? [col * 2 + 1, k * 2 - 1] : [k * 2 + 1, col * 2 - 1]
      for (let x = a; x <= b; x++) {
        if (cells[x]?.ch === ' ') cells[x] = { ch: '━', lane }
      }
    }
    // Nearest first, so each join's run next to its line keeps its color.
    const links = [
      ...(joins[i] ?? []).map(j => ({ owner: j.owner, isJoin: true })),
      ...(forks[i] ?? []).map(f => ({ owner: f.owner, isJoin: false })),
    ]
      .map(l => ({ ...l, k: column[l.owner] }))
      .filter((l): l is { owner: number; isJoin: boolean; k: number } => l.k !== undefined && l.k !== col)
      .sort((x, y) => Math.abs(x.k - col) - Math.abs(y.k - col))
    for (const l of links) {
      span(l.k, tint(l.owner))
      const right = l.k > col
      const ch = l.isJoin
        ? top[l.owner] === i
          ? right ? '┓' : '┏'
          : right ? '┫' : '┣'
        : right ? '┛' : '┗'
      cells[l.k * 2] = { ch, lane: tint(l.owner) }
    }
    cells[col * 2] = own === undefined ? { ch: '●' } : { ch: '●', lane: tint(own) }

    let n = cells.length
    while (n > 0 && cells[n - 1]?.ch === ' ') n--
    const trimmed = cells.slice(0, n)
    return {
      graph: trimmed.map(cell => cell.ch).join('') + ' ',
      segments: toSegments([...trimmed, { ch: ' ' }]),
      hash: c.short,
      time: c.time,
      author: c.author,
      refs: c.refs,
      subject: c.subject,
    }
  })
  return { lines, colors: owners.names.map((_, o) => tint(o)) }
}

/**
 * The legend: one row per branch shown, in the color of its line. A branch
 * whose tip sits on another branch's line takes the color of its own merged
 * line when one is drawn (`on` + `isMerged`), else a color of its own, which
 * its name in the graph is drawn in (`on`). Merged lines follow: named ones by
 * name, and the unnamed ones as one row with all their colors.
 */
export const legend = (
  commits: Commit[],
  tips: Tip[],
  owners: Owners,
  colors: number[],
): LegendEntry[] => {
  const shown = new Set(commits.map(c => c.hash))
  const drawn = new Set(owners.of.values())
  const out: LegendEntry[] = []
  const seen = new Set<string>()
  const usedLines = new Set<number>()
  const lineNamed = (name: string) =>
    owners.names.findIndex(
      (n, i) => owners.merged[i] && n !== undefined && drawn.has(i) && local(n) === local(name),
    )
  for (const tip of tips) {
    const owner = owners.of.get(tip.hash)
    if (!shown.has(tip.hash) || owner === undefined || seen.has(tip.name)) continue
    seen.add(tip.name)
    const on = owners.names[owner]
    if (on === tip.name || on === undefined) {
      usedLines.add(owner)
      out.push({ name: tip.name, lane: colors[owner] ?? owner })
      continue
    }
    const line = lineNamed(tip.name)
    if (line >= 0) {
      usedLines.add(line)
      out.push({ name: tip.name, lane: colors[line] ?? line, on, isMerged: true })
    } else {
      out.push({ name: tip.name, lane: -1, on })
    }
  }
  owners.names.forEach((name, i) => {
    if (!owners.merged[i] || name === undefined || !drawn.has(i) || usedLines.has(i)) return
    if (seen.has(name)) return
    seen.add(name)
    usedLines.add(i)
    out.push({ name, lane: colors[i] ?? i, isMerged: true })
  })
  const unnamed = [
    ...new Set(
      owners.names.flatMap((name, i) =>
        owners.merged[i] && name === undefined && drawn.has(i) ? [colors[i] ?? i] : [],
      ),
    ),
  ]
  if (unnamed[0] !== undefined) {
    out.push({ name: '名前のない枝', lane: unnamed[0], more: unnamed.slice(1), isMerged: true })
  }
  // A branch with no line of its own: a color no line on screen has, else
  // the one the legend uses least.
  const onScreen = new Set([...drawn].map(o => colors[o] ?? o))
  for (const entry of out) {
    if (entry.lane >= 0) continue
    const count = (c: number) => out.filter(e => e.lane === c || e.more?.includes(c)).length
    const free = Array.from({ length: COLORS }, (_, c) => c).sort(
      (x, y) => Number(onScreen.has(x)) - Number(onScreen.has(y)) || count(x) - count(y) || x - y,
    )
    entry.lane = free[0] ?? 0
  }
  return out
}
