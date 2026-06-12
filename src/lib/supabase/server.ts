// Supabase 服务端客户端 — 用于 Server Components / Server Actions / API Routes
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database';

/**
 * Server Component / Server Action 中使用的 Supabase 客户端。
 * 通过 cookie 读取用户 session，自动携带认证信息。
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component 中不能设置 cookie，在 middleware 或 route handler 中处理
          }
        },
      },
    }
  );
}

/**
 * 使用 service_role key 的客户端 — 仅用于同步脚本等需要绕过 RLS 的后端场景。
 * 禁止在客户端代码或 Server Component 中使用。
 */
export function createServiceClient() {
  if (typeof window !== 'undefined') {
    throw new Error('createServiceClient 禁止在浏览器端调用');
  }

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // service_role 客户端不需要 session
        },
      },
    }
  );
}
