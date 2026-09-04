import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PORT,
  DEFAULT_PROFILE,
  SERVICE_LABEL,
  buildLaunchAgentPlist,
  launchAgentLogsDirectory,
  launchAgentPath,
  launchdEnvironment,
  parseServiceArgs,
  resolveNodeExecutable,
} from './service.ts'

describe('macOS LaunchAgent service', () => {
  it('uses the investment defaults and strips pnpm separator', () => {
    expect(parseServiceArgs(['--', 'status'])).toMatchObject({
      action: 'status',
      profile: DEFAULT_PROFILE,
      port: DEFAULT_PORT,
    })
  })

  it('parses explicit profile and port', () => {
    expect(parseServiceArgs(['install', '--profile', 'custom-profile', '--port', '3091'])).toMatchObject({
      action: 'install',
      profile: 'custom-profile',
      port: 3091,
    })
  })

  it('rejects unsafe profiles and invalid ports', () => {
    expect(() => parseServiceArgs(['start', '--profile', 'bad/name'])).toThrow(/profile 名称/)
    expect(() => parseServiceArgs(['start', '--port', '0'])).toThrow(/端口/)
    expect(() => parseServiceArgs(['start', '--port', '65536'])).toThrow(/端口/)
  })

  it('renders a launchd plist with absolute paths and non-shell arguments', () => {
    const plist = buildLaunchAgentPlist({
      label: SERVICE_LABEL,
      programArguments: ['/var/example/.nvm/bin/node', '/var/example/.local/bin/dsh', '--profile', DEFAULT_PROFILE, '--port', String(DEFAULT_PORT), '--no-open'],
      workingDirectory: '/var/example/project',
      environmentVariables: { HOME: '/var/example', PATH: '/bin:/usr/bin' },
      standardOutPath: '/var/example/Library/Logs/dsh-mode-investment/stdout.log',
      standardErrorPath: '/var/example/Library/Logs/dsh-mode-investment/stderr.log',
    })

    expect(plist).toContain(`<key>Label</key>\n<string>${SERVICE_LABEL}</string>`)
    expect(plist).toContain('<key>ProgramArguments</key>')
    expect(plist).toContain('<string>--no-open</string>')
    expect(plist).toContain('<key>KeepAlive</key>')
    expect(plist).toContain('<key>SuccessfulExit</key><false/>')
    expect(plist).toContain('<string>/var/example/.nvm/bin/node</string>')
    expect(plist).not.toContain('sh -c')
  })

  it('prefers an explicit NVM Node path when pnpm changes process.execPath', () => {
    expect(resolveNodeExecutable({ NVM_BIN: '/bin', NODE: '/bin/sh', PATH: '/bin:/usr/bin' }, '/bin/sh')).toBe('/bin/sh')
  })

  it('uses the user home and preserves only safe DSH environment settings', () => {
    expect(launchAgentPath('/var/example')).toBe('/var/example/Library/LaunchAgents/com.modeyang.dsh-mode-investment.plist')
    expect(launchAgentLogsDirectory('/var/example')).toBe('/var/example/Library/Logs/dsh-mode-investment')
    const environment = launchdEnvironment({
      PATH: '/custom/bin',
      DSH_HOME: '/var/example/.dsh',
      DSH_MODE_INVESTMENT_HOME: '/var/example/.dsh-mode-investment',
      DEEPSEEK_API_KEY: 'must-not-be-copied',
    }, '/var/example/.local/bin/dsh', '/var/example', '/var/example/.nvm/bin/node')
    expect(environment).toMatchObject({
      HOME: '/var/example',
      DSH_HOME: '/var/example/.dsh',
      DSH_MODE_INVESTMENT_HOME: '/var/example/.dsh-mode-investment',
    })
    expect(environment.PATH?.split(':')).toEqual(expect.arrayContaining([
      '/var/example/.local/bin',
      dirname(process.execPath),
      '/custom/bin',
      '/usr/local/bin',
      '/opt/homebrew/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ]))
    expect(environment).not.toHaveProperty('DEEPSEEK_API_KEY')
  })
})
