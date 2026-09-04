import { requireUser } from '@/server/auth';
import { getRepositories } from '@/server/repo';
import { NotFoundError, withErrorHandling } from '@/server/http';

/** The kit exactly as Appendix A defines it, for taking elsewhere. */
type Context = { params: Promise<{ id: string }> };

export const GET = withErrorHandling(async (_request: Request, context: Context) => {
  const user = await requireUser();
  const { id } = await context.params;
  const record = await getRepositories().kits.findById(id, user.id);
  if (!record) throw new NotFoundError('Kit not found.');

  const filename = `${(record.kit.source.role || 'kit').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  return new Response(JSON.stringify(record.kit, null, 2), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
});
