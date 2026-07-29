import { BoundedMap } from '@/lib/bounded-map'
import { getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import { Z_HANDLE_PUBKEYS } from '@/lib/tagging/config'
import { publishTagEvent } from '@/lib/tagging/publish'
import { fetchTagEvents, latestByCoord } from '@/lib/tagging/relays'
import {
  applicabilityHintFilter,
  applyEventTagging,
  buildTagElement,
  classifyEventTaggings,
  deriveApplicabilityMembers,
  filterTaggingHeadersForTag,
  filterTaggingsUsingTag,
  filterTagsAppliedToEvent,
  groupTaggingsByTarget,
  normalizeTaggings,
  slug as slugify,
  TAG_FOR_NOSTR_EVENT_Z,
  TAG_FOR_NOSTR_PUBKEY_Z,
  tagElementAddr,
  taggingMembers,
  type TApplyResult,
  type TNormalizedTagging,
  type TTagIdentity,
  type TTaggingMember
} from '@/lib/tagging/sdk/event-tagging/index.js'
import {
  applyProfileTagging,
  filterProfileTaggingsUsingTag,
  filterTagElements,
  filterTagsAppliedToPubkey
} from '@/lib/tagging/sdk/profile-tagging.js'
import { now, signTagEvent } from '@/lib/tagging/sign'
import * as trust from '@/lib/tagging/trust'
import client from '@/services/client.service'
import { Event, Filter } from 'nostr-tools'

const TAGGING_KIND = 39999
const DESCRIPTOR_COORD_RE = /^39999:[0-9a-f]{64}:tagging:.+-tagging$/
// Coalesce scroll-mounted notes into fewer, larger relay queries. Profiled at
// 50ms a deep feed scroll produced many 1-item batches (each fanned out per
// relay); 200ms trades imperceptible chip latency for ~4x larger batches.
const BATCH_DELAY_MS = 200
const FILTER_LIST_CAP = 100
const HEADER_RETRY_MS = 60_000
const CATALOG_TTL_MS = 5 * 60_000

export type TTagChipEntry = { pubkey: string; createdAt: number }

export type TTagChipData = {
  tag: TTagIdentity
  /** The tag-element a-coordinate: 39999:<author>:<slug>. */
  coordinate: string
  name?: string
  description?: string
  /** Counted (trust-filtered) applications / disputes. */
  applications: TTagChipEntry[]
  disputes: TTagChipEntry[]
  /** The viewer's own latest stance, regardless of trust. */
  mine: 'apply' | 'dispute' | null
}

export type TTargetTagsState = {
  status: 'loading' | 'ready' | 'error'
  chips: TTagChipData[]
}

export type TTagElement = {
  coordinate: string
  authorPubkey: string
  slug: string
  name: string
  description: string
  eventId: string
  createdAt: number
}

export type TTagPageRow = {
  applications: number
  disputes: number
  /** Most recent counted application (or the viewer's own stance) timestamp. */
  appliedAt: number
  mine: 'apply' | 'dispute' | null
}

export type TTagPageData = {
  element: TTagElement | null
  notes: (TTagPageRow & { target: { id?: string; address?: string } })[]
  people: (TTagPageRow & { pubkey: string })[]
}

export type TTagApplicability = { event: Set<string>; pubkey: Set<string> }

/** One tag the viewer has published stances with (Tags page "Your tags"). */
export type TMyTagStanceRow = {
  coordinate: string
  element: TTagElement | null
  applies: number
  disputes: number
  latestAt: number
}

/** One tag with recent POV-counted tagging activity (Tags page "Active this week"). */
export type TTagActivityRow = {
  coordinate: string
  element: TTagElement | null
  taggings: number
  asserters: number
  latestAt: number
}

/** Net display count for a chip: applications − disputes (counted set only). */
export function chipNetCount(chip: TTagChipData) {
  return chip.applications.length - chip.disputes.length
}

/**
 * A chip renders whenever there is ANY counted activity or the viewer holds a
 * stance — a disputed-to-nothing tag stays visible (struck through) so every
 * viewer can SEE it was disputed rather than wondering why it vanished.
 */
export function isChipVisible(chip: TTagChipData) {
  return chip.applications.length > 0 || chip.disputes.length > 0 || chip.mine !== null
}

/** A chip whose counted balance is disputed away (drives the struck styling). */
export function isChipDisputed(chip: TTagChipData) {
  return chip.disputes.length > 0 && chipNetCount(chip) <= 0
}

/** Net apply−dispute for a tag-page row. */
export function rowNet(row: { applications: number; disputes: number }) {
  return row.applications - row.disputes
}

/**
 * A tag-page row belongs in the default ("legit") browse view when its counted
 * balance is positive, or the viewer applied it themselves (their stance never
 * vanishes). Everything else is the hidden-by-default disputed set.
 */
export function isRowEndorsed(row: {
  applications: number
  disputes: number
  mine: 'apply' | 'dispute' | null
}) {
  return rowNet(row) > 0 || row.mine === 'apply'
}

export function targetKeyForEvent(event: Event) {
  return isReplaceableEvent(event.kind)
    ? `a:${getReplaceableCoordinateFromEvent(event)}`
    : `e:${event.id}`
}

export function targetKeyForPubkey(pubkey: string) {
  return `p:${pubkey}`
}

function titleizeSlug(slug: string) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Merge same-shape SDK filters by unioning one list key (the kit's sanctioned
 * composition: Nostr filters OR within a list, so this equals concatenating the
 * per-filter query results).
 */
function mergeFilters(filters: Filter[], key: '#e' | '#a' | '#p' | '#z'): Filter {
  const values = new Set<string>()
  for (const filter of filters) {
    for (const value of (filter as Record<string, string[]>)[key] ?? []) {
      values.add(value)
    }
  }
  return { ...filters[0], [key]: Array.from(values) }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

function parseTagElement(event: Event): TTagElement | null {
  const slug = event.tags.find((tag) => tag[0] === 'd')?.[1]
  if (!slug) return null
  let name = ''
  let description = ''
  try {
    const parsed = JSON.parse(event.content)
    name = typeof parsed?.tag?.name === 'string' ? parsed.tag.name : ''
    description = typeof parsed?.tag?.description === 'string' ? parsed.tag.description : ''
  } catch {
    // fall through to slug-derived name
  }
  return {
    coordinate: tagElementAddr(event.pubkey, slug),
    authorPubkey: event.pubkey,
    slug,
    name: name || titleizeSlug(slug),
    description,
    eventId: event.id,
    createdAt: event.created_at
  }
}

class TaggingService {
  static instance: TaggingService

  /** Per-target tag state, keyed 'e:<id>' | 'a:<coord>' | 'p:<pubkey>'. */
  private targetTagsMap = new BoundedMap<string, TTargetTagsState>({ maxSize: 2_000 })
  private subscribers = new Map<string, Set<() => void>>()
  private pendingNoteKeys = new Set<string>()
  private pendingProfileKeys = new Set<string>()
  private noteFlushTimer: ReturnType<typeof setTimeout> | null = null
  private profileFlushTimer: ReturnType<typeof setTimeout> | null = null
  private inFlight = new Set<string>()
  private lastViewer: string | undefined

  /** Resolved per-tag tagging headers, by coordinate 39999:<author>:tagging:<slug>-tagging. */
  private headerCache = new BoundedMap<string, Event>({ maxSize: 2_000 })
  private headerLastTried = new BoundedMap<string, number>({ maxSize: 2_000 })

  /** Tag-elements by coordinate 39999:<author>:<slug>. */
  private tagElementByCoord = new BoundedMap<string, TTagElement>({ maxSize: 5_000 })
  private tagElementLastTried = new BoundedMap<string, number>({ maxSize: 5_000 })
  /**
   * Tag-element EVENT ids → coordinate (and the reverse). Needed for the
   * deployed profile-tagging variant (protocol/tags.md §"Deployed variant"):
   * live assertions reference their tag only via the legacy `e` (tag-element
   * event id), so readers must resolve identity through these ids and union
   * `#a` lookups with legacy `#e` lookups until the corpus is backfilled.
   */
  private elementIdToCoord = new BoundedMap<string, string>({ maxSize: 5_000 })
  private coordToElementIds = new BoundedMap<string, Set<string>>({ maxSize: 5_000 })
  private legacyElementIdLastTried = new BoundedMap<string, number>({ maxSize: 2_000 })

  /** The nostr-user-tag member, extended with the legacy e-reference fallback. */
  private legacyAwareMembers: TTaggingMember[] = (() => {
    const base = taggingMembers.find((member) => member.name === 'nostr-user-tag')
    if (!base) return taggingMembers
    const legacyAware: TTaggingMember = {
      ...base,
      extractTag: (assertion, ctx) => {
        const viaA = base.extractTag(assertion, ctx)
        if (viaA) return viaA
        const eventId = assertion.tags.find((tag) => tag[0] === 'e')?.[1]
        const coordinate = eventId ? this.elementIdToCoord.get(eventId) : undefined
        if (!coordinate) return null
        const [, authorPubkey, ...rest] = coordinate.split(':')
        return { authorPubkey, slug: rest.join(':') }
      }
    }
    return taggingMembers.map((member) => (member === base ? legacyAware : member))
  })()

  private catalogCache: TTagElement[] | null = null
  private catalogFetchedAt = 0
  private catalogRefreshPromise: Promise<void> | null = null

  /** Applicability derived client-side (hint scan) when the house lists are empty. */
  private fallbackApplicability: TTagApplicability | null = null
  private fallbackApplicabilityFetchedAt = 0
  /** Tags created in this session — immediately applicable in their birth context. */
  private localApplicability: TTagApplicability = { event: new Set(), pubkey: new Set() }

  constructor() {
    if (!TaggingService.instance) {
      TaggingService.instance = this
    }
    return TaggingService.instance
  }

  /** =========== subscription =========== */

  subscribeTarget(key: string, callback: () => void) {
    let set = this.subscribers.get(key)
    if (!set) {
      set = new Set()
      this.subscribers.set(key, set)
    }
    set.add(callback)
    return () => {
      set.delete(callback)
      if (set.size === 0) {
        this.subscribers.delete(key)
      }
    }
  }

  getTargetTags(key: string): TTargetTagsState | undefined {
    return this.targetTagsMap.get(key)
  }

  private notify(key: string) {
    this.subscribers.get(key)?.forEach((callback) => callback())
  }

  private setTargetState(key: string, state: TTargetTagsState) {
    this.targetTagsMap.set(key, state)
    this.notify(key)
  }

  /** Chips depend on the viewer (`mine` overlay) — drop caches on account switch. */
  private checkViewer(viewer: string | undefined) {
    if (viewer === this.lastViewer) return
    this.lastViewer = viewer
    const keys = Array.from(this.targetTagsMap.keys())
    this.targetTagsMap.clear()
    keys.forEach((key) => this.notify(key))
  }

  /**
   * Kick off a (batched) fetch for a target's tags. No-op if already
   * loaded/loading. `viewer` is the logged-in pubkey as the CALLER sees it —
   * hooks pass it explicitly because `client.pubkey` is set by a parent-level
   * effect that runs after child effects on account restore.
   */
  requestTargetTags(key: string, viewer?: string | null) {
    this.checkViewer(viewer === undefined ? client.pubkey : (viewer ?? undefined))
    if (this.targetTagsMap.has(key) || this.inFlight.has(key)) return
    this.targetTagsMap.set(key, { status: 'loading', chips: [] })
    this.notify(key)
    this.enqueue(key)
  }

  /** Re-read a target's tags from relays, keeping current chips until fresh data lands. */
  refetchTargetTags(key: string) {
    if (this.inFlight.has(key)) return
    this.enqueue(key)
  }

  private enqueue(key: string) {
    if (key.startsWith('p:')) {
      this.pendingProfileKeys.add(key)
      if (!this.profileFlushTimer) {
        this.profileFlushTimer = setTimeout(() => {
          this.profileFlushTimer = null
          this.flushProfileBatch()
        }, BATCH_DELAY_MS)
      }
    } else {
      this.pendingNoteKeys.add(key)
      if (!this.noteFlushTimer) {
        this.noteFlushTimer = setTimeout(() => {
          this.noteFlushTimer = null
          this.flushNoteBatch()
        }, BATCH_DELAY_MS)
      }
    }
  }

  /** =========== note (event) taggings =========== */

  private async flushNoteBatch() {
    const keys = Array.from(this.pendingNoteKeys)
    this.pendingNoteKeys.clear()
    if (keys.length === 0) return
    keys.forEach((key) => this.inFlight.add(key))
    try {
      const ids = keys.filter((k) => k.startsWith('e:')).map((k) => k.slice(2))
      const addresses = keys.filter((k) => k.startsWith('a:')).map((k) => k.slice(2))
      const filters: Filter[] = []
      for (const idChunk of chunk(ids, FILTER_LIST_CAP)) {
        filters.push(
          mergeFilters(
            idChunk.map((id) => filterTagsAppliedToEvent({ target: { id } })),
            '#e'
          )
        )
      }
      for (const addressChunk of chunk(addresses, FILTER_LIST_CAP)) {
        filters.push(
          mergeFilters(
            addressChunk.map((address) => filterTagsAppliedToEvent({ target: { address } })),
            '#a'
          )
        )
      }
      const candidates = await fetchTagEvents(filters)

      const descriptorCoords = new Set<string>()
      for (const candidate of candidates) {
        for (const tag of candidate.tags) {
          if (tag[0] === 'z' && DESCRIPTOR_COORD_RE.test(tag[1] ?? '')) {
            descriptorCoords.add(tag[1])
          }
        }
      }
      await this.ensureHeaders(Array.from(descriptorCoords))
      await trust.ensure(candidates.map((candidate) => candidate.pubkey))

      const buckets = new Map<string, Event[]>(keys.map((key) => [key, []]))
      for (const candidate of candidates) {
        const eTag = candidate.tags.find((tag) => tag[0] === 'e')?.[1]
        const aTag = eTag ? undefined : candidate.tags.find((tag) => tag[0] === 'a')?.[1]
        const key = eTag ? `e:${eTag}` : aTag ? `a:${aTag}` : undefined
        if (key) {
          buckets.get(key)?.push(candidate)
        }
      }

      const headers = Array.from(this.headerCache.values())
      const viewer = this.lastViewer ?? client.pubkey
      const coordsForNames = new Set<string>()
      for (const [key, bucket] of buckets) {
        const result = classifyEventTaggings({
          candidates: bucket,
          headers,
          honoredAuthorities: Z_HANDLE_PUBKEYS,
          isAsserterTrusted: trust.predicate,
          viewerPubkey: viewer
        })
        if (import.meta.env.DEV && result.unverifiable.length > 0) {
          console.debug('[tagging] unverifiable assertions (header unresolved)', key, result.unverifiable)
        }
        const chips = this.chipsFromClassification(result)
        chips.forEach((chip) => coordsForNames.add(chip.coordinate))
        this.setTargetState(key, { status: 'ready', chips })
      }
      void this.enrichChipNames(Array.from(coordsForNames))
    } catch (error) {
      if (import.meta.env.DEV) {
        console.debug('[tagging] note tag fetch failed', error)
      }
      keys.forEach((key) => {
        const existing = this.targetTagsMap.get(key)
        this.setTargetState(key, {
          status: existing?.status === 'ready' ? 'ready' : 'error',
          chips: existing?.chips ?? []
        })
      })
    } finally {
      keys.forEach((key) => this.inFlight.delete(key))
    }
  }

  private chipsFromClassification(result: ReturnType<typeof classifyEventTaggings>): TTagChipData[] {
    const chipMap = new Map<string, TTagChipData>()
    const getChip = (tag: TTagIdentity) => {
      const coordinate = tagElementAddr(tag.authorPubkey, tag.slug)
      let chip = chipMap.get(coordinate)
      if (!chip) {
        chip = { tag, coordinate, applications: [], disputes: [], mine: null }
        this.decorateChip(chip)
        chipMap.set(coordinate, chip)
      }
      return chip
    }
    for (const group of result.tags) {
      const chip = getChip(group.tag)
      chip.applications = group.applications.map((entry) => ({
        pubkey: entry.authorPubkey,
        createdAt: entry.createdAt
      }))
      chip.disputes = group.disputes.map((entry) => ({
        pubkey: entry.authorPubkey,
        createdAt: entry.createdAt
      }))
    }
    for (const mine of result.mine) {
      getChip(mine.tag).mine = mine.stance
    }
    return this.sortChips(Array.from(chipMap.values()))
  }

  private decorateChip(chip: TTagChipData) {
    const element = this.tagElementByCoord.get(chip.coordinate)
    chip.name = element?.name ?? titleizeSlug(chip.tag.slug)
    chip.description = element?.description
  }

  private sortChips(chips: TTagChipData[]) {
    return chips.sort(
      (a, b) => chipNetCount(b) - chipNetCount(a) || (a.name ?? '').localeCompare(b.name ?? '')
    )
  }

  /** =========== profile (pubkey) taggings =========== */

  private async flushProfileBatch() {
    const keys = Array.from(this.pendingProfileKeys)
    this.pendingProfileKeys.clear()
    if (keys.length === 0) return
    keys.forEach((key) => this.inFlight.add(key))
    try {
      const pubkeys = keys.map((key) => key.slice(2))
      const filters = chunk(pubkeys, FILTER_LIST_CAP).map((pubkeyChunk) =>
        mergeFilters(
          pubkeyChunk.map((targetPubkey) =>
            filterTagsAppliedToPubkey({ targetPubkey, zHandlePubkeys: Z_HANDLE_PUBKEYS })
          ),
          '#p'
        )
      )
      const candidates = await fetchTagEvents(filters)
      await this.resolveLegacyElementRefs(candidates)
      const normalized = normalizeTaggings({
        assertions: candidates,
        headers: [],
        members: this.legacyAwareMembers,
        honoredAuthorities: Z_HANDLE_PUBKEYS
      })
      await trust.ensure(normalized.map((tagging) => tagging.asserter))

      const buckets = new Map<string, TNormalizedTagging[]>(keys.map((key) => [key, []]))
      for (const tagging of normalized) {
        if (tagging.target.type !== 'profile') continue
        buckets.get(`p:${tagging.target.ref}`)?.push(tagging)
      }

      const viewer = this.lastViewer ?? client.pubkey
      const coordsForNames = new Set<string>()
      for (const [key, bucket] of buckets) {
        const chips = this.chipsFromNormalized(bucket, viewer)
        chips.forEach((chip) => coordsForNames.add(chip.coordinate))
        this.setTargetState(key, { status: 'ready', chips })
      }
      void this.enrichChipNames(Array.from(coordsForNames))
    } catch (error) {
      if (import.meta.env.DEV) {
        console.debug('[tagging] profile tag fetch failed', error)
      }
      keys.forEach((key) => {
        const existing = this.targetTagsMap.get(key)
        this.setTargetState(key, {
          status: existing?.status === 'ready' ? 'ready' : 'error',
          chips: existing?.chips ?? []
        })
      })
    } finally {
      keys.forEach((key) => this.inFlight.delete(key))
    }
  }

  private chipsFromNormalized(
    taggings: TNormalizedTagging[],
    viewer: string | undefined
  ): TTagChipData[] {
    const chipMap = new Map<string, TTagChipData & { _mineAt?: number }>()
    for (const tagging of taggings) {
      const coordinate = tagElementAddr(tagging.tag.authorPubkey, tagging.tag.slug)
      let chip = chipMap.get(coordinate)
      if (!chip) {
        chip = { tag: tagging.tag, coordinate, applications: [], disputes: [], mine: null, _mineAt: -1 }
        this.decorateChip(chip)
        chipMap.set(coordinate, chip)
      }
      if (viewer && tagging.asserter === viewer && tagging.createdAt > (chip._mineAt ?? -1)) {
        chip.mine = tagging.stance
        chip._mineAt = tagging.createdAt
      }
      if (!trust.predicate(tagging.asserter)) continue
      const entry = { pubkey: tagging.asserter, createdAt: tagging.createdAt }
      if (tagging.stance === 'apply') {
        chip.applications.push(entry)
      } else {
        chip.disputes.push(entry)
      }
    }
    return this.sortChips(
      Array.from(chipMap.values()).map(({ _mineAt: _, ...chip }) => chip as TTagChipData)
    )
  }

  /** =========== headers + tag-elements =========== */

  /** Fetch (and cache) tagging headers by coordinate — grouped authors + #d lookup. */
  private async ensureHeaders(coords: string[]) {
    const nowMs = Date.now()
    const missing = coords.filter(
      (coord) =>
        !this.headerCache.has(coord) &&
        (this.headerLastTried.get(coord) ?? 0) < nowMs - HEADER_RETRY_MS
    )
    if (missing.length === 0) return
    missing.forEach((coord) => this.headerLastTried.set(coord, nowMs))
    const authors = new Set<string>()
    const dTags = new Set<string>()
    for (const coord of missing) {
      const [, author, ...rest] = coord.split(':')
      authors.add(author)
      dTags.add(rest.join(':'))
    }
    try {
      const events = await fetchTagEvents({
        kinds: [TAGGING_KIND],
        authors: Array.from(authors),
        '#d': Array.from(dTags)
      })
      for (const event of events) {
        const d = event.tags.find((tag) => tag[0] === 'd')?.[1]
        if (d) {
          this.headerCache.set(`${TAGGING_KIND}:${event.pubkey}:${d}`, event)
        }
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.debug('[tagging] header fetch failed', error)
      }
      // Allow a retry sooner than the negative-cache window on outright failure.
      missing.forEach((coord) => this.headerLastTried.delete(coord))
    }
  }

  /**
   * The per-tag tagging headers under the honored authorities (merged into a
   * single query by unioning the per-authority #z lists). Results are cached
   * for classifier resolution.
   */
  async findHeadersForTag(tagAuthorPubkey: string, slug: string): Promise<Event[]> {
    const filters = Z_HANDLE_PUBKEYS.map((taPubkey) =>
      filterTaggingHeadersForTag({ tagAuthorPubkey, slug, taPubkey })
    )
    const events = await fetchTagEvents(mergeFilters(filters, '#z'))
    for (const event of events) {
      const d = event.tags.find((tag) => tag[0] === 'd')?.[1]
      if (d) {
        this.headerCache.set(`${TAGGING_KIND}:${event.pubkey}:${d}`, event)
      }
    }
    return events
  }

  private registerTagElement(element: TTagElement) {
    const existing = this.tagElementByCoord.get(element.coordinate)
    if (!existing || existing.createdAt <= element.createdAt) {
      this.tagElementByCoord.set(element.coordinate, element)
    }
    if (element.eventId) {
      this.elementIdToCoord.set(element.eventId, element.coordinate)
      let ids = this.coordToElementIds.get(element.coordinate)
      if (!ids) {
        ids = new Set()
        this.coordToElementIds.set(element.coordinate, ids)
      }
      ids.add(element.eventId)
    }
  }

  /**
   * Resolve tag identities referenced the legacy way (protocol/tags.md
   * §"Deployed variant"): an assertion without an `a` tag names its tag only
   * via `e` = the tag-element's event id. Fetch those elements by id so the
   * legacy-aware member can resolve them.
   */
  private async resolveLegacyElementRefs(assertions: Event[]) {
    const nowMs = Date.now()
    const missing = new Set<string>()
    for (const assertion of assertions) {
      const hasA = assertion.tags.some(
        (tag) => tag[0] === 'a' && /^39999:[0-9a-f]{64}:/.test(tag[1] ?? '')
      )
      if (hasA) continue
      const eventId = assertion.tags.find((tag) => tag[0] === 'e')?.[1]
      if (
        eventId &&
        !this.elementIdToCoord.has(eventId) &&
        (this.legacyElementIdLastTried.get(eventId) ?? 0) < nowMs - HEADER_RETRY_MS
      ) {
        missing.add(eventId)
      }
    }
    if (missing.size === 0) return
    const ids = Array.from(missing)
    ids.forEach((id) => this.legacyElementIdLastTried.set(id, nowMs))
    try {
      const events = await fetchTagEvents(
        chunk(ids, FILTER_LIST_CAP).map((idChunk) => ({ kinds: [TAGGING_KIND], ids: idChunk }))
      )
      for (const event of events) {
        const element = parseTagElement(event)
        if (element) {
          this.registerTagElement(element)
        }
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.debug('[tagging] legacy tag-element fetch failed', error)
      }
      ids.forEach((id) => this.legacyElementIdLastTried.delete(id))
    }
  }

  /** Fetch (and cache) tag-elements by coordinate — grouped authors + #d lookup. */
  async ensureTagElements(coords: string[]): Promise<void> {
    const nowMs = Date.now()
    const missing = coords.filter(
      (coord) =>
        !this.tagElementByCoord.has(coord) &&
        (this.tagElementLastTried.get(coord) ?? 0) < nowMs - HEADER_RETRY_MS
    )
    if (missing.length === 0) return
    missing.forEach((coord) => this.tagElementLastTried.set(coord, nowMs))
    const authors = new Set<string>()
    const dTags = new Set<string>()
    for (const coord of missing) {
      const [, author, ...rest] = coord.split(':')
      authors.add(author)
      dTags.add(rest.join(':'))
    }
    try {
      const events = await fetchTagEvents({
        kinds: [TAGGING_KIND],
        authors: Array.from(authors),
        '#d': Array.from(dTags)
      })
      for (const event of events) {
        const element = parseTagElement(event)
        if (element) {
          this.registerTagElement(element)
        }
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.debug('[tagging] tag-element fetch failed', error)
      }
      missing.forEach((coord) => this.tagElementLastTried.delete(coord))
    }
  }

  getTagElement(coordinate: string): TTagElement | undefined {
    return this.tagElementByCoord.get(coordinate)
  }

  /** Resolve display names for chips already surfaced, then re-notify their targets. */
  private async enrichChipNames(coords: string[]) {
    const missing = coords.filter((coord) => !this.tagElementByCoord.has(coord))
    if (missing.length === 0) return
    await this.ensureTagElements(missing)
    for (const [key, state] of this.targetTagsMap) {
      let changed = false
      const chips = state.chips.map((chip) => {
        const element = this.tagElementByCoord.get(chip.coordinate)
        if (element && (chip.name !== element.name || chip.description !== element.description)) {
          changed = true
          return { ...chip, name: element.name, description: element.description }
        }
        return chip
      })
      if (changed) {
        this.setTargetState(key, { status: state.status, chips: this.sortChips(chips) })
      }
    }
  }

  /** =========== tag catalog (picker) =========== */

  /**
   * All known tag-elements. Serves the cache immediately when present (kicking
   * a background refresh once stale); only the initial load awaits the network.
   */
  getAllTagElements(): Promise<TTagElement[]> {
    if (this.catalogCache) {
      const stale = Date.now() - this.catalogFetchedAt > CATALOG_TTL_MS
      if (stale) {
        void this.refreshCatalog()
      }
      return Promise.resolve(this.catalogCache)
    }
    return this.refreshCatalog().then(() => this.catalogCache ?? [])
  }

  /** Force a relay round-trip and return the fresh catalog (picker refresh). */
  async refreshCatalogAndGet(): Promise<TTagElement[]> {
    await this.refreshCatalog()
    return this.catalogCache ?? []
  }

  private refreshCatalog(): Promise<void> {
    if (!this.catalogRefreshPromise) {
      this.catalogRefreshPromise = this.doRefreshCatalog().finally(() => {
        this.catalogRefreshPromise = null
      })
    }
    return this.catalogRefreshPromise
  }

  private async doRefreshCatalog(): Promise<void> {
    try {
      const events = await fetchTagEvents(filterTagElements({ zHandlePubkeys: Z_HANDLE_PUBKEYS }))
      const elements: TTagElement[] = []
      for (const event of events) {
        const element = parseTagElement(event)
        if (element) {
          elements.push(element)
          this.registerTagElement(element)
        }
      }
      elements.sort((a, b) => a.name.localeCompare(b.name))
      this.catalogCache = elements
      this.catalogFetchedAt = Date.now()
    } catch (error) {
      // Degraded mode: an unreachable tag hub must never break the UI.
      if (import.meta.env.DEV) {
        console.debug('[tagging] catalog fetch failed', error)
      }
    }
  }

  invalidateCatalog() {
    this.catalogFetchedAt = 0
  }

  /**
   * The Content/Profile applicability sets for the picker: house-published
   * lists first, falling back to the SDK's client-side hint-z scan when the
   * lists are empty; tags minted this session overlay both.
   */
  async getApplicability(): Promise<TTagApplicability> {
    let lists = await trust.getApplicabilityLists()
    if (lists.event.size === 0 && lists.pubkey.size === 0) {
      lists = await this.getFallbackApplicability()
    }
    const event = new Set(lists.event)
    const pubkey = new Set(lists.pubkey)
    this.localApplicability.event.forEach((coord) => event.add(coord))
    this.localApplicability.pubkey.forEach((coord) => pubkey.add(coord))
    return { event, pubkey }
  }

  private async getFallbackApplicability(): Promise<TTagApplicability> {
    if (
      this.fallbackApplicability &&
      Date.now() - this.fallbackApplicabilityFetchedAt < CATALOG_TTL_MS
    ) {
      return this.fallbackApplicability
    }
    try {
      const hintEls = await fetchTagEvents(
        mergeFilters([applicabilityHintFilter('event'), applicabilityHintFilter('pubkey')], '#z')
      )
      const hasHint = (event: Event, hint: string) =>
        event.tags.some((tag) => tag[0] === 'z' && tag[1] === hint)
      const eventMembers = deriveApplicabilityMembers({
        usageRows: [],
        hintEls: hintEls.filter((event) => hasHint(event, TAG_FOR_NOSTR_EVENT_Z)),
        context: 'event'
      })
      const pubkeyMembers = deriveApplicabilityMembers({
        usageRows: [],
        hintEls: hintEls.filter((event) => hasHint(event, TAG_FOR_NOSTR_PUBKEY_Z)),
        context: 'pubkey'
      })
      this.fallbackApplicability = {
        event: new Set(eventMembers.map((member) => member.a)),
        pubkey: new Set(pubkeyMembers.map((member) => member.a))
      }
      this.fallbackApplicabilityFetchedAt = Date.now()
      return this.fallbackApplicability
    } catch {
      return { event: new Set(), pubkey: new Set() }
    }
  }

  /**
   * Resolve a legacy `#hashtag` to the decentralized tag to apply when the
   * viewer "agrees" with it: the matching existing tag-element when one exists
   * (preferring applicability-listed mints, then the oldest mint), else a
   * create-input named after the hashtag.
   */
  async resolveTagInputForHashtag(hashtag: string): Promise<{
    input:
      | { name: string; description?: string }
      | { authorPubkey: string; slug: string; eventId?: string }
    existing: boolean
  }> {
    const slug = slugify(hashtag)
    const [elements, applicability] = await Promise.all([
      this.getAllTagElements(),
      this.getApplicability()
    ])
    const matches = elements.filter((element) => element.slug === slug)
    if (matches.length === 0) {
      return { input: { name: titleizeSlug(slug) }, existing: false }
    }
    const applicable = matches.filter(
      (element) =>
        applicability.event.has(element.coordinate) || applicability.pubkey.has(element.coordinate)
    )
    const pool = applicable.length > 0 ? applicable : matches
    const chosen = pool.slice().sort((a, b) => a.createdAt - b.createdAt)[0]
    return {
      input: { authorPubkey: chosen.authorPubkey, slug: chosen.slug, eventId: chosen.eventId },
      existing: true
    }
  }

  /** =========== write paths =========== */

  private get orchestratorDeps() {
    return {
      findHeaders: async ({
        tagAuthorPubkey,
        slug
      }: {
        tagAuthorPubkey: string
        slug: string
      }) => {
        const headers = await this.findHeadersForTag(tagAuthorPubkey, slug)
        return headers.map((header) => ({ author: header.pubkey }))
      },
      sign: signTagEvent,
      publish: publishTagEvent,
      now
    }
  }

  /**
   * Apply (or dispute) a tag on an event — mints missing intermediates
   * automatically. Throws on a clean pre-publish abort (e.g. signer rejection);
   * returns `failedAt` when something already hit the wire.
   */
  async applyTagToEvent({
    tagInput,
    event,
    polarity
  }: {
    tagInput: { name: string; description?: string } | { authorPubkey: string; slug: string }
    event: Event
    polarity: 1 | -1
  }): Promise<TApplyResult> {
    const viewer = client.pubkey
    if (!viewer) throw new Error('You need to login first')
    const target = isReplaceableEvent(event.kind)
      ? { address: getReplaceableCoordinateFromEvent(event) }
      : { id: event.id, relays: client.getEventHints(event.id) }
    const result = await applyEventTagging({
      tagInput,
      target,
      polarity,
      asserterPubkey: viewer,
      taPubkeys: Z_HANDLE_PUBKEYS,
      deps: this.orchestratorDeps
    })
    this.afterStanceChange({
      result,
      tagInput,
      polarity,
      targetKey: targetKeyForEvent(event),
      context: 'event',
      viewer
    })
    return result
  }

  /** Apply (or dispute) a tag on a pubkey (profile) — direct wire shape. */
  async applyTagToProfile({
    tagInput,
    targetPubkey,
    polarity
  }: {
    tagInput:
      | { name: string; description?: string }
      | { authorPubkey: string; slug: string; eventId?: string }
    targetPubkey: string
    polarity: 1 | -1
  }): Promise<TApplyResult> {
    const viewer = client.pubkey
    if (!viewer) throw new Error('You need to login first')
    // Provenance enrichment: when the caller only knows the tag identity (e.g.
    // a chip stance change), attach the cached tag-element's event id so the
    // assertion carries the applied-version `e` (hybrid e+a shape).
    let enrichedInput = tagInput
    if ('authorPubkey' in tagInput && !tagInput.eventId) {
      const cached = this.tagElementByCoord.get(
        tagElementAddr(tagInput.authorPubkey, tagInput.slug)
      )
      if (cached?.eventId) {
        enrichedInput = { ...tagInput, eventId: cached.eventId }
      }
    }
    const result = await applyProfileTagging({
      tagInput: enrichedInput,
      targetPubkey,
      polarity,
      asserterPubkey: viewer,
      zHandlePubkeys: Z_HANDLE_PUBKEYS,
      deps: { ...this.orchestratorDeps, buildTagElement }
    })
    this.afterStanceChange({
      result,
      tagInput,
      polarity,
      targetKey: targetKeyForPubkey(targetPubkey),
      context: 'pubkey',
      viewer
    })
    return result
  }

  private afterStanceChange({
    result,
    tagInput,
    polarity,
    targetKey,
    context,
    viewer
  }: {
    result: TApplyResult
    tagInput:
      | { name: string; description?: string }
      | { authorPubkey: string; slug: string; eventId?: string }
    polarity: 1 | -1
    targetKey: string
    context: 'event' | 'pubkey'
    viewer: string
  }) {
    const isNew = 'name' in tagInput && typeof tagInput.name === 'string'
    const tag: TTagIdentity = isNew
      ? { authorPubkey: viewer, slug: slugify((tagInput as { name: string }).name) }
      : { authorPubkey: (tagInput as TTagIdentity).authorPubkey, slug: (tagInput as TTagIdentity).slug }
    const coordinate = tagElementAddr(tag.authorPubkey, tag.slug)

    if (isNew && result.published.some((entry) => entry.address === coordinate)) {
      // The freshly minted tag-element: surface it without waiting for relays.
      const input = tagInput as { name: string; description?: string }
      const eventId = result.published.find((entry) => entry.address === coordinate)?.id ?? ''
      const element: TTagElement = {
        coordinate,
        authorPubkey: viewer,
        slug: tag.slug,
        name: input.name,
        description: input.description ?? '',
        eventId,
        createdAt: now()
      }
      this.registerTagElement(element)
      if (this.catalogCache && !this.catalogCache.some((e) => e.coordinate === coordinate)) {
        this.catalogCache = [...this.catalogCache, element].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      }
      this.localApplicability[context].add(coordinate)
      this.invalidateCatalog()
    }

    // The assertion is always the last published entry — only patch when it landed.
    const assertionLanded = !result.failedAt
    if (!assertionLanded) return

    this.patchTargetStance(targetKey, tag, polarity, viewer)
    this.refetchTargetTags(targetKey)
  }

  /** Optimistic `mine` overlay so a just-published stance never flickers away. */
  private patchTargetStance(
    key: string,
    tag: TTagIdentity,
    polarity: 1 | -1,
    viewer: string
  ) {
    const state = this.targetTagsMap.get(key)
    const coordinate = tagElementAddr(tag.authorPubkey, tag.slug)
    // Latest-wins replace semantics are per (tag, target): only the affected
    // chip drops the viewer's previous stance; their stances on other tags stay.
    const chips = (state?.chips ?? []).map((chip) =>
      chip.coordinate === coordinate
        ? {
            ...chip,
            applications: chip.applications.filter((entry) => entry.pubkey !== viewer),
            disputes: chip.disputes.filter((entry) => entry.pubkey !== viewer)
          }
        : chip
    )
    let chip = chips.find((c) => c.coordinate === coordinate)
    if (!chip) {
      chip = { tag, coordinate, applications: [], disputes: [], mine: null }
      this.decorateChip(chip)
      chips.push(chip)
    }
    chip.mine = polarity === 1 ? 'apply' : 'dispute'
    if (trust.predicate(viewer)) {
      const entry = { pubkey: viewer, createdAt: now() }
      if (polarity === 1) {
        chip.applications.push(entry)
      } else {
        chip.disputes.push(entry)
      }
    }
    this.setTargetState(key, { status: state?.status ?? 'ready', chips: this.sortChips(chips) })
  }

  /** =========== tag page =========== */

  async fetchTagPageData(
    tagAuthorPubkey: string,
    slug: string,
    viewerPubkey?: string | null
  ): Promise<TTagPageData> {
    const coordinate = tagElementAddr(tagAuthorPubkey, slug)
    await this.ensureTagElements([coordinate])
    const element = this.tagElementByCoord.get(coordinate) ?? null
    const viewer = viewerPubkey ?? client.pubkey

    // Notes: headers (per honored authority) → taggings per header → group by target.
    const headers = await this.findHeadersForTag(tagAuthorPubkey, slug)
    let notes: TTagPageData['notes'] = []
    if (headers.length > 0) {
      const candidates = await fetchTagEvents(
        mergeFilters(
          headers.map((header) => filterTaggingsUsingTag({ headerAuthorPubkey: header.pubkey, slug })),
          '#z'
        )
      )
      await trust.ensure(candidates.map((candidate) => candidate.pubkey))
      const grouped = groupTaggingsByTarget({
        candidates,
        headers,
        honoredAuthorities: Z_HANDLE_PUBKEYS,
        isAsserterTrusted: trust.predicate,
        viewerPubkey: viewer,
        tag: { authorPubkey: tagAuthorPubkey, slug }
      })
      const rowByKey = new Map<string, TTagPageData['notes'][number]>()
      const keyOf = (target: { id?: string; address?: string }) =>
        target.id ? `e:${target.id}` : `a:${target.address}`
      for (const group of grouped.targets) {
        rowByKey.set(keyOf(group.target), {
          target: group.target,
          applications: group.applications.length,
          disputes: group.disputes.length,
          appliedAt: Math.max(0, ...group.applications.map((entry) => entry.createdAt)),
          mine: null
        })
      }
      for (const mine of grouped.mine) {
        const key = keyOf(mine.target)
        const row = rowByKey.get(key)
        if (row) {
          row.mine = mine.stance
          row.appliedAt = Math.max(row.appliedAt, mine.createdAt)
        } else {
          rowByKey.set(key, {
            target: mine.target,
            applications: 0,
            disputes: 0,
            appliedAt: mine.createdAt,
            mine: mine.stance
          })
        }
      }
      // ALL rows, including disputed ones — presentation (hide by default,
      // reveal on demand) is the UI's decision.
      notes = Array.from(rowByKey.values()).sort((a, b) => b.appliedAt - a.appliedAt)
    }

    // People: profile taggings using this tag, trust-filtered, net > 0.
    // Deployed-variant completeness (protocol/tags.md §"Deployed variant"):
    // union the #a lookup with a legacy #e lookup against the tag-element's
    // known event ids — live assertions carry no `a` tag yet.
    const profileFilter = filterProfileTaggingsUsingTag({
      tagAuthorPubkey,
      slug,
      zHandlePubkeys: Z_HANDLE_PUBKEYS
    })
    const legacyElementIds = Array.from(this.coordToElementIds.get(coordinate) ?? [])
    const profileFilters: Filter[] = [profileFilter]
    if (legacyElementIds.length > 0) {
      profileFilters.push({
        kinds: profileFilter.kinds,
        '#e': legacyElementIds,
        '#z': (profileFilter as Record<string, string[]>)['#z']
      })
    }
    const profileCandidates = latestByCoord(await fetchTagEvents(profileFilters))
    await this.resolveLegacyElementRefs(profileCandidates)
    const normalized = normalizeTaggings({
      assertions: profileCandidates,
      headers: [],
      members: this.legacyAwareMembers,
      honoredAuthorities: Z_HANDLE_PUBKEYS
    }).filter(
      (tagging) =>
        tagging.target.type === 'profile' &&
        tagging.tag.authorPubkey === tagAuthorPubkey &&
        tagging.tag.slug === slug
    )
    await trust.ensure(normalized.map((tagging) => tagging.asserter))
    const peopleByPubkey = new Map<string, TTagPageData['people'][number]>()
    for (const tagging of normalized) {
      let row = peopleByPubkey.get(tagging.target.ref)
      if (!row) {
        row = { pubkey: tagging.target.ref, applications: 0, disputes: 0, appliedAt: 0, mine: null }
        peopleByPubkey.set(tagging.target.ref, row)
      }
      if (viewer && tagging.asserter === viewer) {
        row.mine = tagging.stance
        row.appliedAt = Math.max(row.appliedAt, tagging.createdAt)
      }
      if (!trust.predicate(tagging.asserter)) continue
      if (tagging.stance === 'apply') {
        row.applications += 1
        row.appliedAt = Math.max(row.appliedAt, tagging.createdAt)
      } else {
        row.disputes += 1
      }
    }
    const people = Array.from(peopleByPubkey.values()).sort((a, b) => b.appliedAt - a.appliedAt)

    return { element, notes, people }
  }

  /** =========== Tags page: trust filter, personal stances, activity =========== */

  /**
   * Keep only tag-elements whose AUTHOR passes the house trust predicate — the
   * same POV (and the same known limitations, e.g. unscored pubkeys counting
   * under `unknownPolicy: trusted`) that already filters tagging asserters.
   * For catalog/browse surfaces only: resolution and dedup flows must keep the
   * full catalog, or an untrusted-author tag could be re-minted as a duplicate.
   */
  async filterElementsByAuthorTrust(elements: TTagElement[]): Promise<TTagElement[]> {
    await trust.ensure(elements.map((element) => element.authorPubkey))
    return elements.filter((element) => trust.predicate(element.authorPubkey))
  }

  /** Every concept-z value a tagging assertion can carry (all members × namespaces). */
  private conceptZValues(): string[] {
    return Z_HANDLE_PUBKEYS.flatMap((taPubkey) =>
      taggingMembers.map((member) => member.conceptZ(taPubkey))
    )
  }

  /**
   * Normalize a mixed batch of tagging assertions (profile + event members):
   * resolve legacy `e`-only tag refs, fetch the tagging headers event-taggings
   * hang off, then run the SDK normalizer with the legacy-aware members.
   */
  private async normalizeMixedTaggings(candidates: Event[]): Promise<TNormalizedTagging[]> {
    await this.resolveLegacyElementRefs(candidates)
    const descriptorCoords = new Set<string>()
    for (const candidate of candidates) {
      for (const tag of candidate.tags) {
        if (tag[0] === 'z' && DESCRIPTOR_COORD_RE.test(tag[1] ?? '')) {
          descriptorCoords.add(tag[1])
        }
      }
    }
    await this.ensureHeaders(Array.from(descriptorCoords))
    const headers = Array.from(descriptorCoords)
      .map((coord) => this.headerCache.get(coord))
      .filter((header): header is Event => !!header)
    return normalizeTaggings({
      assertions: candidates,
      headers,
      members: this.legacyAwareMembers,
      honoredAuthorities: Z_HANDLE_PUBKEYS
    })
  }

  /** The viewer's own published stances, aggregated per tag, latest first. */
  async fetchMyTagStances(viewer: string): Promise<TMyTagStanceRow[]> {
    const candidates = latestByCoord(
      await fetchTagEvents({
        kinds: [TAGGING_KIND],
        authors: [viewer],
        '#z': this.conceptZValues()
      })
    )
    const taggings = (await this.normalizeMixedTaggings(candidates)).filter(
      (tagging) => tagging.asserter === viewer
    )
    const byCoord = new Map<string, TMyTagStanceRow>()
    for (const tagging of taggings) {
      const coordinate = tagElementAddr(tagging.tag.authorPubkey, tagging.tag.slug)
      let row = byCoord.get(coordinate)
      if (!row) {
        row = { coordinate, element: null, applies: 0, disputes: 0, latestAt: 0 }
        byCoord.set(coordinate, row)
      }
      if (tagging.stance === 'apply') {
        row.applies += 1
      } else {
        row.disputes += 1
      }
      row.latestAt = Math.max(row.latestAt, tagging.createdAt)
    }
    await this.ensureTagElements(Array.from(byCoord.keys()))
    for (const row of byCoord.values()) {
      row.element = this.tagElementByCoord.get(row.coordinate) ?? null
    }
    return Array.from(byCoord.values()).sort((a, b) => b.latestAt - a.latestAt)
  }

  /**
   * Tags with recent tagging activity, POV-counted: asserters are filtered by
   * the house trust predicate, tag authors by the same predicate, and (when
   * the house applicability lists are reachable) rows are limited to tags the
   * house lists know — the only present signal that separates real tags from
   * throwaway QA mints, whose ephemeral keys are unscored and therefore pass
   * the predicate under `unknownPolicy: trusted`.
   */
  async fetchRecentTagActivity(sinceDays = 7, maxRows = 8): Promise<TTagActivityRow[]> {
    const candidates = latestByCoord(
      await fetchTagEvents({
        kinds: [TAGGING_KIND],
        '#z': this.conceptZValues(),
        since: now() - sinceDays * 86_400,
        limit: 500
      })
    )
    const taggings = await this.normalizeMixedTaggings(candidates)
    await trust.ensure(taggings.map((tagging) => tagging.asserter))
    const byCoord = new Map<string, TTagActivityRow & { asserterSet: Set<string> }>()
    for (const tagging of taggings) {
      if (!trust.predicate(tagging.asserter)) continue
      const coordinate = tagElementAddr(tagging.tag.authorPubkey, tagging.tag.slug)
      let row = byCoord.get(coordinate)
      if (!row) {
        row = {
          coordinate,
          element: null,
          taggings: 0,
          asserters: 0,
          latestAt: 0,
          asserterSet: new Set()
        }
        byCoord.set(coordinate, row)
      }
      row.taggings += 1
      row.asserterSet.add(tagging.asserter)
      row.latestAt = Math.max(row.latestAt, tagging.createdAt)
    }
    let rows = Array.from(byCoord.values())
    await trust.ensure(rows.map((row) => row.coordinate.split(':')[1]))
    rows = rows.filter((row) => trust.predicate(row.coordinate.split(':')[1]))
    const applicability = await this.getApplicability()
    if (applicability.event.size > 0 || applicability.pubkey.size > 0) {
      rows = rows.filter(
        (row) => applicability.event.has(row.coordinate) || applicability.pubkey.has(row.coordinate)
      )
    }
    rows.sort((a, b) => b.taggings - a.taggings || b.latestAt - a.latestAt)
    const top = rows.slice(0, maxRows)
    await this.ensureTagElements(top.map((row) => row.coordinate))
    return top.map(({ asserterSet, ...row }) => ({
      ...row,
      asserters: asserterSet.size,
      element: this.tagElementByCoord.get(row.coordinate) ?? null
    }))
  }
}

const instance = new TaggingService()
export default instance
