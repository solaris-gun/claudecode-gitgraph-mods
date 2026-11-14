/** Which branches the graph shows: local only, or local and remote. */
export type Scope = 'local' | 'all'

export type Branch = {
  /** Short name, e.g. `main` or `origin/main`. */
  name: string
  isCurrent: boolean
  isRemote: boolean
  /** The upstream's short name, absent when the branch tracks nothing. */
  upstream?: string
  ahead: number
  behind: number
  /** The upstream is configured but no longer exists. */
  isGone: boolean
  /** The full hash of the commit the branch points at. */
  tip?: string
}

/** A run of graph glyphs on one branch's line; `lane` picks the color, absent for spaces. */
export type GraphSegment = { text: string; lane?: number }

/** One line of `git log --graph`: graph glyphs, then a commit when it has one. */
export type GraphLine = {
  /** The graph glyphs as plain text. */
  graph: string
  /** The same glyphs in runs of one lane, which picks their color. */
  segments: GraphSegment[]
  hash?: string
  /** Author date, Unix seconds. */
  time?: number
  author?: string
  refs?: string
  subject?: string
}

/**
 * A legend row: a branch and its color. `on` names the line its tip sits on;
 * `isMerged` marks a merged line.
 */
export type LegendEntry = {
  name: string
  lane: number
  on?: string
  isMerged?: boolean
  /** For a merged line no branch name reaches: the merge commit's subject. */
  via?: string
}

/** What the pane shows: the graph, a flat list of the commits, or the branches. */
export type View = 'graph' | 'history' | 'branches'

export type Snapshot = {
  isRepo: boolean
  /** The current branch name, or `HEAD (abc1234)` when detached. */
  head: string
  branches: Branch[]
  graph: GraphLine[]
  /** The branches the graph shows, each with its line's color. */
  legend: LegendEntry[]
  /** Which scope the graph was read for. */
  scope: Scope
  updatedAt: number
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'claudecode-gitgraph-mods': {
      scope: Shaped<Scope>
      view: Shaped<View>
      snapshot: Shaped<Snapshot | null>
    }
  }
}
