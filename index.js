// Declaring npm modules
const Hashids = require('hashids/cjs'); // For hashing and unhashing
const mysql = require('mysql'); // Interfacing with mysql DB
var AWS = require('aws-sdk'); // Interfacing with DynamoDB
const { Kayn, REGIONS, BasicJSCache } = require('kayn'); // Riot API Wrapper

// Import from other files that are not committed to Github
// Contact doowan about getting a copy of these files
const testInputObject = require('./external/test');
const envVars = require('./external/env');

// Global variable constants
const MINUTE_15 = 15;
const MINUTE_25 = 25;
const PUT_INTO_DB = false; // turn 'true' when comfortable to push in
const PHASE2_BANS = 2;
const BLUE_ID = 100;
const RED_ID = 200;
const SIDE_STRING = { [BLUE_ID]: 'Blue', [RED_ID]: 'Red' };
const HID_LENGTH = 12;
const PID_LENGTH = 8;

// Additional configurations
AWS.config.update({ region: 'us-east-2' });
var dynamoDB = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' });
const profileHashIds = new Hashids(envVars.PROFILE_HID_SALT, HID_LENGTH); // process.env.PROFILE_HID_SALT
const teamHashIds = new Hashids(envVars.TEAM_HID_SALT, HID_LENGTH); // process.env.TEAM_HID_SALT
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
        delayBeforeRetry: 1000,
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

// Main AWS Lambda Function. We'll come back to this later
exports.handler = async (event, context) => {
    
    if ('manual' in event) {
        
    }
    
};

async function main() {
    var matchRiotObject = await kayn.Match.get(testInputObject['gameId']);
    var timelineRiotObject = await kayn.Match.timeline(testInputObject['gameId']);
    var lhgMatchObject = await createLhgMatchObject(testInputObject, matchRiotObject, timelineRiotObject);
    console.log(lhgMatchObject['Teams']['100']['Players']);
    putItemInDynamoDB('Matches', lhgMatchObject);
    await insertMatchObjectMySql(lhgMatchObject, testInputObject);
    // The below can happen all concurrently
    /*
    putProfileItemDynamoDb();
    putTeamItemDynamoDb();
    putTournamentItemDynamoDb();
    putSeasonItemDynamoDb();
    */
}

main();

// ----------------------
// Database Functions
// ----------------------

