# IPC Channels

**Regenerated 2026-08-25 from `src/common/constants.ts` (`IPC_CHANNELS`).**
That constant is the authority — this page is an index, regenerated rather
than hand-maintained (the previous version documented 23 channels of which 18
no longer existed, while the real surface had grown to the count below).

Handlers live in `src/main/ipc-handlers.ts` (grep the constant name).
Renderer calls go through `props.electron.ipcRenderer.invoke(IPC_CHANNELS.X, …)`.

**Adding a channel:** add the key to `IPC_CHANNELS`, register the handler in
`ipc-handlers.ts`, and remember the audit rule (CLAUDE.md): a mutating handler
that calls `services.localServices` directly must call `auditDirectOperation`
on both outcomes.

## AGENT (13)

| Constant | Channel |
|---|---|
| `AGENT_LOG_OPEN` | `nexus-ai:agent:log-open` |
| `AGENT_LOG_PROCESSOR_CONNECTED_SITES` | `nexus-ai:agent:log-processor:connected-sites` |
| `AGENT_LOG_PROCESSOR_STATE` | `nexus-ai:agent:log-processor:state` |
| `AGENT_REMOVE` | `nexus-ai:agent:remove` |
| `AGENT_RESUME` | `nexus-ai:agent:resume` |
| `AGENT_RUN_CANCEL` | `nexus-ai:agent:run-cancel` |
| `AGENT_RUN_COMPLETE` | `nexus-ai:agent:run-complete` |
| `AGENT_RUN_NOW` | `nexus-ai:agent:run-now` |
| `AGENT_RUN_STARTED` | `nexus-ai:agent:run-started` |
| `AGENT_SETTINGS_GET` | `nexus-ai:agent:settings-get` |
| `AGENT_SETTINGS_UPDATE` | `nexus-ai:agent:settings-update` |
| `AGENT_TOOL_INVOKE` | `nexus-ai:agent:tool-invoke` |
| `AGENT_WEB_ANALYTICS_STATE` | `nexus-ai:agent:web-analytics:state` |

## AI (10)

| Constant | Channel |
|---|---|
| `AI_CONTEXT_GENERATE` | `nexus-ai:ai-context:generate` |
| `AI_CONTEXT_GET_STATUS` | `nexus-ai:ai-context:get-status` |
| `AI_GATEWAY_CHECK_RATE_LIMIT` | `nexus-ai:ai-gateway:check-rate-limit` |
| `AI_GATEWAY_CLEAR_USAGE` | `nexus-ai:ai-gateway:clear-usage` |
| `AI_GATEWAY_GET_COST` | `nexus-ai:ai-gateway:get-cost` |
| `AI_GATEWAY_GET_RATE_LIMIT` | `nexus-ai:ai-gateway:get-rate-limit` |
| `AI_GATEWAY_GET_STATS` | `nexus-ai:ai-gateway:get-stats` |
| `AI_GATEWAY_GET_USAGE` | `nexus-ai:ai-gateway:get-usage` |
| `AI_GATEWAY_SET_RATE_LIMIT` | `nexus-ai:ai-gateway:set-rate-limit` |
| `AI_GATEWAY_USAGE_UPDATED` | `nexus-ai:ai-gateway:usage-updated` |

## BULK (5)

| Constant | Channel |
|---|---|
| `BULK_CANCEL` | `nexus-ai:bulk:cancel` |
| `BULK_EXECUTE` | `nexus-ai:bulk:execute` |
| `BULK_LIST` | `nexus-ai:bulk:list` |
| `BULK_PROGRESS` | `nexus-ai:bulk:progress` |
| `BULK_STATUS` | `nexus-ai:bulk:status` |

## CHAT (14)

