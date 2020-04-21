/* 
    AWS LAMBDA FUNCTION 1: Insert a matchId (and a couple of other parameters) and process its Match Data
    This function affects the following:
    - MySQL: [All] MatchStats, PlayerStats, TeamStats, Objectives, BannedChamps
    - DynamoDB: Match table
*/

/*  Declaring npm modules */
const Hashids = require('hashids/cjs'); // For hashing and unhashing
const mysql = require('mysql'); // Interfacing with mysql DB
var AWS = require('aws-sdk'); // Interfacing with DynamoDB
const { Kayn, REGIONS, BasicJSCache } = require('kayn'); // Riot API Wrapper

/* 
    Import from other files that are not committed to Github
    Contact doowan about getting a copy of these files
*/
//const inputObjects = require('./external/singularTest');
const inputObjects = require('./external/matchIdList');
const envVars = require('./external/env');

/*  Global variable constants */
const MINUTE_AT_EARLY = 15;     // The minute mark where early game has ended. Calculating @ / Diff
const MINUTE_AT_MID = 25;       // The minute mark where mid game has ended. Calculating @ / Diff
const PHASE2_BANS = 2;
const BLUE_ID = 100;
const RED_ID = 200;
const SIDE_STRING = { [BLUE_ID]: 'Blue', [RED_ID]: 'Red' };
const BARON_DURATION_PATCH_CHANGE = '9.23';
// Baron duration is 3 minutes after this patch, 3.5 minutes before it
const OLD_BARON_DURATION = 210; // in seconds
const CURRENT_BARON_DURATION = 180; // in seconds

/*  Put 'false' to test without affecting the databases. */
const PUT_INTO_DYNAMO = true;       // 'true' when comfortable to push into DynamoDB
const INSERT_INTO_MYSQL = true;    // 'true' when comfortable to push into MySQL
/*  Put 'false' to not debug. */
const DEBUG_DYNAMO = false;
const DEBUG_MYSQL = false;

/*  Configurations of npm modules */
AWS.config.update({ region: 'us-east-2' });
var dynamoDB = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' });
const profileHashIds = new Hashids(envVars.PROFILE_HID_SALT, envVars.HID_LENGTH); // process.env.PROFILE_HID_SALT, process.env.HID_LENGTH
const teamHashIds = new Hashids(envVars.TEAM_HID_SALT, envVars.HID_LENGTH); // process.env.TEAM_HID_SALT,
const kaynCache = new BasicJSCache();
const kayn = Kayn(envVars.RIOT_API_KEY)({ // process.env.RIOT_API_KEY
    region: REGIONS.NORTH_AMERICA,
    apiURLPrefix: 'https://%s.api.riotgames.com',
    locale: 'en_US',
    debugOptions: {
        isEnabled: true,
        showKey: false,
    },
    requestOptions: {
        shouldRetry: true,
        numberOfRetriesBeforeAbort: 3,
        delayBeforeRetry: 1000 * 60 * 2, // 2 minutes
        burst: false,
        shouldExitOn403: true,
    },
    cacheOptions: {
        cache: kaynCache,
        timeToLives: {
            useDefault: true,
            byGroup: {
                DDRAGON: 1000 * 60 * 60 * 24 * 30, // Cache for month
                MATCH: 1000 * 60 * 60 * 24 * 30 // Cache for month
            },
            byMethod: {},
        },
    },
});
const sqlPool = mysql.createPool({
    connectionLimit: 10,
    host: envVars.MYSQL_ENDPOINT,       //process.env.MYSQL_ENDPOINT
    user: envVars.MYSQL_USER,           //process.env.MYSQL_USER
    password: envVars.MYSQL_PASSWORD,   //process.env.MYSQL_PASSWORD
    port: envVars.MYSQL_PORT,           //process.env.MYSQL_PORT
    database: envVars.MYSQL_DATABASE_STATS //process.env.MYSQL_DATABASE_STATS
});

/*  Main AWS Lambda Function. We'll come back to this later */
exports.handler = async (event, context) => {
    
    if ('manual' in event) {
        
    }
    
};

async function main() {
    try {
        for (var i = 0; i < inputObjects.length; ++i) {
            var inputObject = inputObjects[i];
            // Check if MatchPId is already in DynamoDB
            if (!(await doesItemExistInDynamoDB("Matches", "MatchPId", inputObject['gameId'].toString()))) {
                console.log("Processing new match ID: " + inputObject['gameId']);
                var matchRiotObject = await kayn.Match.get(inputObject['gameId']);
                var timelineRiotObject = await kayn.Match.timeline(inputObject['gameId']);
                if (!(matchRiotObject === undefined || matchRiotObject === null || timelineRiotObject === undefined || timelineRiotObject === null)) {
                    var lhgMatchObject = await promiseLhgMatchObject(inputObject, matchRiotObject, timelineRiotObject);
                    await putMatchDataInDBs(lhgMatchObject, inputObject);
                }
            }
        }
    }
    catch (err) {
        console.log("ERROR thrown! Information below.");
        console.log("Stack: ", err.stack);
        console.log("Name: ", err.name);
        console.log("Message: ", err.message);
    }
}

main();

// Returns a Promise
function putMatchDataInDBs(lhgMatchObject, inputObject) {
    return new Promise(async function(resolve, reject) {
        try {
            await insertMatchObjectMySql(lhgMatchObject, inputObject);
            console.log("MySQL: All data from \'" + lhgMatchObject.MatchPId + "\' inserted.");
            await putItemInDynamoDB('Matches', lhgMatchObject, lhgMatchObject.MatchPId);
            resolve(0);
        }
        catch (err) {
            console.error("ERROR - putMatchDataInDBs Promise rejected.");
            reject(err);
        }
    });
}

/*  
    ----------------------
    Database Functions
    ----------------------
*/

// Function used to return the actual Promise. Just to make it look cleaner
function promiseLhgMatchObject(eventInputObject, matchRiotObject, timelineRiotObject) {
    return new Promise(function(resolve, reject) {
        try {
            resolve(createLhgMatchObject(eventInputObject, matchRiotObject, timelineRiotObject));
        }
        catch (err) {
            console.error("ERROR - lhgMatchObject Promise rejected.");
            reject(err);
        }
    });
}