// Successful callback of kayn.timeline from MatchV4
// With both Jsons, we'll be storing into the DB now
async function createLhgMatchObject(eventInputObject, matchRiotObject, timelineRiotObject) {
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
    matchObject['MatchPId'] = eventInputObject.gameId;
    matchObject['RiotMatchId'] = eventInputObject.gameId;
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
            teamData['TeamHId'] = (await getItemInDynamoDB('TeamNameMap', 'TeamName', eventInputObject.blueTeamName))['TeamHId'];
        }
        else if (teamId == RED_ID) {
            teamData['TeamHId'] = (await getItemInDynamoDB('TeamNameMap', 'TeamName', eventInputObject.redTeamName))['TeamHId'];
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
        // For this one, we're going to work backwards from the Array in the riotJson.
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
            var participantObj = matchRiotObject.participants[j];
            if (participantObj.teamId == teamId) {
                var partId = participantObj.participantId;
                teamIdByPartId[partId] = teamId;
                var pStatsObject = participantObj.stats;
                pTimelineObj = participantObj.timeline;
                var profileName = profileObjByChampId[participantObj.championId].name;
                //console.log(profileName);
                playerData['ProfileHId'] = (await getItemInDynamoDB('ProfileNameMap', 'ProfileName', profileName))['ProfileHId'];
                playerData['ParticipantId'] = partId;
                var champRole = profileObjByChampId[participantObj.championId].role;
                playerData['Role'] = champRole;
                partIdByTeamIdAndRole[teamId][champRole] = partId;
                playerData['ChampLevel'] = pStatsObject.champLevel;
                playerData['ChampId'] = participantObj.championId;
                playerData['Spell1Id'] = participantObj.spell1Id;
                playerData['Spell2Id'] = participantObj.spell2Id;
                playerData['Kills'] = pStatsObject.kills;
                teamKills += pStatsObject.kills;
                playerData['Deaths'] = pStatsObject.deaths;
                teamDeaths += pStatsObject.deaths;
                playerData['Assists'] = pStatsObject.assists;
                teamAssists += pStatsObject.assists;
                playerData['Kda'] = ((pStatsObject.kills + pStatsObject.assists) / pStatsObject.deaths).toFixed(2);
                playerData['Gold'] = pStatsObject.goldEarned;
                teamGold += pStatsObject.goldEarned;
                playerData['TotalDamageDealt'] = pStatsObject.totalDamageDealtToChampions;
                teamDamageDealt += pStatsObject.totalDamageDealtToChampions;
                playerData['PhysicalDamageDealt'] = pStatsObject.physicalDamageDealtToChampions;
                playerData['MagicDamageDealt'] = pStatsObject.magicDamageDealtToChampions;
                playerData['TrueDamageDealt'] = pStatsObject.trueDamageDealtToChampions;
                var totalCS = pStatsObject.neutralMinionsKilled + pStatsObject.totalMinionsKilled;
                playerData['CreepScore'] = totalCS;
                teamCreepScore += totalCS;
                playerData['CsInTeamJungle'] = pStatsObject.neutralMinionsKilledTeamJungle;
                playerData['CsInEnemyJungle'] = pStatsObject.neutralMinionsKilledEnemyJungle;
                playerData['VisionScore'] = pStatsObject.visionScore;
                teamVisionScore += pStatsObject.visionScore;
                playerData['WardsPlaced'] = pStatsObject.wardsPlaced;
                teamWardsPlaced += pStatsObject.wardsPlaced;
                playerData['ControlWardsBought'] = pStatsObject.visionWardsBoughtInGame;
                teamControlWardsBought += pStatsObject.visionWardsBoughtInGame;
                playerData['WardsCleared'] = pStatsObject.wardsKilled;
                teamWardsCleared += pStatsObject.wardsKilled;
                playerData['FirstBloodKill'] = false; // Logic in Timeline
                playerData['FirstBloodAssist'] = false; // Logic in Timeline
                playerData['FirstBloodVictim'] = false; // Logic in Timeline
                playerData['FirstTower'] = (pStatsObject.firstTowerKill || pStatsObject.firstTowerAssist);
                playerData['SoloKills'] = 0; // Logic in Timeline
                playerData['PentaKills'] = pStatsObject.pentaKills;
                playerData['QuadraKills'] = pStatsObject.quadraKills - pStatsObject.pentaKills;
                playerData['TripleKills'] = pStatsObject.tripleKills - pStatsObject.quadraKills;
                playerData['DoubleKills'] = pStatsObject.doubleKills - pStatsObject.tripleKills;
                playerData['DamageToTurrets'] = pStatsObject.damageDealtToTurrets;
                playerData['DamageToObjectives'] = pStatsObject.damageDealtToObjectives;
                playerData['TotalHeal'] = pStatsObject.totalHeal;
                playerData['TimeCrowdControl'] = pStatsObject.timeCCingOthers;
                playerData['ItemsFinal'] = [pStatsObject.item0, pStatsObject.item1, 
                    pStatsObject.item2, pStatsObject.item3, pStatsObject.item4, pStatsObject.item5, pStatsObject.item6];
                playerData['ItemBuild'] = {}; // Logic in Timeline
                // Runes
                var playerRunes = {}
                playerRunes['PrimaryPathId'] = pStatsObject.perkPrimaryStyle;
                playerRunes['PrimaryKeystoneId'] = pStatsObject.perk0;
                playerRunes['PrimarySlot0Var1'] = pStatsObject.perk0Var1;
                playerRunes['PrimarySlot0Var2'] = pStatsObject.perk0Var2;
                playerRunes['PrimarySlot0Var3'] = pStatsObject.perk0Var3;
                playerRunes['PrimarySlot1Id'] = pStatsObject.perk1;
                playerRunes['PrimarySlot1Var1'] = pStatsObject.perk1Var1;
                playerRunes['PrimarySlot1Var2'] = pStatsObject.perk1Var2;
                playerRunes['PrimarySlot1Var3'] = pStatsObject.perk1Var3;
                playerRunes['PrimarySlot2Id'] = pStatsObject.perk2;
                playerRunes['PrimarySlot2Var1'] = pStatsObject.perk2Var1;
                playerRunes['PrimarySlot2Var2'] = pStatsObject.perk2Var2;
                playerRunes['PrimarySlot2Var3'] = pStatsObject.perk2Var3;
                playerRunes['PrimarySlot3Id'] = pStatsObject.perk3;
                playerRunes['PrimarySlot3Var1'] = pStatsObject.perk3Var1;
                playerRunes['PrimarySlot3Var2'] = pStatsObject.perk3Var2;
                playerRunes['PrimarySlot3Var3'] = pStatsObject.perk3Var3;
                playerRunes['SecondarySlot1Id'] = pStatsObject.perk4;
                playerRunes['SecondarySlot1Var1'] = pStatsObject.perk4Var1;
                playerRunes['SecondarySlot1Var2'] = pStatsObject.perk4Var2;
                playerRunes['SecondarySlot1Var3'] = pStatsObject.perk4Var3;
                playerRunes['SecondarySlot2Id'] = pStatsObject.perk5;
                playerRunes['SecondarySlot2Var1'] = pStatsObject.perk5Var1;
                playerRunes['SecondarySlot2Var2'] = pStatsObject.perk5Var2;
                playerRunes['SecondarySlot2Var3'] = pStatsObject.perk5Var3;
                playerRunes['ShardSlot0Id'] = pStatsObject.statPerk0;
                playerRunes['ShardSlot1Id'] = pStatsObject.statPerk1;
                playerRunes['ShardSlot2Id'] = pStatsObject.statPerk2;
                playerData['Runes'] = playerRunes;
                playerData['SkillOrder'] = []; // Logic in Timeline
                // Add to playerItem. Phew
                playerItems[participantObj.participantId] = playerData;
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
        teamData['GoldAt15'] = 0;   // Logic in Timeline
        teamData['XpAt15'] = 0;     // Logic in Timeline
        teamData['GoldAt25'] = 0;   // Logic in Timeline
        teamData['XpAt25'] = 0;     // Logic in Timeline
        teamItems[teamRiotObject.teamId] = teamData;
    }
    // 2.2) - Timeline
    var timelineList = [];
    var blueKillsAt15 = 0;
    var blueKillsAt25 = 0;
    var redKillsAt15 = 0;
    var redKillsAt25 = 0;
    var firstBloodFound = false;
    var allItemBuilds = {'1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [], '8': [], '9': [], '10': []};
    // For the above, we want to first just get the entire list of items being built. 
    // Then we can add a Key to it.
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
            // playerData: 15min and 25min
            if (minute == MINUTE_15 || minute == MINUTE_25) {
                playerItems[partId]['GoldAt'+minute] = partFrameRiotObject.totalGold;
                teamItems[thisTeamId]['GoldAt'+minute] += partFrameRiotObject.totalGold;
                playerItems[partId]['CsAt'+minute] = partFrameRiotObject.minionsKilled + partFrameRiotObject.jungleMinionsKilled;
                playerItems[partId]['XpAt'+minute] = partFrameRiotObject.xp;
                teamItems[thisTeamId]['XpAt'+minute] += partFrameRiotObject.xp;
                playerItems[partId]['JungleCsAt'+minute] = partFrameRiotObject.jungleMinionsKilled;
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
                    var baronPP = await computeBaronPowerPlay();
                    if (baronPP != null) {
                        eventItem['BaronPowerPlay'] = baronPP;
                    }
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
                eventItem['AssistIds'] = riotEventObject.assistingParticipantIds;
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
                if (riotEventObject.assistingParticipantIds.length == 0) {
                    playerItems[killerId]['SoloKills']++;
                }
                // playerData: First Blood
                if (!firstBloodFound) {
                    playerItems[killerId]['FirstBloodKill'] = true;
                    riotEventObject.assistingParticipantIds.forEach(function(assistPId) {
                        playerItems[assistPId]['FirstBloodAssist'] = true;
                    });
                    playerItems[victimId]['FirstBloodVictim'] = true;
                    firstBloodFound = true;
                }
                // teamData: 15min and 25min Kills
                if (minute < MINUTE_15) {
                    if (teamId == BLUE_ID) { blueKillsAt15++; }
                    else if (teamId == RED_ID) { redKillsAt15++; }
                }
                if (minute < MINUTE_25) {
                    if (teamId == BLUE_ID) { blueKillsAt25++; }
                    else if (teamId == RED_ID) { redKillsAt25++; }
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
        minuteTimelineItem['Events'] = eventsList;
        timelineList.push(minuteTimelineItem);
    }
    teamItems[BLUE_ID]['KillsAt15'] = blueKillsAt15;
    teamItems[BLUE_ID]['KillsAt25'] = blueKillsAt25;
    teamItems[RED_ID]['KillsAt15'] = redKillsAt15;
    teamItems[RED_ID]['KillsAt25'] = redKillsAt25;
    var blueKillsDiff15 = blueKillsAt15 - redKillsAt15;
    var blueKillsDiff25 = blueKillsAt25 - redKillsAt25;
    teamItems[BLUE_ID]['KillsDiff15'] = blueKillsDiff15;
    teamItems[BLUE_ID]['KillsDiff25'] = blueKillsDiff25;
    teamItems[RED_ID]['KillsDiff15'] = (blueKillsDiff15 == 0) ? 0 : (blueKillsDiff15 * -1);
    teamItems[RED_ID]['KillsDiff25'] = (blueKillsDiff25 == 0) ? 0 : (blueKillsDiff25 * -1);
    var blueTeamGoldDiff15 = teamItems[BLUE_ID]['GoldAt15'] - teamItems[RED_ID]['GoldAt15'];
    var blueTeamGoldDiff25 = teamItems[BLUE_ID]['GoldAt25'] - teamItems[RED_ID]['GoldAt25'];
    var blueTeamXpDiff15 = teamItems[BLUE_ID]['XpAt15'] - teamItems[RED_ID]['XpAt15'];
    var blueTeamXpDiff25 = teamItems[BLUE_ID]['XpAt25'] - teamItems[RED_ID]['XpAt25'];
    teamItems[BLUE_ID]['GoldDiff15'] = blueTeamGoldDiff15;
    teamItems[BLUE_ID]['GoldDiff25'] = blueTeamGoldDiff25;
    teamItems[BLUE_ID]['XpDiff15'] = blueTeamXpDiff15;
    teamItems[BLUE_ID]['XpDiff25'] = blueTeamXpDiff25;
    teamItems[RED_ID]['GoldDiff15'] = (blueTeamGoldDiff15 == 0) ? 0 : (blueTeamGoldDiff15 * -1);
    teamItems[RED_ID]['GoldDiff25'] = (blueTeamGoldDiff25 == 0) ? 0 : (blueTeamGoldDiff25 * -1);
    teamItems[RED_ID]['XpDiff15'] = (blueTeamXpDiff15 == 0) ? 0 : (blueTeamXpDiff15 * -1);
    teamItems[RED_ID]['XpDiff25'] = (blueTeamXpDiff25 == 0) ? 0 : (blueTeamXpDiff25 * -1);
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
    // Calculate difference based on Roles
    for (var role in partIdByTeamIdAndRole[BLUE_ID]) {
        bluePartId = partIdByTeamIdAndRole[BLUE_ID][role];
        redPartId = partIdByTeamIdAndRole[RED_ID][role];
        var bluePlayerGoldDiff15 = playerItems[bluePartId].GoldAt15 - playerItems[redPartId].GoldAt15;
        playerItems[bluePartId]['GoldDiff15'] = bluePlayerGoldDiff15;
        playerItems[redPartId]['GoldDiff15'] = (bluePlayerGoldDiff15 == 0) ? 0 : (bluePlayerGoldDiff15 * -1);
        var bluePlayerCsDiff15 = playerItems[bluePartId].CsAt15 - playerItems[redPartId].CsAt15;
        playerItems[bluePartId]['CsDiff15'] = bluePlayerCsDiff15;
        playerItems[redPartId]['CsDiff15'] = (bluePlayerCsDiff15 == 0) ? 0 : (bluePlayerCsDiff15 * -1);
        var bluePlayerXpDiff15 = playerItems[bluePartId].XpAt15 - playerItems[redPartId].XpAt15;
        playerItems[bluePartId]['XpDiff15'] = bluePlayerXpDiff15;
        playerItems[redPartId]['XpDiff15'] = (bluePlayerXpDiff15 == 0) ? 0 : (bluePlayerXpDiff15 * -1);
        var bluePlayerJgCsDiff15 = playerItems[bluePartId].JungleCsAt15 - playerItems[redPartId].JungleCsAt15;
        playerItems[bluePartId]['JungleCsDiff15'] = bluePlayerJgCsDiff15;
        playerItems[redPartId]['JungleCsDiff15'] = (bluePlayerJgCsDiff15 == 0) ? 0 : (bluePlayerJgCsDiff15 * -1);
        var bluePlayerGoldDiff25 = playerItems[bluePartId].GoldAt25 - playerItems[redPartId].GoldAt25;
        playerItems[bluePartId]['GoldDiff25'] = bluePlayerGoldDiff25;
        playerItems[redPartId]['GoldDiff25'] = (bluePlayerGoldDiff25 == 0) ? 0 : (bluePlayerGoldDiff25 * -1);
        var bluePlayerCsDiff25 = playerItems[bluePartId].CsAt25 - playerItems[redPartId].CsAt25;
        playerItems[bluePartId]['CsDiff25'] = bluePlayerCsDiff25;
        playerItems[redPartId]['CsDiff25'] = (bluePlayerCsDiff25 == 0) ? 0 : (bluePlayerCsDiff25 * -1);
        var bluePlayerXpDiff25 = playerItems[bluePartId].XpAt25 - playerItems[redPartId].XpAt25;
        playerItems[bluePartId]['XpDiff25'] = bluePlayerXpDiff25;
        playerItems[redPartId]['XpDiff25'] = (bluePlayerXpDiff25 == 0) ? 0 : (bluePlayerXpDiff25 * -1);
        var bluePlayerJgCsDiff25 = playerItems[bluePartId].JungleCsAt25 - playerItems[redPartId].JungleCsAt25;
        playerItems[bluePartId]['JungleCsDiff25'] = bluePlayerJgCsDiff25;
        playerItems[redPartId]['JungleCsDiff25'] = (bluePlayerJgCsDiff25 == 0) ? 0 : (bluePlayerJgCsDiff25 * -1);
    }
    // 2.3) - Merge teamItem + playerItem (especially with the Diffs)
    for (var partId in playerItems) {
        var teamId = teamIdByPartId[partId];
        teamItems[teamId]['Players'][partId] = playerItems[partId];
    }
    matchObject['Teams'] = teamItems;
    matchObject['Timeline'] = timelineList;
    
    // Return the whole matchObject
    return new Promise (function(resolve) {
        resolve(matchObject);
    }); 
}

// Takes the lhg Match Item in Dynamo DB
// Inserts into LHG's MySQL tables
// Returns a Promise
async function insertMatchObjectMySql(matchObject, eventInputObject) {
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
    Object.keys(matchObject['Teams']).forEach(function(teamSide) {
        var teamObject = matchObject['Teams'][teamSide];
        var durationByMinute = matchObject.GameDuration / 60;
        var thisTeamPId = (teamSide == BLUE_ID) ? blueTeamId : redTeamId;
        var enemyTeamPId = (teamSide == BLUE_ID) ? redTeamId : blueTeamId;
        var insertTeamStatsColumn = {
            riotMatchId: eventInputObject.gameId,
            teamPId: thisTeamPId,
            side: SIDE_STRING[teamSide],
            win: teamObject.Win,
            KDA: ((teamObject.TeamKills + teamObject.TeamAssists) / teamObject.TeamDeaths).toFixed(2),
            dmgDealtPerMin: (teamObject.TeamDamageDealt / durationByMinute).toFixed(2),
            goldPerMin: (teamObject.TeamGold / durationByMinute).toFixed(2),
            csPerMin: (teamObject.TeamCreepScore / durationByMinute).toFixed(2),
            vsPerMin: (teamObject.TeamVisionScore / durationByMinute).toFixed(2),
            firstBlood: teamObject.FirstBlood,
            firstTower: teamObject.FirstTower,
            goldAt15: teamObject.GoldAt15,
            goldDiff15: teamObject.GoldDiff15,
            xpAt15: teamObject.XpAt15,
            xpDiff15: teamObject.XpDiff15,
            killsAt15: teamObject.KillsAt15,
            killsDiff15: teamObject.KillsDiff15,
            goldAt25: teamObject.GoldAt25,
            goldDiff25: teamObject.GoldDiff25,
            xpAt25: teamObject.XpAt25,
            xpDiff25: teamObject.XpDiff25,
            killsAt25: teamObject.KillsAt25,
            killsDiff25: teamObject.KillsDiff25,
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
        insertMySQLQuery(insertTeamStatsColumn, 'TeamStats');
        // 2.2) BannedChamps
        var insertBannedChampsColumn = {
            riotMatchId: eventInputObject.gameId,
            teamBannedById: thisTeamPId,
            teamBannedAgainstId: enemyTeamPId
        };
        teamObject.Phase1Bans.forEach(function(champId) {
            insertBannedChampsColumn['champId'] = champId;
            insertBannedChampsColumn['phase'] = 1;
            insertMySQLQuery(insertBannedChampsColumn, 'BannedChamps');
        });
        teamObject.Phase2Bans.forEach(function(champId) {
            insertBannedChampsColumn['champId'] = champId;
            insertBannedChampsColumn['phase'] = 2;
            insertMySQLQuery(insertBannedChampsColumn, 'BannedChamps');
        });
        // 2.3) PlayerStats
        Object.values(teamObject['Players']).forEach(function(playerObject) {
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
                KDA: playerObject.Kda,
                damageDealtPerMin: (playerObject.TotalDamageDealt / durationByMinute).toFixed(2),
                csPerMin: (playerObject.CreepScore / durationByMinute).toFixed(2),
                goldPerMin: (playerObject.Gold / durationByMinute).toFixed(2),
                vsPerMin: (playerObject.VisionScore / durationByMinute).toFixed(2),
                firstBloodKill: playerObject.FirstBloodKill,
                firstBloodAssist: playerObject.FirstBloodAssist,
                firstTower: playerObject.FirstTower,
                csAt15: playerObject.CsAt15,
                csDiff15: playerObject.CsDiff15,
                goldAt15: playerObject.GoldAt15,
                goldDiff15: playerObject.GoldDiff15,
                xpAt15: playerObject.XpAt15,
                xpDiff15: playerObject.XpDiff15,
                jungleCsAt15: playerObject.JungleCsAt15,
                jungleCsDiff15: playerObject.JungleCsDiff15,
                csAt25: playerObject.CsAt25,
                csDiff25: playerObject.CsDiff25,
                goldAt25: playerObject.GoldAt25,
                goldDiff25: playerObject.GoldDiff25,
                xpAt25: playerObject.XpAt25,
                xpDiff25: playerObject.XpDiff25,
                jungleCsAt25: playerObject.JungleCsAt25,
                jungleCsDiff25: playerObject.JungleCsDiff25,
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
            insertMySQLQuery(insertPlayerStatsColumn, 'PlayerStats');
        });
    });
    // 3.3) Objectives
    matchObject['Timeline'].forEach(function(minuteObject) {
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
    });
}

// ----------------------
// Helper Functions
// ----------------------

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
            reject(err);
        }
    });
}

