/**
 * Moved to settings/SettingsShell.tsx (spec 6a). Kept as a re-export because
 * NexusOverview.tsx:1445 mounts `SettingsTab` and the tab key is persisted in
 * user state; renaming the mount point is a separate change.
 */
export { SettingsShell as SettingsTab } from './settings/SettingsShell';
