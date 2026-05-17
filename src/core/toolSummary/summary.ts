// src/core/toolSummary/summary.ts
//
// ToolSummary — heuristic-only "tool call collapse" service.
//
// Two pure helpers, both upstream Nuka-Code in origin but free of any
// LLM call, display-component coupling, or singleton dependency:
//
//   1. `summarizeToolInput(input)` — picks the most "interesting" string
//      field from a tool_use input object and returns it, trimmed. This
//      is the label that downstream display code (TUI rows, remote
//      gateway events, recap timelines) puts next to a tool name.
//      Mirrors `summarizeToolInput` in upstream's
//      `remoteControlGateway/remoteEvents.ts`.
//
//   2. `classifyToolForCollapse(toolName)` — answers "is this tool call
//      a search-like or read-like operation?". Used by display code to
//      decide whether several adjacent calls should collapse into a
//      single "Searched / Read X items" group. Tool-name allowlists are
//      lifted verbatim from upstream's
//      `tools/MCPTool/classifyForCollapse.ts`. Names normalize to
//      snake_case before lookup, so camelCase / kebab-case variants of
//      the same MCP tool match the same entry.
//
// Why these two together: they are the *pure* slice of upstream's
// collapse story. Upstream's full `utils/collapseReadSearch.ts` is the
// display-coupled wrapper that combines them with Nuka-Code's Tool /
// Message types and Ink-specific rendering rules; that wrapper is not
// straight-portable. The two pure heuristics ARE portable, and any
// future Nuka display code that wants to collapse tool calls can build
// on them.
//
// The service is pure:
//   - no LLM calls
//   - no I/O
//   - no time / random / global state
//   - parallel-safe, deterministic
//
// Upstream parity caveats:
//   - The two allowlists were collected by upstream as of the source
//     pull. New MCP tools added upstream after that point won't match
//     until the lists are refreshed. A future iter can wire this to
//     dynamic discovery; for now the static lists cover the major
//     hosted + community MCP servers.
//   - We DO NOT export the allowlists. Callers should use
//     `classifyToolForCollapse` so the normalize step is consistent.
//
// Side-effects: none. Read-only, parallel-safe.

/**
 * Result of asking "should this tool call collapse into a search/read
 * group?". A call is collapsible iff at least one of `isSearch` /
 * `isRead` is true. Both can be false (most write/create/update tools).
 * Both should never be true simultaneously — the allowlists are
 * disjoint by construction — but callers should treat that as a soft
 * invariant; `isSearch` wins by convention if it ever happens.
 */
export type CollapseClassification = {
  isSearch: boolean
  isRead: boolean
}

/**
 * Ordered list of input fields the summarizer probes. First non-empty
 * string wins. Order matters: it reflects which field carries the most
 * useful identifying signal for a human glance.
 *
 * - `command` — Bash / shell-style tools where the command line is the
 *   whole story.
 * - `prompt`  — sub-agent tools (Task, dispatch) where the prompt is
 *   what was asked.
 * - `query`   — search tools (Grep, ToolSearch, MCP search_*).
 * - `url`     — fetchers and browser navigation.
 * - `path` / `filePath` / `file_path` / `target_file` — file-touching
 *   tools (Read, Edit, Write, FileSearch).
 * - `trigger_file_path` / `parent_file_path` / `transcript_path` —
 *   hook / orchestration tools that point at a marker file.
 */
const SUMMARY_FIELD_ORDER = [
  'command',
  'prompt',
  'query',
  'url',
  'path',
  'filePath',
  'file_path',
  'target_file',
  'trigger_file_path',
  'parent_file_path',
  'transcript_path',
] as const

/**
 * Pick the most useful identifying string from a tool_use input.
 *
 * Returns the trimmed value of the first matching field in
 * `SUMMARY_FIELD_ORDER`. If no field matches but `input` is non-empty,
 * returns the JSON-serialized form (so the caller at least sees
 * *something* identifying). Returns `null` for missing / empty input.
 *
 * Unicode whitespace is normalized by `.trim()`. Long values are NOT
 * truncated here — that's a display concern, kept out of this pure
 * heuristic. Callers can `slice(0, N)` if they want a hard cap.
 */
