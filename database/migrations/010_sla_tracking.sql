-- ============================================================================
-- FIX_MASTER migration 010: SLA tracking
-- ----------------------------------------------------------------------------
-- Every issue category has a service level (complaint_categories.
-- default_sla_hours). A ticket is now due by sla_due_at = created_at + that
-- many hours. The clock stops when the work is marked done (resolved_at is
-- set) and runs again from the same deadline if a resident rejects the work,
-- because ESCALATED clears resolved_at (migration 008).
--
-- New tickets get sla_due_at from a trigger (migration 011); existing ones
-- are backfilled here.
-- ============================================================================

ALTER TABLE complaints ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMP WITH TIME ZONE;

UPDATE complaints c
SET sla_due_at = c.created_at + make_interval(hours => cat.default_sla_hours)
FROM complaint_subcategories sub
JOIN complaint_categories cat ON cat.category_id = sub.category_id
WHERE sub.subcategory_id = c.subcategory_id
  AND c.sla_due_at IS NULL;

-- The "what is overdue right now" scan only looks at unresolved live tickets.
CREATE INDEX IF NOT EXISTS idx_complaints_sla_open
    ON complaints (sla_due_at)
    WHERE status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ESCALATED');
