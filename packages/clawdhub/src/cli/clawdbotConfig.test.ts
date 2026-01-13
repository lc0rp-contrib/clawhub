/* @vitest-environment node */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveClawdbotDefaultWorkspace, resolveClawdbotSkillRoots } from './clawdbotConfig.js'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('resolveClawdbotSkillRoots', () => {
  it('reads JSON5 config and resolves per-agent + shared skill roots', async () => {
    const base = await mkdtemp(join(tmpdir(), 'clawdhub-clawdbot-'))
    const home = join(base, 'home')
    const stateDir = join(base, 'state')
    const configPath = join(base, 'clawdbot.json')

    process.env.HOME = home
    process.env.CLAWDBOT_STATE_DIR = stateDir
    process.env.CLAWDBOT_CONFIG_PATH = configPath

    const config = `{
      // JSON5 comments + trailing commas supported
      agents: {
        defaults: { workspace: '~/clawd-main', },
        list: [
          { id: 'work', name: 'Work Bot', workspace: '~/clawd-work', },
          { id: 'family', workspace: '~/clawd-family', },
        ],
      },
      // legacy entries still supported
      agent: { workspace: '~/clawd-legacy', },
      routing: {
        agents: {
          work: { name: 'Work Bot', workspace: '~/clawd-work', },
          family: { workspace: '~/clawd-family' },
        },
      },
      skills: {
        load: { extraDirs: ['~/shared/skills', '/opt/skills',], },
      },
    }`
    await writeFile(configPath, config, 'utf8')

    const { roots, labels } = await resolveClawdbotSkillRoots()

    const expectedRoots = [
      resolve(stateDir, 'skills'),
      resolve(home, 'clawd-main', 'skills'),
      resolve(home, 'clawd-work', 'skills'),
      resolve(home, 'clawd-family', 'skills'),
      resolve(home, 'shared', 'skills'),
      resolve('/opt/skills'),
    ]

    expect(roots).toEqual(expect.arrayContaining(expectedRoots))
    expect(labels[resolve(stateDir, 'skills')]).toBe('Shared skills')
    expect(labels[resolve(home, 'clawd-main', 'skills')]).toBe('Agent: main')
    expect(labels[resolve(home, 'clawd-work', 'skills')]).toBe('Agent: Work Bot')
    expect(labels[resolve(home, 'clawd-family', 'skills')]).toBe('Agent: family')
    expect(labels[resolve(home, 'shared', 'skills')]).toBe('Extra: skills')
    expect(labels[resolve('/opt/skills')]).toBe('Extra: skills')
  })

  it('resolves default workspace from agents.defaults and agents.list', async () => {
    const base = await mkdtemp(join(tmpdir(), 'clawdhub-clawdbot-default-'))
    const home = join(base, 'home')
    const stateDir = join(base, 'state')
    const configPath = join(base, 'clawdbot.json')
    const workspaceMain = join(base, 'workspace-main')
    const workspaceList = join(base, 'workspace-list')

    process.env.HOME = home
    process.env.CLAWDBOT_STATE_DIR = stateDir
    process.env.CLAWDBOT_CONFIG_PATH = configPath

    const config = `{
      agents: {
        defaults: { workspace: "${workspaceMain}", },
        list: [
          { id: 'main', workspace: "${workspaceList}", default: true },
        ],
      },
    }`
    await writeFile(configPath, config, 'utf8')

    const workspace = await resolveClawdbotDefaultWorkspace()
    expect(workspace).toBe(resolve(workspaceMain))
  })

  it('falls back to default agent in agents.list when defaults missing', async () => {
    const base = await mkdtemp(join(tmpdir(), 'clawdhub-clawdbot-list-'))
    const home = join(base, 'home')
    const configPath = join(base, 'clawdbot.json')
    const workspaceMain = join(base, 'workspace-main')
    const workspaceWork = join(base, 'workspace-work')

    process.env.HOME = home
    process.env.CLAWDBOT_CONFIG_PATH = configPath

    const config = `{
      agents: {
        list: [
          { id: 'main', workspace: "${workspaceMain}", default: true },
          { id: 'work', workspace: "${workspaceWork}" },
        ],
      },
    }`
    await writeFile(configPath, config, 'utf8')

    const workspace = await resolveClawdbotDefaultWorkspace()
    expect(workspace).toBe(resolve(workspaceMain))
  })

  it('respects CLAWDBOT_STATE_DIR and CLAWDBOT_CONFIG_PATH overrides', async () => {
    const base = await mkdtemp(join(tmpdir(), 'clawdhub-clawdbot-override-'))
    const home = join(base, 'home')
    const stateDir = join(base, 'custom-state')
    const configPath = join(base, 'config', 'clawdbot.json')

    process.env.HOME = home
    process.env.CLAWDBOT_STATE_DIR = stateDir
    process.env.CLAWDBOT_CONFIG_PATH = configPath

    const config = `{
      agent: { workspace: "${join(base, 'workspace-main')}" },
    }`
    await mkdir(join(base, 'config'), { recursive: true })
    await writeFile(configPath, config, 'utf8')

    const { roots, labels } = await resolveClawdbotSkillRoots()

    expect(roots).toEqual(
      expect.arrayContaining([
        resolve(stateDir, 'skills'),
        resolve(join(base, 'workspace-main'), 'skills'),
      ]),
    )
    expect(labels[resolve(stateDir, 'skills')]).toBe('Shared skills')
    expect(labels[resolve(join(base, 'workspace-main'), 'skills')]).toBe('Agent: main')
  })

  it('returns shared skills root when config is missing', async () => {
    const base = await mkdtemp(join(tmpdir(), 'clawdhub-clawdbot-missing-'))
    const stateDir = join(base, 'state')
    const configPath = join(base, 'missing', 'clawdbot.json')

    process.env.CLAWDBOT_STATE_DIR = stateDir
    process.env.CLAWDBOT_CONFIG_PATH = configPath

    const { roots, labels } = await resolveClawdbotSkillRoots()

    expect(roots).toEqual([resolve(stateDir, 'skills')])
    expect(labels[resolve(stateDir, 'skills')]).toBe('Shared skills')
  })
})
