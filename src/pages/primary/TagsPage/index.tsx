import SearchInput from '@/components/SearchInput'
import { ProfileTagChips } from '@/components/TagChips'
import {
  matchTagElements,
  TagElementList,
  useTrustedTagCatalog
} from '@/components/TagSearchResults'
import Tabs from '@/components/Tabs'
import { Button } from '@/components/ui/button'
import { useProfileTags } from '@/hooks/useTargetTags'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { toTag, toTagsGuide } from '@/lib/link'
import { SecondaryPageLink, useSecondaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import storage from '@/services/local-storage.service'
import taggingService, {
  isChipVisible,
  TMyTagStanceRow,
  TTagActivityRow,
  TTagApplicability
} from '@/services/tagging.service'
import { TPageRef } from '@/types'
import { TagSimpleIcon } from '@phosphor-icons/react'
import { CircleHelp, Loader2, Tag as TagIcon, X } from 'lucide-react'
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type TBrowseTab = 'profile' | 'content' | 'other'

/**
 * The Tags primary page — the first-touch surface for decentralized tagging:
 * search-first over the trust-filtered catalog, a dismissible one-liner
 * explaining the trust model (linking the guide), the viewer's own chips and
 * published stances, recent POV-counted activity, and the catalog behind
 * Profile/Content/Other tabs (the house applicability lists; a tag applicable
 * to both appears in both).
 */
const TagsPage = forwardRef<TPageRef>((_, ref) => {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { pubkey } = useNostr()
  const [input, setInput] = useState('')
  const [applicability, setApplicability] = useState<TTagApplicability | null>(null)
  const [introDismissed, setIntroDismissed] = useState(() => storage.getDismissedTagsPageIntro())
  const [browseTab, setBrowseTab] = useState<TBrowseTab>('profile')
  const browseTabPinnedRef = useRef(false)
  const elements = useTrustedTagCatalog()

  useEffect(() => {
    let cancelled = false
    taggingService.getApplicability().then((sets) => !cancelled && setApplicability(sets))
    return () => {
      cancelled = true
    }
  }, [])

  const query = input.trim()
  const matches = useMemo(
    () => (query ? matchTagElements(elements, query) : []),
    [elements, query]
  )

  const { profileTags, contentTags, otherTags } = useMemo(() => {
    const sorted = [...(elements ?? [])].sort((a, b) => a.name.localeCompare(b.name))
    if (!applicability || (applicability.event.size === 0 && applicability.pubkey.size === 0)) {
      return { profileTags: [], contentTags: [], otherTags: sorted }
    }
    // A tag applicable to both contexts appears under BOTH tabs — applicability
    // is a hint, not a partition.
    return {
      profileTags: sorted.filter((el) => applicability.pubkey.has(el.coordinate)),
      contentTags: sorted.filter((el) => applicability.event.has(el.coordinate)),
      otherTags: sorted.filter(
        (el) => !applicability.pubkey.has(el.coordinate) && !applicability.event.has(el.coordinate)
      )
    }
  }, [elements, applicability])

  // Land on the first non-empty tab until the user picks one themselves.
  useEffect(() => {
    if (browseTabPinnedRef.current || elements === null) return
    const first =
      profileTags.length > 0 ? 'profile' : contentTags.length > 0 ? 'content' : 'other'
    setBrowseTab(first)
  }, [elements, profileTags.length, contentTags.length])

  const dismissIntro = () => {
    storage.setDismissedTagsPageIntro(true)
    setIntroDismissed(true)
  }

  const browseList =
    browseTab === 'profile' ? profileTags : browseTab === 'content' ? contentTags : otherTags

  return (
    <PrimaryPageLayout
      ref={ref}
      pageName="tags"
      icon={<TagSimpleIcon />}
      title={t('Tags')}
      controls={
        <Button
          variant="ghost"
          size="titlebar-icon"
          title={t('How decentralized tags work')}
          onClick={() => push(toTagsGuide())}
        >
          <CircleHelp />
        </Button>
      }
      displayScrollToTopButton
    >
      <div className="px-4 pb-1 pt-2">
        <SearchInput
          placeholder={t('Search tags')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </div>

      {!introDismissed && (
        <div className="bg-muted/40 relative mx-4 my-2 rounded-lg border p-3 text-sm">
          <button
            className="text-muted-foreground hover:text-foreground absolute end-2 top-2 rounded-sm p-0.5 transition-colors"
            onClick={dismissIntro}
            aria-label={t('Dismiss')}
          >
            <X className="size-3.5" />
          </button>
          <div className="pe-5">
            {t(
              'Tags are public, signed claims anyone can make. What you see here is filtered through a web of trust.'
            )}
          </div>
          <button
            type="button"
            className="text-primary mt-1 cursor-pointer text-sm hover:underline"
            onClick={() => push(toTagsGuide())}
          >
            {t('How decentralized tags work')}
          </button>
        </div>
      )}

      {query ? (
        elements === null ? (
          <CenteredLoader label={t('Loading tags...')} />
        ) : matches.length === 0 ? (
          <div className="text-muted-foreground mt-4 text-center text-sm">
            {t('No matching tags')}
          </div>
        ) : (
          <TagElementList elements={matches} />
        )
      ) : (
        <>
          {pubkey && <TagsOnYou pubkey={pubkey} />}
          {pubkey && <YourTags pubkey={pubkey} />}
          <ActiveThisWeek />
          {elements === null ? (
            <CenteredLoader label={t('Loading tags...')} />
          ) : (
            <>
              <Tabs
                tabs={[
                  { value: 'profile', label: 'Profile tags', count: profileTags.length },
                  { value: 'content', label: 'Content tags', count: contentTags.length },
                  { value: 'other', label: 'Other tags', count: otherTags.length }
                ]}
                value={browseTab}
                onTabChange={(value) => {
                  browseTabPinnedRef.current = true
                  setBrowseTab(value as TBrowseTab)
                }}
              />
              {browseList.length === 0 ? (
                <div className="text-muted-foreground mt-4 text-center text-sm">
                  {t('No matching tags')}
                </div>
              ) : (
                <TagElementList elements={browseList} />
              )}
            </>
          )}
        </>
      )}
    </PrimaryPageLayout>
  )
})
TagsPage.displayName = 'TagsPage'
export default TagsPage

function CenteredLoader({ label }: { label: string }) {
  return (
    <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <div className="px-4 pb-1 pt-4 text-base font-semibold">{children}</div>
}

/**
 * The viewer's own profile chips — the fastest way to make the model click.
 * The empty state carries the lesson: tags are claims others publish about you.
 */
function TagsOnYou({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const state = useProfileTags(pubkey)
  const visibleCount = state?.chips.filter(isChipVisible).length ?? 0

  return (
    <div className="border-b pb-4">
      <SectionHeading>{t('Tags on you')}</SectionHeading>
      {visibleCount === 0 && (
        <div className="text-muted-foreground px-4 pb-2 text-sm">
          {t('No one has tagged you yet — tags are claims others publish about your profile.')}
        </div>
      )}
      <ProfileTagChips pubkey={pubkey} className="px-4" />
    </div>
  )
}

const coordParts = (coordinate: string) => {
  const [, author, ...rest] = coordinate.split(':')
  return { author, slug: rest.join(':') }
}

/** The stances the viewer has published, one row per tag, latest first. */
function YourTags({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<TMyTagStanceRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    taggingService
      .fetchMyTagStances(pubkey)
      .then((result) => !cancelled && setRows(result))
      .catch(() => !cancelled && setRows([]))
    return () => {
      cancelled = true
    }
  }, [pubkey])

  if (!rows || rows.length === 0) return null

  return (
    <div className="border-b pb-2">
      <SectionHeading>{t('Your tags')}</SectionHeading>
      {rows.map((row) => {
        const { author, slug } = coordParts(row.coordinate)
        return (
          <SecondaryPageLink
            key={row.coordinate}
            to={toTag(author, slug)}
            className="hover:bg-accent/50 flex items-center justify-between gap-2 px-4 py-2 transition-colors"
          >
            <div className="flex min-w-0 items-center gap-2">
              <TagIcon className="text-muted-foreground size-4 shrink-0" />
              <span className="truncate font-semibold" dir="auto">
                {row.element?.name ?? slug}
              </span>
            </div>
            <div className="text-muted-foreground flex shrink-0 gap-2 text-xs">
              {row.applies > 0 && (
                <span>
                  {t('Applied')}
                  {row.applies > 1 ? ` ×${row.applies}` : ''}
                </span>
              )}
              {row.disputes > 0 && (
                <span className="text-destructive">
                  {t('Disputed')}
                  {row.disputes > 1 ? ` ×${row.disputes}` : ''}
                </span>
              )}
            </div>
          </SecondaryPageLink>
        )
      })}
    </div>
  )
}

/** Tags with recent POV-counted tagging activity. */
function ActiveThisWeek() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<TTagActivityRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    taggingService
      .fetchRecentTagActivity()
      .then((result) => !cancelled && setRows(result))
      .catch(() => !cancelled && setRows([]))
    return () => {
      cancelled = true
    }
  }, [])

  if (!rows || rows.length === 0) return null

  return (
    <div className="border-b pb-2">
      <SectionHeading>{t('Active this week')}</SectionHeading>
      {rows.map((row) => {
        const { author, slug } = coordParts(row.coordinate)
        return (
          <SecondaryPageLink
            key={row.coordinate}
            to={toTag(author, slug)}
            className="hover:bg-accent/50 block px-4 py-2 transition-colors"
          >
            <div className="flex min-w-0 items-center gap-2">
              <TagIcon className="text-muted-foreground size-4 shrink-0" />
              <span className="truncate font-semibold" dir="auto">
                {row.element?.name ?? slug}
              </span>
            </div>
            <div className="text-muted-foreground mt-0.5 text-xs">
              {t('{{count}} taggings · {{people}} people', {
                count: row.taggings,
                people: row.asserters
              })}
            </div>
          </SecondaryPageLink>
        )
      })}
    </div>
  )
}
