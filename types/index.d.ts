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

/** One line of `git log --graph`: graph glyphs, then a commit when it has one. */
export type GraphLine = {
  graph: string
  hash?: string
  refs?: string
  subject?: string
}

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
      snapshot: Shaped<Snapshot | null>
    }
  }
}
