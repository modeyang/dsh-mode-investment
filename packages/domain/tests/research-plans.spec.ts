import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Judgement } from '../../contracts/src/index.ts'
import { ensureInvestmentLayout, resolveInvestmentPaths } from '../src/paths.ts'
import { ResearchPlanStore, ResearchPlanValidationError } from '../src/research-plans.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-mode-investment-plan-'))
  roots.push(root)
  const paths = resolveInvestmentPaths(root)
  ensureInvestmentLayout(paths)
  return { paths, store: new ResearchPlanStore(paths) }
}

function writeWorkingPlan(store: ResearchPlanStore, judgementId: string, content: string): void {
  const target = store.workingPlanPath('judgement', judgementId)
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  writeFileSync(target, content, { encoding: 'utf8', mode: 0o600 })
}

const judgement: Judgement = {
  id: 'plan-test', secId: '1.600519', code: '600519', stockName: '贵州茅台',
  masterId: 'serenity-perspective', masterName: 'Serenity', masterVersion: 'v1',
  dshSessionId: 'hanai-plan-test', reportStatus: 'planning', turnStatus: 'idle',
  latestReportVersion: null, modelProvider: 'deepseek-official', model: 'deepseek-chat',
  reasoningEffort: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null, errorCode: null, errorMessage: null,
  planStatus: 'none', latestPlanVersion: null,
}

describe('ResearchPlanStore', () => {
  it('validates, seals, and idempotently recovers the same plan version', () => {
    const { paths, store } = fixture()
    const content = `# 贵州茅台研究计划\n\n${'产业链位置、稀缺环节、证据清单与失效条件。'.repeat(20)}`
    writeWorkingPlan(store, judgement.id, content)
    const first = store.seal(judgement, 1)
    const recovered = store.seal(judgement, 1)
    expect(recovered).toEqual(first)
    expect(store.read(first.relativePath)).toBe(content)
    expect(store.read(first.relativePath)).toBe(readFileSync(join(paths.judgementsDir, judgement.id, 'plans', '0001', 'plan.md'), 'utf8'))
  })

  it('rejects incomplete plans and paths outside the data root', () => {
    const { store } = fixture()
    writeWorkingPlan(store, judgement.id, '# 太短')
    expect(() => store.validateWorkingPlan(judgement.id)).toThrow(ResearchPlanValidationError)
    expect(() => store.read('../../etc/passwd')).toThrow('超出')
    expect(store.hasWorkingPlan(judgement.id)).toBe(true)
  })

  it('rejects a plan sealed without a bound DSH session', () => {
    const { store } = fixture()
    writeWorkingPlan(store, judgement.id, `# 研究计划\n\n${'产业链位置、稀缺环节与失效条件。'.repeat(20)}`)
    expect(() => store.seal({ ...judgement, dshSessionId: null }, 1)).toThrow('未绑定 DSH Session')
  })
})
