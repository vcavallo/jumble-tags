/**
 * Type declarations for the trust SDK (plain ESM JavaScript, see the sibling
 * trust.js). Kept in sync by hand — do not rewrite the SDK.
 */
import type { Event, Filter } from 'nostr-tools'

export function trustEveryone(): (pubkey: string) => boolean

export function createHouseTrustSource(opts: {
  fetchEvents: (filter: Filter) => Promise<Event[]>
  assertionAuthorPubkeys: string[]
  minRank?: number
  maxHops?: number
  unknownPolicy?: 'trusted' | 'everyone'
}): {
  ensure: (pubkeys: string[]) => Promise<void>
  predicate: (pubkey: string) => boolean
}

export function fetchApplicabilityLists(args: {
  fetchEvents: (filter: Filter) => Promise<Event[]>
  houseAssistantPubkey: string
}): Promise<{ event: Set<string>; pubkey: Set<string> }>
