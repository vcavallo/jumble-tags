/**
 * Type declarations for the profile-tagging SDK (plain ESM JavaScript, see the
 * sibling profile-tagging.js). Kept in sync by hand — do not rewrite the SDK.
 */
import type { Event, Filter } from 'nostr-tools'
import type { TApplyResult, TUnsignedTagEvent } from './event-tagging/index.js'

export function conceptNostrUserTag(pk: string): string

export function buildProfileTagAssertion(args: {
  tag: { authorPubkey: string; slug: string; eventId?: string }
  targetPubkey: string
  polarity: 1 | -1
  asserterPubkey: string
  zHandlePubkeys: string[]
}): TUnsignedTagEvent

export function filterTagsAppliedToPubkey(args: {
  targetPubkey: string
  zHandlePubkeys: string[]
}): Filter
export function filterProfileTaggingsUsingTag(args: {
  tagAuthorPubkey: string
  slug: string
  zHandlePubkeys: string[]
}): Filter
export function filterTagElements(args: { zHandlePubkeys: string[] }): Filter

export function applyProfileTagging(args: {
  tagInput:
    | { name: string; description?: string }
    | { authorPubkey: string; slug: string; eventId?: string }
  targetPubkey: string
  polarity: 1 | -1
  asserterPubkey: string
  zHandlePubkeys: string[]
  deps: {
    sign: (unsigned: TUnsignedTagEvent & { pubkey: string; created_at: number }) => Promise<Event>
    publish: (signed: Event) => Promise<unknown>
    now: () => number
    buildTagElement?: (args: {
      name: string
      description?: string
      taPubkeys: string[]
      applicabilityZ?: string
    }) => TUnsignedTagEvent
  }
}): Promise<TApplyResult>
