import storage from '@/services/local-storage.service'
import taggingConfig from './CONFIG.json'

/**
 * The single seam between the tagging deployment config (CONFIG.json) and the
 * app. Every pubkey, relay URL and namespace the tagging feature uses comes
 * from here — never inline protocol literals in components or services.
 */

export type TTaggingTrustSettings = {
  mode: string
  minRank: number
  maxHops: number
  unknownPolicy: 'trusted' | 'everyone'
}

/** The deployment's default tag-hub relays (cold-start default, user-editable). */
export const DEFAULT_TAG_RELAY_URLS: string[] = taggingConfig.tagRelays

/** Relays carrying the house's TA-signed trust artifacts (30382 / 3039x). */
export const TRUST_RELAY_URLS: string[] = taggingConfig.trustRelays

/**
 * Concept namespace pubkeys, canonical first — passed as `taPubkeys` /
 * `zHandlePubkeys` to every SDK builder and as `honoredAuthorities` to every
 * classifier.
 */
export const Z_HANDLE_PUBKEYS: string[] = taggingConfig.zHandlePubkeys

/** The house instance's current Tapestry Assistant (authors the applicability lists). */
export const LOCAL_TA_PUBKEY: string = taggingConfig.localTaPubkey

/** The reference deployment this build points at (identity only — never build features on its API). */
export const HOUSE_INSTANCE: { name: string; relay: string } = {
  name: taggingConfig.houseInstance.name,
  relay: taggingConfig.houseInstance.relay
}

/** Keys honored as kind-30382 trust-assertion authors (current TA first, then retired). */
export const NIP85_AUTHOR_PUBKEYS: string[] = taggingConfig.nip85AuthorPubkeys

export const TRUST_SETTINGS: TTaggingTrustSettings = {
  mode: taggingConfig.trust.mode,
  minRank: taggingConfig.trust.minRank,
  maxHops: taggingConfig.trust.maxHops,
  unknownPolicy: taggingConfig.trust.unknownPolicy === 'everyone' ? 'everyone' : 'trusted'
}

/** The tag-hub relay list, honoring the user's Settings override. */
export function getTagRelayUrls(): string[] {
  return storage.getTagRelayUrls() ?? DEFAULT_TAG_RELAY_URLS
}

export function setTagRelayUrls(urls: string[]) {
  storage.setTagRelayUrls(urls)
}
