#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, rm, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { stdin } from 'node:process'
import semver from 'semver'
import { getGlobalConfigPath, readGlobalConfig, writeGlobalConfig } from './config.js'
import { apiRequest, downloadZip } from './http.js'
import { extractZipToDir, listTextFiles, readLockfile, writeLockfile } from './skills.js'

type GlobalOpts = {
  workdir: string
  dir: string
  registry: string
}

const DEFAULT_REGISTRY = 'https://clawdhub.com'

async function main() {
  const argv = process.argv.slice(2)
  const { opts, rest } = parseGlobalOpts(argv)
  const [cmd, ...args] = rest

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printHelp()
    return
  }

  switch (cmd) {
    case 'login':
      await cmdLogin(opts, args)
      return
    case 'logout':
      await cmdLogout()
      return
    case 'whoami':
      await cmdWhoami(opts)
      return
    case 'search':
      await cmdSearch(opts, args)
      return
    case 'install':
      await cmdInstall(opts, args)
      return
    case 'update':
      await cmdUpdate(opts, args)
      return
    case 'list':
      await cmdList(opts)
      return
    case 'publish':
      await cmdPublish(opts, args)
      return
    default:
      fail(`Unknown command: ${cmd}`)
  }
}

function printHelp() {
  console.log(`clawdhub — skills registry CLI

Usage:
  clawdhub [--workdir DIR] [--dir skills] [--registry URL] <command>

Commands:
  login [--token TOKEN]          Store API token (for publish)
  logout                         Remove stored token
  whoami                         Validate token
  search <query>                 Vector search skills
  install <slug> [--version V]   Install into <dir>/<slug>
  update [slug] --all            Update installed skills
  list                           List installed skills (from lockfile)
  publish <path> [flags]         Publish skill from folder

Env:
  CLAWDHUB_REGISTRY
`)
}

function parseGlobalOpts(argv: string[]): { opts: GlobalOpts; rest: string[] } {
  const rest: string[] = []
  const opts: GlobalOpts = {
    workdir: process.cwd(),
    dir: 'skills',
    registry: process.env.CLAWDHUB_REGISTRY ?? DEFAULT_REGISTRY,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--workdir') {
      opts.workdir = requireValue(argv[++i], '--workdir')
      continue
    }
    if (arg === '--dir') {
      opts.dir = requireValue(argv[++i], '--dir')
      continue
    }
    if (arg === '--registry') {
      opts.registry = requireValue(argv[++i], '--registry')
      continue
    }
    rest.push(arg)
  }

  opts.workdir = resolve(opts.workdir)
  opts.dir = resolve(opts.workdir, opts.dir)
  return { opts, rest }
}

async function cmdLogin(opts: GlobalOpts, args: string[]) {
  const tokenFlag = findFlagValue(args, '--token')
  const token = tokenFlag || (await promptHidden('ClawdHub token: '))
  if (!token) fail('Token required')

  const whoami = await apiRequest<{ user: { handle: string | null } }>(opts.registry, {
    method: 'GET',
    path: '/api/cli/whoami',
    token,
  })
  if (!whoami.user) fail('Login failed')

  await writeGlobalConfig({ registry: opts.registry, token })
  const handle = whoami.user.handle ? `@${whoami.user.handle}` : 'unknown user'
  console.log(`OK. Logged in as ${handle}.`)
}

async function cmdLogout() {
  await rm(getGlobalConfigPath(), { force: true })
  console.log('OK. Logged out.')
}

async function cmdWhoami(opts: GlobalOpts) {
  const cfg = await readGlobalConfig()
  const token = cfg?.token
  if (!token) fail('Not logged in. Run: clawdhub login')
  const registry = cfg?.registry ?? opts.registry
  const whoami = await apiRequest<{ user: { handle: string | null } }>(registry, {
    method: 'GET',
    path: '/api/cli/whoami',
    token,
  })
  console.log(whoami.user.handle ?? 'unknown')
}

