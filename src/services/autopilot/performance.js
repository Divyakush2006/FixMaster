const db = require('../../config/db');
const { PRIOR_WEIGHT } = require('./scoring');

// The staff performance board: 60-day figures per technician and the flags a
// supervisor should look at, each with its evidence. Flags are prompts for a
// conversation, never automatic penalties, and need MIN_RATED_JOBS before
// they appear so one bad day does not label anyone.

const MIN_RATED_JOBS = 8;
const THRESHOLDS = { lowRating: 3.2, highRework: 0.25, lowOnTime: 0.6, longIdleHours: 48 };

async function staffPerformance({ blocks = null, specialization = null } = {}) {
    const params = [];
    const where = ["u.role = 'STAFF'", 'u.is_active'];
    if (specialization) {
        params.push(specialization);
        where.push(`u.specialization = $${params.length}`);
    }
    if (blocks) {
        params.push(blocks);
        where.push(`(u.home_block_id IS NULL OR u.home_block_id = ANY($${params.length}::varchar[]))`);
    }
    const { rows } = await db.query(
        `WITH fb AS (
             SELECT staff_user_id, COUNT(rating)::int AS rated, AVG(rating)::float AS avg_rating,
                    COUNT(*)::int AS rounds, COUNT(*) FILTER (WHERE NOT satisfied)::int AS sent_back
             FROM view_staff_feedback WHERE verified_at >= NOW() - INTERVAL '60 days' GROUP BY staff_user_id
         ), done AS (
             SELECT a.staff_user_id, COUNT(*)::int AS completed,
                    COUNT(*) FILTER (WHERE a.work_completed_at <= c.created_at + make_interval(hours => cat.default_sla_hours))::int AS on_time,
                    AVG(EXTRACT(EPOCH FROM (a.work_completed_at - a.assigned_at)) / 60)::float AS avg_minutes
             FROM complaint_assignments a
             JOIN complaints c ON c.complaint_id = a.complaint_id
             JOIN complaint_subcategories sub ON sub.subcategory_id = c.subcategory_id
             JOIN complaint_categories cat ON cat.category_id = sub.category_id
             WHERE a.work_completed_at >= NOW() - INTERVAL '60 days'
             GROUP BY a.staff_user_id
         ), live AS (
             SELECT staff_user_id, COUNT(*)::int AS live_jobs FROM complaint_assignments
             WHERE current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS') GROUP BY staff_user_id
         ), last AS (
             SELECT staff_user_id, MAX(assigned_at) AS last_assigned_at FROM complaint_assignments GROUP BY staff_user_id
         ), tags AS (
             SELECT v.staff_user_id, t.tag, COUNT(*)::int AS n
             FROM view_staff_feedback v JOIN feedback_tags ft ON ft.feedback_id = v.feedback_id, unnest(ft.tags) AS t(tag)
             WHERE v.verified_at >= NOW() - INTERVAL '60 days'
             GROUP BY v.staff_user_id, t.tag
         )
         SELECT u.user_id, u.full_name, u.reg_or_emp_id, u.specialization, u.home_block_id, u.shift, u.is_available,
                COALESCE(fb.rated, 0) AS rated_jobs, fb.avg_rating, COALESCE(fb.rounds, 0) AS verification_rounds, COALESCE(fb.sent_back, 0) AS sent_back,
                COALESCE(done.completed, 0) AS completed, COALESCE(done.on_time, 0) AS on_time, done.avg_minutes,
                COALESCE(live.live_jobs, 0) AS live_jobs, last.last_assigned_at,
                COALESCE((SELECT json_object_agg(tag, n) FROM tags WHERE tags.staff_user_id = u.user_id), '{}'::json) AS comment_tags
         FROM users u
         LEFT JOIN fb ON fb.staff_user_id = u.user_id
         LEFT JOIN done ON done.staff_user_id = u.user_id
         LEFT JOIN live ON live.staff_user_id = u.user_id
         LEFT JOIN last ON last.staff_user_id = u.user_id
         WHERE ${where.join(' AND ')}
         ORDER BY u.specialization, u.full_name`,
        params
    );
    const campus = rows.filter((r) => r.rated_jobs > 0);
    const campusMean = campus.length ? campus.reduce((s, r) => s + r.avg_rating * r.rated_jobs, 0) / campus.reduce((s, r) => s + r.rated_jobs, 0) : 4;
    const now = Date.now();

    return rows.map((r) => {
        const smoothed = r.rated_jobs ? (r.avg_rating * r.rated_jobs + campusMean * PRIOR_WEIGHT) / (r.rated_jobs + PRIOR_WEIGHT) : null;
        const reworkRate = r.verification_rounds ? r.sent_back / r.verification_rounds : 0;
        const onTimeRate = r.completed ? r.on_time / r.completed : null;
        const idleHours = r.last_assigned_at ? (now - new Date(r.last_assigned_at)) / 3600000 : null;
        const flags = [];
        if (r.rated_jobs >= MIN_RATED_JOBS) {
            if (smoothed < THRESHOLDS.lowRating) flags.push({ code: 'LOW_RATING', evidence: `Average ${r.avg_rating.toFixed(1)} over ${r.rated_jobs} rated jobs` });
            if (reworkRate > THRESHOLDS.highRework) flags.push({ code: 'HIGH_REWORK', evidence: `${r.sent_back} of ${r.verification_rounds} jobs sent back by residents` });
            if (onTimeRate !== null && r.completed >= MIN_RATED_JOBS && onTimeRate < THRESHOLDS.lowOnTime)
                flags.push({ code: 'MISSED_SLA', evidence: `${r.on_time} of ${r.completed} jobs finished within the deadline` });
        }
        if (r.is_available && r.live_jobs === 0 && idleHours !== null && idleHours > THRESHOLDS.longIdleHours)
            flags.push({ code: 'LONG_IDLE', evidence: `On duty with no job for ${Math.floor(idleHours)} hours` });
        return {
            ...r,
            avg_rating: r.avg_rating === null ? null : Math.round(r.avg_rating * 100) / 100,
            smoothed_rating: smoothed === null ? null : Math.round(smoothed * 100) / 100,
            rework_rate: Math.round(reworkRate * 1000) / 1000,
            on_time_rate: onTimeRate === null ? null : Math.round(onTimeRate * 1000) / 1000,
            avg_minutes: r.avg_minutes === null ? null : Math.round(r.avg_minutes),
            flags,
        };
    });
}

module.exports = { staffPerformance, MIN_RATED_JOBS, THRESHOLDS };
