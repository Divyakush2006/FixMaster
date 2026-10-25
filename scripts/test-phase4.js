require('dotenv').config();
const { allocateTechnician, resolveTrade, getCandidates } = require('../src/services/aiAllocationService');
const db = require('../src/config/db');

async function testPhase4() {
    console.log('[Phase 4 Test] Testing Trade Resolution:');
    const tradeElec = await resolveTrade(db, { category_id: 2 });
    console.log(' - Category 2 trade:', tradeElec);
    if (tradeElec !== 'ELECTRICIAN') throw new Error('Expected ELECTRICIAN');

    const tradePlumb = await resolveTrade(db, { category_id: 5 });
    console.log(' - Category 5 trade:', tradePlumb);
    if (tradePlumb !== 'PLUMBER') throw new Error('Expected PLUMBER');

    console.log('\n[Phase 4 Test] Testing Candidate Query:');
    const elecCandidates = await getCandidates(db, 'ELECTRICIAN', 8);
    console.log(` - Electrician candidates (Floor 8 target): ${elecCandidates.length} found`);
    if (elecCandidates.length === 0) throw new Error('Expected at least 1 electrician candidate');
    elecCandidates.forEach((c) => {
        if (c.specialization !== 'ELECTRICIAN') throw new Error(`Non-electrician found: ${c.specialization}`);
    });

    console.log('\n[Phase 4 Test] Testing Allocation Decision:');
    const allocRes = await allocateTechnician({
        category_id: 2,
        priority: 'EMERGENCY',
        floorNumber: 8,
        preview: true,
    });
    console.log(' - Emergency Electrician Allocation Result:', allocRes);
    if (!allocRes.selected_staff_user_id || allocRes.specialization !== 'ELECTRICIAN') {
        throw new Error('Invalid technician allocation result');
    }

    console.log('\n[Phase 4 Test] ALL ASSERTIONS PASSED SUCCESSFULLY!');
    process.exit(0);
}

testPhase4().catch((err) => {
    console.error('[Phase 4 Test] FAILED:', err);
    process.exit(1);
});