| Constant | Channel |
|---|---|
| `CHAT_ALL_CLEARED` | `nexus-ai:chat-all-cleared` |
| `CHAT_CLEAR` | `nexus-ai:chat-clear` |
| `CHAT_CLEAR_ALL` | `nexus-ai:chat-clear-all` |
| `CHAT_SEND` | `nexus-ai:chat-send` |
| `CHAT_SESSION_ACTION_RECORDED` | `nexus-ai:sessions:action-recorded` |
| `CHAT_SESSION_DELETE` | `nexus-ai:sessions:delete` |
| `CHAT_SESSION_GET` | `nexus-ai:sessions:get` |
| `CHAT_SESSION_LIST` | `nexus-ai:sessions:list` |
| `CHAT_SESSION_MARK_READ` | `nexus-ai:sessions:mark-read` |
| `CHAT_SESSION_SAVE` | `nexus-ai:sessions:save` |
| `CHAT_STOP` | `nexus-ai:chat-stop` |
| `CHAT_STREAM` | `nexus-ai:chat-stream` |
| `CHAT_TOOL_APPROVE` | `nexus-ai:chat-tool-approve` |
| `CHAT_UNREAD_COUNT` | `nexus-ai:sessions:unread-count` |

## COMPARATOR (4)

| Constant | Channel |
|---|---|
| `COMPARATOR_ARM_SELECTION` | `nexus-ai:comparator:arm-selection` |
| `COMPARATOR_FACTS` | `nexus-ai:comparator:facts` |
| `COMPARATOR_MATRIX` | `nexus-ai:comparator:matrix` |
| `COMPARATOR_PREVIEW_SCOPE` | `nexus-ai:comparator:preview-scope` |

## GET (29)

| Constant | Channel |
|---|---|
| `GET_AI_PROXY_INFO` | `nexus-ai:ai:proxy-info` |
| `GET_AI_STATUS` | `nexus-ai:ai:get-status` |
| `GET_API_KEY` | `nexus-ai:get-api-key` |
| `GET_API_KEY_STATUS` | `nexus-ai:get-api-key-status` |
| `GET_CREDENTIAL_SYNC_STATUS` | `nexus-ai:credentials:sync-status` |
| `GET_DASHBOARD_STATS` | `nexus-ai:get-dashboard-stats` |
| `GET_EXTERNAL_HOSTS` | `nexus-ai:get-external-hosts` |
| `GET_FLEET_COLLAPSE` | `nexus-ai:fleet:collapse` |
| `GET_FLEET_LIST` | `nexus-ai:get-fleet-list` |
| `GET_FLEET_PLUGINS` | `nexus-ai:get-fleet-plugins` |
| `GET_FLEET_STATUS` | `nexus-ai:get-fleet-status` |
| `GET_FLEET_SUMMARY` | `nexus-ai:get-fleet-summary` |
| `GET_INBOX` | `nexus-ai:inbox:get` |
| `GET_JOB_RUN_DATA` | `nexus-ai:get-job-run-data` |
| `GET_MCP_INFO` | `nexus-ai:get-mcp-info` |
| `GET_MODELS` | `nexus-ai:get-models` |
| `GET_PROVIDERS` | `nexus-ai:get-providers` |
| `GET_SETTINGS` | `nexus-ai:get-settings` |
| `GET_SITES` | `nexus-ai:get-sites` |
| `GET_SITE_AI_CONFIG` | `nexus-ai:ai:get-site-config` |
| `GET_SITE_CHANGE_EVENTS` | `nexus-ai:get-site-change-events` |
| `GET_SITE_CONTENT_STATUS` | `nexus-ai:site:content-status` |
| `GET_SITE_METADATA` | `nexus-ai:metadata:get` |
| `GET_SITE_ROWS` | `nexus-ai:sites:rows` |
| `GET_STARTUP_STATUS` | `nexus-ai:get-startup-status` |
| `GET_WPE_ACCOUNTS` | `nexus-ai:wpe:get-accounts` |
| `GET_WPE_INSTALLS_CACHE` | `nexus-ai:wpe:get-installs-cache` |
| `GET_WPE_SITE_IDS` | `nexus-ai:get-wpe-site-ids` |
| `GET_WP_VERSION` | `nexus-ai:get-wp-version` |

