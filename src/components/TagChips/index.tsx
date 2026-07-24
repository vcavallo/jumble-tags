import TagPickerDialog from '@/components/TagPickerDialog'
import { useNoteTags, useProfileTags } from '@/hooks/useTargetTags'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { isChipVisible } from '@/services/tagging.service'
import { Plus, Tag as TagIcon } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import TagChip from './TagChip'

/** The compact decentralized-tag chip row for a note (feed card + thread view). */
export function NoteTagChips({ event, className }: { event: Event; className?: string }) {
  const state = useNoteTags(event)
  const chips = state?.chips.filter(isChipVisible) ?? []
  if (chips.length === 0) return null

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {chips.map((chip) => (
        <TagChip key={chip.coordinate} chip={chip} target={{ type: 'event', event }} />
      ))}
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
