/**
 * Type declarations for the event-tagging SDK (plain ESM JavaScript, see the
 * sibling .js files). The SDK is copied verbatim from the tagging integration
 * kit — do not rewrite it in TS; keep these declarations in sync instead.
 */
import type { Event, Filter } from 'nostr-tools'

/** A builder result: an UNSIGNED partial event (no pubkey / created_at). */
export type TUnsignedTagEvent = {
  kind: number
  tags: string[][]
  content: string
}

export type TTagIdentity = { authorPubkey: string; slug: string }

/** `{ id }` targets a non-addressable event (e-tag); `{ address }` an a-coordinate. */
export type TTaggingTarget = { id: string; relays?: string[] } | { address: string }

export type TTaggingEntry = {
  eventId: string
  authorPubkey: string
  createdAt: number
  polarity: number
}

export function slug(name: string): string

// ── handles.js ──
export function conceptTag(taPubkey: string): string
export function conceptNostrEventTag(taPubkey: string): string
export function conceptTaggingWithSpecificTag(taPubkey: string): string
export function tagElementAddr(authorPubkey: string, slug: string): string
export function taggingHeaderAddr(authorPubkey: string, slug: string): string

// ── builders.js ──
export function buildTagElement(args: {
  name: string
  description?: string
  taPubkeys: string[]
  applicabilityZ?: string
}): TUnsignedTagEvent
export function buildTaggingHeader(args: {
  tagAuthorPubkey: string
  slug: string
  names: string[]
  description: string
  taPubkeys: string[]
}): TUnsignedTagEvent
export function buildEventTaggingAssertion(args: {
  headerAuthorPubkey: string
  slug: string
  target: TTaggingTarget
  polarity: 1 | -1
  asserterPubkey: string
  taPubkeys: string[]
}): TUnsignedTagEvent

// ── filters.js ──
export function filterTaggingsUsingTag(args: {
  headerAuthorPubkey: string
  slug: string
}): Filter
export function filterTagsAppliedToEvent(args: { target: TTaggingTarget }): Filter
export function filterTaggingHeadersForTag(args: {
  tagAuthorPubkey: string
  slug: string
  taPubkey: string
}): Filter

// ── classify.js ──
export function classifyEventTaggings(args: {
  candidates?: Event[]
  headers?: Event[]
  honoredAuthorities?: string[]
  isAsserterTrusted?: (pubkey: string) => boolean
  viewerPubkey?: string
}): {
  tags: Array<{ tag: TTagIdentity; applications: TTaggingEntry[]; disputes: TTaggingEntry[] }>
  unverifiable: Array<{
    eventId: string
    authorPubkey: string
    descriptor: string
    createdAt: number
  }>
  mine: Array<{ tag: TTagIdentity; stance: 'apply' | 'dispute'; eventId: string; createdAt: number }>
}
export function groupTaggingsByTarget(args: {
  candidates?: Event[]
  headers?: Event[]
  honoredAuthorities?: string[]
  isAsserterTrusted?: (pubkey: string) => boolean
  viewerPubkey?: string
  tag?: TTagIdentity
}): {
  targets: Array<{
    target: { id?: string; address?: string }
    applications: TTaggingEntry[]
    disputes: TTaggingEntry[]
  }>
  mine: Array<{
    target: { id?: string; address?: string }
    stance: 'apply' | 'dispute'
    eventId: string
    createdAt: number
  }>
}

// ── apply.js ──
export type TApplyDeps = {
  findHeaders?: (args: { tagAuthorPubkey: string; slug: string }) => Promise<Array<{ author: string }>>
  sign: (unsigned: TUnsignedTagEvent & { pubkey: string; created_at: number }) => Promise<Event>
  publish: (signed: Event) => Promise<unknown>
  now: () => number
}
export type TApplyResult = {
  sequence?: 'a' | 'b' | 'c'
  published: Array<{ kind: number; address: string; id?: string }>
  failedAt?: { kind: number; address?: string; what?: string; error?: string }
}
export function applyEventTagging(args: {
  tagInput: { name: string; description?: string } | { authorPubkey: string; slug: string }
  target: TTaggingTarget
  polarity: 1 | -1
  asserterPubkey: string
  taPubkeys: string[]
  deps: TApplyDeps
}): Promise<TApplyResult>
export function pickHeader(
  headers: Array<{ author: string }>,
  taPubkeys: string[]
): { author: string } | null

// ── taggings.js ──
export type TNormalizedTagging = {
  tag: TTagIdentity
  target: { type: 'profile' | 'event' | 'address'; ref: string }
  stance: 'apply' | 'dispute'
  asserter: string
  eventId: string
  createdAt: number
}
export type TTagIndexRow = {
  tag: TTagIdentity
  applications: number
  disputes: number
  byType: Record<string, { applications: number; disputes: number }>
  mine: 'apply' | 'dispute' | null
}
export type TTaggingMemberContext = {
  headerByCoord: Map<string, Event>
  honored: Set<string>
}
export type TTaggingMember = {
  name: string
  conceptZ: (taPubkey: string) => string
  extractTag: (assertion: Event, ctx?: TTaggingMemberContext) => TTagIdentity | null
  extractTarget: (assertion: Event) => { type: string; ref: string } | null
  projections?: Record<string, { listKind: number; elementTag: string }>
}
export const taggingMembers: TTaggingMember[]
export function normalizeTaggings(args: {
  assertions?: Event[]
  headers?: Event[]
  members?: TTaggingMember[]
  honoredAuthorities?: string[]
}): TNormalizedTagging[]
export function indexByTag(
  taggings: TNormalizedTagging[],
  opts?: { isAsserterTrusted?: (pubkey: string) => boolean; viewerPubkey?: string }
): { rows: TTagIndexRow[] }
export function taggingsByAsserter(
  taggings: TNormalizedTagging[],
  asserterPubkey: string
): TNormalizedTagging[]
export function projectionFor(
  targetType: string,
  members?: unknown[]
): { listKind: number; elementTag: string } | null
export function curateNotes<T extends { applications?: number; disputes?: number; createdAt?: number }>(
  notes: T[],
  method?: 'notes:net-endorsed' | 'notes:most-applied',
  cutoff?: number
): T[]

// ── applicability.js ──
export const TAG_FOR_NOSTR_PUBKEY_Z: 'tag-for-nostr-pubkey'
export const TAG_FOR_NOSTR_EVENT_Z: 'tag-for-nostr-event'
export const TAG_ELEMENT_KIND: 39999
export function hintZForContext(context: 'event' | 'pubkey'): string
export function byTypeKeyForContext(context: 'event' | 'pubkey'): 'event' | 'profile'
export function applicabilityHintFilter(context: 'event' | 'pubkey'): Filter
export function buildMembers(
  usageRows: TTagIndexRow[],
  hintEls: Event[],
  type: 'event' | 'profile'
): Array<{ a: string; applications: number }>
export function deriveApplicabilityMembers(args: {
  usageRows?: TTagIndexRow[]
  hintEls?: Event[]
  context: 'event' | 'pubkey'
}): Array<{ a: string; authorPubkey: string | null; slug: string | null; applications: number }>
