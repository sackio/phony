import {
    ELEVENLABS_API_KEY,
    ELEVENLABS_DEFAULT_AGENT_ID,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID,
} from '../../config/constants.js';

/**
 * NativeElevenLabsService — wraps the ElevenLabs-managed Twilio outbound API.
 *
 * `POST /v1/convai/twilio/outbound-call` (https://elevenlabs.io/docs/api-reference/twilio/outbound-call)
 *
 * In native mode, ElevenLabs handles the entire call lifecycle:
 * Twilio call creation, media-stream WebSocket, audio routing, hangup,
 * recording. Phony doesn't run any WebSocket bridge for these calls.
 * Trade-off: we lose direct DTMF / mid-call context-injection control on the
 * native path — that's by design in the hybrid plan; advanced calls still go
 * through the Phase-1-optimized WebSocket path.
 *
 * We persist the resulting `conversation_id` + `callSid` so the post-call
 * webhook can link the transcript back to a Call row.
 */

const API_URL = 'https://api.elevenlabs.io/v1/convai/twilio/outbound-call';

export interface NativeOutboundCallInput {
    /** E.164 destination, e.g. "+11234567890". */
    toNumber: string;

    /** Override the agent's default system prompt. The agent's `System prompt`
     *  override must be enabled in the Security tab for this to take effect. */
    systemInstructions?: string;

    /** Override the agent's first message — what it says when the call connects.
     *  Requires the `First message` override toggle. */
    firstMessage?: string;

    /** Override the TTS voice ID. Requires the `Voice` override toggle. */
    voiceId?: string;

    /** Variables interpolated into the agent's prompt template via `{{name}}`. */
    dynamicVariables?: Record<string, string>;

    /** Override which agent handles this call. Defaults to ELEVENLABS_DEFAULT_AGENT_ID. */
    agentId?: string;

    /** Override which Twilio phone number (in ElevenLabs) hosts the call.
     *  Defaults to ELEVENLABS_AGENT_PHONE_NUMBER_ID. */
    agentPhoneNumberId?: string;

    /** Whether Twilio records the call. Defaults to false. */
    recordingEnabled?: boolean;
}

export interface NativeOutboundCallResult {
    success: boolean;
    message: string;
    conversationId: string | null;
    callSid: string | null;
}

export class NativeElevenLabsService {
    /**
     * Create an outbound call via the native ElevenLabs Twilio integration.
     * Throws on missing config or non-2xx HTTP response.
     */
    public async createOutboundCall(input: NativeOutboundCallInput): Promise<NativeOutboundCallResult> {
        if (!ELEVENLABS_API_KEY) {
            throw new Error('ELEVENLABS_API_KEY is not set');
        }
        const agentId = input.agentId || ELEVENLABS_DEFAULT_AGENT_ID;
        if (!agentId) {
            throw new Error('No agent_id configured (set ELEVENLABS_DEFAULT_AGENT_ID or pass agentId)');
        }
        const phoneNumberId = input.agentPhoneNumberId || ELEVENLABS_AGENT_PHONE_NUMBER_ID;
        if (!phoneNumberId) {
            throw new Error('No agent_phone_number_id configured (set ELEVENLABS_AGENT_PHONE_NUMBER_ID or pass agentPhoneNumberId)');
        }
        if (!input.toNumber) {
            throw new Error('toNumber is required');
        }

        const body: Record<string, unknown> = {
            agent_id: agentId,
            agent_phone_number_id: phoneNumberId,
            to_number: input.toNumber,
        };

        // Build conversation_initiation_client_data only if there's something
        // to override. ElevenLabs ignores absent fields gracefully.
        const initData = this.buildInitiationData(input);
        if (initData) body.conversation_initiation_client_data = initData;

        if (input.recordingEnabled !== undefined) {
            body.call_recording_enabled = input.recordingEnabled;
        }

        console.log('[NativeEL] Creating outbound call:', JSON.stringify({
            to: input.toNumber,
            agent_id: agentId,
            agent_phone_number_id: phoneNumberId,
            has_init_data: !!initData,
        }));

        const res = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': ELEVENLABS_API_KEY,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15_000),
        });

        const text = await res.text();
        let parsed: any;
        try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { _raw: text }; }

        if (!res.ok) {
            const detail = parsed?.detail || parsed?.message || text || `HTTP ${res.status}`;
            console.error(`[NativeEL] Outbound call failed: HTTP ${res.status} — ${detail}`);
            throw new Error(`ElevenLabs outbound-call failed: ${detail}`);
        }

        const result: NativeOutboundCallResult = {
            success: !!parsed.success,
            message: parsed.message || '',
            conversationId: parsed.conversation_id ?? null,
            callSid: parsed.callSid ?? parsed.call_sid ?? null,
        };
        console.log(`[NativeEL] Outbound call accepted: callSid=${result.callSid} conversation_id=${result.conversationId}`);
        return result;
    }

    private buildInitiationData(input: NativeOutboundCallInput): Record<string, unknown> | null {
        const override: Record<string, unknown> = {};
        const agentOverride: Record<string, unknown> = {};
        const ttsOverride: Record<string, unknown> = {};

        if (input.systemInstructions) {
            agentOverride.prompt = { prompt: input.systemInstructions };
        }
        if (input.firstMessage) {
            agentOverride.first_message = input.firstMessage;
        }
        if (input.voiceId) {
            ttsOverride.voice_id = input.voiceId;
        }

        if (Object.keys(agentOverride).length > 0) override.agent = agentOverride;
        if (Object.keys(ttsOverride).length > 0) override.tts = ttsOverride;

        const hasOverride = Object.keys(override).length > 0;
        const hasDynamicVars = input.dynamicVariables && Object.keys(input.dynamicVariables).length > 0;
        if (!hasOverride && !hasDynamicVars) return null;

        const data: Record<string, unknown> = { type: 'conversation_initiation_client_data' };
        if (hasOverride) data.conversation_config_override = override;
        if (hasDynamicVars) data.dynamic_variables = input.dynamicVariables;
        return data;
    }
}
