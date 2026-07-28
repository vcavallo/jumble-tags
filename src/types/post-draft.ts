import { Event } from 'nostr-tools'
import { TEmoji, TPollCreateData, TPostTargetItem } from '.'

export type TPostDraftStatus = 'draft' | 'pending' | 'failed'

export type TPostDraftBase = {
  id: string
  pubkey: string
  createdAt: number
  updatedAt: number
}

/** A decentralized-tag reference chosen in the composer (serializable). */
export type TPendingTagInput =
  | { name: string; description?: string }
  | { authorPubkey: string; slug: string; eventId?: string }

export type TPendingPostTag = { input: TPendingTagInput; displayName: string; key: string }

export type TPostDraftUnsigned = TPostDraftBase & {
  status: 'draft'
  tiptapJson: unknown
  previewEvent?: Event
  text: string
  mentions: string[]
  isNsfw: boolean
  isPoll: boolean
  pollCreateData: TPollCreateData
  addClientTag: boolean
  isAnonymous?: boolean
  isProtectedEvent: boolean
  additionalRelayUrls: string[]
  postTargetItems?: TPostTargetItem[]
  minPow: number
  parentEvent?: Event
  parentEventCoordinate?: string
  defaultContent?: string
  highlightedText?: string
  openFrom?: string[]
  imetaTags: Record<string, string[]>
  customEmojis: Record<string, TEmoji>
  /** Composer-chosen decentralized tags, restored with the draft. */
  pendingTags?: TPendingPostTag[]
}

export type TPostDraftSigned = TPostDraftBase & {
  status: 'pending' | 'failed'
  /** Decentralized tags to apply once the note lands (survives reload/resume). */
  pendingTagInputs?: TPendingTagInput[]
  signedEvent: Event
  targetRelays: string[]
  parentEvent?: Event
  parentEventCoordinate?: string
  highlightedText?: string
  error?: string
  failedAt?: number
}

export type TPostDraft = TPostDraftUnsigned | TPostDraftSigned
