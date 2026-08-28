import { createHash } from 'node:crypto'
import {
  chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type {
  Judgement,
  ResearchPlan,
  ResearchPlanOwnerType,
} from '../../contracts/src/index.ts'
import type { InvestmentPaths } from './paths.ts'

export interface ResearchPlanOwner {
  ownerType: ResearchPlanOwnerType
  ownerId: string
  judgementId: string | null
  masterId: string
  masterVersion: string
  dshSessionId: string
}

export interface SealedResearchPlan extends ResearchPlan {
  relativePath: string
}

export interface PlanManifest {
  schemaVersion: 1
  ownerType: ResearchPlanOwnerType
  ownerId: string
  judgementId: string | null
  masterId: string
  masterVersion: string
  dshSessionId: string
  planVersion: number
  sealedAt: string
  sizeBytes: number
  sha256: string
  source: 'workspace/PLAN.md'
}

/** Owns immutable research-plan snapshots produced before Serenity research. */
export class ResearchPlanStore {
  constructor(private readonly paths: InvestmentPaths) {}

  validateWorkingPlan(ownerType: ResearchPlanOwnerType | string, ownerId?: string): { content: string; sizeBytes: number; sha256: string } {
    if (ownerId === undefined) {
      ownerId = ownerType
      ownerType = 'judgement'
    }
    if (ownerType !== 'judgement' && ownerType !== 'expert-chat') throw new Error('研究计划归属类型无效')
    const path = this.workingPlanPath(ownerType, ownerId)
    if (!existsSync(path)) throw new ResearchPlanValidationError('plan-missing', 'Agent 未生成 PLAN.md')
    const content = readFileSync(path, 'utf8').trim()
    const charCount = [...content].length
    if (charCount < this.minChars) {
      throw new ResearchPlanValidationError(
        'plan-too-short',
        `PLAN.md 仅 ${charCount} 个字符，至少需要 ${this.minChars} 个字符`,
      )
    }
    if (!/^#\s+.+/m.test(content)) {
      throw new ResearchPlanValidationError('plan-heading-missing', 'PLAN.md 缺少一级标题')
    }
    const bytes = Buffer.byteLength(content, 'utf8')
    return { content, sizeBytes: bytes, sha256: sha256(content) }
  }

  /** Compatibility helper for judgement-owned plans. */
  validateWorkingJudgementPlan(judgementId: string): { content: string; sizeBytes: number; sha256: string } {
    return this.validateWorkingPlan('judgement', judgementId)
  }

  seal(owner: ResearchPlanOwner | Judgement, version: number): SealedResearchPlan {
    owner = isJudgement(owner) ? researchPlanOwnerFromJudgement(owner) : owner
    assertOwner(owner)
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('研究计划版本必须是正整数')
    const sealedAt = new Date().toISOString()
    const versionName = String(version).padStart(4, '0')
    const targetDirectory = join(this.ownerRoot(owner.ownerType, owner.ownerId), 'plans', versionName)
    const stagingDirectory = `${targetDirectory}.staging`
    if (existsSync(targetDirectory)) return this.readExistingSeal(owner, version, targetDirectory)
    const validated = this.validateWorkingPlan(owner.ownerType, owner.ownerId)
    rmSync(stagingDirectory, { recursive: true, force: true })
    mkdirSync(stagingDirectory, { recursive: true, mode: 0o700 })
    const planPath = join(stagingDirectory, 'plan.md')
    const manifestPath = join(stagingDirectory, 'manifest.json')
    writeFileSync(planPath, validated.content, { encoding: 'utf8', mode: 0o600 })
    const manifest: PlanManifest = {
      schemaVersion: 1,
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      judgementId: owner.judgementId,
      masterId: owner.masterId,
      masterVersion: owner.masterVersion,
      dshSessionId: owner.dshSessionId,
      planVersion: version,
      sealedAt,
      sizeBytes: validated.sizeBytes,
      sha256: validated.sha256,
      source: 'workspace/PLAN.md',
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    chmodSync(planPath, 0o600)
    chmodSync(manifestPath, 0o600)
    renameSync(stagingDirectory, targetDirectory)
    chmodSync(targetDirectory, 0o700)
    const finalPlan = join(targetDirectory, 'plan.md')
    return {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      judgementId: owner.judgementId,
      version,
      content: validated.content,
      sha256: validated.sha256,
      sizeBytes: validated.sizeBytes,
      sealedAt,
      relativePath: relative(this.paths.root, finalPlan).split(sep).join('/'),
    }
  }

  /** Validate both the manifest and content before exposing a sealed plan. */
  readSealed(owner: ResearchPlanOwner, version: number, relativePath: string): ResearchPlan {
    assertOwner(owner)
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('研究计划版本必须是正整数')
    const absolute = this.safePath(relativePath)
    const directory = resolve(absolute, '..')
    const sealed = this.readExistingSeal(owner, version, directory, absolute)
    const expected = relative(this.paths.root, absolute).split(sep).join('/')
    if (sealed.relativePath !== expected) throw new Error('研究计划路径校验失败，拒绝读取')
    return sealed
  }

  readSealedForJudgement(judgement: Judgement, version: number, relativePath: string): ResearchPlan {
    return this.readSealed(researchPlanOwnerFromJudgement(judgement), version, relativePath)
  }

  readSealedForExpertChat(chat: { id: string; masterId: string; masterVersion: string; dshSessionId: string | null }, version: number, relativePath: string): ResearchPlan {
    if (chat.dshSessionId === null) throw new Error('无法读取未绑定 DSH Session 的研究计划')
    return this.readSealed({
      ownerType: 'expert-chat', ownerId: chat.id, judgementId: null,
      masterId: chat.masterId, masterVersion: chat.masterVersion, dshSessionId: chat.dshSessionId,
    }, version, relativePath)
  }

  read(relativePath: string): string {
    return readFileSync(this.safePath(relativePath), 'utf8')
  }

  workingPlanPath(ownerType: ResearchPlanOwnerType | string, ownerId?: string): string {
    if (ownerId === undefined) {
      ownerId = ownerType
      ownerType = 'judgement'
    }
    if (ownerType !== 'judgement' && ownerType !== 'expert-chat') throw new Error('研究计划归属类型无效')
    assertIdentifier(ownerId)
    return join(this.ownerRoot(ownerType, ownerId), 'workspace', 'PLAN.md')
  }

  /** Compatibility helper for judgement-owned plans. */
  workingJudgementPlanPath(judgementId: string): string {
    return this.workingPlanPath('judgement', judgementId)
  }

  hasWorkingPlan(ownerType: ResearchPlanOwnerType | string, ownerId?: string): boolean {
    return existsSync(this.workingPlanPath(ownerType, ownerId))
  }

  workingPlanDirectory(ownerType: ResearchPlanOwnerType, ownerId: string): string {
    return join(this.ownerRoot(ownerType, ownerId), 'workspace')
  }

  hasSealedPlan(ownerType: ResearchPlanOwnerType, ownerId: string): boolean {
    return existsSync(join(this.ownerRoot(ownerType, ownerId), 'plans', '0001', 'plan.md'))
  }

  private readExistingSeal(
    owner: ResearchPlanOwner,
    version: number,
    targetDirectory: string,
    explicitPlanPath?: string,
  ): SealedResearchPlan {
    const planPath = explicitPlanPath ?? join(targetDirectory, 'plan.md')
    const manifestPath = join(targetDirectory, 'manifest.json')
    if (!existsSync(planPath) || !existsSync(manifestPath)) throw new Error('既有研究计划版本不完整，拒绝覆盖')
    const content = readFileSync(planPath, 'utf8')
    let manifest: Partial<PlanManifest>
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<PlanManifest>
    } catch {
      throw new Error('既有研究计划 manifest 无法解析，拒绝读取')
    }
    const digest = sha256(content)
    const actualRelativePath = relative(this.paths.root, planPath).split(sep).join('/')
    if (
      !actualRelativePath.endsWith('/plan.md')
      || manifest.schemaVersion !== 1
      || manifest.ownerType !== owner.ownerType
      || manifest.ownerId !== owner.ownerId
      || (manifest.judgementId ?? null) !== owner.judgementId
      || manifest.masterId !== owner.masterId
      || manifest.masterVersion !== owner.masterVersion
      || manifest.dshSessionId !== owner.dshSessionId
      || manifest.planVersion !== version
      || manifest.sha256 !== digest
      || manifest.sizeBytes !== Buffer.byteLength(content, 'utf8')
      || typeof manifest.sealedAt !== 'string'
      || manifest.source !== 'workspace/PLAN.md'
    ) throw new Error('既有研究计划版本校验失败，拒绝覆盖')
    return {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      judgementId: owner.judgementId,
      version,
      content,
      sha256: digest,
      sizeBytes: manifest.sizeBytes,
      sealedAt: manifest.sealedAt,
      relativePath: relative(this.paths.root, planPath).split(sep).join('/'),
    }
  }

  private ownerRoot(ownerType: ResearchPlanOwnerType, ownerId: string): string {
    assertIdentifier(ownerId)
    return join(ownerType === 'judgement' ? this.paths.judgementsDir : this.paths.expertChatsDir, ownerId)
  }

  private safePath(relativePath: string): string {
    const absolute = resolve(this.paths.root, relativePath)
    const root = resolve(this.paths.root)
    if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) throw new Error('路径超出 Hanai 数据根目录')
    return absolute
  }

  private readonly minChars = 120
}

