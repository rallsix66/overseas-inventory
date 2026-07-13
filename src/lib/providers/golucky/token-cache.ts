// 喜运达(golucky) SupabaseTokenCache — 生产数据库租约缓存
//
// 使用 provider_token_cache 表 + SECURITY DEFINER RPC 实现分布式租约模型。
// 仅服务端（service_role）可调用；页面和普通客户端无权访问。
//
// 并发安全：
//   - 每次 acquireLease 生成独立的 TokenLease（含 fresh UUID leaseId）
//   - storeToken / releaseLease 从 TokenLease.leaseId 提取租约 ID
//   - 无实例级共享可变字段 — 多并发调用互不干扰
//   - 首次缓存：INSERT 占位行 + ON CONFLICT DO NOTHING，仅一个调用方获胜
//   - 刷新缓存：UPDATE lease_owner WHERE lease_until < now（CAS 语义）
//   - 写回：UPDATE WHERE lease_owner = p_lease_id（严格所有权校验）
//
// InMemoryTokenCache 仅限 dry-run 和测试使用，生产环境必须使用 SupabaseTokenCache。

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { TokenCache, TokenLease } from './client';

/**
 * 基于 provider_token_cache 表的生产级 TokenCache。
 *
 * 租约模型：
 *   1. acquireLease → acquire_token_lease RPC（行锁 + 租约 ID）
 *   2. 事务外调外部 API 获取新 token（不持有 DB 锁）
 *   3. storeToken → store_token_with_lease RPC（lease.leaseId 所有权校验）
 *   4. 失败释放 → release_token_lease RPC（lease.leaseId 校验）
 *
 * 每个 acquireLease 返回的 TokenLease 包含独立的 leaseId（UUID）。
 * storeToken / releaseLease 必须使用同一次 acquireLease 返回的 lease。
 * 不存在跨并发请求的共享状态。
 */
export class SupabaseTokenCache implements TokenCache {
  private readonly supabase: SupabaseClient<Database>;

  constructor(supabase: SupabaseClient<Database>) {
    this.supabase = supabase;
  }

  async acquireLease(provider: string): Promise<TokenLease> {
    const leaseId = globalThis.crypto.randomUUID();

    const { data, error } = await this.supabase.rpc('acquire_token_lease', {
      p_provider: provider,
      p_lease_id: leaseId,
    });

    if (error) {
      throw new Error(`抢 Token 租约失败 (${provider}): ${error.message}`);
    }

    const result = data as {
      access_token: string | null;
      expires_at: string | null;
      action: 'reuse' | 'refresh' | 'first_time' | 'lease_held_by_other';
    };

    return {
      action: result.action,
      accessToken: result.access_token,
      expiresAt: result.expires_at,
      leaseId,
    };
  }

  async storeToken(
    provider: string,
    accessToken: string,
    expiresAt: string,
    lease: TokenLease,
  ): Promise<void> {
    const { error } = await this.supabase.rpc('store_token_with_lease', {
      p_provider: provider,
      p_access_token: accessToken,
      p_expires_at: expiresAt,
      p_lease_id: lease.leaseId,
    });

    if (error) {
      throw new Error(`Token 写回失败 (${provider}): ${error.message}`);
    }
  }

  async releaseLease(provider: string, lease: TokenLease): Promise<void> {
    const { error } = await this.supabase.rpc('release_token_lease', {
      p_provider: provider,
      p_lease_id: lease.leaseId,
    });

    // 释放失败不抛错（租约可能在写回时已自动清除）
    if (error) {
      console.warn(`释放 Token 租约失败 (${provider}): ${error.message}`);
    }
  }
}
