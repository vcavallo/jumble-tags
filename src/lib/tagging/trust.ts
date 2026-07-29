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
 * The SCORED-ONLY variant used for catalog VISIBILITY (browse/search/picker
 * listings): a pubkey with no published 30382 score does NOT pass — the
 * default unknown-counts policy would wave through every throwaway mint key.
 * Tagging COUNTS keep the default predicate above.
 *
 * Implementation note: per-author `#d` lookups are the right shape for small
 * asserter sets, but the catalog has ~1k distinct authors — a dozen chunked
 * queries fanned across the user's relays took minutes in the field. The
 * whole house corpus is only a few hundred events, so fetch it ONCE
 * (`kinds:[30382], authors:[honored keys]`, no `#d`) and answer from the
 * resulting set. Failure degrades OPEN (everything passes) and retries on
 * the next call — trust must never break rendering.
 */
let scoredSetPromise: Promise<Set<string> | null> | null = null

function loadScoredSet(): Promise<Set<string> | null> {
  if (!scoredSetPromise) {
    scoredSetPromise = (async () => {
      try {
        const events = await fetchTrustEvents({ kinds: [30382], authors: NIP85_AUTHOR_PUBKEYS })
        // Latest per SUBJECT (d) across all honored authors — a re-run under
        // the current key supersedes a retired key's stale corpus per subject.
        const latest = new Map<string, (typeof events)[number]>()
        for (const event of events) {
          const d = event.tags.find((tag) => tag[0] === 'd')?.[1]
          if (!d || !/^[0-9a-f]{64}$/.test(d)) continue
          const prev = latest.get(d)
          if (!prev || event.created_at > prev.created_at) latest.set(d, event)
        }
        const set = new Set<string>()
        for (const [subject, event] of latest) {
          const num = (name: string, fallback: number) => {
            const value = Number(event.tags.find((tag) => tag[0] === name)?.[1])
            return Number.isFinite(value) ? value : fallback
          }
          if (num('rank', 0) >= TRUST_SETTINGS.minRank && num('hops', 999) <= TRUST_SETTINGS.maxHops) {
            set.add(subject)
          }
        }
        return set
      } catch {
        scoredSetPromise = null // retry on the next surface
        return null
      }
    })()
  }
  return scoredSetPromise
}

let scoredSet: Set<string> | null = null

export const ensureScored = async (_pubkeys: string[]) => {
  if (TRUST_SETTINGS.mode === 'everyone') return
  scoredSet = await loadScoredSet()
}

export const scoredPredicate = (pubkey: string) => {
  if (TRUST_SETTINGS.mode === 'everyone') return true
  if (scoredSet === null) return true // fetch failed → degrade open
  return scoredSet.has(pubkey)
}

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
