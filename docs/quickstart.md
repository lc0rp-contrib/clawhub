---
summary: 'Local setup + CLI smoke: login, search, install, publish, sync.'
read_when:
  - First run / local dev setup
  - Verifying end-to-end flows
---

# Quickstart

## 0) Prereqs

- Bun
- Convex CLI (`bunx convex ...`)
- GitHub OAuth App (for login)
- OpenAI key (for embeddings/search)

## 1) Local dev (web + Convex)

```bash
bun install
cp .env.local.example .env.local

# terminal A
bun run dev

# terminal B
bunx convex dev
```

## 2) Auth setup (GitHub OAuth + Convex Auth keys)

Fill in `.env.local`:

- `AUTH_GITHUB_ID`
- `AUTH_GITHUB_SECRET`
- `VITE_CONVEX_URL`
- `VITE_CONVEX_SITE_URL`
- `CONVEX_SITE_URL` (same as `VITE_CONVEX_SITE_URL`)
- `OPENAI_API_KEY`

Generate Convex Auth keys for your deployment:

```bash
bunx auth --deployment-name <deployment> --web-server-url http://localhost:3000
```

Then paste the printed `JWT_PRIVATE_KEY` + `JWKS` into `.env.local` (and ensure the deployment got them too).

## 3) CLI: login + basic commands

From this repo:

```bash
bun clawdhub --help
bun clawdhub login
bun clawdhub whoami
bun clawdhub search gif --limit 5
```

Install a skill into `./skills/<slug>` (if Clawdbot is configured, installs into that workspace instead):

```bash
bun clawdhub install <slug>
bun clawdhub list
```

You can also install into any folder:

```bash
bun clawdhub install <slug> --workdir /tmp/clawdhub-demo --dir skills
```

Update:

```bash
bun clawdhub update --all
```

## 4) Publish a skill

Create a folder containing `SKILL.md` (required) plus any supporting text files:

```bash
mkdir -p /tmp/clawdhub-skill-demo && cd /tmp/clawdhub-skill-demo
cat > SKILL.md <<'EOF'
---
name: Demo Skill
description: Demo skill for local testing
---

# Demo Skill

Hello.
EOF
```

Publish:

```bash
bun clawdhub publish . \
  --slug clawdhub-demo-$(date +%s) \
  --name "Demo $(date +%s)" \
  --version 1.0.0 \
  --tags latest \
  --changelog "Initial release"
```

## 5) Sync local skills (auto-publish new/changed)

`sync` scans for local skill folders and publishes the ones that aren’t “synced” yet.

```bash
bun clawdhub sync
```

Dry run + non-interactive:

```bash
bun clawdhub sync --all --dry-run --no-input
```
