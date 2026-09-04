import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { stripPnpmRunSeparator } from './pnpm-run-args.ts'

export const SERVICE_LABEL = 'com.modeyang.dsh-mode-investment'
export const DEFAULT_PROFILE = 'mode-investment'
export const DEFAULT_PORT = 3090
const LAUNCHCTL = '/bin/launchctl'
const SHELL = '/bin/sh'
const SAFE_ENVIRONMENT_KEYS = ['DSH_HOME', 'DSH_MODE_INVESTMENT_HOME'] as const

type ServiceAction = 'install' | 'start' | 'stop' | 'restart' | 'status' | 'uninstall'

type Environment = NodeJS.ProcessEnv

export interface ServiceOptions {
  action: ServiceAction
  profile: string
  port: number
  dshBin?: string
  projectRoot: string
  home: string
  environment: Environment
}

export interface LaunchAgentConfig {
  label: string
  programArguments: readonly string[]
  workingDirectory: string
  environmentVariables: Readonly<Record<string, string>>
  standardOutPath: string
  standardErrorPath: string
  runAtLoad?: boolean
  keepAliveOnFailure?: boolean
  throttleIntervalSeconds?: number
}

interface ResolvedService {
  options: ServiceOptions
  dshExecutable: string
  plistPath: string
  logsDirectory: string
  plist: string
}

interface CommandResult {
  status: number | null
  stdout: string
  stderr: string
}

export function parseServiceArgs(args: readonly string[]): ServiceOptions {
  const values = stripPnpmRunSeparator(args)
  const action = values[0] as ServiceAction | undefined
  if (action === undefined || !['install', 'start', 'stop', 'restart', 'status', 'uninstall'].includes(action)) {
    throw new Error('用法：service <install|start|stop|restart|status|uninstall> [--profile name] [--port number] [--dsh-bin path] [--project-root path]')
  }

  let profile = DEFAULT_PROFILE
  let port = DEFAULT_PORT
  let dshBin: string | undefined
  let projectRoot = process.cwd()
  for (let index = 1; index < values.length; index += 1) {
    const argument = values[index]
    if (argument === '--profile') profile = requiredValue(values, ++index, argument)
    else if (argument === '--port') port = parsePort(requiredValue(values, ++index, argument))
    else if (argument === '--dsh-bin') dshBin = requiredValue(values, ++index, argument)
    else if (argument === '--project-root') projectRoot = resolve(requiredValue(values, ++index, argument))
    else throw new Error(`未知参数：${argument}`)
  }

  if (!/^[A-Za-z0-9._-]+$/.test(profile)) throw new Error('profile 名称只能包含字母、数字、点、下划线或连字符')
  return {
    action,
    profile,
    port,
    ...(dshBin === undefined ? {} : { dshBin }),
    projectRoot: resolve(projectRoot),
    home: homedir(),
    environment: process.env,
  }
}

export function buildLaunchAgentPlist(config: LaunchAgentConfig): string {
  assertAbsolute(config.workingDirectory, 'WorkingDirectory')
  assertAbsolute(config.standardOutPath, 'StandardOutPath')
  assertAbsolute(config.standardErrorPath, 'StandardErrorPath')
  if (config.programArguments.length === 0) throw new Error('ProgramArguments 不能为空')

  const environmentEntries = Object.entries(config.environmentVariables)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${keyElement(key)}${stringElement(value)}`)
    .join('')
  const argumentsXml = config.programArguments.map(value => stringElement(value)).join('')
  const runAtLoad = config.runAtLoad ?? true
  const keepAliveOnFailure = config.keepAliveOnFailure ?? true
  const throttleInterval = config.throttleIntervalSeconds ?? 5

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    keyElement('Label'),
    stringElement(config.label),
    keyElement('ProgramArguments'),
    `<array>${argumentsXml}</array>`,
    keyElement('WorkingDirectory'),
    stringElement(config.workingDirectory),
    keyElement('EnvironmentVariables'),
    `<dict>${environmentEntries}</dict>`,
    keyElement('RunAtLoad'),
    booleanElement(runAtLoad),
    keyElement('KeepAlive'),
    `<dict>${keyElement('SuccessfulExit')}${booleanElement(!keepAliveOnFailure)}</dict>`,
    keyElement('ThrottleInterval'),
    `<integer>${String(throttleInterval)}</integer>`,
    keyElement('StandardOutPath'),
    stringElement(config.standardOutPath),
    keyElement('StandardErrorPath'),
    stringElement(config.standardErrorPath),
    '</dict>',
    '</plist>',
    '',
  ].join('\n')
}

export function launchAgentPath(home: string): string {
  return join(home, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`)
}

export function launchAgentLogsDirectory(home: string): string {
  return join(home, 'Library', 'Logs', 'dsh-mode-investment')
}

export function launchdEnvironment(
  environment: Environment,
  dshExecutable: string,
  home: string,
  nodeExecutable = process.execPath,
): Record<string, string> {
  const pathEntries = unique([
    dirname(dshExecutable),
    dirname(nodeExecutable),
    dirname(process.execPath),
    ...(environment.PATH ?? '').split(':').filter(Boolean),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ])
  const result: Record<string, string> = {
    HOME: home,
    PATH: pathEntries.join(':'),
  }
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    const value = environment[key]?.trim()
    if (value !== undefined && value.length > 0) result[key] = value
  }
  return result
}

