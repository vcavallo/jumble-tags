import ResponsiveDialog from '@/components/ResponsiveDialog'
import SearchInput from '@/components/SearchInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useNoteTags, useProfileTags } from '@/hooks/useTargetTags'
import { slug as slugify } from '@/lib/tagging/sdk/event-tagging/index.js'
import taggingService, { TTagApplicability, TTagElement } from '@/services/tagging.service'
import { Check, ChevronDown, ChevronUp, Loader2, Plus, Tag as TagIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TTagStanceTarget, useTagStance } from '../TagChips/useTagStance'

/**
 * The tag picker (F2/F4): search existing tags, apply one to the target note
 * or profile, or create a brand-new tag on the fly. Tags are split into
 * "Content tags" and "Profile tags" via the house applicability lists (with
 * the SDK's hint-scan fallback) — the target-relevant section leads, the other
 * stays reachable because applicability is a hint, not a gate.
 */
export default function TagPickerDialog({
  open,
  onOpenChange,
  target
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: TTagStanceTarget
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

  const noteState = useNoteTags(target.type === 'event' ? target.event : undefined)
  const profileState = useProfileTags(target.type === 'pubkey' ? target.pubkey : undefined)
  const myStances = useMemo(() => {
    const state = target.type === 'event' ? noteState : profileState
    const map = new Map<string, 'apply' | 'dispute'>()
    state?.chips.forEach((chip) => {
      if (chip.mine) map.set(chip.coordinate, chip.mine)
    })
    return map
  }, [target.type, noteState, profileState])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setCreating(false)
      setNewTagName('')
      setNewTagDescription('')
      setShowOtherSection(false)
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

  const leadingContext = target.type === 'event' ? 'event' : 'pubkey'
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
    const leadingSet =
      leadingContext === 'event' ? applicability?.event : applicability?.pubkey
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
    applyStance(
      target,
      { authorPubkey: element.authorPubkey, slug: element.slug, eventId: element.eventId },
      1,
      () => onOpenChange(false)
    )
  }

  const createAndApply = () => {
    const name = newTagName.trim()
    if (!name) return
    applyStance(target, { name, description: newTagDescription.trim() }, 1, () => {
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
      </button>
    )
  }

  const leadingTitle = leadingContext === 'event' ? t('Content tags') : t('Profile tags')
  const otherTitle = leadingContext === 'event' ? t('Profile tags') : t('Content tags')

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <div className="space-y-3">
        <div className="text-lg font-semibold">
          {target.type === 'event' ? t('Tag this note') : t('Tag this profile')}
        </div>
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
              <Button disabled={busy || !newTagName.trim()} onClick={createAndApply}>
                {busy && <Loader2 className="animate-spin" />}
                {t('Create & apply')}
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
