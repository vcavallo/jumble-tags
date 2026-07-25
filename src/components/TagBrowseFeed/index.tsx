import NormalFeed from '@/components/NormalFeed'
import NoteList from '@/components/NoteList'
import TagBrowseContent, { TaggedNoteList } from '@/components/TagBrowseContent'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SPECIAL_FEED_ID } from '@/constants'
import { toTag } from '@/lib/link'
import { getDefaultRelayUrls } from '@/lib/relay'
import { SecondaryPageLink } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import taggingService, {
  isRowEndorsed,
  rowNet,
  TTagPageData
} from '@/services/tagging.service'
import { ChevronRight, Hash, Loader2, Tag as TagIcon } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
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
          hashtagFeed={hashtagFeed}
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

/**
 * Blend: the decentralized tag's endorsed notes first, then the legacy
 * hashtag feed with dispute-filtered results (net-negative taggings drop the
 * note) and duplicates removed.
 */
function BlendFeed({
  authorPubkey,
  slug,
  hashtag,
  kinds,
  hashtagFeed
}: {
  authorPubkey: string
  slug: string
  hashtag: string
  kinds?: number[]
  hashtagFeed: React.ReactNode
}) {
  const { t } = useTranslation()
  const { pubkey: viewerPubkey } = useNostr()
  const [data, setData] = useState<TTagPageData | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    taggingService
      .fetchTagPageData(authorPubkey, slug, viewerPubkey)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch(() => {
        if (!cancelled) setData({ element: null, notes: [], people: [] })
      })
    return () => {
      cancelled = true
    }
  }, [authorPubkey, slug, viewerPubkey])

  const { endorsedRows, excludedIds } = useMemo(() => {
    const rows = data?.notes ?? []
    const endorsedRows = rows.filter(isRowEndorsed)
    // Drop from the hashtag feed: notes already shown above, and notes the POV
    // population disputed below zero.
    const excludedIds = new Set<string>()
    for (const row of endorsedRows) {
      if (row.target.id) excludedIds.add(row.target.id)
    }
    for (const row of rows) {
      if (rowNet(row) < 0 && row.target.id) excludedIds.add(row.target.id)
    }
    return { endorsedRows, excludedIds }
  }, [data])

  if (data === null) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
        <Loader2 className="size-4 animate-spin" />
        {t('Loading...')}
      </div>
    )
  }

  return (
    <>
      {endorsedRows.length > 0 && (
        <>
          <TagFeedHeader authorPubkey={authorPubkey} slug={slug} />
          <TaggedNoteList rows={endorsedRows} />
          <div className="text-muted-foreground flex items-center gap-1 px-4 pt-4 pb-2 text-xs">
            <Hash className="size-3" />
            {t('Hashtag posts')}
          </div>
        </>
      )}
      {excludedIds.size > 0 ? (
        <NoteList
          subRequests={[
            {
              urls: getDefaultRelayUrls(),
              filter: { '#t': [hashtag], ...(kinds && kinds.length > 0 ? { kinds } : {}) }
            }
          ]}
          filterFn={(event: Event) => !excludedIds.has(event.id)}
        />
      ) : (
        hashtagFeed
      )}
    </>
  )
}
