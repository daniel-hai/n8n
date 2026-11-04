import { getItemColumnFiles } from '../helpers/assets';
import { searchBoards } from '../helpers/boardLocator';
import {
	getAggregateGroupByColumns,
	getAggregateMinMaxColumns,
	getAggregateNumericColumns,
	getBoardColumns,
	getBoardDocColumns,
	getBoardFileColumns,
	getBoardLabelColumns,
	getBulkImportMatchColumns,
	getClearableBoardColumns,
	getColumnLabels,
	getFilterableBoardColumns,
	getFilterOperators,
	getItemUpdatesList,
	getTargetBoardColumns,
} from '../helpers/columnOptions';
import { getBulkImportColumnFields, getColumnFields } from '../helpers/columnMapper';
import { searchDocs } from '../helpers/docLocator';
import {
	getBoardList,
	getCreateBoardWorkspaceFolders,
	getCreateFolderParentList,
	getDocWorkspaceFolders,
	getFolderList,
	getMoveDestinationFolderList,
	getUpdateFolderParentList,
	getWorkspaceFolders,
	getWorkspaces,
} from '../helpers/filterOptions';
import { getBoardGroups, getTargetBoardGroups, searchGroups } from '../helpers/groupLocator';
import { searchItems } from '../helpers/itemLocator';
import { getApiVersions } from '../helpers/requestInfo';
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
		getApiVersions,
		getBoardColumns,
		getBoardDocColumns,
		getBoardFileColumns,
		getBoardGroups,
		getBoardLabelColumns,
		getBoardList,
		getBulkImportMatchColumns,
		getClearableBoardColumns,
		getColumnLabels,
		getCreateBoardWorkspaceFolders,
		getCreateFolderParentList,
		getDocWorkspaceFolders,
		getFilterableBoardColumns,
		getFilterOperators,
		getFolderList,
		getItemColumnFiles,
		getItemUpdatesList,
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