/** Kept for callers that construct a judgement owner from the business row. */
export function researchPlanOwnerFromJudgement(judgement: Judgement): ResearchPlanOwner {
  if (judgement.dshSessionId === null) throw new Error('无法封存未绑定 DSH Session 的研究计划')
  return {
    ownerType: 'judgement',
    ownerId: judgement.id,
    judgementId: judgement.id,
    masterId: judgement.masterId,
    masterVersion: judgement.masterVersion,
    dshSessionId: judgement.dshSessionId,
  }
}

function isJudgement(value: ResearchPlanOwner | Judgement): value is Judgement {
  return 'secId' in value && 'stockName' in value
}

function assertOwner(owner: ResearchPlanOwner): void {
  if (owner.ownerType === 'judgement' && owner.judgementId !== owner.ownerId) throw new Error('研判研究计划归属不一致')
  if (owner.ownerType === 'expert-chat' && owner.judgementId !== null) throw new Error('专家对谈研究计划不能绑定研判')
  assertIdentifier(owner.ownerId)
  if (owner.masterId.trim() === '' || owner.masterVersion.trim() === '' || owner.dshSessionId.trim() === '') {
    throw new Error('研究计划归属元数据不能为空')
  }
}

function assertIdentifier(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error('研究计划标识格式无效')
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export class ResearchPlanValidationError extends Error {
  override readonly name = 'ResearchPlanValidationError'

  constructor(readonly code: string, message: string) {
    super(message)
  }
}
