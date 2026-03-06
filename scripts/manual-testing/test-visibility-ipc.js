#!/usr/bin/env node
/**
 * Manual testing script for Sprint 1 Visibility IPC handlers
 *
 * This script tests all 6 event tracking IPC handlers by calling them
 * directly and displaying the results.
 *
 * Usage:
 *   node scripts/manual-testing/test-visibility-ipc.js
 *
 * Prerequisites:
 *   - Addon loaded in Local
 *   - At least one site with WordPress events
 */

const { IPC_CHANNELS } = require('../../lib/common/constants');

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function log(message, color = 'reset') {
  console.log(colors[color] + message + colors.reset);
}

function section(title) {
  log('\n' + '='.repeat(60), 'cyan');
  log(title, 'bright');
  log('='.repeat(60), 'cyan');
}

function subsection(title) {
  log('\n' + title, 'cyan');
  log('-'.repeat(title.length), 'gray');
}

/**
 * Test EVENTS_GET_TIMELINE handler
 */
async function testGetTimeline(ipcRenderer) {
  section('TEST 1: Get Event Timeline');

  try {
    // Test 1: Get all events
    subsection('1.1: Get all events (limit 10)');
    const all = await ipcRenderer.invoke(IPC_CHANNELS.EVENTS_GET_TIMELINE, { limit: 10 });

    if (all.success) {
      log(`✓ Retrieved ${all.events.length} events`, 'green');
      if (all.events.length > 0) {
        const firstEvent = all.events[0];
        log(`  Latest event: ${firstEvent.summary}`, 'gray');
        log(`  Site: ${firstEvent.siteName}`, 'gray');
        log(`  Status: ${firstEvent.status}`, 'gray');
        log(`  Time: ${new Date(firstEvent.timestamp).toLocaleString()}`, 'gray');
      }
    } else {
      log(`✗ Failed: ${all.error}`, 'red');
    }

    // Test 2: Filter by event type
    subsection('1.2: Filter by event type (plugin_activated)');
    const filtered = await ipcRenderer.invoke(IPC_CHANNELS.EVENTS_GET_TIMELINE, {
      filter: 'plugin_activated',
      limit: 5,
    });

    if (filtered.success) {
      log(`✓ Retrieved ${filtered.events.length} plugin_activated events`, 'green');
    } else {
      log(`✗ Failed: ${filtered.error}`, 'red');
    }

    // Test 3: Filter by status
    subsection('1.3: Filter by status (pending)');
    const pending = await ipcRenderer.invoke(IPC_CHANNELS.EVENTS_GET_TIMELINE, {
      status: 'pending',
      limit: 5,
    });

    if (pending.success) {
      log(`✓ Retrieved ${pending.events.length} pending events`, 'green');
    } else {
      log(`✗ Failed: ${pending.error}`, 'red');
    }

  } catch (err) {
    log(`✗ Error: ${err.message}`, 'red');
  }
}

/**
 * Test EVENTS_GET_STATS handler
 */
async function testGetStats(ipcRenderer) {
  section('TEST 2: Get Event Statistics');

  try {
    const result = await ipcRenderer.invoke(IPC_CHANNELS.EVENTS_GET_STATS);

    if (result.success) {
      const { stats } = result;
      log(`✓ Statistics retrieved`, 'green');
      log(`  Total events: ${stats.total}`, 'gray');
      log(`  Today: ${stats.today}`, 'gray');
      log(`  Yesterday: ${stats.yesterday}`, 'gray');
      log(`  Pending: ${stats.pending}`, 'gray');
      log(`  Failed: ${stats.failed}`, 'gray');

      const healthColor = stats.healthStatus === 'good' ? 'green'
                        : stats.healthStatus === 'warning' ? 'yellow'
                        : 'red';
      log(`  Health: ${stats.healthStatus.toUpperCase()}`, healthColor);

      subsection('Events by type:');
      Object.entries(stats.byType).forEach(([type, count]) => {
        log(`  ${type}: ${count}`, 'gray');
      });
    } else {
      log(`✗ Failed: ${result.error}`, 'red');
    }
  } catch (err) {
    log(`✗ Error: ${err.message}`, 'red');
  }
}

/**
 * Test STORAGE_GET_HEALTH handler
 */
async function testGetStorageHealth(ipcRenderer) {
  section('TEST 3: Get Storage Health');

  try {
    const result = await ipcRenderer.invoke(IPC_CHANNELS.STORAGE_GET_HEALTH);

    if (result.success) {
      const { health } = result;
      log(`✓ Storage health retrieved`, 'green');

      subsection('Graph Database:');
      log(`  Path: ${health.graph_db.path}`, 'gray');
      log(`  Size: ${(health.graph_db.size_bytes / 1024 / 1024).toFixed(2)} MB`, 'gray');
      log(`  Events: ${health.graph_db.event_count}`, 'gray');
      if (health.graph_db.oldest_event) {
        log(`  Oldest: ${new Date(health.graph_db.oldest_event).toLocaleString()}`, 'gray');
      }
      if (health.graph_db.newest_event) {
        log(`  Newest: ${new Date(health.graph_db.newest_event).toLocaleString()}`, 'gray');
      }

      subsection('Vector Database:');
      log(`  Path: ${health.vector_db.path}`, 'gray');
      log(`  Size: ${(health.vector_db.size_bytes / 1024 / 1024).toFixed(2)} MB`, 'gray');
      log(`  Tables: ${health.vector_db.table_count}`, 'gray');

      subsection('Event Queue:');
      log(`  Pending: ${health.pending_events}`, 'gray');
      log(`  Failed: ${health.failed_events}`, 'gray');
    } else {
      log(`✗ Failed: ${result.error}`, 'red');
    }
  } catch (err) {
    log(`✗ Error: ${err.message}`, 'red');
  }
}

