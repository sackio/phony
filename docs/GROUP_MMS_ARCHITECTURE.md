# Group MMS Architecture

True group MMS via the Twilio Conversations API. All participants see a
single native group thread on their phones; replies flow back through the
webhook into MongoDB and out to proxy targets (Ben, Laura) as needed.

Verified working on the `feature/true-group-mms` branch, April 2026.
See memo `Twilio Group MMS — Working Configuration (April 2026)`
(id `88aefaf4-b3cd-49e0-a847-a50d4d42a98d`) for the original debugging log.

---

## High-level flow

```
┌──────────────────────────────────────────────────────────────┐
│   External phones                                             │
│   +1-978-555-0103 Murilo                                      │
│   +1-978-555-0104 Junior    ←── native group MMS thread ──┐  │
│   +1-301-555-0101 Ben                                      │  │
│   +1-301-555-0102 Laura                                    │  │
└───────────────────────────────────────────────────────┬────┘  │
                                                       ▼       │
                           ┌───────────────────────────────┐   │
                           │  Twilio Conversations API     │   │
                           │  CH21945a80... "{0101-grp}"   │───┘
                           │                               │
                           │  participants:                │
                           │    identity="phony"           │
                           │      projectedAddress=        │
                           │        +1-857-555-0111        │
                           │    messagingBinding.address=  │
                           │        +1-978-555-0103        │
                           │        +1-978-555-0104        │
                           │        +1-301-555-0101        │
                           │        +1-301-555-0102        │
                           └──────────────┬────────────────┘
                                          │ webhook
                                          ▼
┌──────────────────────────────────────────────────────────────┐
│  Phony voice-server on server4                                │
│    POST /conversations/webhook                                │
│      ├─ onConversationAdded   → registerGroup() + slug        │
│      ├─ onConversationRemoved → unregisterGroup()             │
│      ├─ onParticipantAdded    → updateGroupExternals()        │
│      ├─ onParticipantRemoved  → updateGroupExternals()        │
│      └─ onMessageAdded        → processInboundGroupMessage()  │
│                                                                │
│  processInboundGroupMessage():                                 │
│    1. Dedup by messageSid (SmsModel unique)                   │
│    2. Save as inbound SMS w/ conversationId=CH...             │
│    3. notifyGroupMessage(): fan out to SMS_PROXY_TARGET_      │
│       NUMBERS as 1-on-1 SMS (skip those in the group)         │
└──────────────────────────────────────────────────────────────┘
```

## The participant pattern

The single most important detail: **Twilio only routes a Conversation
as group MMS when the right participant pattern is used.**

| Role | Pattern | Why |
|------|---------|-----|
| Phony (system) | `identity = "phony"` + `messagingBinding.projectedAddress = TWILIO_NUMBER` | Phony acts as the "avatar" — externals see messages from this number |
| Each external | `messagingBinding.address = "+1NPANXXXXXX"` ONLY | No `proxy_address`, no `projected_address`, no `identity`. Twilio reads this as a native SMS participant |

Wrong patterns (learned the hard way):
- `address + proxyAddress` on every participant → Twilio fans out as 1:1,
  no group thread (the April 13, 2026 rollback).
- Setting `messagingServiceSid` on the Conversation → triggers A2P/Address-
  Config mutex (errors 50407, 30034). The Messaging Service MUST NOT be
  attached to the Conversation, even though the Twilio number IS in an MS.

## Account eligibility

Twilio closed Group MMS to new accounts on **2026-03-15**. Any account
created after that date gets "service unavailable" errors. Phony's account
was created 2012-10-03, so it's grandfathered in.

Check via:
```
client.api.v2010.accounts(sid).fetch().then(a => console.log(a.dateCreated))
```

## Twilio Console configuration (one-time)

1. **Messaging Service Integration** (`MGceb3122…` → Integration):
   - Set Incoming Messages = `Autocreate a Conversation`
   - Conversations Service = Default (`MGc0a20feea047e6dd76839c9465e8909d`)

