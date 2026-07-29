import Username from '@/components/Username'
import { toTag } from '@/lib/link'
import { slug as slugify } from '@/lib/tagging/sdk/event-tagging/index.js'
import { SecondaryPageLink } from '@/PageManager'
import taggingService, { TTagElement } from '@/services/tagging.service'
import { Loader2, Tag as TagIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

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

/** The "Tags" section of plain-text search results. */
export default function TagSearchResults({ search }: { search: string }) {
  const { t } = useTranslation()
  const [elements, setElements] = useState<TTagElement[] | null>(null)

  useEffect(() => {
    let cancelled = false
    // Serve the cache instantly, then replace with a fresh relay read so tags
    // minted moments ago by others appear immediately.
    taggingService.getAllTagElements().then((els) => !cancelled && setElements(els))
    taggingService.refreshCatalogAndGet().then((els) => !cancelled && setElements(els))
    return () => {
      cancelled = true
    }
  }, [])

  const matches = useMemo(() => matchTagElements(elements, search), [elements, search])

  if (elements === null) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
        <Loader2 className="size-4 animate-spin" />
        {t('Loading tags...')}
      </div>
    )
  }

  if (matches.length === 0) {
    return (
      <div className="text-muted-foreground mt-4 text-center text-sm">{t('No matching tags')}</div>
    )
  }

  return (
    <div>
      {matches.map((el) => (
        <TagElementRow key={el.coordinate} element={el} />
      ))}
    </div>
  )
}
