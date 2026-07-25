import UserAvatar from '@/components/UserAvatar'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toTag } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSecondaryPage } from '@/PageManager'
import { chipNetCount, TTagChipData } from '@/services/tagging.service'
import { ChevronRight, Hash, Tag as TagIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TTagStanceTarget, useTagStance } from './useTagStance'

/**
 * One tag chip. Click opens the stance popover: counts, who applied, a link to
 * the tag page and the viewer's Apply / Dispute actions (latest-wins replace).
 * `hashtagged` marks a decentralized tag the note's author ALSO used as a
 * legacy #hashtag.
 */
export default function TagChip({
  chip,
  target,
  className,
  hashtagged = false
}: {
  chip: TTagChipData
  target: TTagStanceTarget
  className?: string
  hashtagged?: boolean
}) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { applyStance, busy } = useTagStance()
  const [open, setOpen] = useState(false)
  const net = chipNetCount(chip)
  const name = chip.name ?? chip.tag.slug

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
            chip.mine
              ? 'border-primary/60 text-primary bg-primary/10 hover:bg-primary/20'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground bg-muted/40',
            net <= 0 && 'opacity-60',
            className
          )}
          title={chip.description || name}
        >
          <TagIcon className="size-3 shrink-0" />
          {hashtagged && (
            <Hash className="-ms-0.5 size-3 shrink-0 opacity-70">
              <title>{t('Also hashtagged by the author')}</title>
            </Hash>
          )}
          <span
            dir="auto"
            className={cn('truncate', net <= 0 && chip.mine === 'dispute' && 'line-through')}
          >
            {name}
          </span>
          <span className="shrink-0 opacity-70">{net}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3">
        <div className="space-y-3">
          <button
            className="flex w-full items-center justify-between gap-2 text-start"
            onClick={() => {
              setOpen(false)
              push(toTag(chip.tag.authorPubkey, chip.tag.slug))
            }}
          >
            <div className="min-w-0" dir="auto">
              <div className="truncate font-semibold">{name}</div>
              {chip.description && (
                <div className="text-muted-foreground line-clamp-2 text-xs">{chip.description}</div>
              )}
            </div>
            <ChevronRight className="text-muted-foreground size-4 shrink-0 rtl:-scale-x-100" />
          </button>
          <div className="text-muted-foreground text-xs">
            {t('{{count}} applied', { count: chip.applications.length })}
            {chip.disputes.length > 0 &&
              ` · ${t('{{count}} disputed', { count: chip.disputes.length })}`}
          </div>
          {chip.applications.length > 0 && (
            <div className="flex items-center gap-1">
              {chip.applications.slice(0, 6).map((entry) => (
                <UserAvatar key={entry.pubkey} userId={entry.pubkey} size="xSmall" />
              ))}
              {chip.applications.length > 6 && (
                <span className="text-muted-foreground text-xs">
                  +{chip.applications.length - 6}
                </span>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              variant={chip.mine === 'apply' ? 'default' : 'outline'}
              disabled={busy}
              onClick={() => applyStance(target, chip.tag, 1, () => setOpen(false))}
            >
              {chip.mine === 'apply' ? t('Applied') : t('Apply')}
            </Button>
            <Button
              size="sm"
              className="flex-1"
              variant={chip.mine === 'dispute' ? 'destructive' : 'outline'}
              disabled={busy}
              onClick={() => applyStance(target, chip.tag, -1, () => setOpen(false))}
            >
              {chip.mine === 'dispute' ? t('Disputed') : t('Dispute')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