// Successful callback of kayn.timeline from MatchV4
// With both Jsons, we'll be storing into the DB now
async function createLhgMatchObject(eventInputObject, matchRiotObject, timelineRiotObject) {
    try {
        // ----- 1) Add onto matchObj of profileHId
        profileObjByChampId = {}
        playerArr = eventInputObject['players']; // Array
        for (i = 0; i < playerArr.length; i++) {
            player = playerArr[i];
            profileObjByChampId[player.championId] = {
                name: player.profileName,
                role: player.role
            };
        }

        // ----- 2) Create the Match item for DynamoDB
        matchObject = {};
        matchObject['MatchPId'] = eventInputObject.gameId.toString();
        matchObject['RiotMatchId'] = eventInputObject.gameId.toString();
        matchObject['SeasonPId'] = eventInputObject.seasonPId;
        matchObject['TournamentPId'] = eventInputObject.tournamentPId;
        matchObject['DatePlayed'] = matchRiotObject.gameCreation;
        matchObject['GameDuration'] = matchRiotObject.gameDuration;
        var patch = getPatch(matchRiotObject.gameVersion);
        matchObject['GamePatchVersion'] = patch;
        matchObject['DDragonVersion'] = await getDDragonVersion(patch);

        // 2.1) - Teams+Players
        var teamItems = {}; // teamId (100 or 200) -> teamData {}
        var playerItems = {}; // participantId -> playerData {}
        // We will merge these two Items at 2.3)
        var teamIdByPartId = {}; // Mapping participantId -> teamId in timeline
        var partIdByTeamIdAndRole = {};
        for (i = 0; i < matchRiotObject.teams.length; i++) {
            teamRiotObject = matchRiotObject.teams[i];
            var teamData = {};
            var teamId = teamRiotObject.teamId; // 100 == BLUE, 200 == RED
            partIdByTeamIdAndRole[teamId] = {};
            if (teamId == BLUE_ID) {
                teamData['TeamHId'] = (await getItemInDynamoDB('TeamNameMap', 'TeamName', eventInputObject.blueTeamName.toLowerCase().replace(/ /g, '')))['TeamHId'];
            }
            else if (teamId == RED_ID) {
                teamData['TeamHId'] = (await getItemInDynamoDB('TeamNameMap', 'TeamName', eventInputObject.redTeamName.toLowerCase().replace(/ /g, '')))['TeamHId'];
            }
            if (teamRiotObject.win == 'Win') {
                teamData['Win'] = true;
            }
            else {
                teamData['Win'] = false;
            }
            teamData['Towers'] = teamRiotObject.towerKills;
            teamData['Inhibitors'] = teamRiotObject.inhibitorKills;
            teamData['Barons'] = teamRiotObject.baronKills;
            teamData['Dragons'] = []; // Will be built upon in Timeline
            teamData['Heralds'] = teamRiotObject.riftHeraldKills;
            var phase1BanArr = [];
            var phase2BanArr = [];
            // We're going to work backwards from the Array in the riotJson.
            // Implementation will take assumption that if there's a ban loss, it is always the first X bans
            // First, we need to sort the array of both team bans
            var teamBansSorted = teamRiotObject.bans.sort((a, b) => (a.pickTurn > b.pickTurn) ? 1 : -1);
            for (j = 0; j < teamBansSorted.length; j++) {
                var riotObjIdx = teamBansSorted.length - j - 1; // Start at end of index
                var banObj = teamBansSorted[riotObjIdx];
                if (j < PHASE2_BANS) {
                    phase2BanArr.unshift(banObj.championId);
                }
                else {
                    phase1BanArr.unshift(banObj.championId);
                }
            }
            teamData['Phase1Bans'] = phase1BanArr;
            teamData['Phase2Bans'] = phase2BanArr;
            teamData['FirstTower'] = teamRiotObject.firstTower;
            teamData['FirstBlood'] = teamRiotObject.firstBlood;
            var teamKills = 0;
            var teamAssists = 0;
            var teamDeaths = 0;
            var teamGold = 0;
            var teamDamageDealt = 0;
            var teamCreepScore = 0;
            var teamVisionScore = 0;
            var teamWardsPlaced = 0;
            var teamControlWardsBought = 0;
            var teamWardsCleared = 0;
            for (j = 0; j < matchRiotObject.participants.length; j++) {
                var playerData = {}
                var participantRiotObject = matchRiotObject.participants[j];
                if (participantRiotObject.teamId == teamId) {
                    var partId = participantRiotObject.participantId;
                    teamIdByPartId[partId] = teamId;
                    var pStatsRiotObject = participantRiotObject.stats;
                    var profileName = profileObjByChampId[participantRiotObject.championId].name;
                    //console.log(profileName);
                    playerData['ProfileHId'] = (await getItemInDynamoDB('ProfileNameMap', 'ProfileName', profileName.toLowerCase().replace(/ /g, '')))['ProfileHId'];
                    playerData['ParticipantId'] = partId;
                    var champRole = profileObjByChampId[participantRiotObject.championId].role;
                    playerData['Role'] = champRole;
                    partIdByTeamIdAndRole[teamId][champRole] = partId;
                    playerData['ChampLevel'] = pStatsRiotObject.champLevel;
                    playerData['ChampId'] = participantRiotObject.championId;
                    playerData['Spell1Id'] = participantRiotObject.spell1Id;
                    playerData['Spell2Id'] = participantRiotObject.spell2Id;
                    playerData['Kills'] = pStatsRiotObject.kills;
                    teamKills += pStatsRiotObject.kills;
                    playerData['Deaths'] = pStatsRiotObject.deaths;
                    teamDeaths += pStatsRiotObject.deaths;
                    playerData['Assists'] = pStatsRiotObject.assists;
                    teamAssists += pStatsRiotObject.assists;
                    playerData['Gold'] = pStatsRiotObject.goldEarned;
                    teamGold += pStatsRiotObject.goldEarned;
                    playerData['TotalDamageDealt'] = pStatsRiotObject.totalDamageDealtToChampions;
                    teamDamageDealt += pStatsRiotObject.totalDamageDealtToChampions;
                    playerData['PhysicalDamageDealt'] = pStatsRiotObject.physicalDamageDealtToChampions;
                    playerData['MagicDamageDealt'] = pStatsRiotObject.magicDamageDealtToChampions;
                    playerData['TrueDamageDealt'] = pStatsRiotObject.trueDamageDealtToChampions;
                    var totalCS = pStatsRiotObject.neutralMinionsKilled + pStatsRiotObject.totalMinionsKilled;
                    playerData['CreepScore'] = totalCS;
                    teamCreepScore += totalCS;
                    playerData['CsInTeamJungle'] = pStatsRiotObject.neutralMinionsKilledTeamJungle;
                    playerData['CsInEnemyJungle'] = pStatsRiotObject.neutralMinionsKilledEnemyJungle;
                    playerData['VisionScore'] = pStatsRiotObject.visionScore;
                    teamVisionScore += pStatsRiotObject.visionScore;
                    playerData['WardsPlaced'] = pStatsRiotObject.wardsPlaced;
                    teamWardsPlaced += pStatsRiotObject.wardsPlaced;
                    playerData['ControlWardsBought'] = pStatsRiotObject.visionWardsBoughtInGame;
                    teamControlWardsBought += pStatsRiotObject.visionWardsBoughtInGame;
                    playerData['WardsCleared'] = pStatsRiotObject.wardsKilled;
                    teamWardsCleared += pStatsRiotObject.wardsKilled;
                    playerData['FirstBloodKill'] = false; // Logic in Timeline
                    playerData['FirstBloodAssist'] = false; // Logic in Timeline
                    playerData['FirstBloodVictim'] = false; // Logic in Timeline
                    playerData['FirstTower'] = (pStatsRiotObject.firstTowerKill || pStatsRiotObject.firstTowerAssist);
                    playerData['SoloKills'] = 0; // Logic in Timeline
                    playerData['PentaKills'] = pStatsRiotObject.pentaKills;
                    playerData['QuadraKills'] = pStatsRiotObject.quadraKills - pStatsRiotObject.pentaKills;
                    playerData['TripleKills'] = pStatsRiotObject.tripleKills - pStatsRiotObject.quadraKills;
                    playerData['DoubleKills'] = pStatsRiotObject.doubleKills - pStatsRiotObject.tripleKills;
                    playerData['DamageToTurrets'] = pStatsRiotObject.damageDealtToTurrets;
                    playerData['DamageToObjectives'] = pStatsRiotObject.damageDealtToObjectives;
                    playerData['TotalHeal'] = pStatsRiotObject.totalHeal;
                    playerData['TimeCrowdControl'] = pStatsRiotObject.timeCCingOthers;
                    playerData['ItemsFinal'] = [pStatsRiotObject.item0, pStatsRiotObject.item1, 
                        pStatsRiotObject.item2, pStatsRiotObject.item3, pStatsRiotObject.item4, pStatsRiotObject.item5, pStatsRiotObject.item6];
                    playerData['ItemBuild'] = {}; // Logic in Timeline
                    // Runes
                    var playerRunes = {}
                    playerRunes['PrimaryPathId'] = pStatsRiotObject.perkPrimaryStyle;
                    playerRunes['PrimaryKeystoneId'] = pStatsRiotObject.perk0;
                    playerRunes['PrimarySlot0Var1'] = pStatsRiotObject.perk0Var1;
                    playerRunes['PrimarySlot0Var2'] = pStatsRiotObject.perk0Var2;
                    playerRunes['PrimarySlot0Var3'] = pStatsRiotObject.perk0Var3;
                    playerRunes['PrimarySlot1Id'] = pStatsRiotObject.perk1;
                    playerRunes['PrimarySlot1Var1'] = pStatsRiotObject.perk1Var1;
                    playerRunes['PrimarySlot1Var2'] = pStatsRiotObject.perk1Var2;
                    playerRunes['PrimarySlot1Var3'] = pStatsRiotObject.perk1Var3;
                    playerRunes['PrimarySlot2Id'] = pStatsRiotObject.perk2;
                    playerRunes['PrimarySlot2Var1'] = pStatsRiotObject.perk2Var1;
                    playerRunes['PrimarySlot2Var2'] = pStatsRiotObject.perk2Var2;
                    playerRunes['PrimarySlot2Var3'] = pStatsRiotObject.perk2Var3;
                    playerRunes['PrimarySlot3Id'] = pStatsRiotObject.perk3;
                    playerRunes['PrimarySlot3Var1'] = pStatsRiotObject.perk3Var1;
                    playerRunes['PrimarySlot3Var2'] = pStatsRiotObject.perk3Var2;
                    playerRunes['PrimarySlot3Var3'] = pStatsRiotObject.perk3Var3;
                    playerRunes['SecondarySlot1Id'] = pStatsRiotObject.perk4;
                    playerRunes['SecondarySlot1Var1'] = pStatsRiotObject.perk4Var1;
                    playerRunes['SecondarySlot1Var2'] = pStatsRiotObject.perk4Var2;
                    playerRunes['SecondarySlot1Var3'] = pStatsRiotObject.perk4Var3;
                    playerRunes['SecondarySlot2Id'] = pStatsRiotObject.perk5;
                    playerRunes['SecondarySlot2Var1'] = pStatsRiotObject.perk5Var1;
                    playerRunes['SecondarySlot2Var2'] = pStatsRiotObject.perk5Var2;
                    playerRunes['SecondarySlot2Var3'] = pStatsRiotObject.perk5Var3;
                    playerRunes['ShardSlot0Id'] = pStatsRiotObject.statPerk0;
                    playerRunes['ShardSlot1Id'] = pStatsRiotObject.statPerk1;
                    playerRunes['ShardSlot2Id'] = pStatsRiotObject.statPerk2;
                    playerData['Runes'] = playerRunes;
                    playerData['SkillOrder'] = []; // Logic in Timeline
                    // Add to playerItem. Phew
                    playerItems[participantRiotObject.participantId] = playerData;
                }
            }
            teamData['TeamKills'] = teamKills;
            teamData['TeamDeaths'] = teamDeaths;
            teamData['TeamAssists'] = teamAssists;
            teamData['TeamGold'] = teamGold;
            teamData['TeamDamageDealt'] = teamDamageDealt;
            teamData['TeamCreepScore'] = teamCreepScore;
            teamData['TeamVisionScore'] = teamVisionScore;
            teamData['TeamWardsPlaced'] = teamWardsPlaced;
            teamData['TeamControlWardsBought'] = teamControlWardsBought;
            teamData['TeamWardsCleared'] = teamWardsCleared;
            teamData['Players'] = {};   // Merge after
            if (matchRiotObject.gameDuration >= MINUTE_AT_EARLY * 60) {
                teamData['GoldAtEarly'] = 0;   // Logic in Timeline
                teamData['XpAtEarly'] = 0;     // Logic in Timeline
            }
            if (matchRiotObject.gameDuration >= MINUTE_AT_MID * 60) {
                teamData['GoldAtMid'] = 0;   // Logic in Timeline
                teamData['XpAtMid'] = 0;     // Logic in Timeline
            }
            teamItems[teamRiotObject.teamId] = teamData;
        }
        // 2.2) - Timeline
        var timelineList = [];
        // Each index represents the minute
        var blueKillsAtEarly = 0;
        var blueKillsAtMid = 0;
        var redKillsAtEarly = 0;
        var redKillsAtMid = 0;
        var firstBloodFound = false;
        var allItemBuilds = {'1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [], '8': [], '9': [], '10': []};
        // We want to get the entire list of items being built. Key is the 'participantId'
        var baronObjectiveMinuteIndex = {};
        // Since we want to calculate baron power play AFTER the total team gold is calculated,
        // we want to store which indices in the timelineList each minute and what index in the eventsList
        // Key: minute -> Value: index in ['Events']
        for (minute = 0; minute < timelineRiotObject.frames.length; minute++) {
            var minuteTimelineItem = {};
            var frameRiotObject = timelineRiotObject.frames[minute];
            var blueTeamGold = 0;
            var redTeamGold = 0;
            for (var partId in frameRiotObject.participantFrames) {
                var thisTeamId = teamIdByPartId[partId];
                var partFrameRiotObject = frameRiotObject.participantFrames[partId];
                if (thisTeamId == BLUE_ID) {
                    blueTeamGold += partFrameRiotObject['totalGold'];
                }
                else if (thisTeamId == RED_ID) {
                    redTeamGold += partFrameRiotObject['totalGold'];
                }
                // playerData: EARLY_MINUTE and MID_MINUTE
                if ((minute == MINUTE_AT_EARLY && matchRiotObject.gameDuration >= MINUTE_AT_EARLY * 60) || 
                    (minute == MINUTE_AT_MID && matchRiotObject.gameDuration >= MINUTE_AT_MID * 60)) {
                    var type = (minute == MINUTE_AT_EARLY) ? "Early" : "Mid";
                    playerItems[partId]['GoldAt'+type] = partFrameRiotObject.totalGold;
                    teamItems[thisTeamId]['GoldAt'+type] += partFrameRiotObject.totalGold;
                    var playerCsAt = partFrameRiotObject.minionsKilled + partFrameRiotObject.jungleMinionsKilled;
                    playerItems[partId]['CsAt'+type] = playerCsAt;
                    teamItems[thisTeamId]['CsAt'+type] += playerCsAt.
                    playerItems[partId]['XpAt'+type] = partFrameRiotObject.xp;
                    teamItems[thisTeamId]['XpAt'+type] += partFrameRiotObject.xp;
                    playerItems[partId]['JungleCsAt'+type] = partFrameRiotObject.jungleMinionsKilled;
                }
            }
            minuteTimelineItem['MinuteStamp'] = minute;
            minuteTimelineItem['BlueTeamGold'] = blueTeamGold;
            minuteTimelineItem['RedTeamGold'] = redTeamGold;
            // Looping through Events
            var eventsList = [];
            for (j = 0; j < frameRiotObject.events.length; j++) {
                var riotEventObject = frameRiotObject.events[j];
                var eventItem = {};
                // Only Tower, Inhibitor, Dragon, Baron, Herald, and Kills are added to eventData
                if (riotEventObject.type == 'ELITE_MONSTER_KILL') {
                    var teamId = teamIdByPartId[riotEventObject.killerId];
                    eventItem['TeamId'] = teamId;
                    eventItem['Timestamp'] = riotEventObject.timestamp;
                    eventItem['KillerId'] = riotEventObject.killerId;
                    if (riotEventObject.monsterType == 'DRAGON') {
                        eventItem['EventType'] = 'Dragon';
                        var getDragonString = {
                            'AIR_DRAGON': 'Cloud',
                            'FIRE_DRAGON': 'Infernal',
                            'EARTH_DRAGON': 'Mountain',
                            'WATER_DRAGON': 'Ocean',
                            'ELDER_DRAGON': 'Elder'
                        };
                        var dragonStr = getDragonString[riotEventObject.monsterSubType];
                        eventItem['EventCategory'] = dragonStr;
                        // playerData: Dragon types
                        teamItems[teamId]['Dragons'].push(dragonStr);
                    }
                    else if (riotEventObject.monsterType == 'BARON_NASHOR') {
                        eventItem['EventType'] = 'Baron';
                        baronObjectiveMinuteIndex[minute] = eventsList.length; // We'll add to eventsList anyways
                    }
                    else if (riotEventObject.monsterType == 'RIFTHERALD') {
                        eventItem['EventType'] = 'Herald';
                    }
                    else {
                        // Put some placeholder mystery here in case there's a future monster
                        eventItem['EventType'] = 'MYSTERIOUS MONSTER';
                    }
                }
                else if (riotEventObject.type == 'BUILDING_KILL') {
                    eventItem['TeamId'] = riotEventObject.teamId;
                    eventItem['Timestamp'] = riotEventObject.timestamp;
                    eventItem['KillerId'] = riotEventObject.killerId;
                    if (riotEventObject.assistingParticipantIds.length > 0) {
                        eventItem['AssistIds'] = riotEventObject.assistingParticipantIds;
                    }
                    var getLaneString = {
                        'TOP_LANE': 'Top',
                        'MID_LANE': 'Middle',
                        'BOT_LANE': 'Bottom'
                    };
                    eventItem['Lane'] = getLaneString[riotEventObject.laneType];
                    if (riotEventObject.buildingType == 'TOWER_BUILDING') {
                        eventItem['EventType'] = 'Tower';
                        var getTowerType = {
                            'OUTER_TURRET': 'Outer',
                            'INNER_TURRET': 'Inner',
                            'BASE_TURRET': 'Base',
                            'NEXUS_TURRET': 'Nexus'
                        };
                        eventItem['EventCategory'] = getTowerType[riotEventObject.towerType];
                    }
                    else if (riotEventObject.buildingType == 'INHIBITOR_BUILDING') {
                        eventItem['EventType'] = 'Inhibitor';
                    }
                    else {
                        // Put some placeholder mystery here in case there's a future Building
                        eventItem['EventType'] = 'NEW BUILDING';
                    }
                }
                else if (riotEventObject.type == 'CHAMPION_KILL') {
                    var teamId = teamIdByPartId[riotEventObject.killerId];
                    eventItem['TeamId'] = teamId
                    eventItem['Timestamp'] = riotEventObject.timestamp;
                    var killerId = riotEventObject.killerId;
                    eventItem['KillerId'] = killerId;
                    var victimId = riotEventObject.victimId;
                    eventItem['VictimId'] = victimId;
                    eventItem['EventType'] = 'Kill';
                    // playerData: Solo Kills
                    if (riotEventObject.assistingParticipantIds.length == 0 && killerId != 0) {
                        playerItems[killerId]['SoloKills']++;
                    }
                    else {
                        eventItem['AssistIds'] = riotEventObject.assistingParticipantIds;
                    }
                    // playerData: First Blood
                    if (!firstBloodFound && killerId != 0 && victimId != 0) {
                        playerItems[killerId]['FirstBloodKill'] = true;
                        riotEventObject.assistingParticipantIds.forEach(function(assistPId) {
                            playerItems[assistPId]['FirstBloodAssist'] = true;
                        });
                        playerItems[victimId]['FirstBloodVictim'] = true;
                        firstBloodFound = true;
                    }
                    // teamData: EARLY_MINUTE and MID_MINUTE Kills
                    if (minute < MINUTE_AT_EARLY) {
                        if (teamId == BLUE_ID) { blueKillsAtEarly++; }
                        else if (teamId == RED_ID) { redKillsAtEarly++; }
                    }
                    if (minute < MINUTE_AT_MID) {
                        if (teamId == BLUE_ID) { blueKillsAtMid++; }
                        else if (teamId == RED_ID) { redKillsAtMid++; }
                    }
                }
                else if (riotEventObject.type == 'ITEM_PURCHASED') {
                    var itemEvent = {
                        'MinuteStamp': minute - 1, // Apparently a minute after...
                        'ItemId': riotEventObject.itemId,
                        'Bought': true,
                    };
                    allItemBuilds[riotEventObject.participantId].push(itemEvent);
                }
                else if (riotEventObject.type == 'ITEM_SOLD') {
                    var itemEvent = {
                        'MinuteStamp': minute - 1, // Apparently a minute after...
                        'ItemId': riotEventObject.itemId,
                        'Bought': false,
                    }
                    allItemBuilds[riotEventObject.participantId].push(itemEvent);
                }
                else if (riotEventObject.type == 'ITEM_UNDO') {
                    // Based on the API, I could just remove the last Item Build event
                    allItemBuilds[riotEventObject.participantId].pop(itemEvent);
                }
                else if (riotEventObject.type == 'SKILL_LEVEL_UP') {
                    // playerData['Skillorder']
                    var getSkillLetter = { '1': 'Q', '2': 'W', '3': 'E', '4': 'R' };
                    var skillValue = riotEventObject.skillSlot;
                    if (skillValue in getSkillLetter) {
                        playerItems[riotEventObject.participantId]['SkillOrder']
                            .push(getSkillLetter[riotEventObject.skillSlot]);
                    }
                }
                if (!(Object.keys(eventItem).length === 0 && eventItem.constructor === Object)) {
                    // Javascript's stupid way of checking if an object is empty
                    eventsList.push(eventItem);
                }
            }
            if (eventsList.length > 0) {
                minuteTimelineItem['Events'] = eventsList;
            }
            timelineList.push(minuteTimelineItem);
        }
        // Calculate baron power plays
        await computeBaronPowerPlay(baronObjectiveMinuteIndex, timelineList, matchObject['GamePatchVersion']);
        // Timeline completed
        matchObject['Timeline'] = timelineList;
        // Calculate Diff@Early and Mid for Teams
        if (matchRiotObject.gameDuration >= MINUTE_AT_EARLY * 60) {
            teamItems[BLUE_ID]['KillsAtEarly'] = blueKillsAtEarly;
            teamItems[RED_ID]['KillsAtEarly'] = redKillsAtEarly;
            var blueKillsDiffEarly = blueKillsAtEarly - redKillsAtEarly;
            var blueTeamGoldDiffEarly = teamItems[BLUE_ID]['GoldAtEarly'] - teamItems[RED_ID]['GoldAtEarly'];
            var blueTeamCsDiffEarly = teamItems[BLUE_ID]['CsAtEarly'] - teamItems[RED_ID]['CsAtEarly'];
            var blueTeamXpDiffEarly = teamItems[BLUE_ID]['XpAtEarly'] - teamItems[RED_ID]['XpAtEarly'];
            teamItems[BLUE_ID]['KillsDiffEarly'] = blueKillsDiffEarly;
            teamItems[RED_ID]['KillsDiffEarly'] = (blueKillsDiffEarly == 0) ? 0 : (blueKillsDiffEarly * -1);
            teamItems[BLUE_ID]['GoldDiffEarly'] = blueTeamGoldDiffEarly;
            teamItems[RED_ID]['GoldDiffEarly'] = (blueTeamGoldDiffEarly == 0) ? 0 : (blueTeamGoldDiffEarly * -1);
            teamItems[BLUE_ID]['CsDiffEarly'] = blueTeamCsDiffEarly;
            teamItems[RED_ID]['CsDiffEarly'] = (blueTeamCsDiffEarly == 0) ? 0 : (blueTeamCsDiffEarly * -1);
            teamItems[BLUE_ID]['XpDiffEarly'] = blueTeamXpDiffEarly;
            teamItems[RED_ID]['XpDiffEarly'] = (blueTeamXpDiffEarly == 0) ? 0 : (blueTeamXpDiffEarly * -1);
        }
        if (matchRiotObject.gameDuration >= MINUTE_AT_MID * 60) {
            teamItems[BLUE_ID]['KillsAtMid'] = blueKillsAtMid;
            teamItems[RED_ID]['KillsAtMid'] = redKillsAtMid;
            var blueKillsDiffMid = blueKillsAtMid - redKillsAtMid;
            var blueTeamGoldDiffMid = teamItems[BLUE_ID]['GoldAtMid'] - teamItems[RED_ID]['GoldAtMid'];
            var blueTeamCsDiffMid = teamItems[BLUE_ID]['CsAtMid'] - teamItems[RED_ID]['CsAtMid'];
            var blueTeamXpDiffMid = teamItems[BLUE_ID]['XpAtMid'] - teamItems[RED_ID]['XpAtMid'];
            teamItems[BLUE_ID]['KillsDiffMid'] = blueKillsDiffMid;
            teamItems[RED_ID]['KillsDiffMid'] = (blueKillsDiffMid == 0) ? 0 : (blueKillsDiffMid * -1);
            teamItems[BLUE_ID]['GoldDiffMid'] = blueTeamGoldDiffMid;
            teamItems[RED_ID]['GoldDiffMid'] = (blueTeamGoldDiffMid == 0) ? 0 : (blueTeamGoldDiffMid * -1);
            teamItems[BLUE_ID]['CsDiffMid'] = blueTeamCsDiffMid;
            teamItems[RED_ID]['CsDiffMid'] = (blueTeamCsDiffMid == 0) ? 0 : (blueTeamCsDiffMid * -1);
            teamItems[BLUE_ID]['XpDiffMid'] = blueTeamXpDiffMid;
            teamItems[RED_ID]['XpDiffMid'] = (blueTeamXpDiffMid == 0) ? 0 : (blueTeamXpDiffMid * -1);
        }
        // playerData['ItemBuild']. Reformat allItemBuilds to have each minute as the key
        for (var partId in allItemBuilds) {
            var playerItemBuild = {};
            var currMinute = 0;
            var itemBuildsByMinute = [];
            allItemBuilds[partId].forEach(function(itemEvent) {
                if (currMinute != itemEvent.MinuteStamp) {
                    playerItemBuild[currMinute] = itemBuildsByMinute;
                    currMinute = itemEvent.MinuteStamp;
                    itemBuildsByMinute = [];
                }
                itemBuildsByMinute.push({
                    'ItemId': itemEvent.ItemId,
                    'Bought': itemEvent.Bought
                });
            });
            playerItems[partId]['ItemBuild'] = playerItemBuild;
        }
        // Calculate Diff based on Roles for Players
        for (var role in partIdByTeamIdAndRole[BLUE_ID]) {
            bluePartId = partIdByTeamIdAndRole[BLUE_ID][role];
            redPartId = partIdByTeamIdAndRole[RED_ID][role];
            if (matchRiotObject.gameDuration >= MINUTE_AT_EARLY * 60) {
                var bluePlayerGoldDiffEarly = playerItems[bluePartId].GoldAtEarly - playerItems[redPartId].GoldAtEarly;
                playerItems[bluePartId]['GoldDiffEarly'] = bluePlayerGoldDiffEarly;
                playerItems[redPartId]['GoldDiffEarly'] = (bluePlayerGoldDiffEarly == 0) ? 0 : (bluePlayerGoldDiffEarly * -1);
                var bluePlayerCsDiffEarly = playerItems[bluePartId].CsAtEarly - playerItems[redPartId].CsAtEarly;
                playerItems[bluePartId]['CsDiffEarly'] = bluePlayerCsDiffEarly;
                playerItems[redPartId]['CsDiffEarly'] = (bluePlayerCsDiffEarly == 0) ? 0 : (bluePlayerCsDiffEarly * -1);
                var bluePlayerXpDiffEarly = playerItems[bluePartId].XpAtEarly - playerItems[redPartId].XpAtEarly;
                playerItems[bluePartId]['XpDiffEarly'] = bluePlayerXpDiffEarly;
                playerItems[redPartId]['XpDiffEarly'] = (bluePlayerXpDiffEarly == 0) ? 0 : (bluePlayerXpDiffEarly * -1);
                var bluePlayerJgCsDiffEarly = playerItems[bluePartId].JungleCsAtEarly - playerItems[redPartId].JungleCsAtEarly;
                playerItems[bluePartId]['JungleCsDiffEarly'] = bluePlayerJgCsDiffEarly;
                playerItems[redPartId]['JungleCsDiffEarly'] = (bluePlayerJgCsDiffEarly == 0) ? 0 : (bluePlayerJgCsDiffEarly * -1);
            }
            if (matchRiotObject.gameDuration >= MINUTE_AT_MID * 60) {
                var bluePlayerGoldDiffMid = playerItems[bluePartId].GoldAtMid - playerItems[redPartId].GoldAtMid;
                playerItems[bluePartId]['GoldDiffMid'] = bluePlayerGoldDiffMid;
                playerItems[redPartId]['GoldDiffMid'] = (bluePlayerGoldDiffMid == 0) ? 0 : (bluePlayerGoldDiffMid * -1);
                var bluePlayerCsDiffMid = playerItems[bluePartId].CsAtMid - playerItems[redPartId].CsAtMid;
                playerItems[bluePartId]['CsDiffMid'] = bluePlayerCsDiffMid;
                playerItems[redPartId]['CsDiffMid'] = (bluePlayerCsDiffMid == 0) ? 0 : (bluePlayerCsDiffMid * -1);
                var bluePlayerXpDiffMid = playerItems[bluePartId].XpAtMid - playerItems[redPartId].XpAtMid;
                playerItems[bluePartId]['XpDiffMid'] = bluePlayerXpDiffMid;
                playerItems[redPartId]['XpDiffMid'] = (bluePlayerXpDiffMid == 0) ? 0 : (bluePlayerXpDiffMid * -1);
                var bluePlayerJgCsDiffMid = playerItems[bluePartId].JungleCsAtMid - playerItems[redPartId].JungleCsAtMid;
                playerItems[bluePartId]['JungleCsDiffMid'] = bluePlayerJgCsDiffMid;
                playerItems[redPartId]['JungleCsDiffMid'] = (bluePlayerJgCsDiffMid == 0) ? 0 : (bluePlayerJgCsDiffMid * -1);
            }
        }
        // 2.3) - Merge teamItem + playerItem (especially with the Diffs)
        for (var partId in playerItems) {
            var teamId = teamIdByPartId[partId];
            teamItems[teamId]['Players'][partId] = playerItems[partId];
        }
        matchObject['Teams'] = teamItems;
        
        // Return the whole matchObject
        return matchObject;
    }
    catch (error) {
        throw error;
    }
}

/*  
    Takes the lhg Match Item in Dynamo DB
    Inserts into LHG's MySQL tables
    Returns a Promise
*/
async function insertMatchObjectMySql(matchObject, eventInputObject) {
    try {
        // 1) MatchStats
        var blueTeamId = getPIdString(teamHashIds, matchObject['Teams'][BLUE_ID]['TeamHId']);
        var redTeamId = getPIdString(teamHashIds, matchObject['Teams'][RED_ID]['TeamHId']);
        var insertMatchStatsColumn = {
            riotMatchId: eventInputObject.gameId,
            seasonPId: eventInputObject.seasonPId,
            tournamentPId: eventInputObject.tournamentPId,
            tournamentType: (await getItemInDynamoDB('Tournament', 'TournamentPId', eventInputObject.tournamentPId))['TournamentType'],
            blueTeamPId: blueTeamId,
            redTeamPId: redTeamId,
            duration: matchObject.GameDuration,
            patch: matchObject.GamePatchVersion,
            datePlayed: matchObject.DatePlayed
        };
        await insertMySQLQuery(insertMatchStatsColumn, 'MatchStats');
        // 2) TeamStats + PlayerStats + BannedChamps
        // 2.1) TeamStats
        for (var i = 0; i < Object.keys(matchObject['Teams']).length; ++i) {
            var teamSide = Object.keys(matchObject['Teams'])[i];
            var teamObject = matchObject['Teams'][teamSide];
            var durationByMinute = matchObject.GameDuration / 60;
            var thisTeamPId = (teamSide == BLUE_ID) ? blueTeamId : redTeamId;
            var enemyTeamPId = (teamSide == BLUE_ID) ? redTeamId : blueTeamId;
            var insertTeamStatsColumn = {
                riotMatchId: eventInputObject.gameId,
                teamPId: thisTeamPId,
                side: SIDE_STRING[teamSide],
                win: teamObject.Win,
                dmgDealtPerMin: (teamObject.TeamDamageDealt / durationByMinute).toFixed(2),
                goldPerMin: (teamObject.TeamGold / durationByMinute).toFixed(2),
                csPerMin: (teamObject.TeamCreepScore / durationByMinute).toFixed(2),
                vsPerMin: (teamObject.TeamVisionScore / durationByMinute).toFixed(2),
                firstBlood: teamObject.FirstBlood,
                firstTower: teamObject.FirstTower,
                totalKills: teamObject.TeamKills,
                totalDeaths: teamObject.TeamDeaths,
                totalAssists: teamObject.TeamAssists,
                totalTowers: teamObject.Towers,
                totalDragons: teamObject.Dragons.length,
                totalHeralds: teamObject.Heralds,
                totalBarons: teamObject.Barons,
                totalDamageDealt: teamObject.TeamDamageDealt,
                totalGold: teamObject.TeamGold,
                totalCreepScore: teamObject.TeamCreepScore,
                totalVisionScore: teamObject.TeamVisionScore,
                totalWardsPlaced: teamObject.TeamWardsPlaced,
                totalControlWardsBought: teamObject.TeamControlWardsBought,
                totalWardsCleared: teamObject.TeamWardsCleared
            };
            if (matchObject.GameDuration >= MINUTE_AT_EARLY * 60) {
                insertTeamStatsColumn['goldAtEarly'] = teamObject.GoldAtEarly;
                insertTeamStatsColumn['goldDiffEarly'] = teamObject.GoldDiffEarly;
                insertTeamStatsColumn['csAtEarly'] = teamObject.CsAtEarly;
                insertTeamStatsColumn['csDiffEarly'] = teamObject.CsDiffEarly;
                insertTeamStatsColumn['xpAtEarly'] = teamObject.XpAtEarly;
                insertTeamStatsColumn['xpDiffEarly'] = teamObject.XpDiffEarly;
                insertTeamStatsColumn['killsAtEarly'] = teamObject.KillsAtEarly;
                insertTeamStatsColumn['killsDiffEarly'] = teamObject.KillsDiffEarly;
            }
            if (matchObject.GameDuration >= MINUTE_AT_MID * 60) {
                insertTeamStatsColumn['goldAtMid'] = teamObject.GoldAtMid;
                insertTeamStatsColumn['goldDiffMid'] = teamObject.GoldDiffMid;
                insertTeamStatsColumn['csAtMid'] = teamObject.CsAtMid;
                insertTeamStatsColumn['csDiffMid'] = teamObject.CsDiffMid;
                insertTeamStatsColumn['xpAtMid'] = teamObject.XpAtMid;
                insertTeamStatsColumn['xpDiffMid'] = teamObject.XpDiffMid,
                insertTeamStatsColumn['killsAtMid'] = teamObject.KillsAtMid;
                insertTeamStatsColumn['killsDiffMid'] = teamObject.KillsDiffMid;
            }
            insertMySQLQuery(insertTeamStatsColumn, 'TeamStats');
            // 2.2) BannedChamps
            var insertBannedChampsColumn = {
                riotMatchId: eventInputObject.gameId,
                teamBannedById: thisTeamPId,
                teamBannedAgainstId: enemyTeamPId
            };
            for (var j = 0; j < teamObject.Phase1Bans.length; ++j) {
                var champId = teamObject.Phase1Bans[j];
                insertBannedChampsColumn['champId'] = champId;
                insertBannedChampsColumn['phase'] = 1;
                insertMySQLQuery(insertBannedChampsColumn, 'BannedChamps');
            }
            for (var j = 0; j < teamObject.Phase2Bans.length; ++j) {
                var champId = teamObject.Phase2Bans[j];
                insertBannedChampsColumn['champId'] = champId;
                insertBannedChampsColumn['phase'] = 2;
                insertMySQLQuery(insertBannedChampsColumn, 'BannedChamps');
            }
            // 2.3) PlayerStats
            for (var j = 0; j < Object.values(teamObject['Players']).length; ++j) {
                var playerObject = Object.values(teamObject['Players'])[j];
                var insertPlayerStatsColumn = {
                    profilePId: getPIdString(profileHashIds, playerObject.ProfileHId),
                    riotMatchId: eventInputObject.gameId,
                    teamPId: getPIdString(teamHashIds, teamObject.TeamHId),
                    side: SIDE_STRING[teamSide],
                    role: playerObject.Role,
                    champId: playerObject.ChampId,
                    win: teamObject.Win,
                    kills: playerObject.Kills,
                    deaths: playerObject.Deaths,
                    assists: playerObject.Assists,
                    dmgDealtPerMin: (playerObject.TotalDamageDealt / durationByMinute).toFixed(2),
                    csPerMin: (playerObject.CreepScore / durationByMinute).toFixed(2),
                    goldPerMin: (playerObject.Gold / durationByMinute).toFixed(2),
                    vsPerMin: (playerObject.VisionScore / durationByMinute).toFixed(2),
                    firstBloodKill: playerObject.FirstBloodKill,
                    firstBloodAssist: playerObject.FirstBloodAssist,
                    firstTower: playerObject.FirstTower,
                    damageDealt: playerObject.TotalDamageDealt,
                    gold: playerObject.Gold,
                    creepScore: playerObject.CreepScore,
                    visionScore: playerObject.VisionScore,
                    wardsPlaced: playerObject.WardsPlaced,
                    ControlWardsBought: playerObject.ControlWardsBought,
                    wardsCleared: playerObject.WardsCleared,
                    soloKills: playerObject.SoloKills,
                    doubleKills: playerObject.DoubleKills,
                    tripleKills: playerObject.TripleKills,
                    quadraKills: playerObject.QuadraKills,
                    pentaKills: playerObject.PentaKills
                };
                if (matchObject.GameDuration >= MINUTE_AT_EARLY * 60) {
                    insertPlayerStatsColumn['goldAtEarly'] = playerObject.GoldAtEarly;
                    insertPlayerStatsColumn['goldDiffEarly'] = playerObject.GoldDiffEarly;
                    insertPlayerStatsColumn['csAtEarly'] = playerObject.CsAtEarly;
                    insertPlayerStatsColumn['csDiffEarly'] = playerObject.CsDiffEarly;
                    insertPlayerStatsColumn['xpAtEarly'] = playerObject.XpAtEarly;
                    insertPlayerStatsColumn['xpDiffEarly'] = playerObject.XpDiffEarly;
                    insertPlayerStatsColumn['jungleCsAtEarly'] = playerObject.JungleCsAtEarly;
                    insertPlayerStatsColumn['jungleCsDiffEarly'] = playerObject.JungleCsDiffEarly;
                }
                if (matchObject.GameDuration >= MINUTE_AT_MID * 60) {
                    insertPlayerStatsColumn['goldAtMid'] = playerObject.GoldAtMid;
                    insertPlayerStatsColumn['goldDiffMid'] = playerObject.GoldDiffMid;
                    insertPlayerStatsColumn['csAtMid'] = playerObject.CsAtMid;
                    insertPlayerStatsColumn['csDiffMid'] = playerObject.CsDiffMid;
                    insertPlayerStatsColumn['xpAtMid'] = playerObject.XpAtMid;
                    insertPlayerStatsColumn['xpDiffMid'] = playerObject.XpDiffMid;
                    insertPlayerStatsColumn['jungleCsAtMid'] = playerObject.JungleCsAtMid;
                    insertPlayerStatsColumn['jungleCsDiffMid'] = playerObject.JungleCsDiffMid;
                }
                insertMySQLQuery(insertPlayerStatsColumn, 'PlayerStats');
            }
        }
        // 3.3) Objectives
        matchObject['Timeline'].forEach(function(minuteObject) {
            if ('Events' in minuteObject) {
                minuteObject['Events'].forEach(function(eventObject) {
                    if (['Tower','Inhibitor','Dragon','Baron','Herald'].includes(eventObject.EventType)) {
                        var insertObjectivesColumn = {
                            riotMatchId: eventInputObject.gameId,
                            teamPId: (eventObject.TeamId == BLUE_ID) ? blueTeamId : redTeamId,
                            objectiveEvent: eventObject.EventType,
                            timestamp: eventObject.Timestamp
                        };
                        if ('EventCategory' in eventObject) {
                            insertObjectivesColumn['objectiveCategory'] = eventObject.EventCategory;
                        }
                        if ('Lane' in eventObject) {
                            insertObjectivesColumn['lane'] = eventObject.Lane;
                        }
                        if ('BaronPowerPlay' in eventObject) {
                            insertObjectivesColumn['baronPowerPlay'] = eventObject.BaronPowerPlay;
                        }
                        insertMySQLQuery(insertObjectivesColumn, 'Objectives');
                    }
                });
            }
        });
    }
    catch (error) {
        throw error;
    }
}

/*  
    ----------------------
    Helper Functions
    ----------------------
*/

// Returns a Promise
function getDDragonVersion(patch) {
    return new Promise(async function(resolve, reject) {
        try {
            const DDragonVersionList = await kayn.DDragon.Version.list();
            DDragonVersionList.forEach(function(DDragonVersion) {
                if (DDragonVersion.includes(patch)) {
                    resolve(DDragonVersion);     
                }
            });
            resolve(DDragonVersionList[0]); // Just return latest as default
        }
        catch (err) {
            console.error("getDDragonVersion Promise Rejected.");
            reject(err);
        }
    });
}

function getPatch(patchStr) {
    var patchArr = patchStr.split('.');
    return patchArr[0] + '.' + patchArr[1];
}

// Turn number into string
function strPadZeroes(num, size) {
    var s = num+"";
    while (s.length < size) s = "0" + s;
    return s;
}

// Sub function to make it easier to get PId string
function getPIdString(hashIdType, HId) {
    return strPadZeroes(hashIdType.decode(HId)[0], envVars.PID_LENGTH); // process.env.PID_LENGTH
}

function updateBaronDuration(thisPatch) {
    return (isPatch1LaterThanPatch2(thisPatch, BARON_DURATION_PATCH_CHANGE)) ? CURRENT_BARON_DURATION : OLD_BARON_DURATION;
}

// Assumption: patch1 and patch2 are formatted in "##.##"
function isPatch1LaterThanPatch2(patch1, patch2) {
    var patch1Arr = patch1.split('.');
    var patch2Arr = patch2.split('.');
    season1 = parseInt(patch1Arr[0]);
    season2 = parseInt(patch2Arr[0]);
    version1 = parseInt(patch1Arr[1]);
    version2 = parseInt(patch2Arr[1]);

    if (season1 < season2) { return false; }
    else if (season1 > season2) { return true; }
    return (version1 >= version2) ? true : false;
}

// Team Gold at the given timestamp. Does a linear approximation in between seconds
function teamGoldAtTimeStamp(timestamp, timelineList, teamId) {
    var timeStampMinute = Math.floor(timestamp / 60);
    var timeStampSeconds = timestamp % 60;
    if ((timeStampMinute + 1) >= timelineList.length) { return null; }

    // Take team gold at marked minute, and from minute + 1. Average them.
    var teamGoldAtMinute = (teamId == BLUE_ID) ? timelineList[timeStampMinute]['BlueTeamGold'] : timelineList[timeStampMinute]['RedTeamGold'];
    var teamGoldAtMinutePlus1 = (teamId == BLUE_ID) ? timelineList[timeStampMinute+1]['BlueTeamGold'] : timelineList[timeStampMinute+1]['RedTeamGold'];
    var goldPerSecond = (teamGoldAtMinutePlus1 - teamGoldAtMinute) / 60;
    return (teamGoldAtMinute + Math.floor((goldPerSecond * timeStampSeconds)));
}

// Returns promise since we want this to be computed first before proceeding
// Affects timelineList as well
function computeBaronPowerPlay(baronObjectiveMinuteIndex, timelineList, patch) {
    return new Promise(function(resolve, reject) {
        try {
            var baronDuration = updateBaronDuration(patch); // in seconds
            Object.keys(baronObjectiveMinuteIndex).forEach(function(minute) {
                var eventIndex = baronObjectiveMinuteIndex[minute];
                var baronEventObject = timelineList[minute]['Events'][eventIndex]; // Make shallow copy and change that
                var thisTeamId = baronEventObject.TeamId;
                var oppTeamId = (thisTeamId == BLUE_ID) ? RED_ID : BLUE_ID;
                var timeStampAtKill = baronEventObject.Timestamp / 1000; // Convert ms -> seconds
                var teamGoldAtKill = teamGoldAtTimeStamp(timeStampAtKill, timelineList, thisTeamId);
                var oppGoldAtKill = teamGoldAtTimeStamp(timeStampAtKill, timelineList, oppTeamId);
                if (teamGoldAtKill == null || oppGoldAtKill == null) { return; }
                var timeStampAtExpire = timeStampAtKill + baronDuration;
                var teamGoldAtExpire = teamGoldAtTimeStamp(timeStampAtExpire, timelineList, thisTeamId);
                var oppGoldAtExpire = teamGoldAtTimeStamp(timeStampAtExpire, timelineList, oppTeamId);
                if (teamGoldAtExpire == null || oppGoldAtExpire == null) { return; }
                baronEventObject['BaronPowerPlay'] = (teamGoldAtExpire - teamGoldAtKill) - (oppGoldAtExpire - oppGoldAtKill);
            });
            resolve(0);
        }
        catch (err) {
            console.error("computeBaronPowerPlay Promise Rejected.");
            reject(err);
        }
    });
}

// Returns a promise
function putItemInDynamoDB(tableName, items, key) {
    if (PUT_INTO_DYNAMO) {
        var params = {
            TableName: tableName,
            Item: items
        };
        return new Promise(function(resolve, reject) {
            dynamoDB.put(params, function(err, data) {
                if (err) {
                    console.error("ERROR - putItemInDynamoDB \'" + tableName + "\' Promise rejected.");
                    reject(err);
                }
                else {
                    console.log("Dynamo DB: Put Item \'" + key + "\' into \"" + tableName + "\" Table!");
                    resolve(data);
                }
            });
        });
    }
    else {
        // debugging
        if (DEBUG_DYNAMO) { console.log("DynamoDB Table", "\'" + tableName + "\'"); console.log(JSON.stringify(items)); }
    }
}

// Returns a Promise
function getItemInDynamoDB(tableName, partitionName, key) {
    var params = {
        TableName: tableName,
        Key: {
            [partitionName]: key
        }
    };
    return new Promise(function(resolve, reject) {
        try {
            dynamoDB.get(params, function(err, data) {
                if (err) {
                    reject(err);
                }
                else {
                    console.log("Dynamo DB: Get Item \'" + key + "\' from Table \"" + tableName + "\"");
                    resolve(data['Item']);
                }
            });
        }
        catch (error) {
            console.error("ERROR - getItemInDynamoDB \'" + tableName + "\' Promise rejected.")
            reject(error);
        }
    });
}

// Returns a Promise
function doesItemExistInDynamoDB(tableName, partitionName, key) {
    var params = {
        TableName: tableName,
        Key: {
            [partitionName]: key
        },
        AttributesToGet: [partitionName],
    };
    return new Promise(function(resolve, reject) {
        try {
            dynamoDB.get(params, function(err, data) {
                if (err) {
                    reject(err);
                }
                else {
                    resolve('Item' in data);
                }
            });
        }
        catch (error) {
            console.error("ERROR - doesItemExistInDynamoDB \'" + tableName + "\' Promise rejected.");
            reject(error);
        }
    });
}

// Returns a Promise
function insertMySQLQuery(queryObject, tableName) {
    if (INSERT_INTO_MYSQL) {
        return new Promise(function(resolve, reject) {
            try {
                var queryStr = 'INSERT INTO ' + tableName + ' (';
                Object.keys(queryObject).forEach(function(columnName) {
                    queryStr += (columnName + ',');
                });
                queryStr = queryStr.slice(0, -1); // trimEnd of character
                queryStr += ') VALUES (';
                Object.values(queryObject).forEach(function(value) {
                    value = (typeof value === "string") ? '\'' + value + '\'' : value;
                    queryStr += (value + ',');
                });
                queryStr = queryStr.slice(0, -1); // trimEnd of character
                queryStr += ');';

                sqlPool.getConnection(function(err, connection) {
                    if (err) { reject(err); }
                    connection.query(queryStr, function(error, results, fields) {
                        connection.release();
                        if (error) { throw error; }
                        if (DEBUG_MYSQL) { console.log("MySQL: Insert Row into Table \"" + tableName + "\" - Affected " + results.affectedRows + " row(s)."); }
                        resolve(results); 
                    });
                });
            }
            catch (error) {
                console.error("ERROR - insertMySQLQuery \'" + tableName + "\' Promise rejected.");
                reject(error);
            }
        });
    }
    else {
        // debugging
        if (DEBUG_MYSQL) { console.log("MySQL Table", "\'" + tableName + "\'"); console.log(queryObject); }
    }
}