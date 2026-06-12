// Dashboard 顶栏 — 用户信息 + 登出按钮
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';
import { LogoutButton } from './logout-button';

interface DashboardHeaderProps {
  displayName: string;
  roleName: string;
}

export function DashboardHeader({ displayName, roleName }: DashboardHeaderProps) {
  const isAdmin = roleName === 'admin';

  return (
    <header className="h-14 shrink-0 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      {/* 左侧占位 — 未来可放面包屑或搜索 */}
      <div />

      {/* 右侧用户区域 */}
      <div className="flex items-center gap-3">
        {/* 用户信息 */}
        <div className="flex items-center gap-2.5">
          {/* 头像占位 */}
          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-600">
            {displayName.slice(0, 2).toUpperCase()}
          </div>

          <div className="flex flex-col">
            <span className="text-sm font-medium text-gray-900 leading-tight">
              {displayName}
            </span>
            <span
              className={`text-xs leading-tight ${
                isAdmin ? 'text-purple-600' : 'text-blue-600'
              }`}
            >
              {isAdmin ? '管理员' : '运营'}
            </span>
          </div>
        </div>

        {/* 登出 */}
        <LogoutButton />
      </div>
    </header>
  );
}
