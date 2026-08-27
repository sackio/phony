import { MCPToolDefinition, MCPToolHandler } from '../types.js';
import { createToolResponse, createToolError, validateArgs, sanitizePhoneNumber } from '../utils.js';
import { CallTranscriptService } from '../../services/database/call-transcript.service.js';
import { TwilioCallService } from '../../services/twilio/call.service.js';
import { CallStateService } from '../../services/call-state.service.js';
import { SessionManagerService } from '../../services/session-manager.service.js';
import { NativeElevenLabsService } from '../../services/elevenlabs/native.service.js';
import { CallEventPushService } from '../../services/call-event-push.service.js';

/**
 * Singleton instance — Phase 2 native integration wrapper. Stateless; safe to share.
 */
const nativeElevenLabs = new NativeElevenLabsService();

/**
 * Merge the in-memory transcript of a still-running call over the stored one.
 *
 * ⛔ Do NOT go back to reading Mongo alone here. Transcript lines accumulate in
 * CallStateService's in-memory Map (call-state.service.ts:74) and are flushed to
 * Mongo only on hold and at call end — so for the whole duration of a healthy
 * call the stored `conversationHistory` is `[]`. That empty array is BYTE-
 * IDENTICAL to the one a failed call returns, and on 2026-08-27 a caller read it
 * as "the call is dead" and hung up on a live conversation with a rep who was
 * actioning the request. The tool did not merely hide the work; it induced the
 * caller to destroy it.
 *
 * So: return the live lines when they exist, and — just as important — say which
 * source answered and whether the call is still running, so that "nothing yet"
 * can never again be mistaken for "nothing ever".
 */
function resolveLiveTranscript(
    callSid: string,
    stored: Array<{ role: string; content: string; timestamp?: Date }> | undefined
): {
    messages: Array<{ role: string; content: string; timestamp?: Date }>;
    source: 'live' | 'stored';
    isLive: boolean;
    note?: string;
} {
    const storedMessages = stored || [];
    const active = CallStateService.getInstance().getCall(callSid);

    if (!active) {
        return { messages: storedMessages, source: 'stored', isLive: false };
    }

    const liveMessages = active.conversationHistory || [];
    // The live buffer is authoritative while the call runs; a flush (hold) can
    // make the stored copy briefly longer, so take whichever has more.
    const useLive = liveMessages.length >= storedMessages.length;
    const messages = useLive ? liveMessages : storedMessages;

    return {
        messages,
        source: useLive ? 'live' : 'stored',
        isLive: true,
        note: messages.length === 0
            ? `Call ${callSid} is ACTIVE (status: ${active.status}) and has produced no transcript lines yet. This is the normal state of a call that is ringing, sitting in an IVR, or waiting on hold — it is NOT evidence the call failed. Judge liveness by status and duration, and do not hang up on an empty transcript.`
            : `Live transcript from the in-progress call (status: ${active.status}). It is not written to the database until the call ends.`
    };
}

/**
 * Call Management Tools
 */

