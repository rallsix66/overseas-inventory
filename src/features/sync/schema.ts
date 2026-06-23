// Sync Feature Module — Zod 参数校验 (P5-SY5C2 V5.8)

import { z } from 'zod';

export const triggerSyncSchema = z.discriminatedUnion('mode', [
  z
    .object({
      warehouseId: z.string().uuid(),
      mode: z.literal('dry_run'),
    })
    .strict(),
  z
    .object({
      warehouseId: z.string().uuid(),
      mode: z.literal('real_write'),
      dryRunRunId: z.string().uuid(),
      confirmToken: z.literal('P5-SY3B-PH'),
    })
    .strict(),
]);

export type TriggerSyncInput = z.infer<typeof triggerSyncSchema>;

export const triggerSyncAllSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('dry_run'),
    })
    .strict(),
  z
    .object({
      mode: z.literal('real_write'),
      dryRunRunId: z.string().uuid(),
      confirmToken: z.literal('P5-SY3B-PH'),
    })
    .strict(),
]);

export type TriggerSyncAllInput = z.infer<typeof triggerSyncAllSchema>;

export const syncWarehouseSchema = z.object({
  warehouseId: z.string().uuid(),
}).strict();

export type SyncWarehouseInput = z.infer<typeof syncWarehouseSchema>;

export const getSyncRunsSchema = z.object({
  warehouseId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
}).strict();

export type GetSyncRunsInput = z.infer<typeof getSyncRunsSchema>;

export const getSyncRunDetailSchema = z.object({
  runId: z.string().uuid(),
});

export type GetSyncRunDetailInput = z.infer<typeof getSyncRunDetailSchema>;

// ─── P5-SY9D: Dry Run 审核与确认绑定 ─────────────────────

export const confirmRealWriteSchema = z.object({
  warehouseId: z.string().uuid(),
  dryRunRunId: z.string().uuid(),
}).strict();

export type ConfirmRealWriteInput = z.infer<typeof confirmRealWriteSchema>;