## INDEX (4)

| Constant | Channel |
|---|---|
| `INDEX_ALL_AUTO` | `nexus-ai:index-all-auto` |
| `INDEX_ALL_FLEET` | `nexus-ai:index-fleet` |
| `INDEX_PROGRESS` | `nexus-ai:content:index-progress` |
| `INDEX_SITE` | `nexus-ai:index-site` |

## NEXUS (1)

| Constant | Channel |
|---|---|
| `NEXUS_STATE_UPDATE` | `nexus-ai:state:update` |

## OTHER (89)

| Constant | Channel |
|---|---|
| `ACTIVITY_FILTER` | `nexus-ai:activity:filter` |
| `ASSISTANT_CONTEXT` | `nexus-ai:assistant:context` |
| `ASSISTANT_QUERY` | `nexus-ai:assistant:query` |
| `CLEANUP_EXCLUDED_TYPES` | `nexus-ai:content:cleanup-excluded-types` |
| `CLEANUP_GHOST_INSTALLS` | `nexus-ai:wpe:cleanup-ghost-installs` |
| `CREDENTIAL_API_KEY_CLEAR` | `nexus-ai:credential:api-key:clear` |
| `CREDENTIAL_API_KEY_SET` | `nexus-ai:credential:api-key:set` |
| `CREDENTIAL_API_KEY_STATUS` | `nexus-ai:credential:api-key:status` |
| `CREDENTIAL_CONNECT` | `nexus-ai:credential:connect` |
| `CREDENTIAL_DISCONNECT` | `nexus-ai:credential:disconnect` |
| `CREDENTIAL_EVENT` | `nexus-ai:credential:event` |
| `CREDENTIAL_STATUS` | `nexus-ai:credential:status` |
| `DASHBOARD_V2_STATS` | `nexus-ai:dashboard:v2-stats` |
| `DB_GET_LAST_SCAN` | `nexus-ai:db:get-last-scan` |
| `DB_SCAN_ALL` | `nexus-ai:db:scan-all` |
| `DB_SCAN_SITE` | `nexus-ai:db:scan` |
| `EVENTS_GET_STATS` | `nexus-ai:events:get-stats` |
| `EVENTS_GET_TIMELINE` | `nexus-ai:events:get-timeline` |
| `EVENTS_RETRY_FAILED` | `nexus-ai:events:retry-failed` |
| `FACTORY_RESET` | `nexus-ai:data:factory-reset` |
| `FILTERS_APPLY` | `nexus-ai:filters:apply` |
| `FILTERS_GET_COUNTS` | `nexus-ai:filters:get-counts` |
| `FLEET_COMPLETENESS` | `nexus-ai:fleet:completeness` |
| `FLEET_HEALTH_CHECK_ALL` | `nexus-ai:fleet:health-check-all` |
| `FLEET_PLUGIN_UPDATE_ALL` | `nexus-ai:fleet:plugin-update-all` |
| `FLEET_REFRESH_QUICK` | `nexus-ai:fleet:refresh-quick` |
| `FLEET_SQL_QUERY` | `nexus-ai:fleet-sql-query` |
| `GENERATE_SSH_KEY` | `nexus-ai:generate-ssh-key` |
| `GOVERN_MATRIX` | `nexus-ai:govern:matrix` |
| `GOVERN_SET_GRANT` | `nexus-ai:govern:set-grant` |
| `GROUPS_ADD_SITE` | `nexus-ai:groups:add-site` |
| `GROUPS_CREATE` | `nexus-ai:groups:create` |
| `GROUPS_DELETE` | `nexus-ai:groups:delete` |
| `GROUPS_LIST` | `nexus-ai:groups:list` |
| `GROUPS_REMOVE_SITE` | `nexus-ai:groups:remove-site` |
| `GROUPS_UPDATE` | `nexus-ai:groups:update` |
| `HEALTH_GET_ALL_SCORES` | `nexus-ai:health:get-all-scores` |
| `HEALTH_GET_FLEET_TREND` | `nexus-ai:health:get-fleet-trend` |
| `HEALTH_GET_SCORE` | `nexus-ai:health:get-score` |
| `HEALTH_GET_TREND` | `nexus-ai:health:get-trend` |
| `INBOX_DECIDE` | `nexus-ai:inbox:decide` |
| `INBOX_REOPEN` | `nexus-ai:inbox:reopen` |
| `ISSUES_DETECT` | `nexus-ai:issues:detect` |
| `IW_CONNECT` | `nexus-ai:iw:connect` |
| `IW_DISCONNECT` | `nexus-ai:iw:disconnect` |
| `IW_GET_STATUS` | `nexus-ai:iw:get-status` |
| `LIST_SSH_CONFIG_HOSTS` | `nexus-ai:list-ssh-config-hosts` |
| `LOGGING_CLEAR` | `nexus-ai:logging-clear` |
| `LOGGING_PLAN_CLEAR` | `nexus-ai:logging-plan-clear` |
| `LOGGING_REVEAL` | `nexus-ai:logging-reveal` |
| `LOGGING_STATS` | `nexus-ai:logging-stats` |
| `NAVIGATE_TO_PREFERENCES` | `nexus-ai:ui:navigate-to-preferences` |
| `OPEN_CHAT_SESSION` | `nexus-ai:open-session` |
| `OPERATION_AUDIT_EXPORT` | `nexus-ai:operation-audit:export` |
| `OPERATION_AUDIT_LIST` | `nexus-ai:operation-audit:list` |
| `PREVIEW_SSH_HOST_ENTRY` | `nexus-ai:preview-ssh-host-entry` |
| `QUERIES_CREATE` | `nexus-ai:queries:create` |
| `QUERIES_DELETE` | `nexus-ai:queries:delete` |
| `QUERIES_LIST` | `nexus-ai:queries:list` |
| `QUERIES_RUN` | `nexus-ai:queries:run` |
| `QUERIES_UPDATE` | `nexus-ai:queries:update` |
| `REFRESH_SITE_METADATA` | `nexus-ai:metadata:refresh` |
| `REMOVE_WP_AI` | `nexus-ai:ai:remove-wp-ai` |
| `RETURN_CHANGED_SINCE` | `nexus-ai:return:changed-since` |
| `RETURN_DEFER` | `nexus-ai:return:defer` |
| `RETURN_END_DEFERRAL` | `nexus-ai:return:end-deferral` |
| `RETURN_SESSION` | `nexus-ai:return:session` |
| `RETURN_SNAPSHOT` | `nexus-ai:return:snapshot` |
| `RETURN_TRIAGE` | `nexus-ai:return:triage` |
| `SAVE_API_KEY` | `nexus-ai:save-api-key` |
| `SEARCH` | `nexus-ai:search` |
| `SETUP_AI` | `nexus-ai:setup-ai` |
| `SETUP_AI_ALL_AUTO` | `nexus-ai:ai:setup-all-auto` |
| `SETUP_AI_FLEET` | `nexus-ai:ai:setup-fleet` |
| `SIDEBAR_BULK_ACTION` | `nexus-ai:sidebar:bulk-action` |
| `SIDEBAR_FILTER` | `nexus-ai:sidebar:filter` |
| `SIDEBAR_NAVIGATE_TO_SITE` | `nexus-ai:sidebar:navigate-to-site` |
| `SIDEBAR_SEARCH_TOGGLE` | `nexus-ai:sidebar:search-toggle` |
| `START_SITE` | `nexus-ai:start-site` |
| `STATUS_CHANGE` | `nexus-ai:status-change` |
| `STOP_SITE` | `nexus-ai:stop-site` |
| `SWITCH_AI_PROVIDER` | `nexus-ai:ai:switch-provider` |
| `SYNC_ALL_CREDENTIALS` | `nexus-ai:credentials:sync-all` |
| `SYNC_GRAPH_ALL` | `nexus-ai:sync-graph-all` |
| `SYSTEM_WPE_STATUS` | `nexus-ai:system:wpe-status` |
| `UPDATE_SETTINGS` | `nexus-ai:update-settings` |
| `UPGRADE_WP` | `nexus-ai:upgrade-wp` |
| `VALIDATE_API_KEY` | `nexus-ai:validate-api-key` |
| `WRITE_SSH_HOST_ENTRY` | `nexus-ai:write-ssh-host-entry` |