async function cmdSearch(opts: GlobalOpts, args: string[]) {
  const query = args.join(' ').trim()
  if (!query) fail('Query required')

  const url = new URL('/api/search', opts.registry)
  url.searchParams.set('q', query)
  const result = await apiRequest<{ results: Array<{ slug?: string; displayName?: string; version?: string | null; score: number }> }>(
    opts.registry,
    { method: 'GET', url: url.toString() },
  )

  for (const entry of result.results) {
    const slug = entry.slug ?? 'unknown'
    const name = entry.displayName ?? slug
    const version = entry.version ? ` v${entry.version}` : ''
    console.log(`${slug}${version}  ${name}  (${entry.score.toFixed(3)})`)
  }
}

async function cmdInstall(opts: GlobalOpts, args: string[]) {
  const slug = args[0]?.trim()
  if (!slug) fail('Slug required')
  const versionFlag = findFlagValue(args.slice(1), '--version')
  const force = args.includes('--force')

  await mkdir(opts.dir, { recursive: true })
  const target = join(opts.dir, slug)
  if (!force) {
    const exists = await fileExists(target)
    if (exists) fail(`Already installed: ${target} (use --force)`)
  } else {
    await rm(target, { recursive: true, force: true })
  }

  const resolvedVersion =
    versionFlag ??
    (await apiRequest<{ latestVersion: { version: string } | null }>(opts.registry, {
      method: 'GET',
      path: `/api/skill?slug=${encodeURIComponent(slug)}`,
    })).latestVersion?.version ??
    null
  if (!resolvedVersion) fail('Could not resolve latest version')

  const zip = await downloadZip(opts.registry, { slug, version: resolvedVersion })
  await extractZipToDir(zip, target)

  const lock = await readLockfile(opts.workdir)
  lock.skills[slug] = {
    version: resolvedVersion,
    installedAt: Date.now(),
  }
  await writeLockfile(opts.workdir, lock)
  console.log(`OK. Installed ${slug} -> ${target}`)
}

async function cmdUpdate(opts: GlobalOpts, args: string[]) {
  const slugArg = args[0] && !args[0].startsWith('-') ? args[0] : null
  const all = args.includes('--all')
  if (!slugArg && !all) fail('Provide <slug> or --all')

  const lock = await readLockfile(opts.workdir)
  const slugs = slugArg ? [slugArg] : Object.keys(lock.skills)
  if (slugs.length === 0) {
    console.log('No installed skills.')
    return
  }

  for (const slug of slugs) {
    const current = lock.skills[slug]
    if (!current) continue
    const meta = await apiRequest<{ latestVersion: { version: string } | null }>(opts.registry, {
      method: 'GET',
      path: `/api/skill?slug=${encodeURIComponent(slug)}`,
    })
    const latest = meta.latestVersion?.version
    if (!latest) {
      console.log(`${slug}: not found`)
      continue
    }
    const installed = current.version
    if (installed && semver.valid(installed) && semver.gte(installed, latest)) {
      console.log(`${slug}: up to date (${installed})`)
      continue
    }

    const target = join(opts.dir, slug)
    await rm(target, { recursive: true, force: true })
    const zip = await downloadZip(opts.registry, { slug, version: latest })
    await extractZipToDir(zip, target)
    lock.skills[slug] = { version: latest, installedAt: Date.now() }
    console.log(`${slug}: updated -> ${latest}`)
  }

  await writeLockfile(opts.workdir, lock)
}

async function cmdList(opts: GlobalOpts) {
  const lock = await readLockfile(opts.workdir)
  const entries = Object.entries(lock.skills)
  if (entries.length === 0) {
    console.log('No installed skills.')
    return
  }
  for (const [slug, entry] of entries) {
    console.log(`${slug}  ${entry.version ?? 'latest'}`)
  }
}

