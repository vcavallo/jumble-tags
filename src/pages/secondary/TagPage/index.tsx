import NotFound from '@/components/NotFound'
import NoteCard, { NoteCardLoadingSkeleton } from '@/components/NoteCard'
import Tabs from '@/components/Tabs'
import UserItem from '@/components/UserItem'
import Username from '@/components/Username'
import { useFetchEvent } from '@/hooks'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { userIdToPubkey } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import taggingService, { TTagPageData } from '@/services/tagging.service'
import { Loader2, Tag as TagIcon } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SHOW_COUNT = 10

/**
 * The tag page (F5): everything tagged with one tag, addressed by the tag
 * coordinate — /tags/<author>/<slug> (author as npub or hex; an naddr for the
 * kind-39999 tag-element is accepted as /tags/<naddr>).
 */
const TagPage = forwardRef(
  ({ author, slug, index }: { author?: string; slug?: string; index?: number }, ref) => {
    const { t } = useTranslation()
    const { pubkey: viewerPubkey } = useNostr()
    const [tab, setTab] = useState('notes')
    const [data, setData] = useState<TTagPageData | null>(null)
    const [isFetching, setIsFetching] = useState(true)

    const tagId = useMemo(() => {
      if (!author) return null
      try {
        if (author.startsWith('naddr')) {
          const { type, data: decoded } = nip19.decode(author)
          if (type !== 'naddr' || decoded.kind !== 39999) return null
          return { pubkey: decoded.pubkey, slug: decoded.identifier }
        }
        if (!slug) return null
        return { pubkey: userIdToPubkey(author), slug: decodeURIComponent(slug) }
      } catch {
        return null
      }
    }, [author, slug])

    useEffect(() => {
      if (!tagId) {
        setIsFetching(false)
        return
      }
      let cancelled = false
      setIsFetching(true)
      taggingService
        .fetchTagPageData(tagId.pubkey, tagId.slug, viewerPubkey)
        .then((result) => {
          if (!cancelled) setData(result)
        })
        .catch(() => {
          if (!cancelled) setData({ element: null, notes: [], people: [] })
        })
        .finally(() => {
          if (!cancelled) setIsFetching(false)
        })
      return () => {
        cancelled = true
      }
    }, [tagId, viewerPubkey])

    if (!tagId) {
      return (
        <SecondaryPageLayout index={index} title={t('Tag')} ref={ref}>
          <NotFound />
        </SecondaryPageLayout>
      )
    }

    const title = data?.element?.name ?? tagId.slug

    return (
      <SecondaryPageLayout index={index} title={title} displayScrollToTopButton ref={ref}>
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2">
            <TagIcon className="text-muted-foreground size-5 shrink-0" />
            <div className="truncate text-xl font-semibold" dir="auto">
              {title}
            </div>
          </div>
          {data?.element?.description && (
            <div className="text-muted-foreground mt-1 text-sm" dir="auto">
              {data.element.description}
            </div>
          )}
          <div className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
            {t('Created by')}
            <Username
              userId={tagId.pubkey}
              className="text-muted-foreground max-w-40 truncate font-semibold"
              skeletonClassName="h-3"
            />
          </div>
        </div>
        <Tabs
          tabs={[
            { value: 'notes', label: 'Notes', count: data?.notes.length },
            { value: 'people', label: 'People', count: data?.people.length }
          ]}
          value={tab}
          onTabChange={setTab}
        />
        {isFetching ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t('Loading...')}
          </div>
        ) : tab === 'notes' ? (
          <TaggedNoteList notes={data?.notes ?? []} />
        ) : (
          <TaggedPeopleList people={data?.people ?? []} />
        )}
      </SecondaryPageLayout>
    )
  }
)
TagPage.displayName = 'TagPage'
export default TagPage

function TaggedNoteList({ notes }: { notes: TTagPageData['notes'] }) {
  const { t } = useTranslation()
  const [showCount, setShowCount] = useState(SHOW_COUNT)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const noteIds = useMemo(() => {
    return notes
      .map((row) =>
        row.target.id
          ? row.target.id
          : row.target.address
            ? addressToNaddr(row.target.address)
            : null
      )
      .filter(Boolean) as string[]
  }, [notes])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && showCount < noteIds.length) {
          setShowCount((prev) => prev + SHOW_COUNT)
        }
      },
      { rootMargin: '10px', threshold: 0.1 }
    )
    const el = bottomRef.current
    if (el) observer.observe(el)
    return () => {
      if (el) observer.unobserve(el)
    }
  }, [showCount, noteIds])

  if (noteIds.length === 0) {
    return (
      <div className="text-muted-foreground mt-4 text-center text-sm">
        {t('No notes tagged yet')}
      </div>
    )
  }

  return (
    <div>
      {noteIds.slice(0, showCount).map((id) => (
        <TaggedNote key={id} eventId={id} />
      ))}
      {showCount < noteIds.length && (
        <div ref={bottomRef}>
          <NoteCardLoadingSkeleton />
        </div>
      )}
    </div>
  )
}

function TaggedNote({ eventId }: { eventId: string }) {
  const { event, isFetching } = useFetchEvent(eventId)
  if (isFetching) return <NoteCardLoadingSkeleton className="border-b" />
  if (!event) return null
  return <NoteCard event={event} className="w-full" />
}

function TaggedPeopleList({ people }: { people: TTagPageData['people'] }) {
  const { t } = useTranslation()
  if (people.length === 0) {
    return (
      <div className="text-muted-foreground mt-4 text-center text-sm">
        {t('No profiles tagged yet')}
      </div>
    )
  }
  return (
    <div className="px-4">
      {people.map((row) => (
        <UserItem key={row.pubkey} userId={row.pubkey} />
      ))}
    </div>
  )
}

function addressToNaddr(address: string): string | null {
  const [kindStr, pubkey, ...rest] = address.split(':')
  const kind = Number(kindStr)
  if (!Number.isFinite(kind) || !/^[0-9a-f]{64}$/.test(pubkey ?? '')) return null
  try {
    return nip19.naddrEncode({ kind, pubkey, identifier: rest.join(':') })
  } catch {
    return null
  }
}
