/**
 * Content Browser
 *
 * Standalone interface for browsing and searching indexed content across all sites.
 * Extracted from FleetOverview "Content" tab per UI Reorganization Plan.
 *
 * Features:
 * - Unified search across all indexed sites
 * - Smart filters by site, post type, date
 * - Saved queries for common searches
 *
 * Class-based — Local uses older React, no hooks allowed.
 */
import * as React from 'react';
import { UnifiedSearchPanel } from './UnifiedSearchPanel';
import { SmartFiltersPanel } from './SmartFiltersPanel';
import { SavedQueriesPanel } from './SavedQueriesPanel';

interface ContentBrowserProps {
  electron: any;
}

export class ContentBrowser extends React.Component<ContentBrowserProps> {
  render(): React.ReactNode {
    return React.createElement('div', {
      style: {
        padding: '24px',
        height: '100%',
        overflow: 'auto',
        boxSizing: 'border-box' as const,
      },
    },
      // Header
      React.createElement('div', {
        style: {
          marginBottom: '24px',
        },
      },
        React.createElement('h1', {
          style: {
            fontSize: '24px',
            fontWeight: 600,
            margin: 0,
            marginBottom: '8px',
          },
        }, 'Content Browser'),

        React.createElement('p', {
          style: {
            fontSize: '14px',
            color: 'var(--color-text-secondary, #6b7280)',
            margin: 0,
          },
        }, 'Search and browse indexed content across all your WordPress sites'),
      ),

      // Main content layout
      React.createElement('div', {
        style: {
          display: 'flex',
          gap: '20px',
        },
      },
        // Left column: main search
        React.createElement('div', {
          style: {
            flex: 1,
            minWidth: 0,
          },
        },
          React.createElement(UnifiedSearchPanel, {
            electron: this.props.electron,
          }),
        ),

        // Right column: filters + saved queries
        React.createElement('div', {
          style: {
            width: '300px',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column' as const,
            gap: '16px',
          },
        },
          React.createElement(SmartFiltersPanel, {
            electron: this.props.electron,
          }),

          React.createElement(SavedQueriesPanel, {
            electron: this.props.electron,
          }),
        ),
      ),
    );
  }
}
