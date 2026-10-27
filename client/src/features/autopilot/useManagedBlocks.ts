import { useQuery } from '@tanstack/react-query';
import { meApi, metaApi } from '../../api/endpoints';
import type { HostelBlock } from '../../types';

/**
 * The blocks the signed-in manager runs (the server decides: a supervisor's
 * assigned blocks or their hostel's, a chief warden's hostel plus the academic
 * blocks, every block for administrators).
 */
export function useManagedBlocks(): { blocks: HostelBlock[]; campusWide: boolean; isLoading: boolean } {
  const me = useQuery({ queryKey: ['me'], queryFn: meApi.getMe });
  const all = useQuery({ queryKey: ['meta-blocks'], queryFn: metaApi.getBlocks });
  const assigned = me.data?.managed_blocks ?? [];
  const campusWide = me.data?.campus_wide ?? assigned.length === 0;
  const blocks = (all.data ?? []).filter((b) => campusWide || assigned.includes(b.block_id));
  return { blocks, campusWide, isLoading: me.isLoading || all.isLoading };
}
