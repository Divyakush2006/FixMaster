import React from 'react';
import type { BlockKind, HostelType } from '../../types';
import { BLOCK_GROUPS, blockGroup, blockLabel, compareBlocks } from '../../utils/labels';

interface Props {
  blocks: { block_id: string; block_name?: string; hostel_type?: HostelType | null; block_kind?: BlockKind }[];
}

/**
 * The <option>s of a block dropdown, in the order people look for them: the men's
 * hostel (MH, then A to T), the ladies' hostel (A to H, J, S), then the academic
 * blocks. A list that holds only one group (a student's) gets no group headings.
 */
export const BlockOptions: React.FC<Props> = ({ blocks }) => {
  const sorted = blocks.slice().sort(compareBlocks);
  const groups = BLOCK_GROUPS.map((g) => ({ ...g, blocks: sorted.filter((b) => blockGroup(b) === g.key) })).filter((g) => g.blocks.length > 0);
  const option = (b: Props['blocks'][number]) => (
    <option key={b.block_id} value={b.block_id}>
      {b.block_name || blockLabel(b.block_id)}
    </option>
  );
  if (groups.length <= 1) return <>{sorted.map(option)}</>;
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g.key} label={g.label}>
          {g.blocks.map(option)}
        </optgroup>
      ))}
    </>
  );
};
