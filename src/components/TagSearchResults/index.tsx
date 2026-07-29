import Username from '@/components/Username'
import { toTag, toTagsGuide } from '@/lib/link'
import { slug as slugify } from '@/lib/tagging/sdk/event-tagging/index.js'
import { SecondaryPageLink } from '@/PageManager'
import taggingService, { TTagElement } from '@/services/tagging.service'
import { Loader2, Tag as TagIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const PAGE_SIZE = 30

export type TTagCatalog = { trusted: TTagElement[]; all: TTagElement[] }

/**
 * Partial-match filter over the tag catalog — the same name/slug/description
 * substring matching the tag picker uses, so "podcast" finds "Podcaster"
 * without knowing the exact slug. Exact matches sort first, then prefix
 * matches. Shared by the search results and the Tags page.
 */
export function matchTagElements(
  elements: TTagElement[] | null | undefined,
  search: string
): TTagElement[] {
  const q = search.trim().toLowerCase()
  if (!q) return elements ?? []
  const qSlug = slugify(q) || q
  const filtered = (elements ?? []).filter(
    (el) =>
      el.name.toLowerCase().includes(q) ||
      el.slug.includes(qSlug) ||
      el.description.toLowerCase().includes(q)
  )
  const rank = (el: TTagElement) => {
    if (el.name.toLowerCase() === q || el.slug === qSlug) return 0
    if (el.name.toLowerCase().startsWith(q) || el.slug.startsWith(qSlug)) return 1
    return 2
  }
  return filtered.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

/** One catalog row: tag name, description and creator, linking to the tag page. */
export function TagElementRow({ element }: { element: TTagElement }) {
  const { t } = useTranslation()
  return (
    <SecondaryPageLink
      to={toTag(element.authorPubkey, element.slug)}
      className="block border-b px-4 py-3 transition-colors hover:bg-accent/50"
    >
      <div className="flex items-center gap-2">
        <TagIcon className="text-muted-foreground size-4 shrink-0" />
        <span className="truncate font-semibold" dir="auto">
          {element.name}
        </span>
      </div>
      {element.description && (
        <div className="text-muted-foreground mt-0.5 truncate text-sm" dir="auto">
          {element.description}
        </div>
      )}
      <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
        {t('Created by')}
        <Username
          userId={element.authorPubkey}
          className="text-muted-foreground max-w-40 truncate font-semibold"
          skeletonClassName="h-3"
        />
      </div>
    </SecondaryPageLink>
  )
}

/**
 * A windowed tag-element list: renders in pages of PAGE_SIZE, revealing more
 * as the sentinel scrolls into view — the catalog is thousands of rows.
 */
export function TagElementList({ elements }: { elements: TTagElement[] }) {
  const [showCount, setShowCount] = useState(PAGE_SIZE)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setShowCount(PAGE_SIZE)
  }, [elements])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && showCount < elements.length) {
          setShowCount((prev) => prev + PAGE_SIZE)
        }
      },
      { rootMargin: '200px', threshold: 0 }
    )
    const el = bottomRef.current
    if (el) observer.observe(el)
    return () => {
      if (el) observer.unobserve(el)
    }
  }, [showCount, elements])

  return (
    <div>
      {elements.slice(0, showCount).map((el) => (
        <TagElementRow key={el.coordinate} element={el} />
      ))}
      {showCount < elements.length && <div ref={bottomRef} className="h-8" />}
    </div>
  )
}

/**
 * Load the catalog (cache first, then a fresh relay read) with tag authors
 * passed through the scored-only visibility rule. Returns both the trusted
 * view and the full set, so surfaces can say how much scoring hid instead of
 * hiding silently. Shared by the search results and the Tags page.
 */
export function useTrustedTagCatalog(): TTagCatalog | null {
  const [catalog, setCatalog] = useState<TTagCatalog | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (all: TTagElement[]) => {
      const trusted = await taggingService.filterElementsByAuthorTrust(all)
      if (!cancelled) setCatalog({ trusted, all })
    }
    taggingService.getAllTagElements().then(load)
    taggingService.refreshCatalogAndGet().then(load)
    return () => {
      cancelled = true
    }
  }, [])

  return catalog
}

/** "N matching tags are hidden by scoring" — transparency line with a guide link. */
export function HiddenByScoringHint({ count }: { count: number }) {
  const { t } = useTranslation()
  if (count <= 0) return null
  return (
    <div className="text-muted-foreground px-4 py-3 text-center text-sm">
      {t('{{count}} matching tags are hidden because their creators have no trust score yet.', {
        count
      })}{' '}
      <SecondaryPageLink to={toTagsGuide()} className="text-primary hover:underline">
        {t('How decentralized tags work')}
      </SecondaryPageLink>
    </div>
  )
}

/** The "Tags" section of plain-text search results. */
export default function TagSearchResults({ search }: { search: string }) {
  const { t } = useTranslation()
  const catalog = useTrustedTagCatalog()

  const matches = useMemo(
    () => matchTagElements(catalog?.trusted ?? null, search),
    [catalog, search]
  )
  const hiddenCount = useMemo(
    () => (catalog ? matchTagElements(catalog.all, search).length - matches.length : 0),
    [catalog, search, matches.length]
  )

  if (catalog === null) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
        <Loader2 className="size-4 animate-spin" />
        {t('Loading tags...')}
      </div>
    )
  }

  if (matches.length === 0) {
    return hiddenCount > 0 ? (
      <HiddenByScoringHint count={hiddenCount} />
    ) : (
      <div className="text-muted-foreground mt-4 text-center text-sm">{t('No matching tags')}</div>
    )
  }

  return (
    <>
      <TagElementList elements={matches} />
      <HiddenByScoringHint count={hiddenCount} />
    </>
  )
}
