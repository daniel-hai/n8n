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
import { getCustomActivitiesList } from '../helpers/emailsActivities';
import {
	getArticleWorkspaceFolders,
	getBoardList,
	getCreateBoardWorkspaceFolders,
	getCreateFolderParentList,
	getDocWorkspaceFolders,
	getFolderList,
	getFormWorkspaceFolders,
	getMoveDestinationFolderList,
	getProjectWorkspaceFolders,
	getUpdateFolderParentList,
	getWorkspaceFolders,
	getWorkspaces,
} from '../helpers/filterOptions';
import { getFormQuestionsList, getFormTagsList } from '../helpers/forms';
import { getBoardGroups, getTargetBoardGroups, searchGroups } from '../helpers/groupLocator';
import { searchItems } from '../helpers/itemLocator';
import { searchMeetings } from '../helpers/meetings';
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
		searchMeetings,
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
		getArticleWorkspaceFolders,
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
		getCustomActivitiesList,
		getDocWorkspaceFolders,
		getFilterableBoardColumns,
		getFilterOperators,
		getFolderList,
		getFormQuestionsList,
		getFormTagsList,
		getFormWorkspaceFolders,
		getItemColumnFiles,
		getItemUpdatesList,
		getMoveDestinationFolderList,
		getProjectWorkspaceFolders,
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
