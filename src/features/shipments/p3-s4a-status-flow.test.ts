// P3-S4A: 内部手动在途状态轨迹收口 — 测试
//
// 覆盖：
// 1. 状态流转规则 — isValidStatusTransition 纯函数
// 2. SHIPMENT_STATUS_FLOW 常量正确性
// 3. Zod schema — changeStatusSchema / advanceStatusSchema 不含 warehoused
// 4. Migration 00022 源码检查 — 流转规则 / admin-only
// 5. 权限 — changeStatusSchema 格式、advanceStatusSchema 格式
// 6. 轨迹展示 — detail page 源码检查（creatorName / 升序 / 空状态）
// 7. ShipmentStatusChange 组件 — 只展示下一合法状态

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── 状态流转规则 — 纯函数测试 ────────────────────────────────────────────

import { isValidStatusTransition } from './schema';
import { SHIPMENT_STATUS_FLOW, getNextValidStatus } from './types';

describe('P3-S4A: isValidStatusTransition — 纯函数', () => {
  it('booking → loading 合法', () => {
    expect(isValidStatusTransition('booking', 'loading')).toBe(true);
  });

  it('loading → departed 合法', () => {
    expect(isValidStatusTransition('loading', 'departed')).toBe(true);
  });

  it('departed → arrived 合法', () => {
    expect(isValidStatusTransition('departed', 'arrived')).toBe(true);
  });

  it('arrived → customs 合法', () => {
    expect(isValidStatusTransition('arrived', 'customs')).toBe(true);
  });

  it('customs → 任何状态不合法（无合法后续状态）', () => {
    expect(isValidStatusTransition('customs', 'booking')).toBe(false);
    expect(isValidStatusTransition('customs', 'loading')).toBe(false);
    expect(isValidStatusTransition('customs', 'departed')).toBe(false);
    expect(isValidStatusTransition('customs', 'arrived')).toBe(false);
    expect(isValidStatusTransition('customs', 'customs')).toBe(false);
    expect(isValidStatusTransition('customs', 'warehoused')).toBe(false);
  });

  it('倒退状态被拒绝 — departed → loading', () => {
    expect(isValidStatusTransition('departed', 'loading')).toBe(false);
  });

  it('倒退状态被拒绝 — arrived → departed', () => {
    expect(isValidStatusTransition('arrived', 'departed')).toBe(false);
  });

  it('倒退状态被拒绝 — customs → arrived', () => {
    expect(isValidStatusTransition('customs', 'arrived')).toBe(false);
  });

  it('跳步被拒绝 — booking → departed', () => {
    expect(isValidStatusTransition('booking', 'departed')).toBe(false);
  });

  it('跳步被拒绝 — booking → arrived', () => {
    expect(isValidStatusTransition('booking', 'arrived')).toBe(false);
  });

  it('跳步被拒绝 — loading → customs', () => {
    expect(isValidStatusTransition('loading', 'customs')).toBe(false);
  });

  it('跳步被拒绝 — departed → customs', () => {
    expect(isValidStatusTransition('departed', 'customs')).toBe(false);
  });

  it('warehoused 被拒绝（任何来源）', () => {
    expect(isValidStatusTransition('booking', 'warehoused')).toBe(false);
    expect(isValidStatusTransition('loading', 'warehoused')).toBe(false);
    expect(isValidStatusTransition('departed', 'warehoused')).toBe(false);
    expect(isValidStatusTransition('arrived', 'warehoused')).toBe(false);
    expect(isValidStatusTransition('customs', 'warehoused')).toBe(false);
  });

  it('未知状态 → 任何状态不合法', () => {
    expect(isValidStatusTransition('nonexistent', 'loading')).toBe(false);
    expect(isValidStatusTransition('booking', 'nonexistent')).toBe(false);
  });

  it('warehoused → 任何状态不合法', () => {
    // warehoused 不在 FLOW 中 → 无下一合法状态
    expect(isValidStatusTransition('warehoused', 'booking')).toBe(false);
  });
});

