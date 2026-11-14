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
}

/** A run of graph glyphs on one lane (column), absent for spaces. */
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

/** What the pane shows: the graph, or a flat list of the commits. */
export type View = 'graph' | 'history'

export type Snapshot = {
  isRepo: boolean
  /** The current branch name, or `HEAD (abc1234)` when detached. */
  head: string
  branches: Branch[]
  graph: GraphLine[]
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
