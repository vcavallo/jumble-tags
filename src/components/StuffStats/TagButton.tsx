import TagPickerDialog from '@/components/TagPickerDialog'
import { useNoteTags } from '@/hooks/useTargetTags'
import { useStuff } from '@/hooks/useStuff'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { isChipVisible } from '@/services/tagging.service'
import { Tag } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatCount } from './utils'

/** First-class "add a decentralized tag" action, alongside reply/repost/zap. */
export default function TagButton({ stuff }: { stuff: Event | string }) {
  const { t } = useTranslation()
  const { checkLogin } = useNostr()
  const { event } = useStuff(stuff)
  const state = useNoteTags(event ?? undefined)
  const [open, setOpen] = useState(false)
  const { count, hasMine } = useMemo(() => {
    const chips = state?.chips.filter(isChipVisible) ?? []
    return { count: chips.length, hasMine: chips.some((chip) => chip.mine !== null) }
  }, [state])

  // External content (non-event stuff) is not taggable.
  if (!event) return null

  return (
    <>
      <button
        className={cn(
          'flex h-full cursor-pointer items-center gap-1 pe-3 enabled:hover:text-teal-400',
          hasMine ? 'text-teal-400' : 'text-muted-foreground'
        )}
        onClick={(e) => {
          e.stopPropagation()
          checkLogin(() => {
            setOpen(true)
          })
        }}
        title={t('Add tag')}
      >
        <Tag />
        {count > 0 && <div className="text-sm">{formatCount(count)}</div>}
      </button>
      <TagPickerDialog open={open} onOpenChange={setOpen} target={{ type: 'event', event }} />
    </>
  )
}