describe('P3-S4A: SHIPMENT_STATUS_FLOW 常量', () => {
  it('booking 下一状态为 loading', () => {
    expect(SHIPMENT_STATUS_FLOW['booking']).toBe('loading');
  });

  it('loading 下一状态为 departed', () => {
    expect(SHIPMENT_STATUS_FLOW['loading']).toBe('departed');
  });

  it('departed 下一状态为 arrived', () => {
    expect(SHIPMENT_STATUS_FLOW['departed']).toBe('arrived');
  });

  it('arrived 下一状态为 customs', () => {
    expect(SHIPMENT_STATUS_FLOW['arrived']).toBe('customs');
  });

  it('customs 无下一状态（null）', () => {
    expect(SHIPMENT_STATUS_FLOW['customs']).toBeNull();
  });

  it('warehoused 不在流转规则中', () => {
    expect(SHIPMENT_STATUS_FLOW['warehoused']).toBeUndefined();
  });
});

describe('P3-S4A: getNextValidStatus', () => {
  it('booking → loading', () => {
    expect(getNextValidStatus('booking')).toBe('loading');
  });

  it('loading → departed', () => {
    expect(getNextValidStatus('loading')).toBe('departed');
  });

  it('departed → arrived', () => {
    expect(getNextValidStatus('departed')).toBe('arrived');
  });

  it('arrived → customs', () => {
    expect(getNextValidStatus('arrived')).toBe('customs');
  });

  it('customs → null', () => {
    expect(getNextValidStatus('customs')).toBeNull();
  });

  it('warehoused → null', () => {
    expect(getNextValidStatus('warehoused')).toBeNull();
  });

  it('未知状态 → null', () => {
    expect(getNextValidStatus('unknown')).toBeNull();
  });
});

// ─── Zod schema 测试 ──────────────────────────────────────────────────────

import { changeStatusSchema, advanceStatusSchema } from './schema';

