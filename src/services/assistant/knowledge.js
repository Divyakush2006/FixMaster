// Fixed, reviewed content the assistant uses. None of it is generated.

// Safety advice shown with a draft, keyed by issue code. Written once and
// checked by people, because a model must never improvise what someone
// should do next to a sparking socket or a burst pipe.
const SAFETY_ADVICE = {
    ELEC_SOCKET: 'Do not touch the socket or anything plugged into it. Switch off the room MCB if you can reach it safely, and keep water away.',
    ELEC_SWITCH: 'Do not use the switch board. If you see smoke or smell burning, switch off the room MCB and step out of the room.',
    ELEC_MCB: 'Do not keep resetting the MCB. Unplug heavy appliances (kettles, heaters, irons) before the electrician arrives.',
    AC_SMELL: 'Switch the AC off at the wall and open the window. If there is smoke, leave the room and tell the floor warden.',
    AC_LEAKAGE: 'Switch the AC off, move laptops and chargers away from the water, and put a bucket or towel under the drip.',
    CARP_DOOR_LOCK: 'If you are locked in or cannot lock your room, tell the floor warden now; keep valuables with you meanwhile.',
    CARP_BED: 'Do not sleep on the cracked bed until it is repaired. Ask the warden for a spare mattress if you need one tonight.',
    PLUMB_DRAIN: 'Stop using the washbasin so it does not overflow onto the floor.',
    INFRA_COOLER_TEMP: 'Use another floor’s water cooler meanwhile.',
    INFRA_COOLER_RO: 'Do not drink from this purifier until it is fixed; use another floor’s cooler.',
    INFRA_WASHROOM_BURST: 'Keep clear of the water - it may reach electrical points. Tell the floor warden now and use another washroom.',
    INFRA_LIFT_FAULT: 'Do not use this lift. If someone is stuck inside, call the security desk immediately; do not try to open the doors.',
};

// Keyword classifier: the non-AI fallback, and the cross-check that flags a
// draft whose issue type does not match its own description. English plus
// common Hinglish and Tamil-English spellings heard in the hostels.
const KEYWORDS = [
    ['INFRA_LIFT_FAULT', ['lift', 'elevator', 'stuck in lift', 'lift door']],
    ['INFRA_WASHROOM_BURST', ['pipe burst', 'burst pipe', 'flooding', 'water gushing', 'pipe phat', 'pipe toot']],
    ['INFRA_COOLER_RO', ['purifier', 'ro filter', 'bad taste', 'water tastes', 'filter choked']],
    ['INFRA_COOLER_TEMP', ['water cooler', 'cooler not cold', 'no cold water', 'thanda pani']],
    ['INFRA_CORRIDOR_LIGHT', ['corridor light', 'corridor lights', 'passage light', 'lobby light']],
    ['ELEC_SOCKET', ['socket', 'spark', 'sparking', 'plug point', 'charging point', 'shock']],
    ['ELEC_SWITCH', ['switch board', 'switchboard', 'switch burnt', 'burnt switch', 'switch loose']],
    ['ELEC_MCB', ['mcb', 'trip', 'tripped', 'no power', 'power cut', 'bijli nahi', 'current illa', 'light illa']],
    ['ELEC_FAN', ['fan', 'regulator', 'pankha']],
    ['ELEC_LIGHT', ['tube light', 'tubelight', 'bulb', 'light not working', 'flicker', 'flickering']],
    ['AC_SMELL', ['ac smell', 'burning smell', 'smell from ac']],
    ['AC_LEAKAGE', ['ac leak', 'ac dripping', 'water from ac', 'ac water']],
    ['AC_REMOTE', ['remote', 'error code', 'ac display']],
    ['AC_COOLING', ['ac not cooling', 'ac is not cooling', 'not cooling', 'ac warm', 'ac garam', 'weak airflow', 'ac not working']],
    ['CARP_DOOR_LOCK', ['door lock', 'lock jammed', 'latch', 'locked out', 'cannot lock', 'door not closing']],
    ['CARP_BED', ['bed', 'cot', 'plywood']],
    ['CARP_ALMIRAH', ['almirah', 'wardrobe', 'cupboard', 'hinge']],
    ['CARP_DESK_CHAIR', ['chair', 'table', 'desk']],
    ['PLUMB_GEYSER', ['geyser', 'hot water', 'garam pani', 'heater']],
    ['PLUMB_FLUSH', ['flush', 'toilet', 'commode', 'cistern']],
    ['PLUMB_DRAIN', ['drain', 'clogged', 'blocked sink', 'washbasin', 'choked']],
    ['PLUMB_TAP', ['tap', 'faucet', 'nal', 'leaking tap', 'dripping']],
    ['CLN_TRASH', ['dustbin', 'trash', 'garbage', 'kachra', 'waste bin']],
    ['CLN_DUSTING', ['dust', 'dusting', 'cobweb', 'balcony']],
    ['CLN_ROOM_SWEEP', ['clean', 'cleaning', 'sweep', 'mop', 'jhadu', 'pocha', 'dirty']],
];

/** Every issue code whose keywords appear in the text, in table order (most specific first). */
function keywordMatches(text) {
    const t = ` ${String(text || '').toLowerCase()} `;
    return KEYWORDS.filter(([, words]) => words.some((w) => t.includes(w))).map(([code]) => code);
}

module.exports = { SAFETY_ADVICE, keywordMatches };
