/*  Global Constants */

module.exports = {
    MINUTE_AT_EARLY: 15,     // The minute mark where early game has ended. Calculating @ / Diff
    MINUTE_AT_MID: 25,       // The minute mark where mid game has ended. Calculating @ / Diff
    PHASE1_BANS: 3,
    PHASE2_BANS: 2,
    BLUE_ID: "100",
    RED_ID: "200",
    SIDE_STRING: { 
        '100': 'Blue', 
        '200': 'Red', 
    },
    BARON_DURATION_PATCH_CHANGE: '9.23',
    // Baron duration is 3 minutes after this patch, 3.5 minutes before it
    OLD_BARON_DURATION: 210, // in seconds
    CURRENT_BARON_DURATION: 180, // in seconds
    LEADERBOARD_NUM: 5
}