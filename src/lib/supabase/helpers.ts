// Supabase 查询辅助工具 — 安全解包 join 返回的嵌套对象
// Supabase join 查询返回的关联对象类型为 union (object | array | null)，
// 需要类型收窄后才能安全访问嵌套字段。

/**
 * 安全提取 Supabase join 返回的单个关联对象。
 *
 * Supabase 的 `select('*, child:child_id (col)')` 返回：
 *   { child: { col: '...' } | null }
 * 但类型为 `unknown`，需要类型收窄。
 *
 * @returns 关联对象或 null
 */
export function unwrapJoin<T>(obj: unknown): T | null {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return obj as T;
  }
  return null;
}
