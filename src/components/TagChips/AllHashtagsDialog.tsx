import ResponsiveDialog from '@/components/ResponsiveDialog'
import SearchInput from '@/components/SearchInput'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import taggingService from '@/services/tagging.service'
import { Hash, Loader2 } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTagStance } from './useTagStance'

/**
 * Every legacy hashtag on a note, searchable, with a bridge stance action per
 * row — the durable way to dispute (or endorse) tags on hashtag-spam notes
 * whose chip row can only show a subset.
 */
export default function AllHashtagsDialog({
  open,
  onOpenChange,
  hashtags,
  event
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  hashtags: string[]
  event: Event
}) {
  const { t } = useTranslation()
  const { applyStance, busy } = useTagStance()
  const [query, setQuery] = useState('')
  const [pendingHashtag, setPendingHashtag] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setPendingHashtag(null)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? hashtags.filter((hashtag) => hashtag.toLowerCase().includes(q)) : hashtags
  }, [hashtags, query])

  const takeStance = async (hashtag: string, polarity: 1 | -1) => {
    if (busy || pendingHashtag) return
    setPendingHashtag(hashtag)
    try {
      const { input } = await taggingService.resolveTagInputForHashtag(hashtag)
      await applyStance({ type: 'event', event }, input, polarity)
    } finally {
      setPendingHashtag(null)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <div className="min-w-0 space-y-3">
        <DialogTitle className="text-lg font-semibold">
          {t('All hashtags')} ({hashtags.length})
        </DialogTitle>
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Search')}
        />
        <div className="max-h-96 space-y-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-muted-foreground px-2 py-4 text-center text-sm">
              {t('No matching tags')}
            </div>
          ) : (
            filtered.map((hashtag) => (
              <div key={hashtag} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5">
                <Hash className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1 truncate text-sm" dir="auto">
                  {hashtag}
                </div>
                {pendingHashtag === hashtag && (
                  <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={busy || pendingHashtag !== null}
                  onClick={() => takeStance(hashtag, 1)}
                >
                  {t('Apply')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive h-7 px-2 text-xs"
                  disabled={busy || pendingHashtag !== null}
                  onClick={() => takeStance(hashtag, -1)}
                >
                  {t('Dispute')}
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </ResponsiveDialog>
  )
}
