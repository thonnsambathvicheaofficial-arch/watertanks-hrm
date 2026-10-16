import { redirect } from 'next/navigation'
import { currentPagePermission, requireAccess, type Access } from '@/lib/access'

/**
 * Call first in every page. Next.js does not re-run a layout when you navigate between
 * pages, so a check in the layout alone would be skipped on a click; each page checks
 * for itself. The permission comes from the route table (lib/permissions.js); a page
 * that is not in the table needs an administrator.
 */
export async function guard(): Promise<Access> {
  const a = await requireAccess()
  if (!a.perms.includes(currentPagePermission())) redirect('/no-access')
  return a
}
