import type { AllEntities } from 'n8n-workflow';

type NodeMap = {
	agent: 'replyToMention' | 'sendChatMessage';
	board:
		| 'aggregateBoardData'
		| 'archiveOrDeleteBoard'
		| 'createBoard'
		| 'duplicateBoard'
		| 'getBoard'
		| 'getBoards'
		| 'getActivityLogs'
		| 'getBoardSubscribers'
		| 'searchBoardsAccount'
		| 'updateBoardSubscribers';
	column:
		| 'addColumnLabel'
		| 'createColumn'
		| 'createOrGetTag'
		| 'deleteColumn'
		| 'getColumns'
		| 'updateColumn'
		| 'updateColumnLabel';
	group: 'archiveOrDeleteGroup' | 'createGroup' | 'duplicateGroup' | 'getGroups' | 'updateGroup';
	item:
		| 'archiveOrDeleteItem'
		| 'bulkImport'
		| 'clearColumnValues'
		| 'createItem'
		| 'duplicateItem'
		| 'getItem'
		| 'getBulkImportStatus'
		| 'getColumnValue'
		| 'getItems'
		| 'getItemSubscribers'
		| 'moveItem'
		| 'searchItemsAccount'
		| 'updateItem';
	team: 'getTeam' | 'getTeamMembers' | 'getTeams';
	update: 'addFileToUpdate' | 'createUpdate' | 'getUpdates' | 'searchUpdatesAccount';
	user: 'getMe' | 'getUser' | 'getUserActivityLogs' | 'getUsers' | 'searchUsersAccount';
};

export type MondayComType = AllEntities<NodeMap>;

/** Bulk Import runs once for all input items, so the per-item dispatch excludes it. */
export type MondayComPerItemType = Exclude<
	MondayComType,
	{ resource: 'item'; operation: 'bulkImport' }
>;
