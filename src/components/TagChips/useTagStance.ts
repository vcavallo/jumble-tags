import { useNostr } from '@/providers/NostrProvider'
import taggingService from '@/services/tagging.service'
import type { TApplyResult } from '@/lib/tagging/sdk/event-tagging/index.js'
import { Event } from 'nostr-tools'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export type TTagStanceTarget = { type: 'event'; event: Event } | { type: 'pubkey'; pubkey: string }

export type TTagStanceInput =
  | { name: string; description?: string }
  | { authorPubkey: string; slug: string; eventId?: string }

/**
 * Shared apply/dispute action used by chips, the stance popover and the tag
 * picker. Handles login gating and reports the orchestrators' two failure
 * modes honestly: a throw means nothing hit the wire (clean abort); a
 * `failedAt` result means earlier events already published (reusable
 * tag-elements/headers — never a dangling assertion).
 */
export function useTagStance() {
  const { t } = useTranslation()
  const { checkLogin } = useNostr()
  const [busy, setBusy] = useState(false)

  const applyStance = async (
    target: TTagStanceTarget,
    tagInput: TTagStanceInput,
    polarity: 1 | -1,
    onSuccess?: (result: TApplyResult) => void
  ) => {
    await checkLogin(async () => {
      if (busy) return
      setBusy(true)
      try {
        const result =
          target.type === 'event'
            ? await taggingService.applyTagToEvent({ tagInput, event: target.event, polarity })
            : await taggingService.applyTagToProfile({
                tagInput,
                targetPubkey: target.pubkey,
                polarity
              })
        if (result.failedAt) {
          toast.warning(
            t(
              'Partially published: {{count}} event(s) landed before a failure ({{error}}). Nothing dangling was left — you can retry safely.',
              {
                count: result.published.length,
                error: result.failedAt.error ?? t('publish failed')
              }
            )
          )
        } else {
          toast.success(polarity === 1 ? t('Tag applied') : t('Tag disputed'))
          onSuccess?.(result)
        }
      } catch (error) {
        // Nothing was published (e.g. the signer rejected) — a clean abort.
        toast.error(
          t('Cancelled — nothing was published ({{error}})', {
            error: error instanceof Error ? error.message : String(error)
          })
        )
      } finally {
        setBusy(false)
      }
    })
  }

  return { applyStance, busy }
}
