import type { IDataObject } from 'n8n-workflow';

import { safeJsonParse } from './json';

export interface ActivityLogRow extends IDataObject {
	id?: string;
	event?: string;
	entity?: string;
	data?: string | null;
	user_id?: string;
	account_id?: string;
	created_at?: string;
}

/**
 * Shapes one activity log event: the `data` field arrives as a JSON string
 * (parsed here for the user), and `created_at` is a 17-digit UNIX timestamp
 * in ten-millionths of a second (converted to ISO in `createdAt`).
 */
export function formatActivityLogRow(row: ActivityLogRow): IDataObject {
	let parsedData: unknown = row.data ?? null;
	if (typeof row.data === 'string') {
		const parsed = safeJsonParse(row.data);
		if (parsed !== undefined) parsedData = parsed;
	}
	let createdAt: string | null = null;
	if (row.created_at) {
		const numeric = Number(row.created_at);
		if (!Number.isNaN(numeric) && numeric > 0) {
			createdAt = new Date(numeric / 10000).toISOString();
		}
	}
	return {
		id: row.id ?? null,
		event: row.event ?? null,
		entity: row.entity ?? null,
		userId: row.user_id ?? null,
		accountId: row.account_id ?? null,
		createdAt,
		createdAtRaw: row.created_at ?? null,
		data: parsedData as IDataObject,
	};
}
