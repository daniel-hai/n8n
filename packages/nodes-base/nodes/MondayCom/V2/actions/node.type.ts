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
	doc:
		| 'addDocContent'
		| 'createDoc'
		| 'createDocBlock'
		| 'deleteDoc'
		| 'deleteDocBlocks'
		| 'duplicateDoc'
		| 'exportDocAsMarkdown'
		| 'getDoc'
		| 'getDocBlocks'
		| 'getDocs'
		| 'importDocFromHtml'
		| 'renameDoc'
		| 'searchDocsAccount'
		| 'updateDocBlock';
	file: 'addFileToColumn' | 'downloadFile' | 'getAssets';
	form:
		| 'activateOrDeactivateForm'
		| 'createForm'
		| 'createFormQuestion'
		| 'createFormTag'
		| 'deleteFormQuestion'
		| 'deleteFormTag'
		| 'getForm'
		| 'setFormPassword'
		| 'shortenFormUrl'
		| 'updateForm'
		| 'updateFormQuestion'
		| 'updateFormSettings';
	folder:
		| 'createFolder'
		| 'deleteFolder'
		| 'getFolders'
		| 'getWorkspaceObjects'
		| 'moveObject'
		| 'updateFolder';
	graphql: 'getLimits' | 'graphql';
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
	notification: 'createNotification';
	team: 'getTeam' | 'getTeamMembers' | 'getTeams';
	update: 'addFileToUpdate' | 'createUpdate' | 'getUpdates' | 'searchUpdatesAccount';
	user: 'getMe' | 'getUser' | 'getUserActivityLogs' | 'getUsers' | 'searchUsersAccount';
	workspace: 'searchWorkspacesAccount';
};

export type MondayComType = AllEntities<NodeMap>;

/**
 * Bulk Import runs once for all input items. File: Download returns binary
 * data. The router runs both outside the per-item JSON dispatch.
 */
export type MondayComPerItemType = Exclude<
	MondayComType,
	{ resource: 'item'; operation: 'bulkImport' } | { resource: 'file'; operation: 'downloadFile' }
>;
