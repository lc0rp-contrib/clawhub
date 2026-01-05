import { v } from 'convex/values'
import { internalAction } from './_generated/server'
import { buildDiscordPayload, getWebhookConfig, shouldSendWebhook } from './lib/webhooks'

export const sendDiscordWebhook = internalAction({
  args: {
    event: v.union(v.literal('skill.publish'), v.literal('skill.highlighted')),
    skill: v.object({
      slug: v.string(),
      displayName: v.string(),
      summary: v.optional(v.string()),
      version: v.optional(v.string()),
      ownerHandle: v.optional(v.string()),
      batch: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
    }),
  },
  handler: async (_ctx, args) => {
    const config = getWebhookConfig()
    if (!shouldSendWebhook(args.event, args.skill, config)) return { ok: false, skipped: true }

    const payload = buildDiscordPayload(args.event, args.skill, config)
    const response = await fetch(config.url as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const message = await response.text()
      throw new Error(`Discord webhook failed: ${response.status} ${message}`)
    }
    return { ok: true }
  },
})
