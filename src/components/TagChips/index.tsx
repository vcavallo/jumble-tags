import TagPickerDialog from '@/components/TagPickerDialog'
import { useNoteTags, useProfileTags } from '@/hooks/useTargetTags'
import { slug as slugify } from '@/lib/tagging/sdk/event-tagging/index.js'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { isChipVisible } from '@/services/tagging.service'
import { Ellipsis, Plus, Tag as TagIcon } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AllHashtagsDialog from './AllHashtagsDialog'
import LegacyHashtagChip from './LegacyHashtagChip'
import TagChip from './TagChip'

const MAX_LEGACY_HASHTAGS = 10

/**
 * The compact tag chip row for a note (feed card + thread view): counted
 * decentralized-tag chips first, then the author's legacy `#hashtags` (dashed)
 * as the bridge into decentralized tagging. A hashtag whose slug matches a
 * visible decentralized chip is folded into that chip (shown with a `#` mark)
 * instead of rendering twice. Hashtag-heavy (spammy) notes overflow into a
 * searchable dialog where EVERY hashtag can be applied or disputed.
 */
export function NoteTagChips({ event, className }: { event: Event; className?: string }) {
  const { t } = useTranslation()
  const state = useNoteTags(event)
  const [allHashtagsOpen, setAllHashtagsOpen] = useState(false)
  const chips = state?.chips.filter(isChipVisible) ?? []

  const hashtags = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const tag of event.tags) {
      if (tag[0] !== 't' || !tag[1]?.trim()) continue
      const hashtag = tag[1].trim()
      const key = slugify(hashtag)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(hashtag)
    }
    return out
  }, [event])

  const chipSlugs = new Set(chips.map((chip) => chip.tag.slug))
  const legacyHashtags = hashtags.filter((hashtag) => !chipSlugs.has(slugify(hashtag)))
  const shownLegacyHashtags = legacyHashtags.slice(0, MAX_LEGACY_HASHTAGS)
  const overflowCount = legacyHashtags.length - shownLegacyHashtags.length
  const hashtagSlugs = new Set(hashtags.map((hashtag) => slugify(hashtag)))

  if (chips.length === 0 && legacyHashtags.length === 0) return null

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {chips.map((chip) => (
        <TagChip
          key={chip.coordinate}
          chip={chip}
          target={{ type: 'event', event }}
          hashtagged={hashtagSlugs.has(chip.tag.slug)}
        />
      ))}
      {shownLegacyHashtags.map((hashtag) => (
        <LegacyHashtagChip key={hashtag} hashtag={hashtag} event={event} />
      ))}
      {overflowCount > 0 && (
        <>
          <button
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex items-center gap-0.5 rounded-full border border-dashed px-2 py-0.5 text-xs transition-colors"
            title={t('All hashtags')}
            onClick={() => setAllHashtagsOpen(true)}
          >
            <Ellipsis className="size-3" />+{overflowCount}
          </button>
          <AllHashtagsDialog
            open={allHashtagsOpen}
            onOpenChange={setAllHashtagsOpen}
            hashtags={hashtags}
            event={event}
          />
        </>
      )}
    </div>
  )
}

/** The decentralized-tag chip row for a profile, with the "add tag" entry point. */
export function ProfileTagChips({ pubkey, className }: { pubkey: string; className?: string }) {
  const { t } = useTranslation()
  const { checkLogin } = useNostr()
  const state = useProfileTags(pubkey)
  const [pickerOpen, setPickerOpen] = useState(false)
  const chips = state?.chips.filter(isChipVisible) ?? []

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {chips.map((chip) => (
        <TagChip key={chip.coordinate} chip={chip} target={{ type: 'pubkey', pubkey }} />
      ))}
      <button
        className="text-muted-foreground hover:bg-accent hover:text-foreground flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs transition-colors"
        onClick={() => checkLogin(() => setPickerOpen(true))}
      >
        {chips.length === 0 ? <TagIcon className="size-3" /> : <Plus className="size-3" />}
        {t('Tag')}
      </button>
      <TagPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        target={{ type: 'pubkey', pubkey }}
      />
    </div>
  )
}
