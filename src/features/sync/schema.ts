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
  limit: z.number().int().min(1).max(500).default(200),
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

// ─── P5-SY9H: sync_log 详情 ─────────────────────────────

export const getSyncLogDetailSchema = z.object({
  runId: z.string().uuid(),
});

export type GetSyncLogDetailInput = z.infer<typeof getSyncLogDetailSchema>;

// ─── P5-SY9G: 批量审核后真实写入 ─────────────────────────

export const triggerBatchRealWriteSchema = z.object({
  confirmationPhrase: z.literal('确认写入', {
    error: '确认短语必须为「确认写入」',
  }),
  items: z.array(z.object({
    warehouseId: z.string().uuid(),
    warehouseName: z.string().min(1),
    country: z.string().min(1),
    dryRunRunId: z.string().uuid(),
    confirmToken: z.string().min(1),
  })).min(1).max(20),
}).strict();

export type TriggerBatchRealWriteInput = z.infer<typeof triggerBatchRealWriteSchema>;