export function resolveDshExecutable(dshBin = 'dsh', environment: Environment = process.env): string {
  const candidate = isAbsolute(dshBin) ? dshBin : commandPath(dshBin, environment)
  if (!isAbsolute(candidate)) throw new Error(`无法解析 dsh 的绝对路径：${dshBin}`)
  if (!existsSync(candidate)) throw new Error(`dsh 可执行文件不存在：${candidate}`)
  return candidate
}

function ensureProfileLink(service: ResolvedService): void {
  const packageLink = join(service.options.home, 'profiles', 'node_modules', 'dsh-mode-investment')
  const target = resolve(service.options.projectRoot)
  if (!existsSync(join(target, 'package.json'))) throw new Error(`项目根目录缺少 package.json：${target}`)
  try {
    if (realpathSync(packageLink) === target) return
    unlinkSync(packageLink)
  } catch {
    if (existsSync(packageLink)) unlinkSync(packageLink)
  }
  mkdirSync(dirname(packageLink), { recursive: true })
  symlinkSync(target, packageLink, 'junction')
}

export function resolveNodeExecutable(environment: Environment = process.env, dshExecutable?: string): string {
  if (dshExecutable !== undefined) {
    const dshDirectory = dirname(realpathSync(dshExecutable))
    const siblingNode = join(dshDirectory, 'node')
    if (existsSync(siblingNode)) return realpathSync(siblingNode)
  }
  const nvmBin = environment.NVM_BIN?.trim()
  if (nvmBin !== undefined && nvmBin.length > 0) {
    const nvmNode = join(nvmBin, 'node')
    if (isAbsolute(nvmNode) && existsSync(nvmNode)) return realpathSync(nvmNode)
  }
  const explicit = environment.NODE?.trim()
  if (explicit !== undefined && explicit.length > 0 && isAbsolute(explicit) && existsSync(explicit)) {
    const resolved = realpathSync(explicit)
    if (!resolved.endsWith('/DSH Desktop') && !resolved.endsWith('/node')) return resolved
  }
  const candidate = commandPath('node', environment)
  if (!isAbsolute(candidate)) throw new Error(`无法解析 node 的绝对路径：${candidate}`)
  if (!existsSync(candidate)) throw new Error(`node 可执行文件不存在：${candidate}`)
  return realpathSync(candidate)
}

function resolveService(options: ServiceOptions): ResolvedService {
  const dshExecutable = resolveDshExecutable(options.dshBin, options.environment)
  const nodeExecutable = resolveNodeExecutable(options.environment)
  const plistPath = launchAgentPath(options.home)
  const logsDirectory = launchAgentLogsDirectory(options.home)
  const plist = buildLaunchAgentPlist({
    label: SERVICE_LABEL,
    programArguments: [
      nodeExecutable,
      dshExecutable,
      '--profile',
      options.profile,
      '--port',
      String(options.port),
      '--no-open',
    ],
    workingDirectory: options.projectRoot,
    environmentVariables: launchdEnvironment(options.environment, dshExecutable, options.home, nodeExecutable),
    standardOutPath: join(logsDirectory, 'stdout.log'),
    standardErrorPath: join(logsDirectory, 'stderr.log'),
  })
  return { options, dshExecutable, plistPath, logsDirectory, plist }
}

function installService(service: ResolvedService): void {
  ensureProfileLink(service)
  mkdirSync(dirname(service.plistPath), { recursive: true, mode: 0o700 })
  mkdirSync(service.logsDirectory, { recursive: true, mode: 0o700 })
  writeAtomic(service.plistPath, service.plist)

  if (isLoaded(service.options.home)) bootout(service.options.home)
  bootstrap(service.options.home, service.plistPath)
  console.log(`已安装并启动 macOS LaunchAgent：${service.plistPath}`)
  console.log(`访问地址：http://127.0.0.1:${String(service.options.port)}`)
}

function startService(service: ResolvedService): void {
  ensureProfileLink(service)
  if (!existsSync(service.plistPath)) {
    installService(service)
    return
  }
  writeAtomic(service.plistPath, service.plist)
  if (isLoaded(service.options.home)) bootout(service.options.home)
  bootstrap(service.options.home, service.plistPath)
  console.log(`已启动 ${SERVICE_LABEL}`)
}

function stopService(home: string): void {
  if (!isLoaded(home)) {
    console.log(`服务未运行：${SERVICE_LABEL}`)
    return
  }
  bootout(home)
  console.log(`已停止 ${SERVICE_LABEL}（保留 plist，可用 service:start 再启动）`)
}

function restartService(service: ResolvedService): void {
  ensureProfileLink(service)
  if (isLoaded(service.options.home)) bootout(service.options.home)
  if (!existsSync(service.plistPath)) {
    installService(service)
    return
  }
  writeAtomic(service.plistPath, service.plist)
  bootstrap(service.options.home, service.plistPath)
  console.log(`已重启 ${SERVICE_LABEL}`)
}