## RESET (2)

| Constant | Channel |
|---|---|
| `RESET_AND_REFRESH` | `nexus-ai:data:reset-and-refresh` |
| `RESET_CONTENT_INDEX` | `nexus-ai:content:reset-index` |

## SEARCH (3)

| Constant | Channel |
|---|---|
| `SEARCH_CLASSIFY_INTENT` | `nexus-ai:search:classify-intent` |
| `SEARCH_KEYWORD` | `nexus-ai:search:keyword` |
| `SEARCH_UNIFIED` | `nexus-ai:search:unified` |

## SET (1)

| Constant | Channel |
|---|---|
| `SET_EXTERNAL_HOST_ROOT_MODE` | `nexus-ai:set-external-host-root-mode` |

## SITE (3)

| Constant | Channel |
|---|---|
| `SITE_FINDER_AI_PARSE` | `nexus-ai:site-finder:ai-parse` |
| `SITE_FINDER_APPLY` | `nexus-ai:site-finder:apply` |
| `SITE_FINDER_GET_OPTIONS` | `nexus-ai:site-finder:get-options` |

## STORAGE (2)

| Constant | Channel |
|---|---|
| `STORAGE_CLEANUP` | `nexus-ai:storage:cleanup` |
| `STORAGE_GET_HEALTH` | `nexus-ai:storage:get-health` |

