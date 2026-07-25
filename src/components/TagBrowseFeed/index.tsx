import NormalFeed from '@/components/NormalFeed'
import NoteCard, { NoteCardLoadingSkeleton } from '@/components/NoteCard'
import TagBrowseContent, { addressToNaddr } from '@/components/TagBrowseContent'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SPECIAL_FEED_ID } from '@/constants'
import { toTag } from '@/lib/link'
import { getDefaultRelayUrls } from '@/lib/relay'
import { SecondaryPageLink } from '@/PageManager'
import { useKindFilter } from '@/providers/KindFilterProvider'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import taggingService, { isRowEndorsed, rowNet } from '@/services/tagging.service'
import { ChevronRight, Hash, Loader2, Tag as TagIcon } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type TBrowseMode = 'dtags' | 'hashtags' | 'blend'

/**
 * The tag-browsing surface behind hashtag links and tag search: a prominent
 * three-way switch between the decentralized tag's feed (default — only what
 * the POV population endorses), the raw legacy hashtag feed, and a blend. In
 * the blend, notes whose matching decentralized tagging nets negative are
 * dropped from the hashtag feed — a disputed tagging takes the note out of
 * the browse view.
 */
export default function TagBrowseFeed({ hashtag, kinds }: { hashtag: string; kinds?: number[] }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<TBrowseMode>('dtags')
  const [resolved, setResolved] = useState<
    | { state: 'loading' }
    | { state: 'none' }
    | { state: 'found'; authorPubkey: string; slug: string }
  >({ state: 'loading' })

  useEffect(() => {
    let cancelled = false
    setResolved({ state: 'loading' })
    taggingService
      .resolveTagInputForHashtag(hashtag)
      .then(({ input, existing }) => {
        if (cancelled) return
        if (existing && 'authorPubkey' in input) {
          setResolved({ state: 'found', authorPubkey: input.authorPubkey, slug: input.slug })
        } else {
          setResolved({ state: 'none' })
        }
      })
      .catch(() => {
        if (!cancelled) setResolved({ state: 'none' })
      })
    return () => {
      cancelled = true
    }
  }, [hashtag])

  const hashtagFeed = (
    <NormalFeed
      feedId={SPECIAL_FEED_ID.HASHTAG}
      subRequests={[
        {
          urls: getDefaultRelayUrls(),
          filter: { '#t': [hashtag], ...(kinds && kinds.length > 0 ? { kinds } : {}) }
        }
      ]}
      showRelayCloseReason
    />
  )

  return (
    <>
      <div className="px-4 pb-2">
        <Tabs value={mode} onValueChange={(value) => setMode(value as TBrowseMode)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="dtags" className="gap-1">
              <TagIcon className="size-3.5" />
              {t('Tags')}
            </TabsTrigger>
            <TabsTrigger value="hashtags" className="gap-1">
              <Hash className="size-3.5" />
              {t('Hashtags')}
            </TabsTrigger>
            <TabsTrigger value="blend">{t('Blend')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {mode === 'hashtags' ? (
        hashtagFeed
      ) : resolved.state === 'loading' ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {t('Loading...')}
        </div>
      ) : mode === 'dtags' ? (
        resolved.state === 'found' ? (
          <>
            <TagFeedHeader authorPubkey={resolved.authorPubkey} slug={resolved.slug} />
            <TagBrowseContent tagAuthorPubkey={resolved.authorPubkey} slug={resolved.slug} />
          </>
        ) : (
          <div className="space-y-3 px-4 py-10 text-center">
            <div className="text-muted-foreground text-sm">
              {t('No decentralized tag "{{name}}" yet', { name: hashtag })}
            </div>
            <div className="text-muted-foreground text-xs">
              {t('You can bridge it from any note that uses this hashtag')}
            </div>
            <Button variant="outline" size="sm" onClick={() => setMode('hashtags')}>
              {t('Show hashtag posts')}
            </Button>
          </div>
        )
      ) : resolved.state === 'found' ? (
        <BlendFeed
          authorPubkey={resolved.authorPubkey}
          slug={resolved.slug}
          hashtag={hashtag}
          kinds={kinds}
        />
      ) : (
        hashtagFeed
      )}
    </>
  )
}

function TagFeedHeader({ authorPubkey, slug }: { authorPubkey: string; slug: string }) {
  const { t } = useTranslation()
  const element = taggingService.getTagElement(`39999:${authorPubkey}:${slug}`)
  return (
    <SecondaryPageLink
      to={toTag(authorPubkey, slug)}
      className="text-muted-foreground hover:text-foreground flex items-center gap-1 px-4 pb-2 text-xs"
    >
      <TagIcon className="size-3" />
      <span className="truncate" dir="auto">
        {element?.name ?? slug}
      </span>
      <span className="shrink-0">— {t('View tag page')}</span>
      <ChevronRight className="size-3 shrink-0 rtl:-scale-x-100" />
    </SecondaryPageLink>
  )
}

const BLEND_PAGE_SIZE = 10
const BLEND_HASHTAG_FETCH_LIMIT = 100

/**
 * Blend: ONE time-ordered feed that unions the legacy hashtag posts with the
 * decentralized tag's net-applied posts, deduped — and drops every note whose
 * decentralized tagging nets negative. So a hashtag-only post shows until the
 * POV population disputes its tagging away; a net-applied post shows with or
 * without the hashtag.
 */
function BlendFeed({
  authorPubkey,
  slug,
  hashtag,
  kinds
}: {
  authorPubkey: string
  slug: string
  hashtag: string
  kinds?: number[]
}) {
  const { t } = useTranslation()
  const { pubkey: viewerPubkey } = useNostr()
  const { getShowKinds } = useKindFilter()
  const { mutePubkeySet } = useMuteList()
  const [events, setEvents] = useState<Event[] | null>(null)
  const [showCount, setShowCount] = useState(BLEND_PAGE_SIZE)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setEvents(null)
    setShowCount(BLEND_PAGE_SIZE)
    const load = async () => {
      const showKinds =
        kinds && kinds.length > 0 ? kinds : getShowKinds(SPECIAL_FEED_ID.HASHTAG)
      const [tagData, hashtagEvents] = await Promise.all([
        taggingService
          .fetchTagPageData(authorPubkey, slug, viewerPubkey)
          .catch(() => ({ element: null, notes: [], people: [] })),
        client
          .fetchEvents(getDefaultRelayUrls(), {
            '#t': [hashtag],
            kinds: showKinds,
            limit: BLEND_HASHTAG_FETCH_LIMIT
          })
          .catch(() => [] as Event[])
      ])

      // Net-disputed taggings hide the note — hashtagged or not.
      const excludedIds = new Set<string>()
      for (const row of tagData.notes) {
        if (rowNet(row) < 0 && row.target.id) excludedIds.add(row.target.id)
      }
      // Net-applied taggings bring the note in even without the hashtag.
      const endorsedRows = tagData.notes.filter(isRowEndorsed)
      const dtagEvents = (
        await Promise.all(
          endorsedRows.map((row) => {
            const id = row.target.id ?? (row.target.address ? addressToNaddr(row.target.address) : null)
            if (!id) return Promise.resolve(undefined)
            return client.fetchEvent(id).catch(() => undefined)
          })
        )
      ).filter((event): event is Event => !!event)

      const byId = new Map<string, Event>()
      for (const event of [...dtagEvents, ...hashtagEvents]) {
        if (excludedIds.has(event.id) || mutePubkeySet.has(event.pubkey)) continue
        if (!byId.has(event.id)) byId.set(event.id, event)
      }
      const merged = Array.from(byId.values()).sort((a, b) => b.created_at - a.created_at)
      if (!cancelled) setEvents(merged)
    }
    load()
    return () => {
      cancelled = true
    }
     
  }, [authorPubkey, slug, hashtag, viewerPubkey])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && events && showCount < events.length) {
          setShowCount((prev) => prev + BLEND_PAGE_SIZE)
        }
      },
      { rootMargin: '10px', threshold: 0.1 }
    )
    const el = bottomRef.current
    if (el) observer.observe(el)
    return () => {
      if (el) observer.unobserve(el)
    }
  }, [showCount, events])

  if (events === null) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
        <Loader2 className="size-4 animate-spin" />
        {t('Loading...')}
      </div>
    )
  }

  if (events.length === 0) {
    return <div className="text-muted-foreground mt-4 text-center text-sm">{t('No notes found')}</div>
  }

  return (
    <>
      <TagFeedHeader authorPubkey={authorPubkey} slug={slug} />
      {events.slice(0, showCount).map((event) => (
        <NoteCard key={event.id} event={event} className="w-full" />
      ))}
      {showCount < events.length ? (
        <div ref={bottomRef}>
          <NoteCardLoadingSkeleton />
        </div>
      ) : (
        <div className="text-muted-foreground mt-2 text-center text-sm">{t('no more notes')}</div>
      )}
    </>
  )
}
