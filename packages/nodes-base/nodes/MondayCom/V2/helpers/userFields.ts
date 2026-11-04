/**
 * Standard user profile, shared by User: Get and User: Get Many. In API
 * 2026-10, kind replaces is_admin/is_guest/is_view_only, status replaces
 * enabled/is_pending, and photo_url replaces the flat photo_* fields.
 */
const USER_FIELDS = `
	id
	name
	email
	title
	kind
	status
	created_at
	last_activity
	phone
	mobile_phone
	location
	time_zone_identifier
	url
	photo_url { thumb_small }
	teams { id name }
`;

/** Extra profile fields behind the Include Extended Info option. */
const USER_EXTENDED_FIELDS = `
	account_id
	became_active_at
	birthday
	country_code
	current_language
	invitation_method
	is_deleted
	is_email_confirmed
	serial_number
	utc_hours_diff
	out_of_office { active disable_notifications end_date start_date type }
	user_config { kind role_id visibility }
`;

export function buildUserFieldSelection(includeExtended: boolean): string {
	if (!includeExtended) return USER_FIELDS;
	// Extended mode also returns every photo size.
	return (
		USER_FIELDS.replace(
			'photo_url { thumb_small }',
			'photo_url { original small thumb thumb_small tiny }',
		) + USER_EXTENDED_FIELDS
	);
}
