const { PRIVACY_NOTICE_VERSION } = require('./identity');
const { currentPolicy } = require('../services/retentionService');

// The privacy notice residents are shown (page /privacy, and a summary during
// onboarding). One source: change the text here, bump PRIVACY_NOTICE_VERSION in
// identity.js, and every resident whose consent is for an older version is
// asked to read and accept it again. The retention periods are read from the
// settings in force, so the notice cannot disagree with what the system does.

function notice() {
    const r = currentPolicy();
    const period = (days, what) => (days === 0 ? `${what}: kept.` : `${what}: removed after ${days} days.`);
    return {
        version: PRIVACY_NOTICE_VERSION,
        title: 'How FixMaster uses your information',
        intro:
            'FixMaster is the hostel maintenance and accommodation service of VIT Vellore. This notice says what the hostel office keeps about you, why, who can see it, how long it is kept, and what you can ask for. It follows the Digital Personal Data Protection Act, 2023.',
        sections: [
            {
                id: 'collected',
                title: 'What we keep',
                items: [
                    'Your account: name, registration number, university email and mobile number.',
                    'Your resident profile: school and programme, years, date of birth, gender, a parent or guardian and their phone number, your home address, and your preferred cleaning time. Health details (blood group, medical notes) are optional and only kept if you agree.',
                    'Your room allotment history.',
                    'Your maintenance tickets, the photos you attach, the technicians who worked on them, and your ratings and comments on the work.',
                    'Security records: when you signed in and from where, and actions taken on your account (the audit log).',
                ],
            },
            {
                id: 'why',
                title: 'Why we keep it',
                items: [
                    'To run your accommodation and to repair things in your room and block.',
                    'To reach your family in an emergency.',
                    'To measure and improve the service: how quickly work is done, and how residents rate it.',
                    'To keep the service secure and to investigate misuse.',
                ],
            },
            {
                id: 'who',
                title: 'Who can see it',
                items: [
                    'You can see your own record, and download all of it from your account.',
                    'The hostel office and administrators, for running the hostel.',
                    'Supervisors see tickets, and the names of the residents who raised them, for the blocks they manage. The chief warden sees every block.',
                    'Technicians see the room or place, the problem, and the priority. They do not see your profile, phone number or guardian details.',
                    'Roommates can see the tickets raised for your shared room.',
                ],
            },
            {
                id: 'outside',
                title: 'Outside services',
                items: [
                    'If you use "describe the problem", the words you type are shortened first: names, phone numbers, email addresses and registration numbers are removed. They may then be processed by an AI service (Groq, Google Gemini or OpenRouter) or by a model that runs on the university\'s own servers, to suggest a ticket. You review the suggestion before anything is sent. If no AI service is available the form works without it.',
                    'The daily briefings for supervisors are written from counts and places only, with no names.',
                    'Nothing in your resident profile is sent to any AI service. AI never decides a ticket\'s priority and never assigns a technician.',
                ],
            },
            {
                id: 'retention',
                title: 'How long we keep it',
                items: [
                    'Your account, profile and room history are kept while you live in the hostel. After you leave, you can ask for them to be erased (below).',
                    'Tickets and ratings are kept as the service record. When your data is erased they stay, without your name.',
                    period(r.ai_calls, 'Records of AI calls (no text, only which service answered and how fast)'),
                    period(r.ai_briefings, 'Stored daily briefings'),
                    period(r.email_verifications, 'Email confirmation codes'),
                    period(r.unverified_accounts, 'Sign-ups that were never confirmed'),
                    period(r.audit_log, 'The audit log'),
                ],
            },
            {
                id: 'rights',
                title: 'Your rights',
                items: [
                    'See and download everything we hold about you: Account, then Your data, then Download my data.',
                    'Correct your profile at any time from your account. To correct your name, email or room, contact the hostel office.',
                    'Withdraw your agreement to share health details by editing your profile.',
                    'Ask for your data to be erased: Account, then Your data. The hostel office does it once you have left your room and have no open tickets.',
                    'Complain to the hostel office about how your information is handled, and if you are not satisfied, to the Data Protection Board of India.',
                ],
            },
        ],
        contact: process.env.PRIVACY_CONTACT || 'the Hostel Estates Office, VIT Vellore',
        retention: r,
    };
}

module.exports = { notice };
