import { Event, Filter } from 'nostr-tools'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state: { events: Event[]; pubkey?: string; queries: Filter[] } = {
    events: [],
    pubkey: undefined,
    queries: []
  }
  return {
    state,
    client: {
      get pubkey() {
        return state.pubkey
      },
      fetchEvents: vi.fn(async (_urls: string[], filter: Filter | Filter[]) => {
        const filters = Array.isArray(filter) ? filter : [filter]
        state.queries.push(...filters)
        const matches = (event: Event, f: Filter) => {
          if (f.kinds && !f.kinds.includes(event.kind)) return false
          if (f.ids && !f.ids.includes(event.id)) return false
          if (f.authors && !f.authors.includes(event.pubkey)) return false
          for (const [key, values] of Object.entries(f)) {
            if (!key.startsWith('#')) continue
            const tagName = key.slice(1)
            const wanted = values as string[]
            if (
              !event.tags.some((tag) => tag[0] === tagName && wanted.includes(tag[1]))
            ) {
              return false
            }
          }
          return true
        }
        return state.events.filter((event) => filters.some((f) => matches(event, f)))
      }),
      fetchRelayList: vi.fn(async () => ({ read: [], write: [] })),
      getEventHints: vi.fn(() => []),
      publishEvent: vi.fn(async () => {})
    }
  }
})

vi.mock('@/services/client.service', () => ({ default: mocks.client }))
vi.mock('@/services/local-storage.service', () => ({
  default: { getTagRelayUrls: () => null, setTagRelayUrls: () => {} }
}))

import {
  buildEventTaggingAssertion,
  buildTaggingHeader,
  buildTagElement
} from '@/lib/tagging/sdk/event-tagging/index.js'
import { buildProfileTagAssertion } from '@/lib/tagging/sdk/profile-tagging.js'
import { Z_HANDLE_PUBKEYS } from '@/lib/tagging/config'
import taggingService, { chipNetCount, isChipVisible, isRowEndorsed } from './tagging.service'

const TAG_AUTHOR = 'a'.repeat(64)
const ALICE = 'b'.repeat(64)
const BOB = 'c'.repeat(64)
const VIEWER = 'd'.repeat(64)
const NOTE_ID = '1'.repeat(64)
const PROFILE = 'e'.repeat(63) + '0'

let eventCounter = 0
function asEvent(partial: { kind: number; tags: string[][]; content: string }, pubkey: string, createdAt = 1000): Event {
  eventCounter += 1
  return {
    ...partial,
    pubkey,
    created_at: createdAt,
    id: eventCounter.toString(16).padStart(64, '0'),
    sig: ''
  } as Event
}

