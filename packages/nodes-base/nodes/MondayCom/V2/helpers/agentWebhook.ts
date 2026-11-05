import { isRecord } from '@n8n/utils/is-record';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Agent operations exist only on the preview API version. Do not use this
 * version for the rest of the node.
 */
export const MONDAY_AGENTS_API_VERSION = 'dev';

export const AGENT_TRIGGER_TYPES = ['chat', 'mention', 'assigned'] as const;
export type AgentTriggerType = (typeof AGENT_TRIGGER_TYPES)[number];

const EXTERNAL_AGENT_USER_KIND_RE = /^external_agent(?:_detached)?_member$/;

/** True when the credential is a custom-agent token. */
export function isExternalAgentTokenKind(kind: unknown): boolean {
	return typeof kind === 'string' && EXTERNAL_AGENT_USER_KIND_RE.test(kind);
}

/**
 * The live payload sometimes uses `mentioned` or `assign`. Map both forms
 * onto the canonical type so routing stays stable.
 */
export function normalizeTriggerType(raw: unknown): AgentTriggerType | 'unknown' {
	if (typeof raw !== 'string') return 'unknown';
	const value = raw.toLowerCase().trim();
	if (value === 'chat') return 'chat';
	if (value === 'mention' || value === 'mentioned') return 'mention';
	if (value === 'assigned' || value === 'assign') return 'assigned';
	return 'unknown';
}

/**
 * HMAC-SHA256 over `${timestamp}.${rawBody}` with the agent signing secret.
 * The comparison uses the raw body. A re-serialized body does not match.
 */
export function verifyAgentSignature(
	signingSecret: string,
	rawBody: Buffer | string,
	timestamp: string | undefined,
	signature: string | undefined,
): boolean {
	if (!timestamp || !signature) return false;
	const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
	const expected = `sha256=${createHmac('sha256', signingSecret).update(`${timestamp}.${body}`).digest('hex')}`;
	const expectedBuffer = Buffer.from(expected);
	const receivedBuffer = Buffer.from(signature);
	return (
		expectedBuffer.length === receivedBuffer.length &&
		timingSafeEqual(expectedBuffer, receivedBuffer)
	);
}

/** Immediate webhook acknowledgement. The chat text is sent later by mutation. */
export function buildAgentAck(stream: boolean): {
	body: string | { success: true };
	contentType: string;
} {
	if (!stream) {
		return { body: { success: true }, contentType: 'application/json' };
	}
	return {
		body: 'data: [DONE]\n\n',
		contentType: 'text/event-stream',
	};
}

export function readId(value: unknown): string | undefined {
	if (typeof value === 'string' && value.trim() !== '') return value.trim();
	if (typeof value === 'number') return String(value);
	return undefined;
}

/**
 * The webhook `conversationId` is a signed token (`v1.<claims>.<signature>`). It carries an
 * issue time, so it is different for every message. The `conversationId` claim stays the same.
 * The webhook signature is already checked, so we only read the claim and skip the token signature.
 */
export function readStableConversationId(token: string): string | undefined {
	const claimsPart = token.split('.')[1];
	if (!claimsPart) return undefined;
	try {
		const claims: unknown = JSON.parse(Buffer.from(claimsPart, 'base64url').toString('utf8'));
		return isRecord(claims) ? readId(claims.conversationId) : undefined;
	} catch {
		return undefined;
	}
}

const SECTION_SEPARATOR_RE = /^---\s*$/m;

/**
 * monday prepends instruction sections to the text, split by `---` lines.
 * The user's own message is the last section. Fall back to the full text if empty.
 */
export function extractLastMessage(text: string): string {
	const sections = text.split(SECTION_SEPARATOR_RE);
	const last = sections[sections.length - 1]?.trim() ?? '';
	return last !== '' ? last : text.trim();
}

/**
 * Maps a webhook payload onto the fields the Chat Trigger emits. The AI Agent
 * ("Connected Chat Trigger Node") reads `chatInput`. Memory nodes read `sessionId`.
 * For a mention, `text` is a monday instruction prompt, so use `updateBody`.
 */
export function buildChatFields(
	triggerType: AgentTriggerType,
	payload: Record<string, unknown>,
): { chatInput: string; sessionId: string } {
	const text = typeof payload.text === 'string' ? payload.text : '';
	const updateBody = typeof payload.updateBody === 'string' ? payload.updateBody : '';
	const source = triggerType === 'mention' && updateBody.trim() !== '' ? updateBody : text;
	const chatInput = extractLastMessage(source);

	const conversationToken = readId(payload.conversationId);
	const conversationId = conversationToken
		? (readStableConversationId(conversationToken) ?? conversationToken)
		: undefined;
	const itemId = readId(payload.itemId);
	// A chat has its own conversation. Mentions and assignments share one session for each item.
	const sessionId = conversationId
		? `monday-chat-${conversationId}`
		: itemId
			? `monday-item-${itemId}`
			: 'monday-agent';
	return { chatInput, sessionId };
}

/** Empty selection means every trigger type. Output order stays canonical. */
export function resolveSelectedTriggerTypes(param: unknown): AgentTriggerType[] {
	const selected = Array.isArray(param)
		? param.filter((value): value is string => typeof value === 'string')
		: [];
	const active = AGENT_TRIGGER_TYPES.filter((type) => selected.includes(type));
	return active.length > 0 ? active : [...AGENT_TRIGGER_TYPES];
}

export function readHeader(
	headers: Record<string, string | string[] | undefined>,
	name: string,
): string | undefined {
	const value = headers[name] ?? headers[name.toLowerCase()];
	if (Array.isArray(value)) return value[0];
	return typeof value === 'string' ? value : undefined;
}