async function cmdPublish(opts: GlobalOpts, args: string[]) {
  const folder = args[0] ? resolve(opts.workdir, args[0]) : null
  if (!folder) fail('Path required')
  const folderStat = await stat(folder).catch(() => null)
  if (!folderStat || !folderStat.isDirectory()) fail('Path must be a folder')

  const cfg = await readGlobalConfig()
  const token = cfg?.token
  if (!token) fail('Not logged in. Run: clawdhub login')
  const registry = cfg?.registry ?? opts.registry

  const slug = findFlagValue(args.slice(1), '--slug') ?? sanitizeSlug(basename(folder))
  const displayName = findFlagValue(args.slice(1), '--name') ?? titleCase(basename(folder))
  const version = findFlagValue(args.slice(1), '--version')
  const changelog = findFlagValue(args.slice(1), '--changelog') ?? ''
  const tagsValue = findFlagValue(args.slice(1), '--tags') ?? 'latest'
  const tags = tagsValue
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)

  if (!slug) fail('--slug required')
  if (!displayName) fail('--name required')
  if (!version || !semver.valid(version)) fail('--version must be valid semver')

  const meta = await apiRequest<{ skill?: unknown }>(registry, {
    method: 'GET',
    path: `/api/skill?slug=${encodeURIComponent(slug)}`,
  }).catch(() => null)
  const exists = Boolean(meta?.skill)
  if (exists && !changelog.trim()) fail('--changelog required for updates')

  const filesOnDisk = await listTextFiles(folder)
  if (filesOnDisk.length === 0) fail('No files found')
  if (
    !filesOnDisk.some((file) => {
      const lower = file.relPath.toLowerCase()
      return lower === 'skill.md' || lower === 'skills.md'
    })
  ) {
    fail('SKILL.md required')
  }

  const uploaded: Array<{
    path: string
    size: number
    storageId: string
    sha256: string
    contentType?: string
  }> = []

  for (const file of filesOnDisk) {
    const { uploadUrl } = await apiRequest<{ uploadUrl: string }>(registry, {
      method: 'POST',
      path: '/api/cli/upload-url',
      token,
    })

    const storageId = await uploadFile(uploadUrl, file.bytes, file.contentType ?? 'text/plain')
    const sha256 = sha256Hex(file.bytes)
    uploaded.push({
      path: file.relPath,
      size: file.bytes.byteLength,
      storageId,
      sha256,
      contentType: file.contentType ?? undefined,
    })
  }

  const result = await apiRequest<{ ok: true; skillId: string; versionId: string }>(registry, {
    method: 'POST',
    path: '/api/cli/publish',
    token,
    body: {
      slug,
      displayName,
      version,
      changelog,
      tags,
      files: uploaded,
    },
  })

  console.log(`OK. Published ${slug}@${version} (${result.versionId})`)
}

async function uploadFile(uploadUrl: string, bytes: Uint8Array, contentType: string) {
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': contentType || 'application/octet-stream' },
    body: Buffer.from(bytes),
  })
  if (!response.ok) {
    throw new Error(`Upload failed: ${await response.text()}`)
  }
  const payload = (await response.json()) as { storageId: string }
  return payload.storageId
}

function sha256Hex(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sanitizeSlug(value: string) {
  const raw = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  const cleaned = raw.replace(/^-+/, '').replace(/-+$/, '').replace(/--+/g, '-')
  return cleaned
}

function titleCase(value: string) {
  return value
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function findFlagValue(args: string[], flag: string) {
  const index = args.indexOf(flag)
  if (index === -1) return null
  const value = args[index + 1]
  return value ? value : null
}

function requireValue(value: string | undefined, flag: string) {
  if (!value) fail(`${flag} requires a value`)
  return value
}

async function fileExists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function promptHidden(prompt: string) {
  if (!stdin.isTTY) return ''
  process.stdout.write(prompt)
  const chunks: Buffer[] = []
  stdin.setRawMode(true)
  stdin.resume()
  return new Promise<string>((resolvePromise) => {
    function onData(data: Buffer) {
      const text = data.toString('utf8')
      if (text === '\r' || text === '\n') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.off('data', onData)
        process.stdout.write('\n')
        resolvePromise(Buffer.concat(chunks).toString('utf8').trim())
        return
      }
      if (text === '\u0003') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.off('data', onData)
        process.stdout.write('\n')
        fail('Canceled')
      }
      if (text === '\u007f') {
        chunks.pop()
        return
      }
      chunks.push(data)
    }
    stdin.on('data', onData)
  })
}

function fail(message: string): never {
  console.error(`Error: ${message}`)
  process.exit(1)
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  fail(message)
})
