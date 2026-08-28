import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export interface InvestmentPaths {
  root: string
  databaseDir: string
  databasePath: string
  cacheDir: string
  marketCacheDir: string
  valuationCacheDir: string
  judgementsDir: string
  expertChatsDir: string
  exportsDir: string
  tmpDir: string
}

/** Resolve only the dedicated dsh-mode-investment data root; no previous product root is ever probed. */
export function resolveInvestmentPaths(configured?: string): InvestmentPaths {
  const candidate = configured?.trim() || process.env.DSH_MODE_INVESTMENT_HOME?.trim()
  const root = candidate === undefined || candidate === ''
    ? join(homedir(), '.dsh-mode-investment')
    : isAbsolute(candidate) ? resolve(candidate) : resolve(process.cwd(), candidate)
  return {
    root,
    databaseDir: join(root, 'db'),
    databasePath: join(root, 'db', 'dsh-mode-investment.sqlite'),
    cacheDir: join(root, 'cache'),
    marketCacheDir: join(root, 'cache', 'market'),
    valuationCacheDir: join(root, 'cache', 'valuation'),
    judgementsDir: join(root, 'judgements'),
    expertChatsDir: join(root, 'expert-chats'),
    exportsDir: join(root, 'exports'),
    tmpDir: join(root, 'tmp'),
  }
}

export function ensureInvestmentLayout(paths: InvestmentPaths): void {
  const directories = [
    paths.root,
    paths.databaseDir,
    paths.cacheDir,
    paths.marketCacheDir,
    paths.valuationCacheDir,
    paths.judgementsDir,
    paths.expertChatsDir,
    paths.exportsDir,
    paths.tmpDir,
  ]

  // Preflight the complete managed tree before changing any mode or creating
  // a sibling. In particular, a pre-existing link at the new root must never
  // turn the isolated layout initialization into a read/write of legacy data.
  for (const directory of directories) assertManagedDirectoryNotSymlink(directory)

  for (const directory of directories) {
    // Check again at each mutation boundary. This does not grant an untrusted
    // local process access it does not already have, but it narrows accidental
    // replacement races and keeps every normal restart fail-closed.
    assertManagedDirectoryNotSymlink(directory)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    assertManagedDirectoryNotSymlink(directory)
    chmodSync(directory, 0o700)
  }
}

function assertManagedDirectoryNotSymlink(directory: string): void {
  try {
    if (lstatSync(directory).isSymbolicLink()) {
      throw new Error(`拒绝使用符号链接作为 investment 受管目录：${directory}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return
    throw error
  }
}
