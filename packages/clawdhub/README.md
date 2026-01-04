# `clawdhub`

ClawdHub CLI — install, update, search, and publish agent skills as folders.

## Install

```bash
npm i -g clawdhub
```

## Auth (publish)

Create a token on `clawdhub.com` → Settings → API tokens, then:

```bash
clawdhub login
```

## Examples

```bash
clawdhub search "postgres backups"
clawdhub install my-skill-pack
clawdhub update --all
clawdhub publish ./my-skill-pack --slug my-skill-pack --name "My Skill Pack" --version 1.2.0 --changelog "Fixes + docs"
```

## Defaults

- Registry: `https://clawdhub.com` (override via `--registry` or `CLAWDHUB_REGISTRY`)
- Workdir: current directory (override via `--workdir`)
- Install dir: `./skills` under workdir (override via `--dir`)

