'use strict';

// Batch 1 regression tests — verdict soundness + real remediation.
// These guard three fixes:
//   #1 collapsed the dead `remediationSteps.length === 0` branch
//   #2 verdict coverage is DERIVED from steps built+passed (no hardcoded set)
//   #3 FS-04 / FS-05 / DB-02 now have real removal steps, not just verify-scans
const agent = require('../../../../agents/security-sentinel/agent');
const { buildRemediationChecklist, tier3Remediate, SIGNAL_REMEDIATION_STEP } = agent._test;

const log = {
  info() {}, warn() {}, error() {}, phase() {}, finding() {}, action() {}, siteStatus() {},
};
const install = { name: 'testsite', environment: 'production', postCount: 10 };

// tools mock where every checklist step verifies as passing
const passingTools = () => ({
  invoke: async (_tool, args) => {
    const code = (args && args.code) || '';
    if (code.includes('shuffle-salts')) return 'Success';
    if (code.includes('DISALLOW_FILE_EDIT')) return 'true|added';
    return '[]'; // expectedEmpty steps see an empty array → pass
  },
});

describe('Batch 1 — remediation coverage', () => {
  describe('#3 new removal steps are conditional on their signal', () => {
    it('adds step 4b only when FS-04 fired', () => {
      const withFs04 = buildRemediationChecklist({}, [{ id: 'FS-04', severity: 'critical', title: 'php in uploads' }], 'sbx');
      const without = buildRemediationChecklist({}, [], 'sbx');
      expect(withFs04.some(s => s.step === '4b')).toBe(true);
      expect(without.some(s => s.step === '4b')).toBe(false);
    });

    it('adds step 5f only when FS-05 fired with .htaccess evidence', () => {
      const sig = { id: 'FS-05', severity: 'critical', title: 'bad htaccess', evidence: ['wp-content/uploads/.htaccess: PHP execution enabled — AddType ...'] };
      const withFs05 = buildRemediationChecklist({}, [sig], 'sbx');
      const step5f = withFs05.find(s => s.step === '5f');
      expect(step5f).toBeDefined();
      expect(step5f.toolArgs.code).toContain('file_put_contents');
    });

    it('adds step 5g only when DB-02 fired with option evidence', () => {
      const sig = { id: 'DB-02', severity: 'critical', title: 'opt', evidence: ['evil_widget: eval(base64_decode(...'] };
      const withDb02 = buildRemediationChecklist({}, [sig], 'sbx');
      const step5g = withDb02.find(s => s.step === '5g');
      expect(step5g).toBeDefined();
      expect(step5g.action).toContain('evil_widget');
    });

    it('does not disturb the existing always-on steps', () => {
      const steps = buildRemediationChecklist({}, [], 'sbx').map(s => s.step);
      expect(steps).toContain(3);
      expect(steps).toContain(4);
      expect(steps).toContain(6);
      expect(steps).toContain(7);
      expect(steps).toContain(8);
      expect(steps).not.toContain(5);
    });
  });

  describe('#2 verdict coverage is derived, not hardcoded', () => {
    it('FS-07 is NOT falsely marked covered (the dangerous former hole)', () => {
      // FS-07 had no remediation step yet was listed as covered — a site with
      // only hardcoded C2 indicators could have returned READY.
      expect(SIGNAL_REMEDIATION_STEP['FS-07']).toBeUndefined();
    });

    it('a critical signal with no step blocks the push', async () => {
      // DB-03 (serialized usermeta) is intentionally uncovered — needs human inspection.
      const r = await tier3Remediate(install, 's', [{ id: 'DB-03', severity: 'critical', title: 'serialized usermeta' }], 'sbx', passingTools(), log);
      expect(r.verdict).toBe('blocked');
      expect(r.uncoveredCritical).toContain('DB-03');
    });

    it('FS-02 is covered by step 8, and blocks only when step 8 FAILS', async () => {
      // Step 8 re-runs the full FS-02 scan (all 9 patterns, all 3 dirs), so a passing
      // step 8 is a genuine all-clear. A failing step 8 must block.
      const clean = await tier3Remediate(install, 's', [{ id: 'FS-02', severity: 'critical', title: 'obf' }], 'sbx', passingTools(), log);
      expect(clean.verdict).toBe('ready');

      const dirty = {
        invoke: async (_t, a) => {
          const c = (a && a.code) || '';
          if (c.includes('shuffle-salts')) return 'Success';
          if (c.includes('DISALLOW_FILE_EDIT')) return 'true|added';
          if (c.includes('$patterns')) return JSON.stringify(['obfuscated:themes/x/functions.php']);
          return '[]';
        },
      };
      const r = await tier3Remediate(install, 's', [{ id: 'FS-02', severity: 'critical', title: 'obf' }], 'sbx', dirty, log);
      expect(r.verdict).toBe('blocked');
    });

    it('FS-07 alone blocks the push', async () => {
      const r = await tier3Remediate(install, 's', [{ id: 'FS-07', severity: 'critical', title: 'c2' }], 'sbx', passingTools(), log);
      expect(r.verdict).toBe('blocked');
      expect(r.uncoveredCritical).toContain('FS-07');
    });

    it('a covered critical whose step passes → ready', async () => {
      const r = await tier3Remediate(install, 's', [{ id: 'FS-04', severity: 'critical', title: 'php uploads' }], 'sbx', passingTools(), log);
      expect(r.verdict).toBe('ready');
      expect(r.uncoveredCritical).toEqual([]);
    });

    it('a covered critical whose step FAILS → blocked', async () => {
      // Make the FS-04 removal step report leftover files → step fails.
      const failingUploads = {
        invoke: async (_tool, args) => {
          const code = (args && args.code) || '';
          if (code.includes('shuffle-salts')) return 'Success';
          if (code.includes('DISALLOW_FILE_EDIT')) return 'true|added';
          if (code.includes("getExtension() === 'php'") && code.includes('upload_dir')) {
            return JSON.stringify(['/var/www/wp-content/uploads/shell.php']);
          }
          return '[]';
        },
      };
      const r = await tier3Remediate(install, 's', [{ id: 'FS-04', severity: 'critical', title: 'php uploads' }], 'sbx', failingUploads, log);
      expect(r.verdict).toBe('blocked');
    });

    it('only-high findings with passing steps → ready', async () => {
      const r = await tier3Remediate(install, 's', [{ id: 'DB-01', severity: 'high', title: 'spam', evidence: [] }], 'sbx', passingTools(), log);
      expect(r.verdict).toBe('ready');
    });
  });
});