export const callToolsDefinitions: MCPToolDefinition[] = [
    {
        name: 'phony_create_call',
        description: 'Create an outbound phone call with an ElevenLabs AI voice assistant. Two modes: "advanced" (default) — Phony hosts a WebSocket bridge with mid-call control (DTMF for IVR navigation, mid-call context injection); works on the typical business number that has an IVR. "native" — ElevenLabs hosts the call end-to-end via /v1/convai/twilio/outbound-call (lowest latency, simplest), opt-in via mode:"native"; lacks DTMF preflight, so any IVR will likely strand the call. Use native only when you know the line is human-answered.',
        inputSchema: {
            type: 'object',
            properties: {
                toNumber: {
                    type: 'string',
                    description: 'Phone number to call in E.164 format (e.g., +12125551234)'
                },
                systemInstructions: {
                    type: 'string',
                    description: 'Base system instructions defining the AI assistant role and behavior. LENGTH: this and callInstructions travel in the Twilio webhook URL, which is capped at 4000 characters AFTER percent-encoding (~40% inflation on prose). Keep the two together under ~1,700-1,800 raw characters or the call is rejected before it dials.'
                },
                callInstructions: {
                    type: 'string',
                    description: 'Specific instructions for this particular call. In native mode this becomes the agent\'s first_message override (what it says when the call connects). ⚠️ LINE 1 IS SPOKEN VERBATIM as the opening utterance — including any label or quotation marks you put around it. Writing `Open: "Hi, I\'m calling on behalf of Ben"` makes the agent say the word "Open" and the quotes out loud. Put the literal first sentence on line 1, unlabelled and unquoted, and keep directions to the agent on later lines. Also: read reference and confirmation numbers ONE DIGIT AT A TIME — reps routinely cannot take them spoken as whole numbers.'
                },
                mode: {
                    type: 'string',
                    enum: ['native', 'advanced'],
                    description: 'Which call architecture to use. "advanced" (default): Phony WebSocket bridge — supports DTMF preflight (IVR navigation) and mid-call context injection; reliable on any number that may have an IVR. "native": ElevenLabs hosts the call end-to-end — lowest latency, simplest, but NO sendDigits preflight (an IVR will likely strand the call). Use native only when you know the line is human-answered.'
                },
                contextChannel: {
                    type: 'string',
                    description: 'Optional Slack channel ID or ATC session id. Phony streams the call transcript + status updates to this channel, and any human/agent message arriving there during the call becomes a mid-call context injection ("operator note") delivered to the AI. The originating agent typically passes its own session id so it can watch and steer the call. Native mode receives this as a dynamic_variable; the agent can reference it via tools.'
                },
                dtmfPreflight: {
                    type: 'string',
                    description: 'Advanced mode ONLY. DTMF digits dialed by Twilio at the carrier level immediately after the called party answers, BEFORE the AI media stream connects. Use this for IVR menu navigation: Twilio generates real DTMF tones (much more reliable than audio injection). Format: digits 0-9 / * / # / w (half-second pause). Example: "wwww2" pauses 2s then presses 2 to navigate Weston Nurseries\' "design/install/delivery" menu option. Chain multiple options like "wwww2wwww1". Native mode ignores this.'
                },
                dtmfScript: {
                    type: 'array',
                    description: 'Advanced mode ONLY. Mid-call DTMF for sub-menus encountered AFTER the AI has been talking. For initial IVR navigation use `dtmfPreflight` instead (more reliable). Each entry fires at `at` milliseconds after the media stream connects. Note: mid-call DTMF goes via media-stream audio injection which some IVR detectors miss; prefer `dtmfPreflight` when possible. Format: [{at:3000,digits:"2"}].',
                    items: {
                        type: 'object',
                        properties: {
                            at: { type: 'number', description: 'Milliseconds after media-stream start when this DTMF fires' },
                            digits: { type: 'string', description: 'DTMF digits to send (0-9, *, #, A-D, w = 0.5s pause, W = 1s pause)' }
                        },
                        required: ['at', 'digits']
                    }
                },
                elevenLabsAgentId: {
                    type: 'string',
                    description: 'ElevenLabs agent ID (uses default if not specified)'
                },
                elevenLabsVoiceId: {
                    type: 'string',
                    description: 'ElevenLabs voice ID. Choose natural, conversational voices - avoid dramatic/performative ones. RECOMMENDED Natural Female: Sarah (EXAVITQu4vr4xnSDxMaL, professional), Alice (Xb7hH8MSUJpSbSDYk0k2, professional), Rachel (21m00Tcm4TlvDq8ikWAM, warm narrative), Nicole (piTKgcLEGmPE4e6mEKli, natural). RECOMMENDED Natural Male: Chris (iP95p4xoKVk53GoZ742B, conversational), Charlie (IKne3meq5aSn9XLyUdCD, conversational), Dave (CYw3kZ02Hs0563khs1Fj, casual), Daniel (onwK4e9ZLuTAKqWW03F9, professional), James (ZQe5CZNOzWyzPSCn5a3c, authoritative). Other options - Female: Matilda (XrExE9yKIg1WjnnlVkGX), Lily (pFZP5JQG7iQjIQuC4Bku), Grace (oWAxZDx7w5VEj9dCyTzz), Freya (jsCqWAovK2LkecY7zXl4). Male: Brian (nPczCjzI2devNBz1zQrb), Bill (pqHfZKP75CvOlQylNhV4), Adam (pNInz6obpgDQGcFmaJgB), Drew (29vD33N1CtxCmqQRPOHJ). AVOID dramatic voices: Charlotte, Arnold, Callum, Clyde, Fin, Gigi, Glinda, Harry, Jessie, Mimi, Patrick.'
                },
                recordingEnabled: {
                    type: 'boolean',
                    description: 'When true, Twilio records both sides of the call (dual-channel) from answer to hangup. Useful for IVR debugging (verify our DTMF tones actually reach the line) and for probe calls that map IVR menu timing. Default false. Recording URL accessible via twilioClient.calls(sid).recordings.list() post-call.'
                }
            },
            required: ['toNumber', 'systemInstructions', 'callInstructions']
        }
    },
    {
        name: 'phony_list_calls',
        description: 'List call history with optional filtering',
        inputSchema: {
            type: 'object',
            properties: {
                limit: {
                    type: 'number',
                    description: 'Maximum number of calls to return (default: 50)'
                },
                status: {
                    type: 'string',
                    description: 'Filter by status',
                    enum: ['initiated', 'in-progress', 'completed', 'failed', 'on_hold', 'active']
                },
                callType: {
                    type: 'string',
                    description: 'Filter by call type',
                    enum: ['inbound', 'outbound']
                }
            }
        }
    },
    {
        name: 'phony_get_call',
        description: 'Get detailed information about a specific call including transcript and events',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID (e.g., CA1234567890abcdef)'
                }
            },
            required: ['callSid']
        }
    },
    {
        name: 'phony_hold_call',
        description: 'Put an active call on hold',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID'
                }
            },
            required: ['callSid']
        }
    },
    {
        name: 'phony_resume_call',
        description: 'Resume a call that is on hold',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID'
                }
            },
            required: ['callSid']
        }
    },
    {
        name: 'phony_hangup_call',
        description: 'End an active call',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID'
                }
            },
            required: ['callSid']
        }
    },
    {
        name: 'phony_extend_call',
        description: 'Push back the automatic hangup on a live call. Use when a call is genuinely still going and about to hit its time limit — you normally get a call.expiring_soon event ~90s beforehand. The extension is NOT granted just because you asked: the call must prove it is still alive (someone must have spoken in the last 60s) and Twilio must confirm it is in-progress, with a hard ceiling and a cap on how many times one call can be extended. A refusal always says which check failed; treat it as a signal the call may be dead rather than something to retry.',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID'
                },
                minutes: {
                    type: 'number',
                    description: 'Minutes to add, 1 to 5. Prefer small bumps — a call that needs more can extend again once it has re-proven it is alive.'
                }
            },
            required: ['callSid', 'minutes']
        }
    },
    {
        name: 'phony_inject_context',
        description: 'Inject additional instructions/context into an active call',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID'
                },
                context: {
                    type: 'string',
                    description: 'Instructions or context to inject into the conversation'
                }
            },
            required: ['callSid', 'context']
        }
    },
    {
        name: 'phony_request_operator_context',
        description: 'Put the call on hold and request additional context from the human operator. The call will remain on hold until the operator provides the requested information.',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID'
                },
                question: {
                    type: 'string',
                    description: 'The question or request for the operator. Be specific about what information you need. Example: "What is the customer\'s account balance?" or "Does the customer have any pending orders?"'
                }
            },
            required: ['callSid', 'question']
        }
    },
    {
        name: 'phony_send_dtmf',
        description: 'Send DTMF (phone keypad) tones to an active call. Useful for navigating IVR menus, entering codes, or pressing phone buttons.',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID'
                },
                digits: {
                    type: 'string',
                    description: 'DTMF digits to send. Can include: 0-9, *, #, A-D. Use \'w\' for 0.5s pause, \'W\' for 1s pause. Example: "1", "123#", "1w2w3", "*9#"'
                }
            },
            required: ['callSid', 'digits']
        }
    },
    {
        name: 'phony_get_call_transcript',
        description: 'Get the conversation transcript for a call',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID'
                }
            },
            required: ['callSid']
        }
    },
    {
        name: 'phony_delete_call',
        description: 'Delete a call record from the database by its call SID',
        inputSchema: {
            type: 'object',
            properties: {
                callSid: {
                    type: 'string',
                    description: 'Twilio call SID (e.g., CA1234567890abcdef)'
                }
            },
            required: ['callSid']
        }
    },
    {
        name: 'phony_delete_calls',
        description: 'Delete multiple call records from the database matching the given filters. At least one filter is required.',
        inputSchema: {
            type: 'object',
            properties: {
                callType: {
                    type: 'string',
                    description: 'Filter by call type',
                    enum: ['inbound', 'outbound']
                },
                status: {
                    type: 'string',
                    description: 'Filter by call status',
                    enum: ['initiated', 'in-progress', 'completed', 'failed']
                },
                startDate: {
                    type: 'string',
                    description: 'Delete calls started after this date (ISO format, e.g., 2024-01-15)'
                },
                endDate: {
                    type: 'string',
                    description: 'Delete calls started before this date (ISO format, e.g., 2024-01-20)'
                }
            }
        }
    },
    {
        name: 'phony_search_calls',
        description: 'Search call records by text content. Searches call context, system instructions, and conversation transcripts.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query text to find in call context, instructions, or transcripts'
                },
                callType: {
                    type: 'string',
                    description: 'Filter by call type',
                    enum: ['inbound', 'outbound']
                },
                phoneNumber: {
                    type: 'string',
                    description: 'Filter by phone number (matches either caller or recipient)'
                },
                status: {
                    type: 'string',
                    description: 'Filter by call status',
                    enum: ['initiated', 'in-progress', 'completed', 'failed']
                },
                startDate: {
                    type: 'string',
                    description: 'Filter calls after this date (ISO format, e.g., 2024-01-15)'
                },
                endDate: {
                    type: 'string',
                    description: 'Filter calls before this date (ISO format, e.g., 2024-01-20)'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of calls to return (default: 50, max: 100)'
                }
            },
            required: ['query']
        }
    },
    {
        name: 'phony_emergency_shutdown',
        description: 'EMERGENCY: Terminate ALL active calls immediately. Use this as a safety measure if calls are running uncontrolled or consuming excessive credits.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        }
    }
];

