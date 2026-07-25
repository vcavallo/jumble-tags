import { useNostr } from '@/providers/NostrProvider'
import taggingService, {
  targetKeyForEvent,
  targetKeyForPubkey,
  TTargetTagsState
} from '@/services/tagging.service'
import { Event } from 'nostr-tools'
import { useEffect, useMemo, useSyncExternalStore } from 'react'

function useTargetTags(targetKey?: string): TTargetTagsState | undefined {
  const { pubkey } = useNostr()
  useEffect(() => {
    if (targetKey) {
      // Pass the viewer explicitly: on account restore this effect runs before
      // the provider-level effect that sets client.pubkey.
      taggingService.requestTargetTags(targetKey, pubkey)
    }
  }, [targetKey, pubkey])
  return useSyncExternalStore(
    (callback) => (targetKey ? taggingService.subscribeTarget(targetKey, callback) : () => {}),
    () => (targetKey ? taggingService.getTargetTags(targetKey) : undefined)
  )
}

/** The decentralized-tag state for a note (or any taggable event). */
export function useNoteTags(event?: Event) {
  const targetKey = useMemo(() => (event ? targetKeyForEvent(event) : undefined), [event])
  return useTargetTags(targetKey)
}

/** The decentralized-tag state for a pubkey (profile). */
export function useProfileTags(pubkey?: string) {
  const targetKey = useMemo(() => (pubkey ? targetKeyForPubkey(pubkey) : undefined), [pubkey])
  return useTargetTags(targetKey)
}
