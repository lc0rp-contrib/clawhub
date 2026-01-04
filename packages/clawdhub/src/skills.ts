import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { unzipSync } from 'fflate'
import type { Lockfile } from './types.js'

const TEXT_EXTENSIONS = new Set([
  'md',
  'mdx',
  'txt',
  'json',
  'json5',
  'yaml',
  'yml',
  'toml',
  'js',
  'cjs',
  'mjs',
  'ts',
  'tsx',
  'jsx',
  'py',
  'sh',
  'rb',
  'go',
  'rs',
  'swift',
  'kt',
  'java',
  'cs',
  'cpp',
  'c',
  'h',
  'hpp',
  'sql',
  'csv',
  'ini',
  'cfg',
  'env',
  'xml',
  'html',
  'css',
  'scss',
  'sass',
  'svg',
])

export async function extractZipToDir(zipBytes: Uint8Array, targetDir: string) {
  const entries = unzipSync(zipBytes)
  await mkdir(targetDir, { recursive: true })
  for (const [rawPath, data] of Object.entries(entries)) {
    const safePath = sanitizeRelPath(rawPath)
    if (!safePath) continue
    const outPath = join(targetDir, safePath)
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, data)
  }
}

export async function listTextFiles(root: string) {
  const files: Array<{ relPath: string; bytes: Uint8Array; contentType?: string }> = []
  const absRoot = resolve(root)
  await walk(absRoot, async (absPath) => {
    const relPath = normalizePath(relative(absRoot, absPath))
    if (!relPath) return
    const ext = relPath.split('.').at(-1)?.toLowerCase() ?? ''
    if (!ext || !TEXT_EXTENSIONS.has(ext)) return
    const buffer = await readFile(absPath)
    files.push({ relPath, bytes: new Uint8Array(buffer) })
  })
  return files
}

export async function readLockfile(workdir: string): Promise<Lockfile> {
  const path = join(workdir, '.clawdhub', 'lock.json')
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid')
    const value = parsed as Lockfile
    if (!value.skills || typeof value.skills !== 'object') throw new Error('invalid')
    return value
  } catch {
    return { version: 1, skills: {} }
  }
}

export async function writeLockfile(workdir: string, lock: Lockfile) {
  const path = join(workdir, '.clawdhub', 'lock.json')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
}

function normalizePath(path: string) {
  return path.split(sep).join('/').replace(/^\.\/+/, '')
}

function sanitizeRelPath(path: string) {
  const normalized = path.replace(/^\.\/+/, '').replace(/^\/+/, '')
  if (!normalized || normalized.endsWith('/')) return null
  if (normalized.includes('..') || normalized.includes('\\')) return null
  return normalized
}

async function walk(dir: string, onFile: (path: string) => Promise<void>) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, onFile)
      continue
    }
    if (!entry.isFile()) continue
    await onFile(full)
  }
}

