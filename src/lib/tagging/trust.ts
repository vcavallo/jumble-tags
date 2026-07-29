import { LOCAL_TA_PUBKEY, NIP85_AUTHOR_PUBKEYS, TRUST_SETTINGS } from './config'
import { fetchTrustEvents } from './relays'
import { createHouseTrustSource, fetchApplicabilityLists } from './sdk/trust.js'

/**
 * The house-POV trust singleton used by every tagging read surface.
 *
 * `predicate` is synchronous and cache-backed: always `await ensure(pubkeys)`
 * with the asserter pubkeys you collected BEFORE classifying. Failed relay
 * fetches leave chunks uncached (retried on a later ensure) and the predicate
 * degrades per `unknownPolicy` — trust must never break rendering.
 */
const source =
  TRUST_SETTINGS.mode === 'everyone'
    ? {
        ensure: async () => {},
        predicate: () => true
      }
    : createHouseTrustSource({
        fetchEvents: fetchTrustEvents,
        assertionAuthorPubkeys: NIP85_AUTHOR_PUBKEYS,
        minRank: TRUST_SETTINGS.minRank,
        maxHops: TRUST_SETTINGS.maxHops,
        unknownPolicy: TRUST_SETTINGS.unknownPolicy
      })

export const ensure = (pubkeys: string[]) => source.ensure(pubkeys)
export const predicate = (pubkey: string) => source.predicate(pubkey)

/**
 * The SCORED-ONLY variant: same corpus, same minRank/maxHops, but a pubkey
 * with no published 30382 score does NOT pass (SDK semantics: any
 * `unknownPolicy` other than `'trusted'` rejects unknowns at predicate time).
 * Used for catalog VISIBILITY (browse/search/picker listings) where the
 * default unknown-counts policy would wave through throwaway mint keys;
 * tagging COUNTS keep the default predicate above. Degrades with `mode:
 * 'everyone'` exactly like the default source.
 */
const strictSource =
  TRUST_SETTINGS.mode === 'everyone'
    ? {
        ensure: async () => {},
        predicate: () => true
      }
    : createHouseTrustSource({
        fetchEvents: fetchTrustEvents,
        assertionAuthorPubkeys: NIP85_AUTHOR_PUBKEYS,
        minRank: TRUST_SETTINGS.minRank,
        maxHops: TRUST_SETTINGS.maxHops,
        unknownPolicy: 'everyone'
      })

export const ensureScored = (pubkeys: string[]) => strictSource.ensure(pubkeys)
export const scoredPredicate = (pubkey: string) => strictSource.predicate(pubkey)

/**
 * The house-published tag-applicability lists (which tags are for events vs
 * pubkeys), cached after the first successful fetch. Empty sets when the lists
 * are unpublished or unreachable — callers fall back to the SDK's client-side
 * hint/usage derivation.
 */
let applicabilityPromise: Promise<{ event: Set<string>; pubkey: Set<string> }> | null = null

export function getApplicabilityLists() {
  if (!applicabilityPromise) {
    applicabilityPromise = fetchApplicabilityLists({
      fetchEvents: fetchTrustEvents,
      houseAssistantPubkey: LOCAL_TA_PUBKEY
    }).then((lists) => {
      if (lists.event.size === 0 && lists.pubkey.size === 0) {
        // Nothing found (possibly unreachable) — allow a later retry.
        applicabilityPromise = null
      }
      return lists
    })
  }
  return applicabilityPromise
}
