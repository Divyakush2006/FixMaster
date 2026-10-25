const db = require('../config/db');
const { isGeminiEnabled, generateStructured } = require('../config/gemini');
const { Type } = require('@google/genai');
const { recordSuccess, recordFallback } = require('./aiHealthTracker');

/**
 * Step A: Determine required trade specialization from subcategory or category.
 */
async function resolveTrade(client, { subcategory_id, category_id }) {
    if (subcategory_id) {
        const res = await client.query(
            'SELECT required_specialization FROM complaint_subcategories WHERE subcategory_id = $1',
            [subcategory_id]
        );
        if (res.rows.length > 0 && res.rows[0].required_specialization) {
            return res.rows[0].required_specialization;
        }
    }
    if (category_id) {
        const catMap = {
            1: 'CLEANING',
            2: 'ELECTRICIAN',
            3: 'CARPENTER',
            4: 'AC_TECH',
            5: 'PLUMBER',
        };
        if (catMap[category_id]) return catMap[category_id];
    }
    return 'CLEANING';
}

/**
 * Step B: Query candidates with workload & floor proximity.
 */
async function getCandidates(client, trade, targetFloor) {
    const floor = Number.isInteger(targetFloor) ? targetFloor : 0;
    const res = await client.query(
        `SELECT u.user_id, u.full_name, u.specialization,
                COUNT(ca.assignment_id)::int AS active_tasks,
                COUNT(CASE WHEN r.floor_number = $2 THEN 1 END)::int AS same_floor_tasks
         FROM users u
         LEFT JOIN complaint_assignments ca 
             ON ca.staff_user_id = u.user_id 
            AND ca.current_state IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS')
         LEFT JOIN complaints c ON c.complaint_id = ca.complaint_id
         LEFT JOIN rooms r ON r.room_id = c.room_id
         WHERE u.role = 'STAFF'
           AND u.specialization = $1
           AND u.is_available = TRUE
           AND u.is_active = TRUE
         GROUP BY u.user_id, u.full_name, u.specialization
         ORDER BY active_tasks ASC, same_floor_tasks DESC, u.full_name ASC
         LIMIT 8`,
        [trade, floor]
    );
    return res.rows;
}

/**
 * Allocate a technician using Gemini or fallback.
 */
async function allocateTechnician({ subcategory_id, category_id, priority, floorNumber, preview = false, client = db }) {
    const trade = await resolveTrade(client, { subcategory_id, category_id });
    const candidates = await getCandidates(client, trade, floorNumber);

    if (candidates.length === 0) {
        return {
            selected_staff_user_id: null,
            staff_name: null,
            specialization: trade,
            allocation_reasoning: `No ${trade.toLowerCase()} staff currently available on duty. Ticket will remain queued for dispatch.`,
            meta: { source: 'fallback', candidates_count: 0 },
        };
    }

    // Deterministic fallback rule:
    // Sort by: EMERGENCY -> fewest active tasks first; otherwise fewest tasks + same floor proximity
    const fallbackCandidate = candidates[0];
    const fallbackReasoning = priority === 'EMERGENCY'
        ? `Emergency allocation: ${fallbackCandidate.full_name} has the lowest active queue (${fallbackCandidate.active_tasks} tasks) for fastest immediate dispatch.`
        : `Allocated to ${fallbackCandidate.full_name} based on active workload (${fallbackCandidate.active_tasks} tasks) and proximity to floor ${floorNumber ?? 'N/A'}.`;

    if (!isGeminiEnabled() || candidates.length === 1) {
        recordFallback('allocation');
        return {
            selected_staff_user_id: fallbackCandidate.user_id,
            staff_name: fallbackCandidate.full_name,
            specialization: trade,
            allocation_reasoning: fallbackReasoning,
            meta: { source: 'fallback', candidates_count: candidates.length },
        };
    }

    try {
        const candidateEnum = candidates.map((c) => c.user_id);
        const systemInstruction = `You are the FixMaster Smart Hostel Automated Dispatcher at VIT Vellore.
Select the optimal technician from the pre-filtered candidate list.
RULES:
1. For EMERGENCY priority, choose the technician with the lowest active_tasks for the fastest response.
2. For HIGH/MEDIUM/LOW priority, prefer technicians already on or near the target floor (same_floor_tasks) and balance workloads.
3. You MUST select selected_staff_user_id ONLY from the candidate IDs provided. Never invent a person.`;

        const responseSchema = {
            type: Type.OBJECT,
            properties: {
                selected_staff_user_id: { type: Type.STRING, enum: candidateEnum },
                allocation_reasoning: { type: Type.STRING },
            },
            required: ['selected_staff_user_id', 'allocation_reasoning'],
        };

        const prompt = `Target Issue Priority: ${priority || 'MEDIUM'}
Target Floor: ${floorNumber ?? 'Unknown'}
Required Specialization: ${trade}

Available Candidates:
${JSON.stringify(candidates, null, 2)}`;

        const decision = await generateStructured({
            systemInstruction,
            prompt,
            responseSchema,
        });

        const chosen = candidates.find((c) => c.user_id === decision.selected_staff_user_id);
        if (chosen) {
            recordSuccess('allocation');
            return {
                selected_staff_user_id: chosen.user_id,
                staff_name: chosen.full_name,
                specialization: trade,
                allocation_reasoning: decision.allocation_reasoning,
                meta: { source: 'gemini', candidates_count: candidates.length },
            };
        }
    } catch (err) {
        recordFallback('allocation', err);
        console.warn(`[AI Allocation] Gemini decision error: ${err.message}. Using deterministic fallback.`);
    }

    return {
        selected_staff_user_id: fallbackCandidate.user_id,
        staff_name: fallbackCandidate.full_name,
        specialization: trade,
        allocation_reasoning: fallbackReasoning,
        meta: { source: 'fallback', candidates_count: candidates.length },
    };
}

module.exports = {
    allocateTechnician,
    resolveTrade,
    getCandidates,
};