/**
 * Test ISSUES_DETECT handler
 */
async function testDetectIssues(ipcRenderer) {
  section('TEST 4: Detect Issues');

  try {
    const result = await ipcRenderer.invoke(IPC_CHANNELS.ISSUES_DETECT);

    if (result.success) {
      if (result.issues.length === 0) {
        log(`✓ No issues detected - all systems healthy!`, 'green');
      } else {
        log(`✓ Detected ${result.issues.length} issue(s)`, 'yellow');
        result.issues.forEach((issue, i) => {
          subsection(`Issue ${i + 1}: ${issue.title}`);
          const severityColor = issue.severity === 'error' ? 'red' : 'yellow';
          log(`  Severity: ${issue.severity.toUpperCase()}`, severityColor);
          log(`  Type: ${issue.type}`, 'gray');
          log(`  Description: ${issue.description}`, 'gray');
          log(`  Count: ${issue.count}`, 'gray');
        });
      }
    } else {
      log(`✗ Failed: ${result.error}`, 'red');
    }
  } catch (err) {
    log(`✗ Error: ${err.message}`, 'red');
  }
}

/**
 * Test STORAGE_CLEANUP handler
 */
async function testStorageCleanup(ipcRenderer) {
  section('TEST 5: Storage Cleanup');

  try {
    log('Running cleanup with 30-day retention...', 'cyan');
    const result = await ipcRenderer.invoke(IPC_CHANNELS.STORAGE_CLEANUP, {
      retentionDays: 30,
    });

    if (result.success) {
      log(`✓ Cleanup completed`, 'green');
      log(`  Events deleted: ${result.deletedCount}`, 'gray');
    } else {
      log(`✗ Failed: ${result.error}`, 'red');
    }
  } catch (err) {
    log(`✗ Error: ${err.message}`, 'red');
  }
}

/**
 * Test EVENTS_RETRY_FAILED handler
 */
async function testRetryFailed(ipcRenderer) {
  section('TEST 6: Retry Failed Events');

  try {
    log('Retrying all failed events...', 'cyan');
    const result = await ipcRenderer.invoke(IPC_CHANNELS.EVENTS_RETRY_FAILED);

    if (result.success) {
      log(`✓ Retry completed`, 'green');
      log(`  Events retried: ${result.retriedCount}`, 'gray');
    } else {
      log(`✗ Failed: ${result.error}`, 'red');
    }
  } catch (err) {
    log(`✗ Error: ${err.message}`, 'red');
  }
}

/**
 * Main test runner
 */
async function runTests() {
  log('\n' + '╔' + '═'.repeat(58) + '╗', 'bright');
  log('║' + ' '.repeat(10) + 'SPRINT 1 VISIBILITY IPC TESTS' + ' '.repeat(19) + '║', 'bright');
  log('╚' + '═'.repeat(58) + '╝', 'bright');

  // Check if we're running in Electron
  if (typeof window === 'undefined' || !window.require) {
    log('\n✗ This script must be run in an Electron renderer process', 'red');
    log('  Run it from the browser console in Local\'s DevTools', 'yellow');
    log('  Or integrate it into a test component', 'yellow');
    return;
  }

  const { ipcRenderer } = window.require('electron');

  // Run all tests
  await testGetTimeline(ipcRenderer);
  await testGetStats(ipcRenderer);
  await testGetStorageHealth(ipcRenderer);
  await testDetectIssues(ipcRenderer);
  await testStorageCleanup(ipcRenderer);
  await testRetryFailed(ipcRenderer);

  section('ALL TESTS COMPLETE');
  log('Check results above for any failures\n', 'cyan');
}

// If running in Node (not Electron), show usage
if (typeof window === 'undefined') {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║              SPRINT 1 VISIBILITY IPC TESTS                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log('This script tests all 6 event tracking IPC handlers.\n');
  console.log('USAGE:');
  console.log('  1. Open Local app');
  console.log('  2. Open DevTools (View → Toggle Developer Tools)');
  console.log('  3. Paste this script into the Console');
  console.log('  4. Or: Create a test button in the UI that calls runTests()\n');
  console.log('ALTERNATIVE:');
  console.log('  Run integration tests: npm run test:integration\n');

  // Export for use in Electron
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runTests };
  }
} else {
  // Running in Electron - execute tests
  runTests().catch(err => {
    log(`\n✗ Fatal error: ${err.message}`, 'red');
    console.error(err);
  });
}