function computeBaronPowerPlay() {
    // TODO (Do this later)
    return new Promise(function(resolve, reject) {
        resolve("NO U");
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
    return strPadZeroes(hashIdType.decode(HId)[0], PID_LENGTH);
}

// Returns a promise
function putItemInDynamoDB(tableName, items) {
    if (PUT_INTO_DB) {
        var params = {
            TableName: tableName,
            Item: items
        };
        return new Promise(function(resolve, reject) {
            dynamoDB.put(params, function(err) {
                if (err) {
                    reject(err);
                }
                else {
                    console.log("Dynamo DB: Put Item into \"" + tableName + "\" Table!");
                }
            });
        });
    }
    else {
        console.log("TESTING - Dynamo DB: Put Item into \"" + tableName + "\" Table!")
    }
}

// Returns a Promise
function getItemInDynamoDB(tableName, keyName, itemName) {
    // Check if it exists in db. If it does, add to cache
    var params = {
        TableName: tableName,
        Key: {
            [keyName]: itemName
        }
    };
    return new Promise(function(resolve, reject) {
        dynamoDB.get(params, function(err, data) {
            if (err) {
                reject(err);
            }
            else {
                console.log("Dynamo DB: Get Item \'" + itemName + "\' from Table \"" + tableName + "\"");
                resolve(data['Item']);
            }
        });
    });
}

// Returns a Promise
function insertMySQLQuery(queryObject, tableName) {
    if (PUT_INTO_DB) {
        var queryStr = 'INSERT INTO ' + tableName + ' (';
        Object.keys(queryObject).forEach(function(columnName) {
            queryStr += (columnName + ',');
        });
        queryStr = queryStr.slice(0, -1); // trimEnd of character
        queryStr += ') VALUES (';
        Object.values(queryObject).forEach(function(value) {
            value = (typeof value === 'string') ? '\'' + value + '\'' : value;
            queryStr += (value + ',');
        });
        queryStr = queryStr.slice(0, -1); // trimEnd of character
        queryStr += ');';

        return new Promise(function(resolve, reject) {
            sqlPool.getConnection(function(err, connection) {
                if (err) { reject(err); }
                connection.query(queryStr, function(error, results, fields) {
                    console.log("MySQL: Insert Row into Table \"" + tableName + "\"");
                    connection.release();
                    if (error) { reject(error); }
                });
            });
        });
    }
    else {
        console.log("TESTING - MySQL: Insert Row into Table \"" + tableName + "\"");
    }
}

// Returns a Promise
function selectMySQLQuery(queryObject, tableName) {

}