## TELEMETRY (1)

| Constant | Channel |
|---|---|
| `TELEMETRY_TRACK` | `nexus-ai:telemetry` |

## TRUST (1)

| Constant | Channel |
|---|---|
| `TRUST_EXTERNAL_HOST_KEY` | `nexus-ai:trust-external-host-key` |

## WPE (14)

| Constant | Channel |
|---|---|
| `WPE_CAPI_SYNC` | `nexus-ai:wpe:capi-sync` |
| `WPE_CREATE_BACKUP` | `nexus-ai:wpe:create-backup` |
| `WPE_DIAGNOSE` | `nexus-ai:wpe:diagnose` |
| `WPE_DIAGNOSE_SITE` | `nexus-ai:wpe:diagnose-site` |
| `WPE_GET_SITE_DETAILS` | `nexus-ai:wpe:get-site-details` |
| `WPE_GET_SYNCED_SITES` | `nexus-ai:wpe:get-synced-sites` |
| `WPE_LOGIN_START` | `nexus-ai:wpe:login-start` |
| `WPE_PULL_TO_LOCAL` | `nexus-ai:wpe:pull-to-local` |
| `WPE_REMOVE_SITE` | `nexus-ai:wpe:remove-site` |
| `WPE_SYNC_ALL` | `nexus-ai:wpe:sync-all` |
| `WPE_SYNC_SINGLE` | `nexus-ai:wpe:sync-single` |
| `WPE_SYNC_STATS` | `nexus-ai:wpe:sync-stats` |
| `WPE_SYNC_STATUS` | `nexus-ai:wpe:sync-status` |
| `WPE_SYNC_STOP` | `nexus-ai:wpe:sync-stop` |


*196 channels at generation time (2026-08-25). Regenerate when the count drifts.*
