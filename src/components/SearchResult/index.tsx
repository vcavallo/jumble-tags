import { SPECIAL_FEED_ID } from '@/constants'
import { getSearchRelayUrls } from '@/lib/relay'
import { TSearchParams } from '@/types'
import { Tag as TagIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import NormalFeed from '../NormalFeed'
import Profile from '../Profile'
import { ProfileListBySearch } from '../ProfileListBySearch'
import Relay from '../Relay'
import TagBrowseFeed from '../TagBrowseFeed'
import TagSearchResults from '../TagSearchResults'
import TrendingNotes from '../TrendingNotes'
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'

export default function SearchResult({ searchParams }: { searchParams: TSearchParams | null }) {
  if (!searchParams) {
    return <TrendingNotes />
  }
  if (searchParams.type === 'profile') {
    return <Profile id={searchParams.search} />
  }
  if (searchParams.type === 'profiles') {
    return <ProfileListBySearch search={searchParams.search} />
  }
  if (searchParams.type === 'notes') {
    return <NotesAndTagsSearchResult search={searchParams.search} />
  }
  if (searchParams.type === 'hashtag') {
    return <TagBrowseFeed hashtag={searchParams.search} />
  }
  if (searchParams.type === 'nak') {
    return (
      <NormalFeed
        feedId={SPECIAL_FEED_ID.NAK}
        subRequests={[searchParams.request]}
        showRelayCloseReason
      />
    )
  }
  return <Relay url={searchParams.search} />
}

/**
 * The plain-text search result: the note feed, plus a "Tags" section doing a
 * partial-match search over the decentralized tag catalog (the dropdown's
 * "Search tags" entry only resolves an exact slug — this is the actual search).
 */
function NotesAndTagsSearchResult({ search }: { search: string }) {
  const { t } = useTranslation()
  const [section, setSection] = useState<'notes' | 'tags'>('notes')

  return (
    <>
      <div className="px-4 pb-2 pt-1">
        <Tabs value={section} onValueChange={(value) => setSection(value as 'notes' | 'tags')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="notes">{t('Notes')}</TabsTrigger>
            <TabsTrigger value="tags" className="gap-1">
              <TagIcon className="size-3.5" />
              {t('Tags')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {section === 'notes' ? (
        <NormalFeed
          feedId={SPECIAL_FEED_ID.SEARCH}
          subRequests={[{ urls: getSearchRelayUrls(), filter: { search } }]}
          showRelayCloseReason
        />
      ) : (
        <TagSearchResults search={search} />
      )}
    </>
  )
}
