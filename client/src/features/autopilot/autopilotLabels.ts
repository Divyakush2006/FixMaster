import type { AutopilotMode, ExclusionReason, PerformanceFlagCode, ScoreComponent } from '../../types';

export const COMPONENT_LABEL: Record<ScoreComponent, string> = {
  quality: 'Ratings',
  load: 'Free capacity',
  idle: 'Time since last job',
  proximity: 'Nearby',
  reliability: 'On time, first time',
  roomHistory: 'Liked here before',
};

export const COMPONENT_HELP: Record<ScoreComponent, string> = {
  quality: 'Average resident rating over 60 days, pulled toward the campus average until there are enough ratings.',
  load: 'How far below their live-job cap they are.',
  idle: 'Brings in people who have been free for a while (up to 4 hours).',
  proximity: 'Already on this floor, in this block, or elsewhere.',
  reliability: 'Jobs finished within the deadline, minus jobs residents sent back.',
  roomHistory: 'This room rated them 4 or more before.',
};

export const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  OFF_DUTY: 'Off duty',
  ON_LEAVE: 'On leave today',
  OFF_SHIFT: 'Not on this shift',
  OTHER_BLOCK: 'Based in another block',
  AT_CAPACITY: 'At their live-job limit',
  BAD_EXPERIENCE_HERE: 'Rated badly here in the last 30 days',
  BLOCK_STAFF_AVAILABLE: 'Campus pool: block staff are available',
};

export const MODE_LABEL: Record<AutopilotMode, string> = { OFF: 'Off', SUGGEST: 'Suggest', AUTO: 'Automatic' };

export const MODE_HELP: Record<AutopilotMode, string> = {
  OFF: 'No suggestions. Supervisors choose every technician.',
  SUGGEST: 'Shows the best technician for each ticket; a supervisor confirms.',
  AUTO: 'Assigns new and sent-back tickets straight away. Supervisors can still reassign.',
};

export const FLAG_LABEL: Record<PerformanceFlagCode, string> = {
  LOW_RATING: 'Low ratings',
  HIGH_REWORK: 'Work often sent back',
  MISSED_SLA: 'Misses deadlines',
  LONG_IDLE: 'Idle on duty',
};

export const TAG_LABEL: Record<string, string> = {
  LATE: 'Late',
  NO_SHOW: 'Did not come',
  INCOMPLETE: 'Left unfinished',
  POOR_QUALITY: 'Poor work',
  REPEAT_ISSUE: 'Problem came back',
  RUDE: 'Rude',
  MESSY: 'Left a mess',
  POLITE: 'Polite',
  QUICK: 'Quick',
  THOROUGH: 'Thorough',
  CLEAN_AFTER: 'Cleaned up',
};

export const POSITIVE_TAGS = new Set(['POLITE', 'QUICK', 'THOROUGH', 'CLEAN_AFTER']);
