import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import JSON5 from 'json5'

type ClawdbotConfig = {
  agent?: { workspace?: string }
  agents?: {
    defaults?: { workspace?: string }
    list?: Array<{
      id?: string
      name?: string
      workspace?: string
      default?: boolean
    }>
  }
  routing?: {
    agents?: Record<
      string,
      {
        name?: string
        workspace?: string
      }
    >
  }
  skills?: {
    load?: {
      extraDirs?: string[]
    }
  }
}

export type ClawdbotSkillRoots = {
  roots: string[]
  labels: Record<string, string>
}

export async function resolveClawdbotSkillRoots(): Promise<ClawdbotSkillRoots> {
  const roots: string[] = []
  const labels: Record<string, string> = {}

  const stateDir = resolveClawdbotStateDir()
  const sharedSkills = resolveUserPath(join(stateDir, 'skills'))
  pushRoot(roots, labels, sharedSkills, 'Shared skills')

  const config = await readClawdbotConfig()
  if (!config) return { roots, labels }

  const mainWorkspace = resolveUserPath(
    config.agents?.defaults?.workspace ?? config.agent?.workspace ?? '',
  )
  if (mainWorkspace) {
    pushRoot(roots, labels, join(mainWorkspace, 'skills'), 'Agent: main')
  }

  const listedAgents = config.agents?.list ?? []
  for (const entry of listedAgents) {
    const workspace = resolveUserPath(entry?.workspace ?? '')
    if (!workspace) continue
    const name = entry?.name?.trim() || entry?.id?.trim() || 'agent'
    pushRoot(roots, labels, join(workspace, 'skills'), `Agent: ${name}`)
  }

  const agents = config.routing?.agents ?? {}
  for (const [agentId, entry] of Object.entries(agents)) {
    const workspace = resolveUserPath(entry?.workspace ?? '')
    if (!workspace) continue
    const name = entry?.name?.trim() || agentId
    pushRoot(roots, labels, join(workspace, 'skills'), `Agent: ${name}`)
  }

  const extraDirs = config.skills?.load?.extraDirs ?? []
  for (const dir of extraDirs) {
    const resolved = resolveUserPath(String(dir))
    if (!resolved) continue
    const label = `Extra: ${basename(resolved) || resolved}`
    pushRoot(roots, labels, resolved, label)
  }

  return { roots, labels }
}

export async function resolveClawdbotDefaultWorkspace(): Promise<string | null> {
  const config = await readClawdbotConfig()
  if (!config) return null

  const defaultsWorkspace = resolveUserPath(
    config.agents?.defaults?.workspace ?? config.agent?.workspace ?? '',
  )
  if (defaultsWorkspace) return defaultsWorkspace

  const listedAgents = config.agents?.list ?? []
  const defaultAgent =
    listedAgents.find((entry) => entry.default) ?? listedAgents.find((entry) => entry.id === 'main')
  const listWorkspace = resolveUserPath(defaultAgent?.workspace ?? '')
  return listWorkspace || null
}

function resolveClawdbotStateDir() {
  const override = process.env.CLAWDBOT_STATE_DIR?.trim()
  if (override) return resolveUserPath(override)
  return join(homedir(), '.clawdbot')
}

function resolveClawdbotConfigPath() {
  const override = process.env.CLAWDBOT_CONFIG_PATH?.trim()
  if (override) return resolveUserPath(override)
  return join(resolveClawdbotStateDir(), 'clawdbot.json')
}

function resolveUserPath(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('~')) {
    return resolve(trimmed.replace(/^~(?=$|[\\/])/, homedir()))
  }
  return resolve(trimmed)
}

async function readClawdbotConfig(): Promise<ClawdbotConfig | null> {
  try {
    const raw = await readFile(resolveClawdbotConfigPath(), 'utf8')
    const parsed = JSON5.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as ClawdbotConfig
  } catch {
    return null
  }
}

function pushRoot(roots: string[], labels: Record<string, string>, root: string, label?: string) {
  const resolved = resolveUserPath(root)
  if (!resolved) return
  if (!roots.includes(resolved)) roots.push(resolved)
  if (!label) return
  const existing = labels[resolved]
  if (!existing) {
    labels[resolved] = label
    return
  }
  const parts = existing
    .split(', ')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.includes(label)) return
  labels[resolved] = `${existing}, ${label}`
}