function statusService(options: ServiceOptions): void {
  const plistPath = launchAgentPath(options.home)
  if (!existsSync(plistPath)) {
    console.log(`未安装：${plistPath}`)
    return
  }
  if (!isLoaded(options.home)) {
    console.log(`已安装但未加载：${plistPath}`)
    return
  }
  const result = runLaunchctl(['print', serviceTarget(options.home)])
  process.stdout.write(result.stdout)
  if (result.stderr.length > 0) process.stderr.write(result.stderr)
}

function uninstallService(options: ServiceOptions): void {
  if (isLoaded(options.home)) bootout(options.home)
  const plistPath = launchAgentPath(options.home)
  if (existsSync(plistPath)) unlinkSync(plistPath)
  console.log(`已卸载 ${SERVICE_LABEL}；日志保留在 ${launchAgentLogsDirectory(options.home)}`)
}

function bootstrap(home: string, plistPath: string): void {
  const result = runLaunchctl(['bootstrap', launchdDomain(home), plistPath], true)
  if (result.status !== 0 && !/already bootstrapped|already loaded|service already exists/i.test(result.stderr)) {
    throw launchctlError(['bootstrap', launchdDomain(home), plistPath], result)
  }
}

function bootout(home: string): void {
  const domain = launchdDomain(home)
  const target = serviceTarget(home)
  const result = runLaunchctl(['bootout', domain, SERVICE_LABEL], true)
  if (result.status === 0 || /could not find service|no such process|not found/i.test(result.stderr)) return

  // Some macOS builds report EIO while the job is still stopping. Ask launchd
  // to terminate this exact service, then clear its stale registration.
  const killResult = runLaunchctl(['kill', 'SIGTERM', target], true)
  const removeResult = runLaunchctl(['remove', SERVICE_LABEL], true)
  // `remove` is the successful fallback on macOS versions which return EIO
  // from bootout even after the owned process has been terminated.
  if (killResult.status === 0 || removeResult.status === 0) return
  if (!isLoaded(home)) return
  throw launchctlError(['bootout', domain, SERVICE_LABEL], result)
}

function isLoaded(home: string): boolean {
  const result = runLaunchctl(['print', serviceTarget(home)], true)
  return result.status === 0
}

function serviceTarget(home: string): string {
  return `${launchdDomain(home)}/${SERVICE_LABEL}`
}

function launchdDomain(home: string): string {
  const uid = process.getuid?.()
  if (uid === undefined) throw new Error('无法获取当前用户 uid，不能操作用户级 LaunchAgent')
  if (resolve(home) !== resolve(homedir())) {
    throw new Error('测试或自定义 home 不能直接用于 launchctl；LaunchAgent 必须安装在当前用户域')
  }
  return `gui/${String(uid)}`
}

function commandPath(command: string, environment: Environment): string {
  const result = spawnSync(SHELL, ['-c', `command -v ${shellQuote(command)}`], {
    encoding: 'utf8',
    env: environment,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`PATH 中找不到 ${command}`)
  return result.stdout.trim().split('\n')[0] ?? ''
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function runLaunchctl(args: readonly string[], allowFailure = false): CommandResult {
  const result = spawnSync(LAUNCHCTL, [...args], { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  const commandResult: CommandResult = {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
  if (!allowFailure && commandResult.status !== 0) throw launchctlError(args, commandResult)
  return commandResult
}

function launchctlError(args: readonly string[], result: CommandResult): Error {
  const detail = (result.stderr || result.stdout).trim()
  return new Error(`launchctl ${args.join(' ')} 失败${detail.length > 0 ? `：${detail}` : ''}`)
}

function writeAtomic(path: string, content: string): void {
  const temporary = `${path}.tmp-${String(process.pid)}`
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

function requiredValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index]
  if (value === undefined || value === '') throw new Error(`${flag} 缺少值`)
  return value
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`端口必须是 1 到 65535 的整数：${value}`)
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error(`端口必须是 1 到 65535 的整数：${value}`)
  return port
}

function assertAbsolute(value: string, label: string): void {
  if (!isAbsolute(value)) throw new Error(`${label} 必须是绝对路径：${value}`)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function keyElement(value: string): string {
  return `<key>${xmlEscape(value)}</key>`
}

function stringElement(value: string): string {
  return `<string>${xmlEscape(value)}</string>`
}

function booleanElement(value: boolean): string {
  return value ? '<true/>' : '<false/>'
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function assertMacOS(): void {
  if (process.platform !== 'darwin') throw new Error('macOS LaunchAgent 命令只能在 macOS 上执行')
}

function main(args: readonly string[]): void {
  assertMacOS()
  const options = parseServiceArgs(args)
  switch (options.action) {
    case 'install':
      installService(resolveService(options))
      break
    case 'start':
      startService(resolveService(options))
      break
    case 'stop':
      stopService(options.home)
      break
    case 'restart':
      restartService(resolveService(options))
      break
    case 'status':
      statusService(options)
      break
    case 'uninstall':
      uninstallService(options)
      break
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

export { main }