describe('P3-S4A: changeStatusSchema — 不含 warehoused', () => {
  it('合法状态 booking 通过', () => {
    const result = changeStatusSchema.safeParse({
      shipmentId: '00000000-0000-4000-8000-000000000001',
      status: 'booking',
    });
    expect(result.success).toBe(true);
  });

  it('合法状态 loading 通过', () => {
    const result = changeStatusSchema.safeParse({
      shipmentId: '00000000-0000-4000-8000-000000000001',
      status: 'loading',
    });
    expect(result.success).toBe(true);
  });

  it('合法状态 departed 通过', () => {
    const result = changeStatusSchema.safeParse({
      shipmentId: '00000000-0000-4000-8000-000000000001',
      status: 'departed',
    });
    expect(result.success).toBe(true);
  });

  it('合法状态 arrived 通过', () => {
    const result = changeStatusSchema.safeParse({
      shipmentId: '00000000-0000-4000-8000-000000000001',
      status: 'arrived',
    });
    expect(result.success).toBe(true);
  });

  it('合法状态 customs 通过', () => {
    const result = changeStatusSchema.safeParse({
      shipmentId: '00000000-0000-4000-8000-000000000001',
      status: 'customs',
    });
    expect(result.success).toBe(true);
  });

  it('warehoused 被 Zod 拒绝', () => {
    const result = changeStatusSchema.safeParse({
      shipmentId: '00000000-0000-4000-8000-000000000001',
      status: 'warehoused',
    });
    expect(result.success).toBe(false);
  });

  it('非法随机状态被拒绝', () => {
    const result = changeStatusSchema.safeParse({
      shipmentId: '00000000-0000-4000-8000-000000000001',
      status: 'invalid_status',
    });
    expect(result.success).toBe(false);
  });

  it('空状态被拒绝', () => {
    const result = changeStatusSchema.safeParse({
      shipmentId: '00000000-0000-4000-8000-000000000001',
      status: '',
    });
    expect(result.success).toBe(false);
  });

  it('无效 shipmentId 被拒绝', () => {
    const result = changeStatusSchema.safeParse({
      shipmentId: 'not-a-uuid',
      status: 'loading',
    });
    expect(result.success).toBe(false);
  });

  it('description 超过 500 字符被拒绝', () => {
    const result = changeStatusSchema.safeParse({
      shipmentId: '00000000-0000-4000-8000-000000000001',
      status: 'loading',
      description: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

describe('P3-S4A: advanceStatusSchema — 不含 warehoused', () => {
  it('合法状态 loading 通过', () => {
    const result = advanceStatusSchema.safeParse({
      shipmentId: '00000000-0000-4000-8000-000000000001',
      nextStatus: 'loading',
    });
    expect(result.success).toBe(true);
  });

  it('合法状态 departed 通过', () => {
    const result = advanceStatusSchema.safeParse({
      shipmentId: '00000000-0000-4000-8000-000000000001',
      nextStatus: 'departed',
    });
    expect(result.success).toBe(true);
  });

  it('合法状态 arrived 通过', () => {
    const result = advanceStatusSchema.safeParse({
      shipmentId: '00000000-0000-4000-8000-000000000001',
      nextStatus: 'arrived',
    });
    expect(result.success).toBe(true);
  });

  it('合法状态 customs 通过', () => {
    const result = advanceStatusSchema.safeParse({
      shipmentId: '00000000-0000-4000-8000-000000000001',
      nextStatus: 'customs',
    });
    expect(result.success).toBe(true);
  });

  it('warehoused 被 Zod 拒绝', () => {
    const result = advanceStatusSchema.safeParse({
      shipmentId: '00000000-0000-4000-8000-000000000001',
      nextStatus: 'warehoused',
    });
    expect(result.success).toBe(false);
  });

  it('booking 不作为 nextStatus 接受（起始状态不可作为目标）', () => {
    const result = advanceStatusSchema.safeParse({
      shipmentId: '00000000-0000-4000-8000-000000000001',
      nextStatus: 'booking',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Migration 00022 源码检查 ─────────────────────────────────────────────

const MIGRATION_00022 = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/00022_status_flow_validation.sql'),
  'utf-8',
);

describe('P3-S4A: Migration 00022 — 流转规则', () => {
  it('包含状态流转顺序校验 booking→loading', () => {
    expect(MIGRATION_00022).toMatch(/booking.*loading/);
  });

  it('包含状态流转顺序校验 loading→departed', () => {
    expect(MIGRATION_00022).toMatch(/loading.*departed/);
  });

  it('包含状态流转顺序校验 departed→arrived', () => {
    expect(MIGRATION_00022).toMatch(/departed.*arrived/);
  });

  it('包含状态流转顺序校验 arrived→customs', () => {
    expect(MIGRATION_00022).toMatch(/arrived.*customs/);
  });

  it('包含"仅允许按顺序推进"错误消息', () => {
    expect(MIGRATION_00022).toMatch(/仅允许按顺序推进/);
  });

  it('包含 status 不可从 X 变更为 Y 的异常格式', () => {
    expect(MIGRATION_00022).toMatch(/状态不可从.*变更为/);
  });

  it('仍拒绝 warehoused', () => {
    expect(MIGRATION_00022).toMatch(/warehoused/);
    expect(MIGRATION_00022).toMatch(/不支持手动推进到入仓/);
  });

  it('仍为 admin-only（v_role != admin）', () => {
    expect(MIGRATION_00022).toMatch(/v_role\s*!=\s*'admin'/);
  });

  it('仍包含 GET DIAGNOSTICS 确认命中目标行', () => {
    expect(MIGRATION_00022).toMatch(/GET DIAGNOSTICS/);
  });

  it('事务内同时包含 UPDATE + INSERT tracking_event', () => {
    expect(MIGRATION_00022).toMatch(/UPDATE\s+public\.shipment/);
    expect(MIGRATION_00022).toMatch(/INSERT INTO public\.tracking_event/);
  });

  it('权限收口：REVOKE FROM PUBLIC 和 FROM anon，GRANT TO authenticated', () => {
    expect(MIGRATION_00022).toMatch(/REVOKE EXECUTE.*FROM PUBLIC/);
    expect(MIGRATION_00022).toMatch(/REVOKE EXECUTE.*FROM anon/);
    expect(MIGRATION_00022).toMatch(/GRANT EXECUTE.*TO authenticated/);
  });
});

// ─── 轨迹展示 — detail page 源码检查 ──────────────────────────────────────

const DETAIL_PAGE = readFileSync(
  resolve(process.cwd(), 'src/app/dashboard/shipments/[id]/page.tsx'),
  'utf-8',
);

describe('P3-S4A: 详情页轨迹展示', () => {
  it('轨迹时间线显示创建人姓名', () => {
    expect(DETAIL_PAGE).toMatch(/creatorName/);
  });

  it('空轨迹显示"暂无物流轨迹"', () => {
    expect(DETAIL_PAGE).toMatch(/暂无物流轨迹/);
  });

  it('轨迹按 occurredAt 显示（camelCase，来自 TrackingEventDetail）', () => {
    expect(DETAIL_PAGE).toMatch(/occurredAt/);
  });

  it('显示状态中文标签（STATUS_LABELS）', () => {
    expect(DETAIL_PAGE).toMatch(/STATUS_LABELS/);
  });

  it('显示轨迹时间', () => {
    expect(DETAIL_PAGE).toMatch(/toLocaleString/);
  });
});

// ─── 仓库层 getById 源码检查 ──────────────────────────────────────────────

const REPO_SRC = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/repository.ts'),
  'utf-8',
);

describe('P3-S4A: repository getById — 轨迹增强', () => {
  it('tracking_event 查询 join profiles 获取 display_name', () => {
    expect(REPO_SRC).toMatch(/profile:created_by\s*\(\s*display_name\s*\)/);
  });

  it('tracking_event 按 occurred_at 升序排列', () => {
    expect(REPO_SRC).toMatch(/order\('occurred_at',\s*\{\s*ascending:\s*true\s*\}\)/);
  });

  it('事件映射返回 TrackingEventDetail 含 creatorName', () => {
    expect(REPO_SRC).toMatch(/creatorName/);
    expect(REPO_SRC).toMatch(/TrackingEventDetail/);
  });
});

describe('P3-S4A: repository changeStatus — 流转校验', () => {
  it('changeStatus 预读取当前 status', () => {
    expect(REPO_SRC).toMatch(/select\('status'\)/);
  });

  it('changeStatus 调用 isValidStatusTransition', () => {
    expect(REPO_SRC).toMatch(/isValidStatusTransition/);
  });
});

describe('P3-S4A: repository advanceStatus — 收口到 RPC', () => {
  // Extract only the advanceStatus method body for precise assertions
  const ADVANCE_STATUS_BODY = REPO_SRC.match(
    /async advanceStatus[\s\S]*?\n  },/,
  )?.[0] ?? '';

  it('advanceStatus 禁用 warehoused', () => {
    expect(ADVANCE_STATUS_BODY).toMatch(/warehoused/);
  });

  it('advanceStatus 委托 changeStatus（this.changeStatus）', () => {
    expect(ADVANCE_STATUS_BODY).toMatch(/this\.changeStatus/);
  });

  it('advanceStatus 方法体不含 .from(\'shipment\').update', () => {
    expect(ADVANCE_STATUS_BODY).not.toMatch(/\.from\('shipment'\)\.update/);
  });

  it('advanceStatus 方法体不含 .from(\'tracking_event\').insert', () => {
    expect(ADVANCE_STATUS_BODY).not.toMatch(/\.from\('tracking_event'\)\.insert/);
  });

  it('整文件不含 .from(\'tracking_event\').insert（唯一写路径已移除）', () => {
    expect(REPO_SRC).not.toMatch(/\.from\('tracking_event'\)\.insert/);
  });
});

// ─── ShipmentStatusChange 组件源码检查 ─────────────────────────────────────

const STATUS_CHANGE_SRC = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/components/shipment-status-change.tsx'),
  'utf-8',
);

describe('P3-S4A: ShipmentStatusChange 组件 — 仅下一合法状态', () => {
  it('使用 getNextValidStatus 获取下一合法状态', () => {
    expect(STATUS_CHANGE_SRC).toMatch(/getNextValidStatus/);
  });

  it('不导入 Select 组件（无下拉选择）', () => {
    expect(STATUS_CHANGE_SRC).not.toMatch(/from ['"]@\/components\/ui\/select['"]/);
  });

  it('无可推进状态时不显示按钮（canAdvance）', () => {
    expect(STATUS_CHANGE_SRC).toMatch(/canAdvance/);
  });

  it('显示"已是最终状态"提示', () => {
    expect(STATUS_CHANGE_SRC).toMatch(/已是最终状态/);
  });
});

// ─── actions.ts 源码检查 ──────────────────────────────────────────────────

const ACTIONS_SRC = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/actions.ts'),
  'utf-8',
);

describe('P3-S4A: actions — 权限与校验', () => {
  it('changeShipmentStatus 仅 Admin 可调用', () => {
    expect(ACTIONS_SRC).toMatch(/仅管理员可变更物流状态/);
  });

  it('advanceShipmentStatus 仅 Admin 可调用', () => {
    expect(ACTIONS_SRC).toMatch(/仅管理员可推进物流状态/);
  });

  it('advanceShipmentStatus 捕获 ShipmentError 并返回中文错误', () => {
    expect(ACTIONS_SRC).toMatch(/ShipmentError/);
  });
});
