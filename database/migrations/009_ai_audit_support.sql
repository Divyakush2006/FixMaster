-- ============================================================================
-- FIX_MASTER migration 009: AI audit columns and allocation performance indexes
-- ----------------------------------------------------------------------------
-- Adds non-breaking audit columns to track AI reasoning, safety advisories,
-- and flag whether priority or technician allocation were decided by Gemini.
-- ============================================================================

-- 1. AI audit fields on complaints
ALTER TABLE complaints
    ADD COLUMN IF NOT EXISTS ai_priority_reasoning TEXT,
    ADD COLUMN IF NOT EXISTS ai_safety_advisory TEXT,
    ADD COLUMN IF NOT EXISTS ai_decided BOOLEAN DEFAULT FALSE;

-- 2. AI allocation fields on complaint_assignments
ALTER TABLE complaint_assignments
    ADD COLUMN IF NOT EXISTS ai_allocation_reasoning TEXT,
    ADD COLUMN IF NOT EXISTS ai_allocated BOOLEAN DEFAULT FALSE;

-- 3. Allocation and candidate lookup performance indexes
CREATE INDEX IF NOT EXISTS idx_complaints_ai_decided ON complaints (ai_decided);
CREATE INDEX IF NOT EXISTS idx_assignments_ai_allocated ON complaint_assignments (ai_allocated);
CREATE INDEX IF NOT EXISTS idx_assignments_staff_state_composite 
    ON complaint_assignments (staff_user_id, current_state);
