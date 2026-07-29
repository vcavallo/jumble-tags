import NotFound from '@/components/NotFound'
import TagBrowseContent, { TTagBrowseTab } from '@/components/TagBrowseContent'
import Username from '@/components/Username'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { userIdToPubkey } from '@/lib/pubkey'
import { TTagPageData } from '@/services/tagging.service'
import { Tag as TagIcon } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { forwardRef, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * The tag page (F5): everything tagged with one tag, addressed by the tag
 * coordinate — /tags/<author>/<slug> (author as npub or hex; an naddr for the
 * kind-39999 tag-element is accepted as /tags/<naddr>). The selected tab is
 * kept in the URL (?tab=notes|people) so a specific view is shareable.
 */
const TagPage = forwardRef(
  ({ author, slug, index }: { author?: string; slug?: string; index?: number }, ref) => {
    const { t } = useTranslation()
    const [element, setElement] = useState<TTagPageData['element']>(null)

    const initialTab = useMemo<TTagBrowseTab | undefined>(() => {
      const tab = new URLSearchParams(window.location.search).get('tab')
      return tab === 'people' || tab === 'notes' ? tab : undefined
    }, [])

    const handleTabChange = useCallback((tab: TTagBrowseTab) => {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', tab)
      const newUrl = url.pathname + url.search + url.hash
      // Keep the PageManager's {index, url} history state intact so back/forward
      // rebuilds this page (with the chosen tab) instead of losing its place.
      const state = window.history.state
      window.history.replaceState(state ? { ...state, url: newUrl } : state, '', newUrl)
    }, [])

    const tagId = useMemo(() => {
      if (!author) return null
      try {
        if (author.startsWith('naddr')) {
          const { type, data: decoded } = nip19.decode(author)
          if (type !== 'naddr' || decoded.kind !== 39999) return null
          return { pubkey: decoded.pubkey, slug: decoded.identifier }
        }
        if (!slug) return null
        // userIdToPubkey returns its input on decode failure — reject anything
        // that is not a real pubkey so a bad URL 404s instead of half-rendering.
        const pubkey = userIdToPubkey(author)
        if (!/^[0-9a-f]{64}$/.test(pubkey)) return null
        return { pubkey, slug: decodeURIComponent(slug) }
      } catch {
        return null
      }
    }, [author, slug])

    if (!tagId) {
      return (
        <SecondaryPageLayout index={index} title={t('Tag')} ref={ref}>
          <NotFound />
        </SecondaryPageLayout>
      )
    }

    const title = element?.name ?? tagId.slug

    return (
      <SecondaryPageLayout index={index} title={title} displayScrollToTopButton ref={ref}>
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2">
            <TagIcon className="text-muted-foreground size-5 shrink-0" />
            <div className="truncate text-xl font-semibold" dir="auto">
              {title}
            </div>
          </div>
          {element?.description && (
            <div className="text-muted-foreground mt-1 text-sm" dir="auto">
              {element.description}
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
        <TagBrowseContent
          tagAuthorPubkey={tagId.pubkey}
          slug={tagId.slug}
          initialTab={initialTab}
          onTabChange={handleTabChange}
          onDataLoaded={(data) => setElement(data.element)}
        />
      </SecondaryPageLayout>
    )
  }
)
TagPage.displayName = 'TagPage'
export default TagPage
