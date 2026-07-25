import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toNoteList } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import taggingService from '@/services/tagging.service'
import { Hash, Loader2 } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTagStance } from './useTagStance'

/**
 * A legacy `#hashtag` the note's author used, shown as a dashed chip. Clicking
 * offers the bridge into decentralized tagging: "I agree with the author that
 * this applies" → apply the matching decentralized tag (creating it when none
 * exists yet). Once the viewer's tagging lands, the read pipeline replaces
 * this chip with the counted decentralized chip.
 */
export default function LegacyHashtagChip({ hashtag, event }: { hashtag: string; event: Event }) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { applyStance, busy } = useTagStance()
  const [open, setOpen] = useState(false)
  const [resolving, setResolving] = useState(false)

  // Agree (+1) or dispute (−1) the author's hashtag as a decentralized tagging.
  const takeStance = async (polarity: 1 | -1) => {
    if (busy || resolving) return
    setResolving(true)
    try {
      const { input } = await taggingService.resolveTagInputForHashtag(hashtag)
      await applyStance({ type: 'event', event }, input, polarity, () => setOpen(false))
    } finally {
      setResolving(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex max-w-full items-center gap-0.5 rounded-full border border-dashed px-2 py-0.5 text-xs transition-colors"
          title={t("Author's hashtag")}
        >
          <Hash className="size-3 shrink-0" />
          <span className="truncate" dir="auto">
            {hashtag}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3">
        <div className="space-y-3">
          <div className="min-w-0">
            <div className="truncate font-semibold" dir="auto">
              #{hashtag}
            </div>
            <div className="text-muted-foreground text-xs">
              {t("Author's hashtag — not a decentralized tag yet")}
            </div>
          </div>
          <div className="space-y-2">
            <Button
              size="sm"
              className="w-full"
              disabled={busy || resolving}
              onClick={() => takeStance(1)}
            >
              {(busy || resolving) && <Loader2 className="animate-spin" />}
              {t('Agree & apply as tag')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive w-full"
              disabled={busy || resolving}
              onClick={() => takeStance(-1)}
            >
              {t('Disagree & dispute as tag')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => {
                setOpen(false)
                push(toNoteList({ hashtag }))
              }}
            >
              {t('Browse hashtag')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
