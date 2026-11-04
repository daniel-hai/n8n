import { searchBoards } from '../helpers/boardLocator';
import {
	getAggregateGroupByColumns,
	getAggregateMinMaxColumns,
	getAggregateNumericColumns,
	getBoardColumns,
	getBoardLabelColumns,
	getBulkImportMatchColumns,
	getClearableBoardColumns,
	getColumnLabels,
	getFilterableBoardColumns,
	getFilterOperators,
	getTargetBoardColumns,
} from '../helpers/columnOptions';
import { getBulkImportColumnFields, getColumnFields } from '../helpers/columnMapper';
import { searchDocs } from '../helpers/docLocator';
import {
	getBoardList,
	getCreateBoardWorkspaceFolders,
	getCreateFolderParentList,
	getFolderList,
	getMoveDestinationFolderList,
	getUpdateFolderParentList,
	getWorkspaceFolders,
	getWorkspaces,
} from '../helpers/filterOptions';
import { getBoardGroups, getTargetBoardGroups, searchGroups } from '../helpers/groupLocator';
import { searchItems } from '../helpers/itemLocator';
import {
	getTeamsList,
	searchTeams,
	searchUsers,
	searchUsersAndTeams,
} from '../helpers/userLocator';
import { searchWorkspaces } from '../helpers/workspaceLocator';

export const methods = {
	listSearch: {
		searchBoards,
		searchDocs,
		searchGroups,
		searchItems,
		searchTeams,
		searchUsers,
		searchUsersAndTeams,
		searchWorkspaces,
	},
	loadOptions: {
		getAggregateGroupByColumns,
		getAggregateMinMaxColumns,
		getAggregateNumericColumns,
		getBoardColumns,
		getBoardGroups,
		getBoardLabelColumns,
		getBoardList,
		getBulkImportMatchColumns,
		getClearableBoardColumns,
		getColumnLabels,
		getCreateBoardWorkspaceFolders,
		getCreateFolderParentList,
		getFilterableBoardColumns,
		getFilterOperators,
		getFolderList,
		getMoveDestinationFolderList,
		getTargetBoardColumns,
		getTargetBoardGroups,
		getTeamsList,
		getUpdateFolderParentList,
		getWorkspaceFolders,
		getWorkspaces,
	},
	resourceMapping: {
		getBulkImportColumnFields,
		getColumnFields,
	},
};
