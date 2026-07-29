import Username from '@/components/Username'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { toRelaySettings } from '@/lib/link'
import { formatPubkey } from '@/lib/pubkey'
import {
  getTagRelayUrls,
  HOUSE_INSTANCE,
  LOCAL_TA_PUBKEY,
  NIP85_AUTHOR_PUBKEYS,
  TRUST_RELAY_URLS,
  TRUST_SETTINGS,
  Z_HANDLE_PUBKEYS
} from '@/lib/tagging/config'
import { SecondaryPageLink } from '@/PageManager'
import { Tag as TagIcon } from 'lucide-react'
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * The decentralized-tagging explainer: what tags and taggings are, why counts
 * are a point of view, and exactly which defaults this build ships (all values
 * rendered from the tagging config module — never inlined).
 */
const TagsGuidePage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()

  return (
    <SecondaryPageLayout ref={ref} index={index} title={t('How decentralized tags work')}>
      <div className="space-y-6 px-4 pb-10 text-sm leading-relaxed">
        <div className="flex items-center gap-2 pt-2">
          <TagIcon className="text-muted-foreground size-5 shrink-0" />
          <div className="text-xl font-semibold">{t('How decentralized tags work')}</div>
        </div>

        <p>
          {t(
            'This app is a Jumble fork with decentralized tagging: community-created tags that anyone can apply to notes and profiles. Everything you see is computed from public, cryptographically signed events on relays — there is no central tag database and no moderator deciding what a tag contains.'
          )}
        </p>

        <Section title={t('Tags are created by people, not platforms')}>
          <p>
            {t(
              'A tag is itself a small Nostr event. Anyone can create one, and a tag is identified by its creator plus a slug — so "podcaster" created by Alice and "podcaster" created by Bob are two distinct tags. Tags are shared: once created, everyone applies the same tag, and its page shows everything the network has gathered under it.'
            )}
          </p>
        </Section>

        <Section title={t('Tagging and disputing')}>
          <p>
            {t(
              'Applying a tag publishes a signed assertion: "this note (or this profile) belongs to this tag — says me." Disputing publishes the opposite stance. You always have exactly one live stance per tag and target; applying after disputing (or the reverse) replaces it. Nothing is silently deleted — a dispute is itself a public, signed statement anyone can read.'
            )}
          </p>
        </Section>

        <Section title={t('What you see is a point of view')}>
          <p>
            {t(
              'Anyone can publish taggings, so raw counts would be trivially spammable. Instead, counts are filtered through a web of trust: an assertion only counts when its author is trusted under the point of view (PoV) this app is configured with. There is no global truth — every count is a view from somewhere.'
            )}
          </p>
          <p>
            {t(
              'This build ships the "{{house}}" point of view. Trust scores come from NIP-85 Trusted Assertions (kind 30382) published by that deployment\'s Tapestry Assistant, and an asserter counts when their published rank is at least {{minRank}}.',
              { house: HOUSE_INSTANCE.name, minRank: TRUST_SETTINGS.minRank }
            )}
          </p>
          {TRUST_SETTINGS.unknownPolicy === 'trusted' ? (
            <p>
              {t(
                'People with no published score currently also count — the deployment counts unscored asserters while its trust pipeline matures. Your own stances are always visible to you, trusted or not.'
              )}
            </p>
          ) : (
            <p>{t('Trust filtering is currently off: every asserter counts.')}</p>
          )}
        </Section>

        <Section title={t('Disputed content is hidden, not deleted')}>
          <p>
            {t(
              'A tag page shows what the PoV population endorses: entries with more applies than disputes. Net-disputed notes and profiles move behind a "Show disputed" toggle instead of disappearing — you can always look at what was disputed away and by whom.'
            )}
          </p>
        </Section>

        <Section title={t('Tags vs hashtags')}>
          <p>
            {t(
              'A hashtag is plain text inside one note; a tag is a standalone event with an identity that others can endorse or dispute. Searching a hashtag here offers three views: the decentralized tag\'s endorsed feed, the raw hashtag feed, and a blend where net-disputed notes drop out. Any hashtag can be bridged into a real tag from a note that uses it.'
            )}
          </p>
        </Section>

        <Section title={t('Where the data lives')}>
          <p>
            {t(
              'Tags and taggings are read from and published to the tag-hub relays below in addition to your own relays. Trust artifacts (the kind-30382 assertions) live on the deployment\'s trust relays.'
            )}{' '}
            <SecondaryPageLink to={toRelaySettings()} className="text-primary hover:underline">
              {t('Tag relays')}
            </SecondaryPageLink>
          </p>
        </Section>

        <Section title={t('The baked-in defaults')}>
          <div className="space-y-3">
            <Default label={t('Tag hub relays')}>
              {getTagRelayUrls().map((url) => (
                <div key={url} className="font-mono text-xs">
                  {url}
                </div>
              ))}
            </Default>
            <Default label={t('Trust relays')}>
              {TRUST_RELAY_URLS.map((url) => (
                <div key={url} className="font-mono text-xs">
                  {url}
                </div>
              ))}
            </Default>
            <Default label={t('Reference deployment')}>
              <div className="font-mono text-xs">{HOUSE_INSTANCE.name}</div>
            </Default>
            <Default label={t('Tapestry Assistant (trust list author)')}>
              <div className="flex items-center gap-1">
                <Username
                  userId={LOCAL_TA_PUBKEY}
                  className="max-w-40 truncate text-xs font-semibold"
                  skeletonClassName="h-3"
                />
                <span className="text-muted-foreground font-mono text-xs">
                  {formatPubkey(LOCAL_TA_PUBKEY)}
                </span>
              </div>
            </Default>
            <Default label={t('Honored trust-assertion authors')}>
              {NIP85_AUTHOR_PUBKEYS.map((pubkey) => (
                <div key={pubkey} className="font-mono text-xs">
                  {formatPubkey(pubkey)}
                </div>
              ))}
            </Default>
            <Default label={t('Tag namespaces')}>
              {Z_HANDLE_PUBKEYS.map((pubkey) => (
                <div key={pubkey} className="font-mono text-xs">
                  {formatPubkey(pubkey)}
                </div>
              ))}
            </Default>
            <Default label={t('Trust settings')}>
              <div className="font-mono text-xs">
                {`mode=${TRUST_SETTINGS.mode} minRank=${TRUST_SETTINGS.minRank} maxHops=${TRUST_SETTINGS.maxHops} unknown=${TRUST_SETTINGS.unknownPolicy}`}
              </div>
            </Default>
          </div>
        </Section>

        <p className="text-muted-foreground">
          {t(
            'These defaults define the point of view this build ships with. The protocol itself is open: other deployments can run other points of view over the same public data, and future versions may let you choose your own.'
          )}
        </p>
      </div>
    </SecondaryPageLayout>
  )
})
TagsGuidePage.displayName = 'TagsGuidePage'
export default TagsGuidePage

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-base font-semibold">{title}</div>
      {children}
    </div>
  )
}

function Default({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
        {label}
      </div>
      <div className="mt-0.5 space-y-0.5 break-all">{children}</div>
    </div>
  )
}
