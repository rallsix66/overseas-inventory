import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const FEATURE_DIR = path.resolve(process.cwd(), 'src/features/in-transit');
const PAGE_PATH = path.resolve(
  process.cwd(),
  'src/app/dashboard/shipments/import/golucky/page.tsx',
);
const COMPONENT_PATH = path.resolve(
  FEATURE_DIR,
  'components/golucky-unbound-records.tsx',
);
const ACTIONS_PATH = path.resolve(FEATURE_DIR, 'actions.ts');
const REPOSITORY_PATH = path.resolve(FEATURE_DIR, 'repository.ts');
const BINDING_MIGRATION_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/00039_golucky_rls_rpc.sql',
);

describe('P0 Golucky 未绑定记录绑定界面', () => {
  it('导入页服务端读取未绑定记录并渲染绑定组件', () => {
    const source = fs.readFileSync(PAGE_PATH, 'utf8');

    expect(source).toContain("listUnboundExternalRefs('golucky')");
    expect(source).toContain('<GoluckyUnboundRecords');
    expect(source).toContain('records={unboundRecords}');
  });

  it('客户端只通过 Server Action 查询候选和执行绑定', () => {
    const source = fs.readFileSync(COMPONENT_PATH, 'utf8');

    expect(source).toContain('listShipmentBindingCandidates');
    expect(source).toContain('bindExternalRefToShipment');
    expect(source).not.toMatch(/createClient|supabase\.from|\.rpc\(/);
  });

  it('界面覆盖空状态、错误状态与不可逆操作提醒', () => {
    const source = fs.readFileSync(COMPONENT_PATH, 'utf8');

    expect(source).toContain('暂无未绑定的喜运达物流记录');
    expect(source).toContain('暂无可绑定的 Shipment');
    expect(source).toContain('role="alert"');
    expect(source).toContain('P0 暂不支持解绑');
  });

  it('候选查询要求有效登录并使用 Zod 校验外部记录 ID', () => {
    const source = fs.readFileSync(ACTIONS_PATH, 'utf8');
    const start = source.indexOf('export async function listShipmentBindingCandidates');
    const end = source.indexOf('/** P0: 获取同步失败', start);
    const actionSource = source.slice(start, end);

    expect(actionSource).toContain('requireActiveAuth()');
    expect(actionSource).toContain('listShipmentBindingCandidatesSchema.safeParse');
    expect(actionSource).toContain('externalTrackingRepository.listShipmentBindingCandidates');
  });

  it('Repository 只返回与外部记录同仓库、同国家的 Shipment', () => {
    const source = fs.readFileSync(REPOSITORY_PATH, 'utf8');
    const start = source.indexOf('async listShipmentBindingCandidates');
    const end = source.indexOf('/** P0: 查询同步失败', start);
    const methodSource = source.slice(start, end);

    expect(methodSource).toContain(".eq('provider', 'golucky')");
    expect(methodSource).toContain(".eq('warehouse_id', ref.warehouse_id)");
    expect(methodSource).toContain(".eq('country', ref.country)");
    expect(methodSource).toContain('if (ref.shipment_id)');
  });

  it('最终写入仍由数据库 RPC 验证用户、仓库、国家与并发绑定状态', () => {
    const source = fs.readFileSync(BINDING_MIGRATION_PATH, 'utf8');
    const start = source.indexOf('CREATE OR REPLACE FUNCTION public.bind_external_ref_to_shipment');
    const end = source.indexOf('CREATE OR REPLACE FUNCTION public.reactivate_external_ref', start);
    const functionSource = source.slice(start, end);

    expect(functionSource).toContain('auth.uid()');
    expect(functionSource).toContain('FOR UPDATE');
    expect(functionSource).toContain('v_ref.warehouse_id IS DISTINCT FROM v_shipment.warehouse_id');
    expect(functionSource).toContain('v_ref.country IS DISTINCT FROM v_shipment.country');
    expect(functionSource).toContain('v_ref.shipment_id IS NOT NULL');
  });
});
