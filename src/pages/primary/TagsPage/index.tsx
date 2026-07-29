import SearchInput from '@/components/SearchInput'
import { ProfileTagChips } from '@/components/TagChips'
import { matchTagElements, TagElementRow } from '@/components/TagSearchResults'
import { Button } from '@/components/ui/button'
import { useProfileTags } from '@/hooks/useTargetTags'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { toTagsGuide } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import storage from '@/services/local-storage.service'
import taggingService, {
  isChipVisible,
  TTagApplicability,
  TTagElement
} from '@/services/tagging.service'
import { TPageRef } from '@/types'
import { TagSimpleIcon } from '@phosphor-icons/react'
import { CircleHelp, Loader2, X } from 'lucide-react'
import { forwardRef, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * The Tags primary page — the first-touch surface for decentralized tagging:
 * search-first over the whole catalog, a dismissible one-liner explaining the
 * trust model (linking the guide), the viewer's own profile chips ("tags on
 * you"), and the full catalog sectioned by the house applicability lists.
 */
const TagsPage = forwardRef<TPageRef>((_, ref) => {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { pubkey } = useNostr()
  const [input, setInput] = useState('')
  const [elements, setElements] = useState<TTagElement[] | null>(null)
  const [applicability, setApplicability] = useState<TTagApplicability | null>(null)
  const [introDismissed, setIntroDismissed] = useState(() => storage.getDismissedTagsPageIntro())

  useEffect(() => {
    let cancelled = false
    // Serve the cache instantly, then replace with a fresh relay read.
    taggingService.getAllTagElements().then((els) => !cancelled && setElements(els))
    taggingService.refreshCatalogAndGet().then((els) => !cancelled && setElements(els))
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
    const profile: TTagElement[] = []
    const content: TTagElement[] = []
    const other: TTagElement[] = []
    for (const el of sorted) {
      if (applicability?.pubkey.has(el.coordinate)) {
        profile.push(el)
      } else if (applicability?.event.has(el.coordinate)) {
        content.push(el)
      } else {
        other.push(el)
      }
    }
    return { profileTags: profile, contentTags: content, otherTags: other }
  }, [elements, applicability])

  const dismissIntro = () => {
    storage.setDismissedTagsPageIntro(true)
    setIntroDismissed(true)
  }

  const loader = (
    <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
      <Loader2 className="size-4 animate-spin" />
      {t('Loading tags...')}
    </div>
  )

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
          loader
        ) : matches.length === 0 ? (
          <div className="text-muted-foreground mt-4 text-center text-sm">
            {t('No matching tags')}
          </div>
        ) : (
          <div>
            {matches.map((el) => (
              <TagElementRow key={el.coordinate} element={el} />
            ))}
          </div>
        )
      ) : (
        <>
          {pubkey && <TagsOnYou pubkey={pubkey} />}
          {elements === null ? (
            loader
          ) : (
            <>
              <TagSection heading={t('Profile tags')} elements={profileTags} />
              <TagSection heading={t('Content tags')} elements={contentTags} />
              <TagSection
                heading={applicability ? t('Other tags') : t('All tags')}
                elements={otherTags}
              />
            </>
          )}
        </>
      )}
    </PrimaryPageLayout>
  )
})
TagsPage.displayName = 'TagsPage'
export default TagsPage

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
      <div className="px-4 pb-2 pt-4 text-base font-semibold">{t('Tags on you')}</div>
      {visibleCount === 0 && (
        <div className="text-muted-foreground px-4 pb-2 text-sm">
          {t('No one has tagged you yet — tags are claims others publish about your profile.')}
        </div>
      )}
      <ProfileTagChips pubkey={pubkey} className="px-4" />
    </div>
  )
}

function TagSection({ heading, elements }: { heading: string; elements: TTagElement[] }) {
  if (elements.length === 0) return null
  return (
    <div>
      <div className="text-muted-foreground flex items-baseline gap-2 px-4 pb-1 pt-4 text-sm font-semibold uppercase tracking-wide">
        {heading}
        <span className="font-normal tabular-nums">{elements.length}</span>
      </div>
      {elements.map((el) => (
        <TagElementRow key={el.coordinate} element={el} />
      ))}
    </div>
  )
}
