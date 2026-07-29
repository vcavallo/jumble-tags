import { toTagsGuide } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import { Tag as TagIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * The quiet sidebar-footer fork notice: this build carries decentralized tags,
 * with a link to the explainer page.
 */
export default function TagGuideLink({ collapse }: { collapse: boolean }) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()

  if (collapse) {
    return (
      <button
        type="button"
        title={t('How decentralized tags work')}
        className="text-muted-foreground hover:text-foreground flex size-8 cursor-pointer items-center justify-center self-center rounded-full transition-colors hover:bg-background"
        onClick={() => push(toTagsGuide())}
      >
        <TagIcon className="size-4" />
      </button>
    )
  }

  return (
    <div className="text-muted-foreground space-y-0.5 px-2 text-xs">
      <div>{t('A Jumble fork with decentralized tags')}</div>
      <button
        type="button"
        className="text-primary cursor-pointer hover:underline"
        onClick={() => push(toTagsGuide())}
      >
        {t('How decentralized tags work')}
      </button>
    </div>
  )
}
