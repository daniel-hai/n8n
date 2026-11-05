import { createHmac } from 'node:crypto';

import {
	buildAgentAck,
	buildChatFields,
	extractLastMessage,
	isExternalAgentTokenKind,
	normalizeTriggerType,
	readId,
	readStableConversationId,
	resolveSelectedTriggerTypes,
	verifyAgentSignature,
} from '../helpers/agentWebhook';

// Two real-shaped tokens for one conversation. Only the issue time (iat) and signature differ.
const claims = (iat: number) =>
	Buffer.from(
		JSON.stringify({
			v: 1,
			accountId: 5,
			agentId: 618564,
			iat,
			surface: 'builder',
			conversationId: 4193717,
		}),
	).toString('base64url');
const TOKEN_A = `v1.${claims(1793866508)}.sig-a`;
const TOKEN_B = `v1.${claims(1793866529)}.sig-b`;

describe('agent webhook helpers', () => {
	it('accepts only custom-agent token kinds', () => {
		expect(isExternalAgentTokenKind('external_agent_member')).toBe(true);
		expect(isExternalAgentTokenKind('external_agent_detached_member')).toBe(true);
		expect(isExternalAgentTokenKind('admin')).toBe(false);
		expect(isExternalAgentTokenKind('member')).toBe(false);
		expect(isExternalAgentTokenKind('personal_agent_member')).toBe(false);
	});

	it('normalizes trigger aliases', () => {
		expect(normalizeTriggerType('mentioned')).toBe('mention');
		expect(normalizeTriggerType('assign')).toBe('assigned');
		expect(normalizeTriggerType('chat')).toBe('chat');
		expect(normalizeTriggerType('other')).toBe('unknown');
	});

	it('verifies the signature over the raw body', () => {
		const secret = 'signing-secret';
		const raw = '{"event":"agent_triggered"}';
		const timestamp = '1782326623754';
		const signature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}`;
		expect(verifyAgentSignature(secret, raw, timestamp, signature)).toBe(true);
		expect(verifyAgentSignature(secret, `${raw} `, timestamp, signature)).toBe(false);
		expect(verifyAgentSignature(secret, raw, undefined, signature)).toBe(false);
	});

	it('acks chat with an empty event stream and other events with JSON', () => {
		expect(buildAgentAck(true)).toEqual({
			body: 'data: [DONE]\n\n',
			contentType: 'text/event-stream',
		});
		expect(buildAgentAck(false)).toEqual({
			body: { success: true },
			contentType: 'application/json',
		});
	});

	it('maps a chat payload to chatInput and sessionId', () => {
		expect(buildChatFields('chat', { text: 'hello', conversationId: TOKEN_A })).toEqual({
			chatInput: 'hello',
			sessionId: 'monday-chat-4193717',
		});
	});

	it('uses the update body for a mention and the item for the session', () => {
		expect(
			buildChatFields('mention', { text: 'monday prompt', updateBody: 'hi agent', itemId: 42 }),
		).toEqual({ chatInput: 'hi agent', sessionId: 'monday-item-42' });
		expect(buildChatFields('mention', { text: 'monday prompt', itemId: '42' }).chatInput).toBe(
			'monday prompt',
		);
	});

	it('keeps only the last section when monday prepends instructions', () => {
		const text = [
			'## Monday Agent Identity',
			'',
			'You are a monday.com platform agent.',
			'',
			'---',
			'',
			'## monday chat UI components',
			'',
			'Use BoardTable for items.',
			'',
			'---',
			'',
			'what did I ask you in the last message?',
		].join('\n');
		expect(buildChatFields('chat', { text, conversationId: TOKEN_A })).toEqual({
			chatInput: 'what did I ask you in the last message?',
			sessionId: 'monday-chat-4193717',
		});
	});

	it('keeps the same sessionId across messages of one conversation', () => {
		const first = buildChatFields('chat', { text: 'a', conversationId: TOKEN_A });
		const second = buildChatFields('chat', { text: 'b', conversationId: TOKEN_B });
		expect(second.sessionId).toBe(first.sessionId);
		expect(readStableConversationId(TOKEN_A)).toBe('4193717');
	});

	it('uses the whole token when the claims cannot be read', () => {
		expect(readStableConversationId('opaque')).toBeUndefined();
		expect(buildChatFields('chat', { text: 'a', conversationId: 'opaque' }).sessionId).toBe(
			'monday-chat-opaque',
		);
	});

	it('reads monday IDs given as numbers or strings', () => {
		expect(readId(123)).toBe('123');
		expect(readId(' 456 ')).toBe('456');
		expect(readId('')).toBeUndefined();
		expect(readId(undefined)).toBeUndefined();
	});

	it('returns the full text when there is no separator', () => {
		expect(extractLastMessage('  plain message  ')).toBe('plain message');
	});

	it('falls back to the full text when the last section is empty', () => {
		expect(extractLastMessage('instructions\n\n---\n\n')).toBe('instructions\n\n---');
	});

	it('falls back to a fixed session when no ids exist', () => {
		expect(buildChatFields('assigned', { text: 'do it' })).toEqual({
			chatInput: 'do it',
			sessionId: 'monday-agent',
		});
	});

	it('treats an empty trigger selection as every type', () => {
		expect(resolveSelectedTriggerTypes([])).toEqual(['chat', 'mention', 'assigned']);
		expect(resolveSelectedTriggerTypes(['mention'])).toEqual(['mention']);
	});
});
