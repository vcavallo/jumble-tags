import NoteCard, { NoteCardLoadingSkeleton } from '@/components/NoteCard'
import Tabs from '@/components/Tabs'
import UserItem from '@/components/UserItem'
import { Button } from '@/components/ui/button'
import { useFetchEvent } from '@/hooks'
import { useNostr } from '@/providers/NostrProvider'
import taggingService, {
  isRowEndorsed,
  TTagElement,
  TTagPageData
} from '@/services/tagging.service'
import { cn } from '@/lib/utils'
import { Eye, EyeOff, Loader2, ThumbsDown } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const SHOW_COUNT = 10

export type TTagNoteRow = TTagPageData['notes'][number]

/**
 * The browsing view of one decentralized tag: Notes / People tabs with the
 * disputed rows hidden by default and a prominent reveal toggle — a tag feed
 * shows what the POV population endorses, not what it has disputed away.
 * Used by the tag page and the tag-search results.
 */
export default function TagBrowseContent({
  tagAuthorPubkey,
  slug,
  onDataLoaded
}: {
  tagAuthorPubkey: string
  slug: string
  onDataLoaded?: (data: TTagPageData) => void
}) {
  const { t } = useTranslation()
  const { pubkey: viewerPubkey } = useNostr()
  const [tab, setTab] = useState('notes')
  const [data, setData] = useState<TTagPageData | null>(null)
  const [isFetching, setIsFetching] = useState(true)
  const [showDisputed, setShowDisputed] = useState(false)
  const onDataLoadedRef = useRef(onDataLoaded)
  onDataLoadedRef.current = onDataLoaded

  useEffect(() => {
    let cancelled = false
    setIsFetching(true)
    setData(null)
    taggingService
      .fetchTagPageData(tagAuthorPubkey, slug, viewerPubkey)
      .then((result) => {
        if (cancelled) return
        setData(result)
        onDataLoadedRef.current?.(result)
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
  }, [tagAuthorPubkey, slug, viewerPubkey])

  const { endorsedNotes, disputedNotes, endorsedPeople, disputedPeople } = useMemo(() => {
    const notes = data?.notes ?? []
    const people = data?.people ?? []
    return {
      endorsedNotes: notes.filter(isRowEndorsed),
      disputedNotes: notes.filter((row) => !isRowEndorsed(row)),
      endorsedPeople: people.filter(isRowEndorsed),
      disputedPeople: people.filter((row) => !isRowEndorsed(row))
    }
  }, [data])

  const disputedCount = tab === 'notes' ? disputedNotes.length : disputedPeople.length

  return (
    <>
      <Tabs
        tabs={[
          { value: 'notes', label: 'Notes', count: endorsedNotes.length },
          { value: 'people', label: 'People', count: endorsedPeople.length }
        ]}
        value={tab}
        onTabChange={setTab}
        options={
          disputedCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-8 gap-1.5 px-2.5 text-sm font-normal',
                showDisputed
                  ? 'text-destructive hover:text-destructive'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setShowDisputed((prev) => !prev)}
            >
              {showDisputed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              {showDisputed ? t('Hide disputed') : `${t('Show disputed')} (${disputedCount})`}
            </Button>
          ) : undefined
        }
      />
      {isFetching ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {t('Loading...')}
        </div>
      ) : tab === 'notes' ? (
        <TaggedNoteList
          rows={showDisputed ? [...endorsedNotes, ...disputedNotes] : endorsedNotes}
        />
      ) : (
        <TaggedPeopleList endorsed={endorsedPeople} disputed={showDisputed ? disputedPeople : []} />
      )}
    </>
  )
}

export function TaggedNoteList({ rows, emptyText }: { rows: TTagNoteRow[]; emptyText?: string }) {
  const { t } = useTranslation()
  const [showCount, setShowCount] = useState(SHOW_COUNT)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const items = useMemo(() => {
    return rows
      .map((row) => ({
        id: row.target.id
          ? row.target.id
          : row.target.address
            ? addressToNaddr(row.target.address)
            : null,
        disputed: !isRowEndorsed(row)
      }))
      .filter((item) => item.id) as { id: string; disputed: boolean }[]
  }, [rows])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && showCount < items.length) {
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
  }, [showCount, items])

  if (items.length === 0) {
    return (
      <div className="text-muted-foreground mt-4 text-center text-sm">
        {emptyText ?? t('No notes tagged yet')}
      </div>
    )
  }

  return (
    <div>
      {items.slice(0, showCount).map((item) => (
        <TaggedNote key={item.id} eventId={item.id} disputed={item.disputed} />
      ))}
      {showCount < items.length && (
        <div ref={bottomRef}>
          <NoteCardLoadingSkeleton />
        </div>
      )}
    </div>
  )
}

function TaggedNote({ eventId, disputed }: { eventId: string; disputed: boolean }) {
  const { t } = useTranslation()
  const { event, isFetching } = useFetchEvent(eventId)
  if (isFetching) return <NoteCardLoadingSkeleton className="border-b" />
  if (!event) return null
  if (!disputed) return <NoteCard event={event} className="w-full" />
  return (
    <div className="opacity-70">
      <div className="text-destructive flex items-center gap-1 px-4 pt-2 text-xs">
        <ThumbsDown className="size-3" />
        {t('Disputed by the network')}
      </div>
      <NoteCard event={event} className="w-full" />
    </div>
  )
}

function TaggedPeopleList({
  endorsed,
  disputed
}: {
  endorsed: TTagPageData['people']
  disputed: TTagPageData['people']
}) {
  const { t } = useTranslation()
  if (endorsed.length === 0 && disputed.length === 0) {
    return (
      <div className="text-muted-foreground mt-4 text-center text-sm">
        {t('No profiles tagged yet')}
      </div>
    )
  }
  return (
    <div className="px-4">
      {endorsed.map((row) => (
        <UserItem key={row.pubkey} userId={row.pubkey} />
      ))}
      {disputed.map((row) => (
        <div key={row.pubkey} className="opacity-70">
          <div className="text-destructive flex items-center gap-1 pt-2 text-xs">
            <ThumbsDown className="size-3" />
            {t('Disputed by the network')}
          </div>
          <UserItem userId={row.pubkey} />
        </div>
      ))}
    </div>
  )
}

export function addressToNaddr(address: string): string | null {
  const [kindStr, pubkey, ...rest] = address.split(':')
  const kind = Number(kindStr)
  if (!Number.isFinite(kind) || !/^[0-9a-f]{64}$/.test(pubkey ?? '')) return null
  try {
    return nip19.naddrEncode({ kind, pubkey, identifier: rest.join(':') })
  } catch {
    return null
  }
}

export type { TTagElement }
