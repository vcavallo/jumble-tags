import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DEFAULT_TAG_RELAY_URLS, getTagRelayUrls, setTagRelayUrls } from '@/lib/tagging/config'
import { isWebsocketUrl, normalizeUrl } from '@/lib/url'
import { CircleX } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import RelayIcon from '../RelayIcon'

/** Settings editor for the tag-hub relay list (GO.md §3 — user-editable, persisted). */
export default function TagRelaysSetting() {
  const { t } = useTranslation()
  const [relayUrls, setRelayUrls] = useState<string[]>(getTagRelayUrls())
  const [newRelayUrl, setNewRelayUrl] = useState('')
  const [newRelayUrlError, setNewRelayUrlError] = useState<string | null>(null)

  const removeRelayUrl = (url: string) => {
    const newUrls = relayUrls.filter((u) => u !== url)
    setRelayUrls(newUrls)
    setTagRelayUrls(newUrls)
  }

  const saveNewRelayUrl = () => {
    if (newRelayUrl === '') return
    const normalizedUrl = normalizeUrl(newRelayUrl)
    if (!normalizedUrl || !isWebsocketUrl(normalizedUrl)) {
      return setNewRelayUrlError(t('Invalid relay URL'))
    }
    if (relayUrls.includes(normalizedUrl)) {
      return setNewRelayUrlError(t('Relay already exists'))
    }
    const newUrls = [...relayUrls, normalizedUrl]
    setRelayUrls(newUrls)
    setTagRelayUrls(newUrls)
    setNewRelayUrl('')
  }

  const handleRelayUrlInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      saveNewRelayUrl()
    }
  }

  const resetToDefault = () => {
    setRelayUrls(DEFAULT_TAG_RELAY_URLS)
    setTagRelayUrls([])
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-base font-normal">{t('Tag relays')}</Label>
        <Button variant="outline" size="sm" onClick={resetToDefault}>
          {t('Reset to default')}
        </Button>
      </div>
      <div className="text-muted-foreground text-xs">
        {t(
          'Relays used for decentralized tags. Tag reads and publishes always include these in addition to your own relays.'
        )}
      </div>
      <div className="mt-1">
        {relayUrls.map((url, index) => (
          <div key={index} className="flex items-center justify-between py-1 ps-1 pe-3">
            <div className="flex w-0 flex-1 items-center gap-3">
              <RelayIcon url={url} className="h-4 w-4" />
              <div className="text-muted-foreground truncate text-sm">{url}</div>
            </div>
            <div className="shrink-0">
              <CircleX
                size={16}
                onClick={() => removeRelayUrl(url)}
                className="text-muted-foreground hover:text-destructive cursor-pointer"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Input
          className={newRelayUrlError ? 'border-destructive' : ''}
          placeholder={t('Add a new relay')}
          value={newRelayUrl}
          onKeyDown={handleRelayUrlInputKeyDown}
          onChange={(e) => {
            setNewRelayUrl(e.target.value)
            setNewRelayUrlError(null)
          }}
          onBlur={saveNewRelayUrl}
        />
        <Button onClick={saveNewRelayUrl}>{t('Add')}</Button>
      </div>
      {newRelayUrlError && <div className="text-destructive mt-1 text-xs">{newRelayUrlError}</div>}
    </div>
  )
}