2. **Conversations global webhook** (Conversations → Manage → Global webhooks):
   - Post-Event URL: `https://phony.pushbuild.com/conversations/webhook`
   - Method: POST
   - Filters: `onConversationAdded`, `onConversationRemoved`, `onParticipantAdded`, `onParticipantRemoved`, `onMessageAdded`

Pre-Event webhooks are not used.

## Outbound flow (Phony initiates a group)

`phony_create_group_conversation` MCP tool:
1. `TwilioConversationsService.createGroupConversation(twilioNumber, externals)`:
   - `conversations.v1.conversations.create({friendlyName, uniqueName})` (no `messagingServiceSid`)
   - Add Phony as projectedAddress participant
   - Add each external with `messagingBinding.address` only
2. `TwilioSmsService.registerGroup(convSid, twilioNumber, externals, friendlyName)`:
   - Allocate a slug (`<last4-of-first-external>-grp`, e.g. `0101-grp`)
   - Persist to `GroupConversationModel`
   - Cache slug maps in memory
3. Optional: `postMessage(convSid, initialMessage)` — Twilio fans out as group MMS

`phony_send_group_sms` MCP tool:
- Takes a CH-SID or slug reference
- Optionally uploads media URLs to Twilio MCS (`mcs.us1.twilio.com/v1/Services/default/Media`) and gets back media SIDs
- `postMessage(convSid, body, mediaSids)` → Twilio fans out

## Inbound flow (group message arrives)

1. External sends into the group.
2. Twilio's Autocreate MS Integration intercepts and routes through a
   Conversation — fires our webhook:
   - If first message: `onConversationAdded` (then `onParticipantAdded` per participant, then `onMessageAdded`)
   - If existing Conversation: `onMessageAdded` only
3. `handleConversationsWebhook` responds 200 OK immediately, processes async:
   - `onConversationAdded` → `registerGroup` + notify proxy targets (intro "📥 New group {slug} — …")
   - `onMessageAdded` → `processInboundGroupMessage`:
     - Dedup by `messageSid` (SmsModel unique)
     - `registerGroup` if unknown (handles webhook downtime during autocreate)
     - Save with `conversationId = CH…`
     - `notifyGroupMessage` fan-out to `SMS_PROXY_TARGET_NUMBERS`

## Proxy fan-out and skip rules

Ben and Laura are the two numbers in `SMS_PROXY_TARGET_NUMBERS`. When
group activity happens, Phony sends each of them a 1-on-1 SMS like:

```
📥 {0101-grp} [0103/{murilo}] +19785550103 → group:
Usually railings are white and options for balusters are white vinyl…
---
Reply: {0101-grp}: msg
```

**Skip rules — don't duplicate what they already see natively:**
1. If the proxy target is the message author, skip.
2. If the proxy target is an external participant in the group (they see it
   natively on their phone), skip.
3. Intro/join/leave notifications apply the same skip.

## Reply routing from proxy targets

Ben/Laura reply to Phony's Twilio number with:
```
{0101-grp}: dimensions are 36x42, all black metal
```

Flow:
1. `/sms/incoming` webhook fires (Ben's number is NOT in active groups,
   so the dedup check doesn't block — but Ben IS in this group actually,
   so it would. See caveat below.)
2. `TwilioSmsService.handleIncomingSms` → `handleProxyReply`
3. `parseIncoming` matches `{0101-grp}: msg`
4. Resolve slug → CH-SID via `TwilioSmsService.getGroupSidBySlug`
5. `handleGroupReply` → `conversationsService.postMessage(convSid, msg)` → Twilio fans out as group MMS

**Caveat — the in-group proxy target problem:** If Ben is both a proxy
target AND a group participant, his carrier delivers group messages as
native group MMS, and `handleIncomingSms` skips the 1-on-1 save. That
means his `{0101-grp}: msg` reply command, which comes in as a 1-on-1
SMS to Phony, would also be skipped — breaking the reply command path.