function flush(ms = 150) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('tagging service read pipeline', () => {
  beforeEach(() => {
    mocks.state.events = []
    mocks.state.pubkey = undefined
    mocks.state.queries = []
  })

  it('classifies batched note taggings into net-counted chips with the mine overlay', async () => {
    const element = asEvent(
      buildTagElement({ name: 'Psychology', taPubkeys: Z_HANDLE_PUBKEYS }),
      TAG_AUTHOR
    )
    const header = asEvent(
      buildTaggingHeader({
        tagAuthorPubkey: TAG_AUTHOR,
        slug: 'psychology',
        names: ['x', 'y'],
        description: '',
        taPubkeys: Z_HANDLE_PUBKEYS
      }),
      TAG_AUTHOR
    )
    const applyByAlice = asEvent(
      buildEventTaggingAssertion({
        headerAuthorPubkey: TAG_AUTHOR,
        slug: 'psychology',
        target: { id: NOTE_ID },
        polarity: 1,
        asserterPubkey: ALICE,
        taPubkeys: Z_HANDLE_PUBKEYS
      }),
      ALICE,
      1001
    )
    const applyByBob = asEvent(
      buildEventTaggingAssertion({
        headerAuthorPubkey: TAG_AUTHOR,
        slug: 'psychology',
        target: { id: NOTE_ID },
        polarity: 1,
        asserterPubkey: BOB,
        taPubkeys: Z_HANDLE_PUBKEYS
      }),
      BOB,
      1002
    )
    const disputeByViewer = asEvent(
      buildEventTaggingAssertion({
        headerAuthorPubkey: TAG_AUTHOR,
        slug: 'psychology',
        target: { id: NOTE_ID },
        polarity: -1,
        asserterPubkey: VIEWER,
        taPubkeys: Z_HANDLE_PUBKEYS
      }),
      VIEWER,
      1003
    )
    mocks.state.events = [element, header, applyByAlice, applyByBob, disputeByViewer]
    mocks.state.pubkey = VIEWER

    taggingService.requestTargetTags(`e:${NOTE_ID}`)
    await flush()

    const state = taggingService.getTargetTags(`e:${NOTE_ID}`)
    expect(state?.status).toBe('ready')
    expect(state?.chips).toHaveLength(1)
    const chip = state!.chips[0]
    expect(chip.tag).toEqual({ authorPubkey: TAG_AUTHOR, slug: 'psychology' })
    expect(chip.applications.map((entry) => entry.pubkey).sort()).toEqual([ALICE, BOB].sort())
    expect(chip.disputes.map((entry) => entry.pubkey)).toEqual([VIEWER])
    expect(chip.mine).toBe('dispute')
    expect(chipNetCount(chip)).toBe(1)
    expect(isChipVisible(chip)).toBe(true)
    expect(chip.name).toBe('Psychology')
  })

  it('keeps only the latest assertion per coordinate (apply→dispute toggles)', async () => {
    const noteId = '2'.repeat(64)
    const element = asEvent(
      buildTagElement({ name: 'Toggles', taPubkeys: Z_HANDLE_PUBKEYS }),
      TAG_AUTHOR
    )
    const header = asEvent(
      buildTaggingHeader({
        tagAuthorPubkey: TAG_AUTHOR,
        slug: 'toggles',
        names: ['x', 'y'],
        description: '',
        taPubkeys: Z_HANDLE_PUBKEYS
      }),
      TAG_AUTHOR
    )
    const build = (polarity: 1 | -1) =>
      buildEventTaggingAssertion({
        headerAuthorPubkey: TAG_AUTHOR,
        slug: 'toggles',
        target: { id: noteId },
        polarity,
        asserterPubkey: ALICE,
        taPubkeys: Z_HANDLE_PUBKEYS
      })
    const older = asEvent(build(1), ALICE, 1001)
    const newer = asEvent(build(-1), ALICE, 2000)
    // Same d-tag — replaceable; only the newer dispute may count.
    expect(older.tags.find((t) => t[0] === 'd')![1]).toEqual(
      newer.tags.find((t) => t[0] === 'd')![1]
    )
    mocks.state.events = [element, header, older, newer]

    taggingService.requestTargetTags(`e:${noteId}`)
    await flush()

    const chip = taggingService.getTargetTags(`e:${noteId}`)!.chips[0]
    expect(chip.applications).toHaveLength(0)
    expect(chip.disputes.map((entry) => entry.pubkey)).toEqual([ALICE])
    // Disputed-to-nothing chips stay visible (struck) so everyone can SEE the
    // dispute rather than wondering why the tag vanished.
    expect(isChipVisible(chip)).toBe(true)
  })

  it('resolves legacy profile assertions (no a-tag) through the tag-element event id', async () => {
    const element = asEvent(
      buildTagElement({ name: 'Verified Human', taPubkeys: Z_HANDLE_PUBKEYS }),
      TAG_AUTHOR
    )
    const modern = asEvent(
      buildProfileTagAssertion({
        tag: { authorPubkey: TAG_AUTHOR, slug: 'verified-human', eventId: element.id },
        targetPubkey: PROFILE,
        polarity: 1,
        asserterPubkey: ALICE,
        zHandlePubkeys: Z_HANDLE_PUBKEYS
      }),
      ALICE,
      1001
    )
    // The deployed legacy shape: d/p/e/z/polarity, no `a` (protocol/tags.md).
    const legacyBuilt = buildProfileTagAssertion({
      tag: { authorPubkey: TAG_AUTHOR, slug: 'verified-human', eventId: element.id },
      targetPubkey: PROFILE,
      polarity: 1,
      asserterPubkey: BOB,
      zHandlePubkeys: Z_HANDLE_PUBKEYS
    })
    const legacy = asEvent(
      { ...legacyBuilt, tags: legacyBuilt.tags.filter((tag) => tag[0] !== 'a') },
      BOB,
      1002
    )
    mocks.state.events = [element, modern, legacy]

    taggingService.requestTargetTags(`p:${PROFILE}`)
    await flush()

    const state = taggingService.getTargetTags(`p:${PROFILE}`)
    expect(state?.status).toBe('ready')
    expect(state?.chips).toHaveLength(1)
    const chip = state!.chips[0]
    expect(chip.tag.slug).toBe('verified-human')
    // Both the modern (a-tagged) and legacy (e-only) assertions must count.
    expect(chip.applications.map((entry) => entry.pubkey).sort()).toEqual([ALICE, BOB].sort())
    expect(chipNetCount(chip)).toBe(2)
  })

  it('batches concurrent note requests into one relay query', async () => {
    const noteA = '3'.repeat(64)
    const noteB = '4'.repeat(64)
    mocks.state.events = []
    mocks.state.queries = []

    taggingService.requestTargetTags(`e:${noteA}`)
    taggingService.requestTargetTags(`e:${noteB}`)
    await flush()

    const eQueries = mocks.state.queries.filter((f) => '#e' in f)
    expect(eQueries).toHaveLength(1)
    expect((eQueries[0] as Record<string, string[]>)['#e'].sort()).toEqual([noteA, noteB].sort())
    expect(taggingService.getTargetTags(`e:${noteA}`)?.status).toBe('ready')
    expect(taggingService.getTargetTags(`e:${noteB}`)?.chips).toHaveLength(0)
  })

  it('builds tag-page rows: net-positive targets only, most recently tagged first', async () => {
    const element = asEvent(
      buildTagElement({ name: 'Pagetest', taPubkeys: Z_HANDLE_PUBKEYS }),
      TAG_AUTHOR
    )
    const header = asEvent(
      buildTaggingHeader({
        tagAuthorPubkey: TAG_AUTHOR,
        slug: 'pagetest',
        names: ['x', 'y'],
        description: '',
        taPubkeys: Z_HANDLE_PUBKEYS
      }),
      TAG_AUTHOR
    )
    const noteA = '5'.repeat(64)
    const noteB = '6'.repeat(64)
    const noteC = '7'.repeat(64)
    const assertion = (target: string, asserter: string, polarity: 1 | -1, at: number) =>
      asEvent(
        buildEventTaggingAssertion({
          headerAuthorPubkey: TAG_AUTHOR,
          slug: 'pagetest',
          target: { id: target },
          polarity,
          asserterPubkey: asserter,
          taPubkeys: Z_HANDLE_PUBKEYS
        }),
        asserter,
        at
      )
    mocks.state.events = [
      element,
      header,
      assertion(noteA, ALICE, 1, 1001),
      assertion(noteB, ALICE, 1, 2000),
      assertion(noteC, ALICE, -1, 1500) // net negative → excluded
    ]

    const data = await taggingService.fetchTagPageData(TAG_AUTHOR, 'pagetest')
    expect(data.element?.name).toBe('Pagetest')
    // ALL rows come back (most recently applied first; dispute-only rows have
    // no applied timestamp and sort last) — hiding disputed rows is the UI's
    // default, via isRowEndorsed.
    expect(data.notes.map((row) => row.target.id)).toEqual([noteB, noteA, noteC])
    expect(data.notes.filter(isRowEndorsed).map((row) => row.target.id)).toEqual([noteB, noteA])
    expect(data.people).toHaveLength(0)
  })

  it('classifies ARTICLE (addressable) taggings via the #a batch path', async () => {
    const articleAuthor = 'f'.repeat(63) + '1'
    const address = `30023:${articleAuthor}:my-article`
    const element = asEvent(
      buildTagElement({ name: 'Longform', taPubkeys: Z_HANDLE_PUBKEYS }),
      TAG_AUTHOR
    )
    const header = asEvent(
      buildTaggingHeader({
        tagAuthorPubkey: TAG_AUTHOR,
        slug: 'longform',
        names: ['x', 'y'],
        description: '',
        taPubkeys: Z_HANDLE_PUBKEYS
      }),
      TAG_AUTHOR
    )
    const build = (polarity: 1 | -1, asserter: string) =>
      buildEventTaggingAssertion({
        headerAuthorPubkey: TAG_AUTHOR,
        slug: 'longform',
        target: { address },
        polarity,
        asserterPubkey: asserter,
        taPubkeys: Z_HANDLE_PUBKEYS
      })
    const applyByAlice = asEvent(build(1, ALICE), ALICE, 1001)
    // Assertion d-tag identifies the target by the address's AUTHOR segment.
    expect(applyByAlice.tags.find((t) => t[0] === 'd')![1]).toBe(
      `event-tag-longform-${articleAuthor.slice(0, 8)}-${ALICE.slice(0, 8)}`
    )
    expect(applyByAlice.tags.find((t) => t[0] === 'a')![1]).toBe(address)
    mocks.state.events = [element, header, applyByAlice, asEvent(build(-1, VIEWER), VIEWER, 1002)]
    mocks.state.pubkey = VIEWER

    taggingService.requestTargetTags(`a:${address}`, VIEWER)
    await flush()

    const aQueries = mocks.state.queries.filter((f) => '#a' in f && f.kinds?.includes(39999))
    expect(aQueries.length).toBeGreaterThan(0)
    const state = taggingService.getTargetTags(`a:${address}`)
    expect(state?.status).toBe('ready')
    const chip = state!.chips[0]
    expect(chip.tag).toEqual({ authorPubkey: TAG_AUTHOR, slug: 'longform' })
    expect(chip.applications.map((entry) => entry.pubkey)).toEqual([ALICE])
    expect(chip.disputes.map((entry) => entry.pubkey)).toEqual([VIEWER])
    expect(chip.mine).toBe('dispute')
  })

  it('tag-page rows carry addressable article targets', async () => {
    const articleAuthor = 'f'.repeat(63) + '2'
    const address = `30023:${articleAuthor}:tagged-article`
    const element = asEvent(
      buildTagElement({ name: 'Articlerows', taPubkeys: Z_HANDLE_PUBKEYS }),
      TAG_AUTHOR
    )
    const header = asEvent(
      buildTaggingHeader({
        tagAuthorPubkey: TAG_AUTHOR,
        slug: 'articlerows',
        names: ['x', 'y'],
        description: '',
        taPubkeys: Z_HANDLE_PUBKEYS
      }),
      TAG_AUTHOR
    )
    const assertion = asEvent(
      buildEventTaggingAssertion({
        headerAuthorPubkey: TAG_AUTHOR,
        slug: 'articlerows',
        target: { address },
        polarity: 1,
        asserterPubkey: ALICE,
        taPubkeys: Z_HANDLE_PUBKEYS
      }),
      ALICE,
      1001
    )
    mocks.state.events = [element, header, assertion]

    const data = await taggingService.fetchTagPageData(TAG_AUTHOR, 'articlerows')
    expect(data.notes).toHaveLength(1)
    expect(data.notes[0].target).toEqual({ address })
    expect(isRowEndorsed(data.notes[0])).toBe(true)
  })
})
