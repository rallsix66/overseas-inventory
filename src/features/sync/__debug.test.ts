import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSyncActions } from './actions';
import type { SyncActionsDeps, InputArtifactSource } from './actions';
import { MockRepository } from './repository';
import { MockArtifactProvider } from './mock-artifact-provider';
import { MockSyncRunner } from './mock-sync-runner';
import { createSyncService, type SyncServiceDeps } from './sync-service';

vi.mock('@/lib/auth', () => ({
  requireActiveAdmin: vi.fn(),
  requireActiveAuth: vi.fn(),
}));

import { requireActiveAdmin, requireActiveAuth } from '@/lib/auth';

const WH1 = { id: 'adc5ec45-cd98-42a8-a1d1-26600e80d481', name: 'PH', country: 'PH' };
const WH2 = { id: 'c0b661fa-7b6b-4c28-9563-e3e2e3e48a27', name: 'VN', country: 'VN' };
const WH3 = { id: 'aa3af864-28d9-4a9d-8e9d-3a3b9e3f4483', name: 'TH', country: 'TH' };

describe('debug', () => {
  beforeEach(() => {
    MockRepository._resetAll();
    MockArtifactProvider._resetAll();
    vi.mocked(requireActiveAdmin).mockResolvedValue({
      id: 'admin-id', email: 'a@b.com', displayName: 'A', roleName: 'admin', isActive: true as const,
    });
  });

  it('3 warehouses, TH fails', async () => {
    const repo = new MockRepository('admin');
    const runner = new MockSyncRunner();
    const ap = new MockArtifactProvider();
    const svc = createSyncService({ repository: repo, artifactProvider: ap, runner });
    
    const actions = createSyncActions({
      repository: repo,
      syncService: svc,
      inputArtifactSource: {
        getInputArtifact: async (whId) => {
          if (whId === WH3.id) throw new Error('TH fail');
          return { skus: ['SKU'] };
        },
      },
      artifactProvider: ap,
    });

    const result = await actions.triggerBatchDryRun([WH1, WH2, WH3]);
    console.error('RESULTS:', JSON.stringify(result.results.map(r => ({ name: r.warehouseName, status: r.status, reason: r.failureReason?.slice(0, 30) }))));
    console.error('COUNTS:', result.successCount, result.failedCount);
    expect(result.successCount).toBe(2);
    expect(result.failedCount).toBe(1);
  });
});
