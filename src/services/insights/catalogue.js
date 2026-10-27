const base = require('./reports');
const more = require('./moreReports');
const extra = require('./extraReports');

// The closed list of reports. Everything that can answer a question - the
// dashboards, the briefing and "Ask FixMaster" - comes from here, and a
// question can only ever select an entry; it is never turned into a query.
//
// Per entry:
//   title        shown with an answer
//   about        one line for the model that routes questions
//   keywords     the no-model router: first entry (in this order) with a hit wins
//   run(scope, { blockId, days })   scoped by the caller's blocks
//   answer(rows, { blockId, days }) the sentence(s) shown; fixed templates, never model text
//   usesDays     whether `days` changes the result

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const where = (p) => (p.blockId ? ` in ${p.blockId}` : '');
const hours = (h) => `${h} hour${h === 1 ? '' : 's'}`;
const clock = (h) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ROOM_TYPES = { AC: 'AC rooms', NON_AC: 'non-AC rooms', DELUXE_AC: 'deluxe AC rooms' };

const CATALOGUE = {
    // Specific phrases first: the keyword router takes the first entry with a hit.
    stale_tickets: {
        title: 'Tickets nobody has touched',
        about: 'open tickets with no update for three days or more',
        keywords: ['stale', 'untouched', 'no update', 'not touched', 'gone quiet', 'forgotten', 'no activity'],
        run: extra.staleTickets,
        answer: (rows, p) =>
            rows.length === 0
                ? `Every open ticket${where(p)} has had some activity in the last three days.`
                : `${plural(rows.length, 'open ticket')}${where(p)} ${rows.length === 1 ? 'has' : 'have'} had no update for three days or more. Quietest: ${rows[0].issue_name} at ${rows[0].location} (${rows[0].block_id}), ${rows[0].days_quiet} days.`,
    },
    upcoming_leave: {
        title: 'Technician leave starting soon',
        about: 'technicians whose leave starts in the next two weeks, and the open jobs they hold now',
        keywords: ['upcoming leave', 'leave next', 'leave coming', 'going on leave', 'next two weeks', 'on leave soon', 'planned leave'],
        run: extra.upcomingLeave,
        answer: (rows, p) =>
            rows.length === 0
                ? `No technician${where(p)} has leave starting in the next two weeks.`
                : `${plural(rows.length, 'technician')}${where(p)} ${rows.length === 1 ? 'has' : 'have'} leave starting in the next two weeks. First: ${rows[0].full_name} (${rows[0].specialization.toLowerCase().replace('_', ' ')}) from ${rows[0].starts_on}, holding ${plural(rows[0].open_jobs, 'open job')}.`,
    },
    first_response: {
        title: 'How quickly a technician is sent',
        about: 'how long it takes from a ticket being raised to a technician being sent, by priority',
        usesDays: true,
        keywords: ['first response', 'first reply', 'how quickly', 'how fast', 'time to assign', 'time to respond', 'respond'],
        run: extra.firstResponse,
        answer: (rows, p) => {
            if (rows.length === 0) return `No technician was sent to a ticket${where(p)} in the last ${p.days} days.`;
            const slowest = [...rows].sort((a, b) => b.median_hours - a.median_hours)[0];
            return `In the last ${p.days} days${where(p)}, a technician was sent after a median of ${hours(slowest.median_hours)} for ${slowest.priority.toLowerCase()}-priority tickets (nine in ten within ${hours(slowest.p90_hours)}), the slowest group.`;
        },
    },
    reassignments: {
        title: 'Jobs declined or moved',
        about: 'how often a job was declined or passed to a different technician before it was done',
        usesDays: true,
        keywords: ['reassign', 'declined', 'turned down', 'moved to someone', 'passed on', 'handed over'],
        run: extra.reassignments,
        answer: (r, p) =>
            r.tickets_assigned === 0
                ? `No tickets${where(p)} were assigned in the last ${p.days} days.`
                : `Of ${plural(r.tickets_assigned, 'assigned ticket')}${where(p)} in the last ${p.days} days, ${r.moved} (${r.moved_pct}%) went to more than one technician, and ${plural(r.declined, 'job')} ${r.declined === 1 ? 'was' : 'were'} declined.`,
    },
    rework_by_category: {
        title: 'Work most often sent back, by kind',
        about: 'which kinds of work residents most often say were not fixed',
        usesDays: true,
        keywords: ['rework rate', 'sent back most', 'redone most', 'kinds of work sent back', 'not fixed most'],
        run: extra.reworkByCategory,
        answer: (rows, p) =>
            rows.length === 0
                ? `No resident has given a verdict on finished work${where(p)} in the last ${p.days} days.`
                : `${rows[0].category_name} is sent back most${where(p)}: ${rows[0].sent_back} of ${rows[0].verdicts} verdicts (${rows[0].sent_back_pct}%) in the last ${p.days} days.`,
    },
    sla_by_priority: {
        title: 'Deadlines met, by priority',
        about: 'the share of finished tickets that met their deadline for each priority level',
        usesDays: true,
        keywords: ['by priority', 'per priority', 'each priority', 'priority level'],
        run: extra.slaByPriority,
        answer: (rows, p) => {
            const scored = rows.filter((r) => r.compliance_pct !== null);
            if (scored.length === 0) return `No tickets${where(p)} finished in the last ${p.days} days.`;
            const worst = [...scored].sort((a, b) => a.compliance_pct - b.compliance_pct)[0];
            return `Deadlines were met least often for ${worst.priority.toLowerCase()}-priority tickets${where(p)}: ${worst.compliance_pct}% (${worst.met} met, ${worst.breached} missed) in the last ${p.days} days.`;
        },
    },
    peak_hours: {
        title: 'Busiest hours of the day',
        about: 'what time of day tickets are raised',
        usesDays: true,
        keywords: ['peak hour', 'busy hour', 'time of day', 'which hour', 'hours of the day', 'what time'],
        run: extra.peakHours,
        answer: (rows, p) =>
            rows.length === 0
                ? `No tickets were raised${where(p)} in the last ${p.days} days.`
                : `Most tickets${where(p)} are raised around ${clock(rows[0].hour)} (${rows[0].tickets} in the last ${p.days} days)${rows[1] ? `, then ${clock(rows[1].hour)}` : ''}.`,
    },
    weekday_pattern: {
        title: 'Busiest days of the week',
        about: 'which days of the week tickets are raised on',
        usesDays: true,
        keywords: ['weekday', 'day of the week', 'which day', 'busiest day', 'weekend'],
        run: extra.weekdayPattern,
        answer: (rows, p) => {
            if (rows.length === 0) return `No tickets were raised${where(p)} in the last ${p.days} days.`;
            const top = [...rows].sort((a, b) => b.tickets - a.tickets)[0];
            const quiet = [...rows].sort((a, b) => a.tickets - b.tickets)[0];
            return `${WEEKDAYS[top.weekday - 1]} is the busiest day${where(p)} (${top.tickets} tickets in the last ${p.days} days) and ${WEEKDAYS[quiet.weekday - 1]} the quietest (${quiet.tickets}).`;
        },
    },
    room_type_faults: {
        title: 'Faults by room type',
        about: 'tickets per 100 rooms for AC, non-AC and deluxe AC rooms',
        usesDays: true,
        keywords: ['room type', 'ac room', 'non-ac', 'air condition', 'deluxe'],
        run: extra.roomTypeFaults,
        answer: (rows, p) =>
            rows.length === 0 || rows[0].tickets === 0
                ? `No room tickets${where(p)} in the last ${p.days} days.`
                : `${ROOM_TYPES[rows[0].room_type] || rows[0].room_type} raise the most tickets${where(p)}: ${rows[0].per_100_rooms} per 100 rooms in the last ${p.days} days (${rows[0].tickets} across ${rows[0].rooms} rooms).`,
    },
    top_rooms: {
        title: 'Rooms with the most tickets',
        about: 'individual rooms that have raised the most tickets',
        usesDays: true,
        keywords: ['which rooms', 'worst rooms', 'top rooms', 'problem rooms', 'rooms with the most', 'specific room'],
        run: extra.topRooms,
        answer: (rows, p) =>
            rows.length === 0
                ? `No room${where(p)} raised two or more tickets in the last ${p.days} days.`
                : `${plural(rows.length, 'room')}${where(p)} raised two or more tickets in the last ${p.days} days. Most: ${rows[0].room_number} in ${rows[0].block_id} (floor ${rows[0].floor_number}) with ${rows[0].tickets}, across ${plural(rows[0].kinds, 'kind')} of problem.`,
    },
    occupancy: {
        title: 'Beds and residents',
        about: 'how many beds each block has and how full they are',
        keywords: ['occupancy', 'occupied', 'beds', 'vacant', 'vacancy', 'how full', 'residents live'],
        run: extra.occupancy,
        answer: (rows, p) => {
            const beds = rows.reduce((s, r) => s + r.beds, 0);
            const residents = rows.reduce((s, r) => s + r.residents, 0);
            if (beds === 0) return `No beds are set up${where(p)}.`;
            return `${plural(residents, 'resident')} in ${plural(beds, 'bed')}${where(p)} (${Math.round((1000 * residents) / beds) / 10}% full). Fullest: ${rows[0].block_id} at ${rows[0].occupancy_pct}%.`;
        },
    },
    emergencies: {
        title: 'Open emergencies',
        about: 'emergency-priority tickets that are still open',
        keywords: ['emergency', 'emergencies', 'critical'],
        run: more.emergencies,
        answer: (rows, p) =>
            rows.length === 0
                ? `There are no open emergencies${where(p)}.`
                : `${plural(rows.length, 'emergency ticket')} open${where(p)}. Oldest: ${rows[0].issue_name} at ${rows[0].location} (${rows[0].block_id}), open ${hours(rows[0].hours_open)}${rows[0].assigned_to ? '' : ', with nobody assigned'}.`,
    },
    escalations: {
        title: 'Work residents sent back',
        about: 'tickets where the resident said the fix did not work and the job is waiting to be redone',
        keywords: ['escalat', 'sent back', 'send back', 'sending back', 'not fixed', 'reopen', 'came back', 'redo', 'rework'],
        run: more.escalations,
        answer: (rows, p) =>
            rows.length === 0
                ? `No tickets${where(p)} are waiting to be redone.`
                : `${plural(rows.length, 'ticket')}${where(p)} ${rows.length === 1 ? 'was' : 'were'} sent back by the resident and not yet redone. Most often sent back: ${rows[0].issue_name} at ${rows[0].location} (${rows[0].block_id}), ${rows[0].times_sent_back} times.`,
    },
    unassigned: {
        title: 'Tickets nobody has been sent to',
        about: 'tickets that no technician has been sent to yet',
        keywords: ['unassigned', 'no technician', 'nobody assigned', 'not assigned', 'waiting for', 'not been sent', 'not taken'],
        run: base.unassigned,
        answer: (rows, p) =>
            rows.length === 0
                ? `Every open ticket${where(p)} has a technician.`
                : `${plural(rows.length, 'ticket')}${where(p)} ${rows.length === 1 ? 'has' : 'have'} no technician yet. The longest wait is ${hours(Math.max(...rows.map((r) => r.hours_waiting)))}.`,
    },
    staffing_gaps: {
        title: 'Where staffing is short',
        about: 'blocks and trades with open tickets but no or too few technicians on duty',
        keywords: ['staffing', 'understaffed', 'short of', 'not enough', 'enough staff', 'enough technicians', 'coverage', 'no electrician', 'no plumber', 'no cleaner', 'shortage'],
        run: more.staffingGaps,
        answer: (rows, p) => {
            if (rows.length === 0) return `Every block${where(p)} has enough technicians on duty for its open work.`;
            const none = rows.filter((r) => r.status === 'NO_COVER');
            const first = rows[0];
            return (
                `${plural(rows.length, 'place')}${where(p)} ${rows.length === 1 ? 'is' : 'are'} short of staff` +
                (none.length ? `, ${none.length} with nobody on duty at all and no campus pool to help` : '') +
                `. Most pressing: ${first.block_id}, ${first.trade.toLowerCase().replace('_', ' ')} (${plural(first.open_tickets, 'open ticket')}, ${first.on_duty} on duty).`
            );
        },
    },
    staff_absence: {
        title: 'Technicians off duty or on leave',
        about: 'technicians who are off duty or on leave today, and the open jobs they still hold',
        keywords: ['absent', 'on leave', 'off duty', 'leave today', 'who is off', 'not working today'],
        run: more.staffAbsence,
        answer: (rows, p) =>
            rows.length === 0
                ? `Nobody${where(p)} is off duty or on leave today.`
                : `${plural(rows.length, 'technician')}${where(p)} ${rows.length === 1 ? 'is' : 'are'} off duty or on leave; ${rows.reduce((s, r) => s + r.open_jobs, 0)} open ${rows.reduce((s, r) => s + r.open_jobs, 0) === 1 ? 'job is' : 'jobs are'} still with them.`,
    },
    staff_flags: {
        title: 'Technicians who need a conversation',
        about: 'technicians flagged for low ratings, work often sent back, missed deadlines or long idle spells, with the evidence',
        keywords: ['flagged', 'low rated', 'poor performance', 'worst technician', 'technician performance', 'underperform', 'who needs coaching'],
        run: more.staffFlags,
        answer: (rows, p) =>
            rows.length === 0
                ? `No technician${where(p)} is flagged: everyone with enough rated jobs is within the thresholds.`
                : `${plural(rows.length, 'technician')}${where(p)} ${rows.length === 1 ? 'is' : 'are'} flagged. First: ${rows[0].full_name}, ${rows[0].flags[0].evidence.toLowerCase()}. Flags start a conversation; they are not penalties.`,
    },
    technician_workload: {
        title: 'Technician workload',
        about: 'how many live jobs each technician has right now, and who is free',
        keywords: ['workload', 'who is free', 'who is busy', 'busiest technician', 'idle', 'how busy', 'free technicians'],
        run: more.technicianWorkload,
        answer: (rows, p) => {
            if (rows.length === 0) return `No technicians${where(p)}.`;
            const free = rows.filter((r) => r.is_available && r.live_jobs === 0).length;
            return `${plural(rows.filter((r) => r.live_jobs > 0).length, 'technician')}${where(p)} ${rows.filter((r) => r.live_jobs > 0).length === 1 ? 'has' : 'have'} live jobs; ${free} on duty with none. Busiest: ${rows[0].full_name} with ${plural(rows[0].live_jobs, 'live job')}.`;
        },
    },
    autopilot_usage: {
        title: 'How much the autopilot does',
        about: 'how many assignments were made by the autopilot, accepted from its suggestion, or chosen by hand',
        usesDays: true,
        keywords: ['autopilot', 'auto-assign', 'automatically assigned', 'automation', 'by hand', 'manually assigned'],
        run: more.autopilotUsage,
        answer: (r, p) =>
            r.total === 0
                ? `No assignments were made${where(p)} in the last ${p.days} days.`
                : `Of ${plural(r.total, 'assignment')}${where(p)} in the last ${p.days} days, ${r.autopilot} were made by the autopilot, ${r.suggestion} accepted its suggestion and ${r.manual} were chosen by hand (${r.hands_on_pct}% by hand).`,
    },
    overdue_by_trade: {
        title: 'Overdue work by trade',
        about: 'open overdue and at-risk tickets grouped by trade',
        keywords: ['by trade', 'which trade', 'per trade', 'each trade'],
        run: more.overdueByTrade,
        answer: (rows, p) =>
            rows.length === 0 || rows[0].overdue + rows[0].at_risk === 0
                ? `No trade${where(p)} has overdue or at-risk work.`
                : `${rows[0].trade.toLowerCase().replace('_', ' ')} has the most late work${where(p)}: ${rows[0].overdue} overdue and ${rows[0].at_risk} close to the deadline among ${rows[0].open_tickets} open.`,
    },
    daily_volume: {
        title: 'Tickets per day',
        about: 'how many tickets were raised each day recently',
        usesDays: true,
        keywords: ['per day', 'daily', 'each day', 'day by day'],
        run: more.dailyVolume,
        answer: (rows, p) => {
            const total = rows.reduce((s, r) => s + r.tickets, 0);
            const busiest = [...rows].sort((a, b) => b.tickets - a.tickets)[0];
            return rows.length === 0 ? `No tickets were raised${where(p)}.` : `${plural(total, 'ticket')} were raised${where(p)} over ${plural(rows.length, 'day')}; the busiest day had ${busiest.tickets}.`;
        },
    },
    sla_compliance: {
        title: 'Deadlines met',
        about: 'what share or percentage of finished tickets met their deadline, by block',
        usesDays: true,
        keywords: ['compliance', 'sla', 'met the deadline', 'met their deadline', 'within the deadline', 'on time', 'how often', 'share', 'percent', '%'],
        run: more.slaCompliance,
        answer: (r, p) =>
            r.compliance_pct === null
                ? `No tickets${where(p)} finished in the last ${p.days} days.`
                : `${r.compliance_pct}% of tickets${where(p)} met their deadline in the last ${p.days} days (${r.met} met, ${r.breached} missed).` +
                  (r.blocks.length > 1 && r.blocks[0].compliance_pct !== null ? ` Lowest: ${r.blocks[0].block_id} at ${r.blocks[0].compliance_pct}%.` : ''),
    },
    breach_risk: {
        title: 'Tickets at risk of missing their deadline',
        about: 'open tickets that are overdue or close to their deadline',
        keywords: ['overdue', 'deadline', 'breach', 'at risk', 'at-risk', 'delayed', 'running out of time', 'late'],
        run: base.breachRisk,
        answer: (rows, p) =>
            rows.length === 0
                ? `No open tickets${where(p)} are overdue or close to their deadline.`
                : `${plural(rows.length, 'ticket')}${where(p)} ${rows.length === 1 ? 'is' : 'are'} overdue or close to the deadline; ${rows.filter((r) => r.sla_status === 'OVERDUE').length} already overdue. Most urgent: ${rows[0].issue_name} at ${rows[0].location} (${rows[0].block_id}).`,
    },
    rating_trend: {
        title: 'Resident ratings by week',
        about: 'the average rating residents give, week by week',
        usesDays: true,
        keywords: ['rating', 'satisfaction', 'stars', 'feedback score', 'happy'],
        run: more.ratingTrend,
        answer: (rows, p) => {
            const rated = rows.filter((r) => r.ratings > 0);
            if (rated.length === 0) return `No ratings were given${where(p)} in this period.`;
            const last = rated[rated.length - 1];
            const first = rated[0];
            return `Residents rated work${where(p)} ${last.avg_rating} out of 5 in the latest week (${plural(last.ratings, 'rating')}), against ${first.avg_rating} at the start of the period.`;
        },
    },
    volume_trend: {
        title: 'Ticket volume by week',
        about: 'how many tickets are raised each week, and whether any week or block is unusually busy',
        usesDays: true,
        keywords: ['unusual', 'spike', 'trend', 'busier', 'more than usual', 'weekly', 'week on week', 'volume', 'surge'],
        run: more.volumeTrend,
        answer: (r, p) => {
            const odd = r.weeks.filter((w) => w.unusual);
            const last = r.weeks[r.weeks.length - 1];
            let text = last ? `${last.tickets} tickets were raised${where(p)} last week` : `No weekly data${where(p)}`;
            text += odd.length ? `; ${plural(odd.length, 'week')} in the period ${odd.length === 1 ? 'was' : 'were'} unusually ${odd[0].z > 0 ? 'busy' : 'quiet'}.` : ', in line with the weeks before.';
            if (r.blocks.length) text += ` ${r.blocks[0].block_id} is well above its usual week (${r.blocks[0].last_7_days} against about ${r.blocks[0].usual_week}).`;
            return text;
        },
    },
    resolution_times: {
        title: 'How long work takes',
        about: 'how long each kind of work takes to finish compared with its deadline',
        usesDays: true,
        keywords: ['how long', 'resolution time', 'average time', 'turnaround', 'time to fix', 'time to resolve', 'speed'],
        run: more.resolutionTimes,
        answer: (rows, p) =>
            rows.length === 0
                ? `No tickets${where(p)} were finished in the last ${p.days} days.`
                : `Slowest to finish${where(p)}: ${rows[0].category_name}, ${hours(rows[0].avg_hours)} on average against a ${hours(rows[0].sla_hours)} deadline (${rows[0].within_deadline_pct}% on time).`,
    },
    busiest_floors: {
        title: 'Floors raising the most tickets',
        about: 'the floors that raise the most tickets',
        usesDays: true,
        keywords: ['which floor', 'busiest floor', 'floors'],
        run: more.busiestFloors,
        answer: (rows, p) =>
            rows.length === 0
                ? `No tickets were raised${where(p)} in the last ${p.days} days.`
                : `Busiest floor${where(p)}: floor ${rows[0].floor_number} of ${rows[0].block_id}, ${plural(rows[0].tickets, 'ticket')} in the last ${p.days} days (${rows[0].urgent} urgent).`,
    },
    recurring_faults: {
        title: 'Places with repeat faults',
        about: 'places where the same kind of fault keeps coming back',
        usesDays: true,
        keywords: ['recurring', 'repeat', 'keeps', 'hotspot', 'same problem', 'frequent'],
        run: base.recurringFaults,
        answer: (rows, p) =>
            rows.length === 0
                ? `No place${where(p)} has had the same kind of fault three or more times in ${p.days} days.`
                : `${plural(rows.length, 'place')}${where(p)} keep having the same fault. Worst: ${rows[0].location} (${rows[0].block_id}), ${rows[0].category_name.toLowerCase()}, ${rows[0].incidents} times in ${p.days} days.`,
    },
    block_comparison: {
        title: 'Blocks compared',
        about: 'all blocks side by side: volume, deadlines met, speed and ratings, worst first',
        usesDays: true,
        keywords: ['compare', 'comparison', 'which block', 'worst block', 'best block', 'rank', 'blocks performing', 'league'],
        run: more.blockComparison,
        answer: (rows, p) => {
            if (rows.length === 0) return `No tickets were raised in the last ${p.days} days.`;
            const worst = rows[0];
            return `Across ${plural(rows.length, 'block')} in the last ${p.days} days, ${worst.block_id} has the lowest share of deadlines met (${worst.compliance_pct === null ? 'none finished yet' : `${worst.compliance_pct}%`}), with ${worst.overdue_now} overdue now.`;
        },
    },
    category_mix: {
        title: 'What is being reported',
        about: 'which kinds of problem are raised most',
        usesDays: true,
        keywords: ['most common', 'most reported', 'what kind', 'what type', 'breakdown', 'categories', 'electrical', 'plumbing', 'carpentry', 'cleaning'],
        run: base.categoryMix,
        answer: (rows, p) =>
            rows.length === 0
                ? `No tickets were raised${where(p)} in the last ${p.days} days.`
                : `In the last ${p.days} days${where(p)}, the most reported area was ${rows[0].category_name.toLowerCase()} (${plural(rows[0].tickets, 'ticket')}, ${rows[0].urgent} urgent).`,
    },
    overview: {
        title: 'Campus overview',
        about: 'totals and per-block counts of open, overdue, at-risk, emergency and unassigned tickets, and average rating',
        keywords: ['overview', 'summary', 'how many', 'status', 'open tickets', 'total'],
        run: base.overview,
        answer: (r, p) => {
            const t = r.totals;
            const worst = [...r.blocks].sort((a, b) => b.overdue - a.overdue || b.open_tickets - a.open_tickets)[0];
            return (
                `${plural(t.open_tickets, 'ticket')} open${where(p)}: ${t.overdue} overdue, ${t.at_risk} close to the deadline, ${t.emergencies} emergency, ${t.unassigned} not yet assigned.` +
                (worst && worst.overdue > 0 ? ` ${worst.block_id} has the most overdue (${worst.overdue}).` : '')
            );
        },
    },
};

const NAMES = Object.keys(CATALOGUE);

module.exports = { CATALOGUE, NAMES };