/**
 * Create tool handlers
 */
export function createCallToolHandlers(
    transcriptService: CallTranscriptService,
    twilioService: TwilioCallService,
    sessionManager: SessionManagerService
): Record<string, MCPToolHandler> {
    return {
        phony_create_call: async (args) => {
            try {
                validateArgs(args, ['toNumber', 'systemInstructions', 'callInstructions']);

                const toNumber = sanitizePhoneNumber(args.toNumber);
                const fromNumber = process.env.TWILIO_NUMBER || '';
                // Default to `advanced` so any IVR-gated business line has a
                // chance of being navigated (dtmfPreflight, dtmfScript, and
                // mid-call DTMF via play_keypad_touch_tone all live there).
                // `native` remains opt-in for the niche "let ElevenLabs host
                // everything" use case.
                const mode: 'native' | 'advanced' = args.mode === 'native' ? 'native' : 'advanced';
                const contextChannel = args.contextChannel ? String(args.contextChannel) : undefined;

                if (mode === 'native') {
                    // Native path: ElevenLabs hosts the call end-to-end. We just POST
                    // to their outbound-call API and persist the resulting Call row;
                    // there's no WebSocket bridge to set up on our side.
                    const dynamicVariables: Record<string, string> = {
                        from_number: fromNumber,
                        to_number: toNumber,
                        source: 'phony',
                    };
                    if (contextChannel) dynamicVariables.context_channel = contextChannel;

                    const result = await nativeElevenLabs.createOutboundCall({
                        toNumber,
                        systemInstructions: args.systemInstructions,
                        firstMessage: args.callInstructions,
                        voiceId: args.elevenLabsVoiceId,
                        agentId: args.elevenLabsAgentId,
                        dynamicVariables,
                    });

                    if (!result.callSid) {
                        return createToolError('Native outbound call failed', { detail: result.message || 'no callSid returned' });
                    }

                    // Persist the Call row with conversation_id so the post-call webhook
                    // can link the transcript back. callType is "outbound" per the model.
                    const { CallModel } = await import('../../models/call.model.js');
                    await CallModel.create({
                        callSid: result.callSid,
                        fromNumber,
                        toNumber,
                        callType: 'outbound',
                        voiceProvider: 'elevenlabs',
                        voice: '',
                        elevenLabsAgentId: args.elevenLabsAgentId,
                        elevenLabsVoiceId: args.elevenLabsVoiceId,
                        elevenLabsConversationId: result.conversationId ?? undefined,
                        callMode: 'native',
                        systemInstructions: args.systemInstructions,
                        callInstructions: args.callInstructions,
                        startedAt: new Date(),
                        status: 'initiated',
                        conversationHistory: [],
                        twilioEvents: [],
                        openaiEvents: [],
                        tags: contextChannel ? [`context-channel:${contextChannel}`] : [],
                    }).catch(err => console.error('[phony_create_call/native] Failed to persist Call:', err));

                    return createToolResponse({
                        callSid: result.callSid,
                        conversationId: result.conversationId,
                        status: 'initiated',
                        mode: 'native',
                        contextChannel: contextChannel ?? null,
                        message: `Call initiated to ${toNumber} (ElevenLabs native, conv=${result.conversationId})`,
                    });
                }

                // Advanced path: our WebSocket bridge. Supports DTMF + context injection.
                // dtmfPreflight: passed to Twilio call.create as `sendDigits` — Twilio
                //   generates real DTMF at the carrier level RIGHT after answer,
                //   before the media stream. Reliable for IVR navigation.
                // dtmfScript: mid-call DTMF scheduled via setTimeout, injected as audio
                //   into the Twilio media stream. Less reliable; use only for sub-menus
                //   after the AI is talking.
                const dtmfScriptJson = Array.isArray(args.dtmfScript) && args.dtmfScript.length > 0
                    ? JSON.stringify(args.dtmfScript)
                    : undefined;

                // Explicit dtmfPreflight from the caller wins. If absent, fall back
                // to the per-number IVR registry — barge-in-disabled IVRs that have
                // been probed previously will auto-navigate to an operator without
                // the caller needing to know the timing.
                let dtmfPreflight = typeof args.dtmfPreflight === 'string' && args.dtmfPreflight.length > 0
                    ? String(args.dtmfPreflight)
                    : undefined;
                let registryHit: string | undefined;
                if (!dtmfPreflight) {
                    try {
                        const { IvrPreflightModel } = await import('../../models/ivr-preflight.model.js');
                        const entry = await IvrPreflightModel.findOne({ phoneNumber: toNumber, enabled: true }).lean();
                        if (entry?.preflight) {
                            dtmfPreflight = entry.preflight;
                            registryHit = `${entry.preflight} (registry, gen=${entry.generation}${entry.derivedFrom ? `, from ${entry.derivedFrom}` : ''})`;
                            console.log(`[phony_create_call] Auto-applied IVR preflight for ${toNumber}: ${entry.preflight.slice(0, 60)}…`);
                        }
                    } catch (err) {
                        console.error('[phony_create_call] IVR registry lookup failed:', err);
                    }
                }

                const recordingEnabled = args.recordingEnabled === true;

                const result = await twilioService.makeOutboundCall(
                    toNumber,
                    args.systemInstructions,
                    args.callInstructions,
                    args.elevenLabsAgentId,
                    args.elevenLabsVoiceId,
                    undefined, // fromNumber
                    dtmfScriptJson,
                    dtmfPreflight,
                    recordingEnabled,
                );

                const callStateService = CallStateService.getInstance();
                callStateService.addCall(result.sid, {
                    callSid: result.sid,
                    twilioCallSid: result.sid,
                    toNumber: toNumber,
                    fromNumber: fromNumber,
                    callType: 'outgoing',
                    voiceProvider: 'elevenlabs',
                    elevenLabsAgentId: args.elevenLabsAgentId,
                    elevenLabsVoiceId: args.elevenLabsVoiceId,
                    contextChannel: contextChannel,
                    status: 'initiated',
                    startedAt: new Date(),
                    conversationHistory: []
                });

                callStateService.startDurationTimer(result.sid);

                // Start pushing live progress to whichever session is driving
                // this call, so it does not have to poll. Started unconditionally:
                // the dispatcher no-ops when no webhook matches, and gating this
                // on contextChannel would mean a mis-set channel silently yields
                // no events at all — the failure being fixed, in a new place.
                CallEventPushService.getInstance().start(result.sid, {
                    toNumber,
                    fromNumber,
                });

                return createToolResponse({
                    callSid: result.sid,
                    status: result.status,
                    mode: 'advanced',
                    contextChannel: contextChannel ?? null,
                    dtmfPreflight: registryHit ?? dtmfPreflight ?? null,
                    recordingEnabled,
                    message: `Call initiated to ${toNumber} (advanced WebSocket bridge${contextChannel ? `, context channel: ${contextChannel}` : ''}${registryHit ? ', IVR registry preflight applied' : ''}${recordingEnabled ? ', recording on' : ''})`
                });
            } catch (error: any) {
                return createToolError('Failed to create call', { message: error.message });
            }
        },

        phony_list_calls: async (args) => {
            try {
                const limit = args.limit || 50;
                let calls = await transcriptService.getRecentCalls(limit);

                // Apply filters
                if (args.status) {
                    calls = calls.filter(call => call.status === args.status);
                }
                if (args.callType) {
                    calls = calls.filter(call => call.callType === args.callType);
                }

                return createToolResponse({
                    calls: calls.map(call => ({
                        callSid: call.callSid,
                        fromNumber: call.fromNumber,
                        toNumber: call.toNumber,
                        callType: call.callType,
                        status: call.status,
                        startedAt: call.startedAt,
                        endedAt: call.endedAt,
                        duration: call.duration
                    })),
                    total: calls.length
                });
            } catch (error: any) {
                return createToolError('Failed to list calls', { message: error.message });
            }
        },

        phony_get_call: async (args) => {
            try {
                validateArgs(args, ['callSid']);

                const call = await transcriptService.getCall(args.callSid);
                if (!call) {
                    return createToolError(`Call not found: ${args.callSid}`);
                }

                const live = resolveLiveTranscript(args.callSid, call.conversationHistory);

                return createToolResponse({
                    call: {
                        _id: call._id,
                        callSid: call.callSid,
                        fromNumber: call.fromNumber,
                        toNumber: call.toNumber,
                        callType: call.callType,
                        status: call.status,
                        conversationHistory: live.messages,
                        transcriptSource: live.source,
                        isLive: live.isLive,
                        transcriptNote: live.note,
                        // ⚠️ twilioEvents are NOT buffered in memory — they are written
                        // only when the call ends. Mid-call this is legitimately empty,
                        // and saying so is the whole point: an empty array here used to
                        // be indistinguishable from a call that produced nothing.
                        twilioEvents: call.twilioEvents,
                        twilioEventsNote: live.isLive
                            ? 'Not available until the call ends; this emptiness says nothing about the call.'
                            : undefined,
                        systemInstructions: call.systemInstructions,
                        callInstructions: call.callInstructions,
                        startedAt: call.startedAt,
                        endedAt: call.endedAt,
                        duration: call.duration,
                        errorMessage: call.errorMessage
                    }
                });
            } catch (error: any) {
                return createToolError('Failed to get call', { message: error.message });
            }
        },

        phony_hold_call: async (args) => {
            try {
                validateArgs(args, ['callSid']);

                // Get call state to retrieve the voice parameter
                const callStateService = CallStateService.getInstance();
                const callState = callStateService.getCall(args.callSid);

                if (!callState) {
                    return createToolError(`Call not found: ${args.callSid}`);
                }

                await twilioService.holdCall(args.callSid);

                // Update call state
                callStateService.updateCallStatus(args.callSid, 'on_hold');

                return createToolResponse({
                    success: true,
                    status: 'on_hold',
                    message: `Call ${args.callSid} is now on hold`
                });
            } catch (error: any) {
                return createToolError('Failed to hold call', { message: error.message });
            }
        },

        phony_resume_call: async (args) => {
            try {
                validateArgs(args, ['callSid']);

                await twilioService.resumeCall(args.callSid);

                // Update call state
                const callStateService = CallStateService.getInstance();
                callStateService.updateCallStatus(args.callSid, 'in-progress');

                return createToolResponse({
                    success: true,
                    status: 'in-progress',
                    message: `Call ${args.callSid} has been resumed`
                });
            } catch (error: any) {
                return createToolError('Failed to resume call', { message: error.message });
            }
        },

        phony_hangup_call: async (args) => {
            try {
                validateArgs(args, ['callSid']);

                await twilioService.endCall(args.callSid);

                return createToolResponse({
                    success: true,
                    message: `Call ${args.callSid} has been ended`
                });
            } catch (error: any) {
                return createToolError('Failed to hangup call', { message: error.message });
            }
        },

        phony_extend_call: async (args) => {
            try {
                validateArgs(args, ['callSid', 'minutes']);

                const result = await CallStateService.getInstance()
                    .extendCall(args.callSid, Number(args.minutes));

                if (!result.granted) {
                    // ⛔ A refusal is a real answer, not an error to retry around.
                    // It carries the specific gate that failed, because the most
                    // useful case — "nobody has spoken for N seconds" — means the
                    // call is probably already dead and the right move is to hang
                    // up and report, not to ask again.
                    return createToolError('Extension refused', {
                        reason: result.reason,
                        extensionsUsed: result.extensionsUsed,
                        guidance: 'Do not retry immediately. If the refusal was for silence, the call is likely dead or the far end has gone — verify with phony_get_call_transcript and hang up rather than waiting for the auto-hangup.',
                    });
                }

                return createToolResponse({
                    success: true,
                    message: `Call ${args.callSid} extended by ${args.minutes} min`,
                    newDurationSec: result.newDurationSec,
                    remainingSec: result.remainingSec,
                    extensionsUsed: result.extensionsUsed,
                    extensionsRemaining: result.extensionsRemaining,
                });
            } catch (error: any) {
                return createToolError('Failed to extend call', { message: error.message });
            }
        },

        phony_inject_context: async (args) => {
            try {
                validateArgs(args, ['callSid', 'context']);

                // Get conversation history from CallStateService
                const callStateService = CallStateService.getInstance();
                const call = callStateService.getCall(args.callSid);

                if (!call) {
                    return createToolError(`Call not found or not active: ${args.callSid}`);
                }

                const conversationHistory = call.conversationHistory || [];

                // Inject context via session manager
                const success = sessionManager.injectContext(
                    args.callSid,
                    args.context,
                    conversationHistory
                );

                if (!success) {
                    return createToolError(`Failed to inject context - call session not found: ${args.callSid}`);
                }

                return createToolResponse({
                    success: true,
                    message: `Context injected into call ${args.callSid}`
                });
            } catch (error: any) {
                return createToolError('Failed to inject context', { message: error.message });
            }
        },

        phony_request_operator_context: async (args) => {
            try {
                validateArgs(args, ['callSid', 'question']);

                const callStateService = CallStateService.getInstance();
                const call = callStateService.getCall(args.callSid);

                if (!call) {
                    return createToolError(`Call not found: ${args.callSid}`);
                }

                // Put the call on hold first
                await twilioService.holdCall(args.callSid);

                // Update call status to on_hold
                callStateService.updateCallStatus(args.callSid, 'on_hold');

                // Store the pending context request
                callStateService.setPendingContextRequest(args.callSid, args.question, 'agent');

                // Emit context request via Socket.IO to notify the frontend
                const SocketService = await import('../../services/socket.service.js').then(m => m.SocketService);
                const socketService = SocketService.getInstance();
                socketService.emitContextRequest(args.callSid, args.question, 'agent');

                return createToolResponse({
                    success: true,
                    status: 'on_hold',
                    message: `Call ${args.callSid} is on hold. Waiting for operator to provide: ${args.question}`,
                    question: args.question
                });
            } catch (error: any) {
                return createToolError('Failed to request operator context', { message: error.message });
            }
        },

        phony_send_dtmf: async (args) => {
            try {
                validateArgs(args, ['callSid', 'digits']);

                // Validate DTMF digits
                const validDTMF = /^[0-9*#A-DwW ]+$/;
                if (!validDTMF.test(args.digits)) {
                    return createToolError('Invalid DTMF digits. Allowed: 0-9, *, #, A-D, w (0.5s pause), W (1s pause)');
                }

                // Get call from CallStateService
                const callStateService = CallStateService.getInstance();
                const call = callStateService.getCall(args.callSid);

                if (!call || !call.twilioCallSid) {
                    return createToolError(`Call not found or not active: ${args.callSid}`);
                }

                // Send DTMF tones via Twilio
                await twilioService.sendDTMF(call.twilioCallSid, args.digits);

                return createToolResponse({
                    success: true,
                    message: `DTMF tones "${args.digits}" sent to call ${args.callSid}`
                });
            } catch (error: any) {
                return createToolError('Failed to send DTMF tones', { message: error.message });
            }
        },

        phony_get_call_transcript: async (args) => {
            try {
                validateArgs(args, ['callSid']);

                const call = await transcriptService.getCall(args.callSid);
                if (!call) {
                    return createToolError(`Call not found: ${args.callSid}`);
                }

                const live = resolveLiveTranscript(args.callSid, call.conversationHistory);

                return createToolResponse({
                    callSid: call.callSid,
                    status: call.status,
                    messages: live.messages,
                    messageCount: live.messages.length,
                    transcriptSource: live.source,
                    isLive: live.isLive,
                    note: live.note
                });
            } catch (error: any) {
                return createToolError('Failed to get transcript', { message: error.message });
            }
        },

        phony_delete_call: async (args) => {
            try {
                validateArgs(args, ['callSid']);

                const success = await transcriptService.deleteCall(args.callSid);

                if (!success) {
                    return createToolError(`Call not found: ${args.callSid}`);
                }

                return createToolResponse({
                    success: true,
                    message: `Call record ${args.callSid} deleted`
                });
            } catch (error: any) {
                return createToolError('Failed to delete call', { message: error.message });
            }
        },

        phony_delete_calls: async (args) => {
            try {
                const options: any = {};

                if (args.callType) options.callType = args.callType;
                if (args.status) options.status = args.status;
                if (args.startDate) options.startDate = new Date(args.startDate);
                if (args.endDate) options.endDate = new Date(args.endDate);

                const hasFilters = args.callType || args.status || args.startDate || args.endDate;
                if (!hasFilters) {
                    return createToolError('At least one filter is required to prevent accidental deletion of all call records');
                }

                const deletedCount = await transcriptService.deleteManyCalls(options);

                return createToolResponse({
                    success: true,
                    message: `Deleted ${deletedCount} call record(s)`,
                    data: { deletedCount }
                });
            } catch (error: any) {
                return createToolError('Failed to delete calls', { message: error.message });
            }
        },

        phony_search_calls: async (args) => {
            try {
                validateArgs(args, ['query']);

                const options: any = { query: args.query.trim() };

                if (args.callType) options.callType = args.callType;
                if (args.status) options.status = args.status;
                if (args.phoneNumber) options.phoneNumber = sanitizePhoneNumber(args.phoneNumber);
                if (args.startDate) options.startDate = new Date(args.startDate);
                if (args.endDate) options.endDate = new Date(args.endDate);
                if (args.limit) options.limit = Math.min(args.limit, 100);

                const calls = await transcriptService.searchCalls(options);

                return createToolResponse({
                    query: args.query,
                    calls: calls.map(call => ({
                        callSid: call.callSid,
                        fromNumber: call.fromNumber,
                        toNumber: call.toNumber,
                        callType: call.callType,
                        status: call.status,
                        callContext: call.callContext,
                        systemInstructions: call.systemInstructions,
                        startedAt: call.startedAt,
                        endedAt: call.endedAt,
                        duration: call.duration,
                        tags: call.tags
                    })),
                    count: calls.length
                });
            } catch (error: any) {
                return createToolError('Failed to search calls', { message: error.message });
            }
        },

        phony_emergency_shutdown: async () => {
            try {
                const PUBLIC_URL = process.env.PUBLIC_URL || '';
                const DYNAMIC_API_SECRET = await import('../../config/constants.js').then(m => m.DYNAMIC_API_SECRET);

                // Call the emergency shutdown endpoint
                const response = await fetch(`${PUBLIC_URL}/api/emergency-shutdown?apiSecret=${DYNAMIC_API_SECRET}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    return createToolError('Emergency shutdown failed', {
                        status: response.status,
                        statusText: response.statusText
                    });
                }

                const result = await response.json();

                return createToolResponse({
                    success: true,
                    message: `Emergency shutdown completed successfully`,
                    terminatedCount: result.terminatedCount,
                    failedCount: result.failedCount,
                    terminatedCalls: result.terminatedCalls,
                    failedCalls: result.failedCalls
                });
            } catch (error: any) {
                return createToolError('Failed to execute emergency shutdown', { message: error.message });
            }
        }
    };
}