**Fix (implemented):** the dedup check in `handleIncomingSms` only fires
for messages that look like inbound group content, not for messages that
parse as proxy reply commands. Currently this means: if the sender is
`SMS_PROXY_TARGET_NUMBERS` we always process (the `isFromProxyTarget`
branch runs before the group-skip check).

## Reconciliation

Two independent polls every 5 minutes, 24-hour lookback:

1. **SMS reconciliation** (`messages.list({to: twilioNumber, dateSentAfter})`):
   - Per enabled number, capped 500 messages per pass
   - `SmsModel.findOne({messageSid})` dedup
   - Replays via `handleIncomingSms` (which routes to either 1-on-1 or group-skip)

2. **Conversations reconciliation** (`conversations.v1.conversations.list()`):
   - Up to 200 Conversations per pass, filtered by `dateUpdated >= lookback`
   - For each: `conversations(sid).messages.list()` → dedup + replay
   - `processInboundGroupMessage` is idempotent (messageSid unique + E11000 catch)

Both passes are safe to run concurrently with the live webhook.

Override via env:
```
SMS_RECONCILIATION_INTERVAL_MS=300000     # 5 min
SMS_RECONCILIATION_LOOKBACK_MS=86400000   # 24 hr
```

## Backfill

For Conversations that started before autocreate was enabled, or for
outages longer than the reconciler window:

```bash
npx tsx scripts/backfill-conversation.ts CH21945a80e14b454ebfd984d624f601f1 --since 2026-04-20
```

Three steps:
1. `registerGroup` — persist the group + allocate slug from current externals
2. `retagHistoricalSmsForConversation` — update 1-on-1 `SmsModel` rows
   where projected=Twilio# and the other side is a group external,
   setting `conversationId = CH-SID`. Excludes proxy-notification bodies
   (`^📥|^📤|^👥|^Reply formats:|^{.*-grp}`).
3. `backfillConversation` — pull all messages from Twilio's Conversation
   and save any not already in `SmsModel` (skipNotify to avoid a proxy
   SMS storm).

## Data model

```ts
// src/models/group-conversation.model.ts
{
  conversationSid: "CH21945a80e14b454ebfd984d624f601f1",  // unique
  slug: "0101-grp",                                        // unique
  twilioNumber: "+18575550111",
  externalParticipants: ["+19785550103", "+19785550104",
                         "+13015550101", "+13015550102"],
  friendlyName: "Reedy Meadow Project",
  lastActivityAt: ...,
}

// src/models/sms.model.ts (existing, now polymorphic)
{
  messageSid: "IM67aaddfe…",
  conversationId: "CH21945a80…",   // CH-SID for group, conv_… for 1-on-1
  fromNumber: "+19785550104",
  toNumber: "+18575550111",
  direction: "inbound",
  body: "Garage door dimensions: …",
  ...
}
```

## Constraints and limits

- **US/CA long codes only.** +1 numbers. TF, short codes, and non-NANP all fail.
- **3–10 total participants.** Twilio enforces; our code enforces 2–9 externals.
- **Account must predate 2026-03-15.** Twilio's Group MMS lockout is account-wide.
- **Twilio number must be MMS-capable.** Phony's +18575550111 is.
- **Do not attach `messagingServiceSid` to the Conversation** — it re-triggers
  the A2P/Address-Config mutex. Messaging Service membership of the number
  itself is fine and required for A2P.
- **No friendlyName visible on phones.** Native Messages groups don't have a
  shared name field. `friendlyName` is an internal label.
- **Media via MCS.** For MMS in a Conversation, upload to Twilio MCS first
  and reference by media SID. Public URLs don't work for Conversation
  messages the way they do for `messages.create` (Programmable Messaging).
