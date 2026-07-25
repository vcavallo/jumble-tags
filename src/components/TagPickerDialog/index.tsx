import ResponsiveDialog from '@/components/ResponsiveDialog'
import SearchInput from '@/components/SearchInput'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useNoteTags, useProfileTags } from '@/hooks/useTargetTags'
import { slug as slugify } from '@/lib/tagging/sdk/event-tagging/index.js'
import taggingService, { TTagApplicability, TTagElement } from '@/services/tagging.service'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Tag as TagIcon,
  ThumbsDown
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TTagStanceInput, TTagStanceTarget, useTagStance } from '../TagChips/useTagStance'

/**
 * The tag picker (F2/F4): search existing tags, apply one to the target note
 * or profile, or create a brand-new tag on the fly. Tags are split into
 * "Content tags" and "Profile tags" via the house applicability lists (with
 * the SDK's hint-scan fallback) — the target-relevant section leads, the other
 * stays reachable because applicability is a hint, not a gate.
 *
 * Two modes:
 *  - apply (pass `target`): picking a tag publishes the stance immediately.
 *  - select (pass `onSelect` + `selectContext`): picking a tag hands it back to
 *    the caller without publishing — used by the composer, which applies the
 *    chosen tags after the note lands on relays.
 */
export default function TagPickerDialog({
  open,
  onOpenChange,
  target,
  selectContext,
  onSelect
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target?: TTagStanceTarget
  selectContext?: 'event' | 'pubkey'
  onSelect?: (tagInput: TTagStanceInput, displayName: string) => void
}) {
  const { t } = useTranslation()
  const { applyStance, busy } = useTagStance()
  const [query, setQuery] = useState('')
  const [elements, setElements] = useState<TTagElement[] | null>(null)
  const [applicability, setApplicability] = useState<TTagApplicability | null>(null)
  const [showOtherSection, setShowOtherSection] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagDescription, setNewTagDescription] = useState('')
  // Apply-mode stance: picking a tag can apply it (+1, default) or dispute it
  // (−1) — the only way to dispute a tag that has no visible chip yet.
  const [stanceMode, setStanceMode] = useState<'apply' | 'dispute'>('apply')
  const polarity = stanceMode === 'dispute' ? -1 : 1

  const noteState = useNoteTags(target?.type === 'event' ? target.event : undefined)
  const profileState = useProfileTags(target?.type === 'pubkey' ? target.pubkey : undefined)
  const myStances = useMemo(() => {
    const state = target?.type === 'event' ? noteState : target ? profileState : undefined
    const map = new Map<string, 'apply' | 'dispute'>()
    state?.chips.forEach((chip) => {
      if (chip.mine) map.set(chip.coordinate, chip.mine)
    })
    return map
  }, [target, noteState, profileState])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setCreating(false)
      setNewTagName('')
      setNewTagDescription('')
      setShowOtherSection(false)
      setStanceMode('apply')
      return
    }
    let cancelled = false
    // Serve the cache instantly, then replace with a fresh relay read so tags
    // minted moments ago by others appear immediately.
    taggingService.getAllTagElements().then((els) => !cancelled && setElements(els))
    taggingService.refreshCatalogAndGet().then((els) => !cancelled && setElements(els))
    taggingService.getApplicability().then((sets) => !cancelled && setApplicability(sets))
    return () => {
      cancelled = true
    }
  }, [open])

  const leadingContext = target
    ? target.type === 'event'
      ? 'event'
      : 'pubkey'
    : (selectContext ?? 'event')
  const { leading, other, exactMatch } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const qSlug = q ? slugify(q) : ''
    const filtered = (elements ?? []).filter(
      (el) =>
        !q ||
        el.name.toLowerCase().includes(q) ||
        el.slug.includes(qSlug || q) ||
        el.description.toLowerCase().includes(q)
    )
    const leadingSet = leadingContext === 'event' ? applicability?.event : applicability?.pubkey
    const leading: TTagElement[] = []
    const other: TTagElement[] = []
    for (const el of filtered) {
      if (leadingSet?.has(el.coordinate)) {
        leading.push(el)
      } else {
        other.push(el)
      }
    }
    const exactMatch =
      !!q && (elements ?? []).some((el) => el.name.toLowerCase() === q || el.slug === qSlug)
    return { leading, other, exactMatch }
  }, [elements, applicability, query, leadingContext])

  const applyExisting = (element: TTagElement) => {
    const tagInput = {
      authorPubkey: element.authorPubkey,
      slug: element.slug,
      eventId: element.eventId
    }
    if (onSelect) {
      onSelect(tagInput, element.name)
      onOpenChange(false)
      return
    }
    if (!target) return
    applyStance(target, tagInput, polarity, () => onOpenChange(false))
  }

  const createAndApply = () => {
    const name = newTagName.trim()
    if (!name) return
    const tagInput = { name, description: newTagDescription.trim() }
    if (onSelect) {
      onSelect(tagInput, name)
      onOpenChange(false)
      return
    }
    if (!target) return
    applyStance(target, tagInput, polarity, () => {
      onOpenChange(false)
    })
  }

  const startCreating = () => {
    setNewTagName(query.trim())
    setCreating(true)
  }

  const renderElement = (element: TTagElement) => {
    const stance = myStances.get(element.coordinate)
    return (
      <button
        key={element.coordinate}
        className="hover:bg-accent flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start transition-colors disabled:opacity-50"
        disabled={busy}
        onClick={() => applyExisting(element)}
      >
        <TagIcon className="text-muted-foreground size-4 shrink-0" />
        <div className="min-w-0 flex-1" dir="auto">
          <div className="truncate text-sm font-medium">{element.name}</div>
          {element.description && (
            <div className="text-muted-foreground truncate text-xs">{element.description}</div>
          )}
        </div>
        {stance === 'apply' && <Check className="text-primary size-4 shrink-0" />}
        {stance === 'dispute' && <ThumbsDown className="text-destructive size-4 shrink-0" />}
      </button>
    )
  }

  const leadingTitle = leadingContext === 'event' ? t('Content tags') : t('Profile tags')
  const otherTitle = leadingContext === 'event' ? t('Profile tags') : t('Content tags')

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      {/* min-w-0: DialogContent is a grid — without this the nowrap (truncate)
          rows inflate the auto track past the dialog width. */}
      <div className="min-w-0 space-y-3">
        <DialogTitle className="text-lg font-semibold">
          {onSelect
            ? t('Add tags')
            : target?.type === 'pubkey'
              ? t('Tag this profile')
              : t('Tag this note')}
        </DialogTitle>
        {!onSelect && (
          <Tabs
            value={stanceMode}
            onValueChange={(value) => setStanceMode(value as 'apply' | 'dispute')}
          >
            <TabsList className="grid h-8 w-full grid-cols-2">
              <TabsTrigger value="apply" className="h-6 gap-1 text-xs">
                <Check className="size-3" />
                {t('Apply')}
              </TabsTrigger>
              <TabsTrigger
                value="dispute"
                className="data-[state=active]:text-destructive h-6 gap-1 text-xs"
              >
                <ThumbsDown className="size-3" />
                {t('Dispute')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        {creating ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">{t('Name')}</div>
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder={t('Tag name')}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground text-sm">{t('Description (optional)')}</div>
              <Textarea
                value={newTagDescription}
                onChange={(e) => setNewTagDescription(e.target.value)}
                placeholder={t('What is this tag for?')}
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => setCreating(false)}>
                {t('Back')}
              </Button>
              <Button
                variant={!onSelect && stanceMode === 'dispute' ? 'destructive' : 'default'}
                disabled={busy || !newTagName.trim()}
                onClick={createAndApply}
              >
                {busy && <Loader2 className="animate-spin" />}
                {onSelect
                  ? t('Add tag')
                  : stanceMode === 'dispute'
                    ? t('Create & dispute')
                    : t('Create & apply')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Search tags')}
            />
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {elements === null ? (
                <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  {t('Loading tags...')}
                </div>
              ) : (
                <>
                  {query.trim() && !exactMatch && (
                    <button
                      className="hover:bg-accent text-primary flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start text-sm font-medium transition-colors disabled:opacity-50"
                      disabled={busy}
                      onClick={startCreating}
                    >
                      <Plus className="size-4 shrink-0" />
                      {t('Create tag "{{name}}"', { name: query.trim() })}
                    </button>
                  )}
                  <div>
                    <div className="text-muted-foreground px-2 pb-1 text-xs font-semibold uppercase">
                      {leadingTitle}
                    </div>
                    {leading.length > 0 ? (
                      leading.map(renderElement)
                    ) : (
                      <div className="text-muted-foreground px-2 py-2 text-sm">
                        {t('No matching tags')}
                      </div>
                    )}
                  </div>
                  <div>
                    <button
                      className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 px-2 pb-1 text-xs font-semibold uppercase transition-colors"
                      onClick={() => setShowOtherSection((prev) => !prev)}
                    >
                      {otherTitle} ({other.length})
                      {showOtherSection ? (
                        <ChevronUp className="size-3" />
                      ) : (
                        <ChevronDown className="size-3" />
                      )}
                    </button>
                    {showOtherSection &&
                      (other.length > 0 ? (
                        other.map(renderElement)
                      ) : (
                        <div className="text-muted-foreground px-2 py-2 text-sm">
                          {t('No matching tags')}
                        </div>
                      ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </ResponsiveDialog>
  )
}
