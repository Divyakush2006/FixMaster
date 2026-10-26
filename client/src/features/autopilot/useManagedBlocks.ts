import { useQuery } from '@tanstack/react-query';
import { meApi, metaApi } from '../../api/endpoints';
import type { HostelBlock } from '../../types';

/**
 * The blocks the signed-in manager runs: a supervisor's assigned blocks, or
 * every block for chief wardens, administrators and unassigned supervisors.
 */
export function useManagedBlocks(): { blocks: HostelBlock[]; campusWide: boolean; isLoading: boolean } {
  const me = useQuery({ queryKey: ['me'], queryFn: meApi.getMe });
  const all = useQuery({ queryKey: ['meta-blocks'], queryFn: metaApi.getBlocks });
  const assigned = me.data?.managed_blocks ?? [];
  const campusWide = assigned.length === 0;
  const blocks = (all.data ?? []).filter((b) => campusWide || assigned.includes(b.block_id));
  return { blocks, campusWide, isLoading: me.isLoading || all.isLoading };
}