export function summarizeToolInput(
  input: Readonly<Record<string, unknown>> | undefined | null,
): string | null {
  if (!input) {
    return null
  }

  for (const key of SUMMARY_FIELD_ORDER) {
    const value = input[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  let serialized: string
  try {
    serialized = JSON.stringify(input)
  } catch {
    return null
  }
  if (!serialized || serialized === '{}') {
    return null
  }
  return serialized
}

/**
 * Allowlist of tool names that should classify as "search" for collapse
 * purposes. Lifted from upstream Nuka-Code's classifyForCollapse.ts.
 * Keys are pre-normalized: snake_case, lowercase. Names are stable
 * across MCP server installs, so we match on tool name alone (server
 * name is intentionally ignored).
 */
// prettier-ignore
const SEARCH_TOOLS: ReadonlySet<string> = new Set([
  // Slack
  'slack_search_public',
  'slack_search_public_and_private',
  'slack_search_channels',
  'slack_search_users',
  // GitHub
  'search_code',
  'search_repositories',
  'search_issues',
  'search_pull_requests',
  'search_orgs',
  'search_users',
  // Linear / Sentry (overlap)
  'search_documentation',
  'search_docs',
  // Datadog
  'search_logs',
  'search_spans',
  'search_rum_events',
  'search_audit_logs',
  'search_monitors',
  'search_monitor_groups',
  'find_slow_spans',
  'find_monitors_matching_pattern',
  // Sentry
  'search_events',
  'search_issue_events',
  'find_organizations',
  'find_teams',
  'find_projects',
  'find_releases',
  'find_dsns',
  // Notion
  'search',
  // Gmail
  'gmail_search_messages',
  // Google Drive
  'google_drive_search',
  // Google Calendar
  'gcal_find_my_free_time',
  'gcal_find_meeting_times',
  'gcal_find_user_emails',
  // Atlassian/Jira
  'search_jira_issues_using_jql',
  'search_confluence_using_cql',
  'lookup_jira_account_id',
  'confluence_search',
  'jira_search',
  'jira_search_fields',
  // Asana
  'asana_search_tasks',
  'asana_typeahead_search',
  // Filesystem
  'search_files',
  // Memory
  'search_nodes',
  // Brave
  'brave_web_search',
  'brave_local_search',
  // Grafana
  'search_dashboards',
  'search_folders',
  // Stripe
  'search_stripe_resources',
  'search_stripe_documentation',
  // PubMed
  'search_articles',
  'find_related_articles',
  'lookup_article_by_citation',
  'search_papers',
  'search_pubmed',
  'search_pubmed_key_words',
  'search_pubmed_advanced',
  'pubmed_search',
  'pubmed_mesh_lookup',
  // Firecrawl
  'firecrawl_search',
  // Exa
  'web_search_exa',
  'web_search_advanced_exa',
  'people_search_exa',
  'linkedin_search_exa',
  'deep_search_exa',
  // Perplexity
  'perplexity_search',
  'perplexity_search_web',
  // Tavily
  'tavily_search',
  // Obsidian
  'obsidian_simple_search',
  'obsidian_complex_search',
  // MongoDB
  'find',
  'search_knowledge',
  // Neo4j
  'search_memories',
  'find_memories_by_name',
  // Airtable
  'search_records',
  // Todoist
  'find_tasks',
  'find_tasks_by_date',
  'find_completed_tasks',
  'find_sections',
  'find_comments',
  'find_project_collaborators',
  'find_activity',
  'find_labels',
  'find_filters',
  // AWS
  'search_catalog',
  // Terraform
  'search_modules',
  'search_providers',
  'search_policies',
])

/**
 * Allowlist of tool names that should classify as "read" for collapse
 * purposes. Lifted from upstream Nuka-Code's classifyForCollapse.ts.
 * Pre-normalized snake_case. Disjoint from SEARCH_TOOLS — if a name
 * appears in both upstream lists (e.g. `search_documentation`), we
 * keep it in SEARCH_TOOLS only, because search semantics are louder
 * for the human glance.
 */
// prettier-ignore
const READ_TOOLS: ReadonlySet<string> = new Set([
  // Slack
  'slack_read_channel',
  'slack_read_thread',
  'slack_read_canvas',
  'slack_read_user_profile',
  'slack_list_channels',
  'slack_get_channel_history',
  'slack_get_thread_replies',
  'slack_get_users',
  'slack_get_user_profile',
  // GitHub
  'get_me',
  'get_team_members',
  'get_teams',
  'get_commit',
  'get_file_contents',
  'get_repository_tree',
  'list_branches',
  'list_commits',
  'list_releases',
  'list_tags',
  'get_latest_release',
  'get_release_by_tag',
  'get_tag',
  'list_issues',
  'issue_read',
  'list_issue_types',
  'get_label',
  'list_label',
  'pull_request_read',
  'get_gist',
  'list_gists',
  'list_notifications',
  'get_notification_details',
  'projects_list',
  'projects_get',
  'actions_get',
  'actions_list',
  'get_job_logs',
  'get_code_scanning_alert',
  'list_code_scanning_alerts',
  'get_dependabot_alert',
  'list_dependabot_alerts',
  'get_secret_scanning_alert',
  'list_secret_scanning_alerts',
  'get_global_security_advisory',
  'list_global_security_advisories',
  'list_org_repository_security_advisories',
  'list_repository_security_advisories',
  'get_discussion',
  'get_discussion_comments',
  'list_discussion_categories',
  'list_discussions',
  'list_starred_repositories',
  'get_issue',
  'get_pull_request',
  'list_pull_requests',
  'get_pull_request_files',
  'get_pull_request_status',
  'get_pull_request_comments',
  'get_pull_request_reviews',
  // Linear
  'list_comments',
  'list_cycles',
  'get_document',
  'list_documents',
  'list_issue_statuses',
  'get_issue_status',
  'list_my_issues',
  'list_issue_labels',
  'list_projects',
  'get_project',
  'list_project_labels',
  'list_teams',
  'get_team',
  'list_users',
  'get_user',
  // Datadog
  'aggregate_logs',
  'list_spans',
  'aggregate_spans',
  'analyze_trace',
  'trace_critical_path',
  'query_metrics',
  'aggregate_rum_events',
  'list_rum_metrics',
  'get_rum_metric',
  'list_monitors',
  'get_monitor',
  'check_can_delete_monitor',
  'validate_monitor',
  'validate_existing_monitor',
  'list_dashboards',
  'get_dashboard',
  'query_dashboard_widget',
  'list_notebooks',
  'get_notebook',
  'query_notebook_cell',
  'get_profiling_metrics',
  'compare_profiling_metrics',
  // Sentry
  'whoami',
  'get_issue_details',
  'get_issue_tag_values',
  'get_trace_details',
  'get_event_attachment',
  'get_doc',
  'get_sentry_resource',
  'list_events',
  'list_issue_events',
  'get_sentry_issue',
  // Notion
  'fetch',
  'get_comments',
  'get_users',
  'get_self',
  // Gmail
  'gmail_get_profile',
  'gmail_read_message',
  'gmail_read_thread',
  'gmail_list_drafts',
  'gmail_list_labels',
  // Google Drive
  'google_drive_fetch',
  'google_drive_export',
  // Google Calendar
  'gcal_list_calendars',
  'gcal_list_events',
  'gcal_get_event',
  // Atlassian / Jira / Confluence
  'atlassian_user_info',
  'get_accessible_atlassian_resources',
  'get_visible_jira_projects',
  'get_jira_project_issue_types_metadata',
  'get_jira_issue',
  'get_transitions_for_jira_issue',
  'get_jira_issue_remote_issue_links',
  'get_confluence_spaces',
  'get_confluence_page',
  'get_pages_in_confluence_space',
  'get_confluence_page_ancestors',
  'get_confluence_page_descendants',
  'get_confluence_page_footer_comments',
  'get_confluence_page_inline_comments',
  'confluence_get_page',
  'confluence_get_page_children',
  'confluence_get_comments',
  'confluence_get_labels',
  'jira_get_issue',
  'jira_get_transitions',
  'jira_get_worklog',
  'jira_get_agile_boards',
  'jira_get_board_issues',
  'jira_get_sprints_from_board',
  'jira_get_sprint_issues',
  'jira_get_link_types',
  'jira_download_attachments',
  'jira_batch_get_changelogs',
  'jira_get_user_profile',
  'jira_get_project_issues',
  'jira_get_project_versions',
  // Filesystem
  'read_file',
  'read_text_file',
  'read_media_file',
  'read_multiple_files',
  'list_directory',
  'list_directory_with_sizes',
  'directory_tree',
  'get_file_info',
  'list_allowed_directories',
  // Memory
  'read_graph',
  'open_nodes',
  // Postgres
  'query',
  // SQLite
  'read_query',
  'list_tables',
  'describe_table',
  // Git
  'git_status',
  'git_diff',
  'git_diff_unstaged',
  'git_diff_staged',
  'git_log',
  'git_show',
  'git_branch',
])

/**
 * Normalize a tool name for allowlist lookup.
 *
 * Splits camelCase boundaries, replaces `-` with `_`, lowercases.
 * Matches the upstream `normalize` helper byte-for-byte so the same
 * SEARCH_TOOLS / READ_TOOLS sets carry over without re-curation.
 *
 * Exported for tests; production callers should use
 * `classifyToolForCollapse`, which already normalizes.
 */
export function normalizeToolName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase()
}

/**
 * Classify a tool name as search / read / neither for collapse.
 *
 * Conservative: an unknown name returns `{ isSearch: false, isRead:
 * false }` rather than guessing. The caller should treat "neither" as
 * "do not collapse" — collapse semantics apply only to opt-in tools
 * whose name carries enough signal that the user will recognize the
 * group label (e.g. "Searched 4×").
 */
export function classifyToolForCollapse(toolName: string): CollapseClassification {
  const key = normalizeToolName(toolName)
  return {
    isSearch: SEARCH_TOOLS.has(key),
    isRead: !SEARCH_TOOLS.has(key) && READ_TOOLS.has(key),
  }
}

/**
 * Convenience: classify + summarize in one call. Returns the full
 * "row" that a transcript display would render for a tool call.
 *
 * `summary` is null when no informative field is present and the input
 * object doesn't serialize to anything useful. `isCollapsible` is the
 * disjunction of `isSearch` / `isRead`.
 */
export type ToolCallRow = {
  toolName: string
  summary: string | null
  isSearch: boolean
  isRead: boolean
  isCollapsible: boolean
}

export function buildToolCallRow(
  toolName: string,
  input: Readonly<Record<string, unknown>> | undefined | null,
): ToolCallRow {
  const summary = summarizeToolInput(input)
  const { isSearch, isRead } = classifyToolForCollapse(toolName)
  return {
    toolName,
    summary,
    isSearch,
    isRead,
    isCollapsible: isSearch || isRead,
  }
}
