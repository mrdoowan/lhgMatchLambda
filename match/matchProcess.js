module.exports = {
    convertRiotToLhgObject: convertRiotToLhgObject,
    pushIntoDynamoDb: pushIntoDynamoDb,
    pushIntoMySql: pushIntoMySql,
};

/*  Declaring npm modules */
const { Kayn, REGIONS, BasicJSCache } = require('kayn'); // Riot API Wrapper
require('dotenv').config({ path: '../.env' });

/*  Import helper function modules */
const GLOBAL = require('../dependencies/globals');
const dynamoDb = require('../dependencies/dynamoDbHelper');
const mySql = require('../dependencies/mySqlHelper');
const helper = require('../dependencies/helper');

/*  Configurations of npm modules */
const kaynCache = new BasicJSCache();
const kayn = Kayn(process.env.RIOT_API_KEY)({
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

/*
    Input will take the Match 'Setup' Object in DynamoDB:
    {
        RiotMatchId: 'MATCH_ID', // string
        BlueTeam: {
            TeamPId: 0,
            Players: [
                {
                    ProfilePId: '',
                    ChampId: '',
                    Role: '',
                },
                // etc.
            ]
        },
        RedTeam: {
            // Same as above
        }
        SeasonPId: 0,
        TournamentPId: 0,
    }
*/

/**
 * Processes the match input object and calls a GET request from the Riot API.
 * After that, it takes the response from Riot and processes it into a LHG match object
 * @param {object} eventInputObject     Following input (from documentation)
 * @param {boolean} testing_flag        If TRUE, then always call Riot API regardless
 */
function convertRiotToLhgObject(eventInputObject, testing_flag) {
    return new Promise(async function(resolve, reject) {
        try {
            // Check if object already exists in LHG's Database
            const matchDynamoDbJson = await dynamoDb.getItem("Matches", "MatchPId", eventInputObject['RiotMatchId']);
            if (matchDynamoDbJson == null || 'Setup' in matchDynamoDbJson || testing_flag) {
                // Call Riot API
                console.log(`Processing new match ID: ${eventInputObject['RiotMatchId']}`);
                const matchRiotObject = await kayn.Match.get(parseInt(eventInputObject['RiotMatchId']));
                const timelineRiotObject = await kayn.Match.timeline(parseInt(eventInputObject['RiotMatchId']));

                // Process into LHG object
                if (!(matchRiotObject == null || timelineRiotObject == null)) {
                    // ----- 1) Add onto matchObj of profileHId
                    let profileObjByChampId = {}
                    let bluePlayerArr = eventInputObject['BlueTeam']['Players']; // Array
                    for (let i = 0; i < bluePlayerArr.length; i++) {
                        player = bluePlayerArr[i];
                        profileObjByChampId[player['ChampId']] = {
                            'PId': player.ProfilePId,
                            'Role': player.Role,
                        };
                    }
                    let redPlayerArr = eventInputObject['RedTeam']['Players']; // Array
                    for (let i = 0; i < redPlayerArr.length; i++) {
                        player = redPlayerArr[i];
                        profileObjByChampId[player['ChampId']] = {
                            'PId': player.ProfilePId,
                            'Role': player.Role,
                        };
                    }

                    // ----- 2) Create the Match item for DynamoDB
                    matchObject = {};
                    matchObject['MatchPId'] = eventInputObject['RiotMatchId'];
                    matchObject['SeasonPId'] = eventInputObject['SeasonPId'];
                    matchObject['TournamentPId'] = eventInputObject['TournamentPId'];
                    matchObject['DatePlayed'] = matchRiotObject.gameCreation;
                    matchObject['GameDuration'] = matchRiotObject.gameDuration;
                    let patch = getPatch(matchRiotObject.gameVersion);
                    matchObject['GamePatchVersion'] = patch;
                    matchObject['DDragonVersion'] = await getDDragonVersion(patch);

                    // 2.1) - Teams+Players
                    let teamItems = {}; // teamId (100 or 200) -> teamData {}
                    let playerItems = {}; // participantId -> playerData {}
                    // We will merge these two Items at 2.3)
                    let teamIdByPartId = {}; // Mapping participantId -> teamId in timeline
                    let partIdByTeamIdAndRole = {};
                    for (let i = 0; i < matchRiotObject.teams.length; i++) {
                        teamRiotObject = matchRiotObject.teams[i];
                        let teamData = {};
                        let teamId = teamRiotObject.teamId; // 100 == BLUE, 200 == RED
                        partIdByTeamIdAndRole[teamId] = {};
                        if (teamId == GLOBAL.BLUE_ID) {
                            teamData['TeamHId'] = helper.getTeamHId(eventInputObject['BlueTeam']['TeamPId']);
                        }
                        else if (teamId == GLOBAL.RED_ID) {
                            teamData['TeamHId'] = helper.getTeamHId(eventInputObject['RedTeam']['TeamPId']);
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
                        // Bans
                        // NOTE: Riot API's "pickTurn" is completely bugged and useless
                        let banArray = [];
                        let teamBansList = teamRiotObject.bans;
                        for (let banIdx = 0; banIdx < teamBansList.length; banIdx++) {
                            let banObj = teamBansList[banIdx];
                            banArray.push(banObj.championId);
                        }
                        teamData['Bans'] = banArray;
                        // ----------
                        teamData['FirstTower'] = teamRiotObject.firstTower;
                        teamData['FirstBlood'] = teamRiotObject.firstBlood;
                        let teamKills = 0;
                        let teamAssists = 0;
                        let teamDeaths = 0;
                        let teamGold = 0;
                        let teamDamageDealt = 0;
                        let teamCreepScore = 0;
                        let teamVisionScore = 0;
                        let teamWardsPlaced = 0;
                        let teamControlWardsBought = 0;
                        let teamWardsCleared = 0;
                        for (let j = 0; j < matchRiotObject.participants.length; j++) {
                            let playerData = {}
                            let participantRiotObject = matchRiotObject.participants[j];
                            if (participantRiotObject.teamId == teamId) {
                                let partId = participantRiotObject.participantId;
                                teamIdByPartId[partId] = teamId;
                                let pStatsRiotObject = participantRiotObject.stats;
                                let profilePId = profileObjByChampId[participantRiotObject.championId]['PId'];
                                playerData['ProfileHId'] = helper.getProfileHId(profilePId);
                                playerData['ParticipantId'] = partId;
                                let champRole = profileObjByChampId[participantRiotObject.championId]['Role'];
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
                                let totalCS = pStatsRiotObject.neutralMinionsKilled + pStatsRiotObject.totalMinionsKilled;
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
                                let playerRunes = {}
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
                                playerData['SkillOrder'] = []; // Logic will be done in Timeline
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
                        if (matchRiotObject.gameDuration >= GLOBAL.MINUTE_AT_EARLY * 60) {
                            teamData['CsAtEarly'] = 0;      // Logic in Timeline
                            teamData['GoldAtEarly'] = 0;    // Logic in Timeline
                            teamData['XpAtEarly'] = 0;      // Logic in Timeline
                        }
                        if (matchRiotObject.gameDuration >= GLOBAL.MINUTE_AT_MID * 60) {
                            teamData['CsAtMid'] = 0;        // Logic in Timeline
                            teamData['GoldAtMid'] = 0;      // Logic in Timeline
                            teamData['XpAtMid'] = 0;        // Logic in Timeline
                        }
                        teamItems[teamRiotObject.teamId] = teamData;
                    }
                    // 2.2) - Timeline
                    let timelineList = [];
                    // Each index represents the minute
                    let blueKillsAtEarly = 0;
                    let blueKillsAtMid = 0;
                    let redKillsAtEarly = 0;
                    let redKillsAtMid = 0;
                    let firstBloodFound = false;
                    let allItemBuilds = {'1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [], '8': [], '9': [], '10': []};
                    // We want to get the entire list of items being built. Key is the 'participantId'
                    let baronObjectiveMinuteIndex = {};
                    // Since we want to calculate baron power play AFTER the total team gold is calculated,
                    // we want to store which indices in the timelineList each minute and what index in the eventsList
                    // Key: minute -> Value: index in ['Events']
                    for (let minute = 0; minute < timelineRiotObject.frames.length; minute++) {
                        let minuteTimelineItem = {};
                        let frameRiotObject = timelineRiotObject.frames[minute];
                        let blueTeamGold = 0;
                        let redTeamGold = 0;
                        for (let partId in frameRiotObject.participantFrames) {
                            let thisTeamId = teamIdByPartId[partId];
                            let partFrameRiotObject = frameRiotObject.participantFrames[partId];
                            if (thisTeamId == GLOBAL.BLUE_ID) {
                                blueTeamGold += partFrameRiotObject['totalGold'];
                            }
                            else if (thisTeamId == GLOBAL.RED_ID) {
                                redTeamGold += partFrameRiotObject['totalGold'];
                            }
                            // playerData: EARLY_MINUTE and MID_MINUTE
                            if ((minute == GLOBAL.MINUTE_AT_EARLY && matchRiotObject.gameDuration >= GLOBAL.MINUTE_AT_EARLY * 60) || 
                                (minute == GLOBAL.MINUTE_AT_MID && matchRiotObject.gameDuration >= GLOBAL.MINUTE_AT_MID * 60)) {
                                let type = (minute == GLOBAL.MINUTE_AT_EARLY) ? "Early" : "Mid";
                                playerItems[partId]['GoldAt'+type] = partFrameRiotObject.totalGold;
                                teamItems[thisTeamId]['GoldAt'+type] += partFrameRiotObject.totalGold;
                                let playerCsAt = partFrameRiotObject.minionsKilled + partFrameRiotObject.jungleMinionsKilled;
                                playerItems[partId]['CsAt'+type] = playerCsAt;
                                teamItems[thisTeamId]['CsAt'+type] += playerCsAt;
                                playerItems[partId]['XpAt'+type] = partFrameRiotObject.xp;
                                teamItems[thisTeamId]['XpAt'+type] += partFrameRiotObject.xp;
                                playerItems[partId]['JungleCsAt'+type] = partFrameRiotObject.jungleMinionsKilled;
                            }
                        }
                        minuteTimelineItem['MinuteStamp'] = minute;
                        minuteTimelineItem['BlueTeamGold'] = blueTeamGold;
                        minuteTimelineItem['RedTeamGold'] = redTeamGold;
                        // Looping through Events
                        let eventsList = [];
                        for (let j = 0; j < frameRiotObject.events.length; j++) {
                            let riotEventObject = frameRiotObject.events[j];
                            let eventItem = {};
                            // Only Tower, Inhibitor, Dragon, Baron, Herald, and Kills are added to eventData
                            if (riotEventObject.type == 'ELITE_MONSTER_KILL') {
                                let teamId = teamIdByPartId[riotEventObject.killerId];
                                eventItem['TeamId'] = teamId;
                                eventItem['Timestamp'] = riotEventObject.timestamp;
                                eventItem['KillerId'] = riotEventObject.killerId;
                                if (riotEventObject.monsterType == 'DRAGON') {
                                    eventItem['EventType'] = 'Dragon';
                                    let getDragonString = {
                                        'AIR_DRAGON': 'Cloud',
                                        'FIRE_DRAGON': 'Infernal',
                                        'EARTH_DRAGON': 'Mountain',
                                        'WATER_DRAGON': 'Ocean',
                                        'ELDER_DRAGON': 'Elder'
                                    };
                                    let dragonStr = getDragonString[riotEventObject.monsterSubType];
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
                                eventItem['TeamId'] = (riotEventObject.teamId == GLOBAL.BLUE_ID) ? parseInt(GLOBAL.RED_ID) : parseInt(GLOBAL.BLUE_ID);   
                                // FROM RIOT API, THE ABOVE IS TEAM_ID OF TOWER DESTROYED. NOT KILLED (which is what we intend)
                                eventItem['Timestamp'] = riotEventObject.timestamp;
                                eventItem['KillerId'] = riotEventObject.killerId;
                                if (riotEventObject.assistingParticipantIds.length > 0) {
                                    eventItem['AssistIds'] = riotEventObject.assistingParticipantIds;
                                }
                                let getLaneString = {
                                    'TOP_LANE': 'Top',
                                    'MID_LANE': 'Middle',
                                    'BOT_LANE': 'Bottom'
                                };
                                eventItem['Lane'] = getLaneString[riotEventObject.laneType];
                                if (riotEventObject.buildingType == 'TOWER_BUILDING') {
                                    eventItem['EventType'] = 'Tower';
                                    let getTowerType = {
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
                                let teamId = teamIdByPartId[riotEventObject.killerId];
                                eventItem['TeamId'] = teamId
                                eventItem['Timestamp'] = riotEventObject.timestamp;
                                let killerId = riotEventObject.killerId;
                                eventItem['KillerId'] = killerId;
                                let victimId = riotEventObject.victimId;
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
                                if (minute < GLOBAL.MINUTE_AT_EARLY) {
                                    if (teamId == GLOBAL.BLUE_ID) { blueKillsAtEarly++; }
                                    else if (teamId == GLOBAL.RED_ID) { redKillsAtEarly++; }
                                }
                                if (minute < GLOBAL.MINUTE_AT_MID) {
                                    if (teamId == GLOBAL.BLUE_ID) { blueKillsAtMid++; }
                                    else if (teamId == GLOBAL.RED_ID) { redKillsAtMid++; }
                                }
                            }
                            else if (riotEventObject.type == 'ITEM_PURCHASED') {
                                let itemEvent = {
                                    'MinuteStamp': minute - 1, // Apparently a minute after...
                                    'ItemId': riotEventObject.itemId,
                                    'Bought': true,
                                };
                                allItemBuilds[riotEventObject.participantId].push(itemEvent);
                            }
                            else if (riotEventObject.type == 'ITEM_SOLD') {
                                let itemEvent = {
                                    'MinuteStamp': minute - 1, // Apparently a minute after...
                                    'ItemId': riotEventObject.itemId,
                                    'Bought': false,
                                }
                                allItemBuilds[riotEventObject.participantId].push(itemEvent);
                            }
                            else if (riotEventObject.type == 'ITEM_UNDO') {
                                // Based on the API, I could just remove the last Item Build event
                                allItemBuilds[riotEventObject.participantId].pop();
                            }
                            else if (riotEventObject.type == 'SKILL_LEVEL_UP') {
                                // playerData['Skillorder']
                                let getSkillLetter = { '1': 'Q', '2': 'W', '3': 'E', '4': 'R' };
                                let skillValue = riotEventObject.skillSlot;
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
                    if (matchRiotObject.gameDuration >= GLOBAL.MINUTE_AT_EARLY * 60) {
                        teamItems[GLOBAL.BLUE_ID]['KillsAtEarly'] = blueKillsAtEarly;
                        teamItems[GLOBAL.RED_ID]['KillsAtEarly'] = redKillsAtEarly;
                        let blueKillsDiffEarly = blueKillsAtEarly - redKillsAtEarly;
                        let blueTeamGoldDiffEarly = teamItems[GLOBAL.BLUE_ID]['GoldAtEarly'] - teamItems[GLOBAL.RED_ID]['GoldAtEarly'];
                        let blueTeamCsDiffEarly = teamItems[GLOBAL.BLUE_ID]['CsAtEarly'] - teamItems[GLOBAL.RED_ID]['CsAtEarly'];
                        let blueTeamXpDiffEarly = teamItems[GLOBAL.BLUE_ID]['XpAtEarly'] - teamItems[GLOBAL.RED_ID]['XpAtEarly'];
                        teamItems[GLOBAL.BLUE_ID]['KillsDiffEarly'] = blueKillsDiffEarly;
                        teamItems[GLOBAL.RED_ID]['KillsDiffEarly'] = (blueKillsDiffEarly == 0) ? 0 : (blueKillsDiffEarly * -1);
                        teamItems[GLOBAL.BLUE_ID]['GoldDiffEarly'] = blueTeamGoldDiffEarly;
                        teamItems[GLOBAL.RED_ID]['GoldDiffEarly'] = (blueTeamGoldDiffEarly == 0) ? 0 : (blueTeamGoldDiffEarly * -1);
                        teamItems[GLOBAL.BLUE_ID]['CsDiffEarly'] = blueTeamCsDiffEarly;
                        teamItems[GLOBAL.RED_ID]['CsDiffEarly'] = (blueTeamCsDiffEarly == 0) ? 0 : (blueTeamCsDiffEarly * -1);
                        teamItems[GLOBAL.BLUE_ID]['XpDiffEarly'] = blueTeamXpDiffEarly;
                        teamItems[GLOBAL.RED_ID]['XpDiffEarly'] = (blueTeamXpDiffEarly == 0) ? 0 : (blueTeamXpDiffEarly * -1);
                    }
                    if (matchRiotObject.gameDuration >= GLOBAL.MINUTE_AT_MID * 60) {
                        teamItems[GLOBAL.BLUE_ID]['KillsAtMid'] = blueKillsAtMid;
                        teamItems[GLOBAL.RED_ID]['KillsAtMid'] = redKillsAtMid;
                        let blueKillsDiffMid = blueKillsAtMid - redKillsAtMid;
                        let blueTeamGoldDiffMid = teamItems[GLOBAL.BLUE_ID]['GoldAtMid'] - teamItems[GLOBAL.RED_ID]['GoldAtMid'];
                        let blueTeamCsDiffMid = teamItems[GLOBAL.BLUE_ID]['CsAtMid'] - teamItems[GLOBAL.RED_ID]['CsAtMid'];
                        let blueTeamXpDiffMid = teamItems[GLOBAL.BLUE_ID]['XpAtMid'] - teamItems[GLOBAL.RED_ID]['XpAtMid'];
                        teamItems[GLOBAL.BLUE_ID]['KillsDiffMid'] = blueKillsDiffMid;
                        teamItems[GLOBAL.RED_ID]['KillsDiffMid'] = (blueKillsDiffMid == 0) ? 0 : (blueKillsDiffMid * -1);
                        teamItems[GLOBAL.BLUE_ID]['GoldDiffMid'] = blueTeamGoldDiffMid;
                        teamItems[GLOBAL.RED_ID]['GoldDiffMid'] = (blueTeamGoldDiffMid == 0) ? 0 : (blueTeamGoldDiffMid * -1);
                        teamItems[GLOBAL.BLUE_ID]['CsDiffMid'] = blueTeamCsDiffMid;
                        teamItems[GLOBAL.RED_ID]['CsDiffMid'] = (blueTeamCsDiffMid == 0) ? 0 : (blueTeamCsDiffMid * -1);
                        teamItems[GLOBAL.BLUE_ID]['XpDiffMid'] = blueTeamXpDiffMid;
                        teamItems[GLOBAL.RED_ID]['XpDiffMid'] = (blueTeamXpDiffMid == 0) ? 0 : (blueTeamXpDiffMid * -1);
                    }
                    // playerData['ItemBuild']. Reformat allItemBuilds to have each minute as the key
                    for (let partId in allItemBuilds) {
                        let playerItemBuild = {};
                        let currMinute = 0;
                        let itemBuildsByMinute = [];
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
                    for (let role in partIdByTeamIdAndRole[GLOBAL.BLUE_ID]) {
                        bluePartId = partIdByTeamIdAndRole[GLOBAL.BLUE_ID][role];
                        redPartId = partIdByTeamIdAndRole[GLOBAL.RED_ID][role];
                        if (matchRiotObject.gameDuration >= GLOBAL.MINUTE_AT_EARLY * 60) {
                            let bluePlayerGoldDiffEarly = playerItems[bluePartId].GoldAtEarly - playerItems[redPartId].GoldAtEarly;
                            playerItems[bluePartId]['GoldDiffEarly'] = bluePlayerGoldDiffEarly;
                            playerItems[redPartId]['GoldDiffEarly'] = (bluePlayerGoldDiffEarly == 0) ? 0 : (bluePlayerGoldDiffEarly * -1);
                            let bluePlayerCsDiffEarly = playerItems[bluePartId].CsAtEarly - playerItems[redPartId].CsAtEarly;
                            playerItems[bluePartId]['CsDiffEarly'] = bluePlayerCsDiffEarly;
                            playerItems[redPartId]['CsDiffEarly'] = (bluePlayerCsDiffEarly == 0) ? 0 : (bluePlayerCsDiffEarly * -1);
                            let bluePlayerXpDiffEarly = playerItems[bluePartId].XpAtEarly - playerItems[redPartId].XpAtEarly;
                            playerItems[bluePartId]['XpDiffEarly'] = bluePlayerXpDiffEarly;
                            playerItems[redPartId]['XpDiffEarly'] = (bluePlayerXpDiffEarly == 0) ? 0 : (bluePlayerXpDiffEarly * -1);
                            let bluePlayerJgCsDiffEarly = playerItems[bluePartId].JungleCsAtEarly - playerItems[redPartId].JungleCsAtEarly;
                            playerItems[bluePartId]['JungleCsDiffEarly'] = bluePlayerJgCsDiffEarly;
                            playerItems[redPartId]['JungleCsDiffEarly'] = (bluePlayerJgCsDiffEarly == 0) ? 0 : (bluePlayerJgCsDiffEarly * -1);
                        }
                        if (matchRiotObject.gameDuration >= GLOBAL.MINUTE_AT_MID * 60) {
                            let bluePlayerGoldDiffMid = playerItems[bluePartId].GoldAtMid - playerItems[redPartId].GoldAtMid;
                            playerItems[bluePartId]['GoldDiffMid'] = bluePlayerGoldDiffMid;
                            playerItems[redPartId]['GoldDiffMid'] = (bluePlayerGoldDiffMid == 0) ? 0 : (bluePlayerGoldDiffMid * -1);
                            let bluePlayerCsDiffMid = playerItems[bluePartId].CsAtMid - playerItems[redPartId].CsAtMid;
                            playerItems[bluePartId]['CsDiffMid'] = bluePlayerCsDiffMid;
                            playerItems[redPartId]['CsDiffMid'] = (bluePlayerCsDiffMid == 0) ? 0 : (bluePlayerCsDiffMid * -1);
                            let bluePlayerXpDiffMid = playerItems[bluePartId].XpAtMid - playerItems[redPartId].XpAtMid;
                            playerItems[bluePartId]['XpDiffMid'] = bluePlayerXpDiffMid;
                            playerItems[redPartId]['XpDiffMid'] = (bluePlayerXpDiffMid == 0) ? 0 : (bluePlayerXpDiffMid * -1);
                            let bluePlayerJgCsDiffMid = playerItems[bluePartId].JungleCsAtMid - playerItems[redPartId].JungleCsAtMid;
                            playerItems[bluePartId]['JungleCsDiffMid'] = bluePlayerJgCsDiffMid;
                            playerItems[redPartId]['JungleCsDiffMid'] = (bluePlayerJgCsDiffMid == 0) ? 0 : (bluePlayerJgCsDiffMid * -1);
                        }
                    }
                    // 2.3) - Merge teamItem + playerItem (especially with the Diffs)
                    for (let partId in playerItems) {
                        let teamId = teamIdByPartId[partId];
                        teamItems[teamId]['Players'][partId] = playerItems[partId];
                    }
                    matchObject['Teams'] = teamItems;
                    
                    // Return the whole matchObject
                    resolve(matchObject);
                }
            }
        }
        catch (err) {
            reject({
                error: err,
                message: `Function "convertRiotToLhgObject" Failed`,
            });
        }
    });
}

/**
 * Takes the Takes the LHG Match object and pushes into DynamoDB
 * @param {object} lhgMatchObject 
 */
async function pushIntoDynamoDb(lhgMatchObject) {
    await dynamoDb.putItem('Matches', lhgMatchObject, lhgMatchObject.MatchPId);
}

/**
 * Takes the LHG Match object and inserts into LHG's MySQL tables
 * @param {object} lhgMatchObject 
 * @param {object} eventInputObject 
 */
async function pushIntoMySql(lhgMatchObject, eventInputObject) {
    try {
        // 1) MatchStats
        const blueTeamPId = helper.getTeamPId(lhgMatchObject['Teams'][GLOBAL.BLUE_ID]['TeamHId']);
        const redTeamPId = helper.getTeamPId(lhgMatchObject['Teams'][GLOBAL.RED_ID]['TeamHId']);
        const insertMatchStatsColumn = {
            'riotMatchId': eventInputObject['RiotMatchId'],
            'seasonPId': eventInputObject['SeasonPId'],
            'tournamentPId': eventInputObject['TournamentPId'],
            'tournamentType': (await dynamoDb.getItem('Tournament', 'TournamentPId', eventInputObject['TournamentPId']))['Information']['TournamentType'],
            'blueTeamPId': blueTeamPId,
            'redTeamPId': redTeamPId,
            'duration': lhgMatchObject.GameDuration,
            'patch': lhgMatchObject.GamePatchVersion,
            'datePlayed': lhgMatchObject.DatePlayed
        };
        await mySql.insertQuery(insertMatchStatsColumn, 'MatchStats');

        // 2) TeamStats + PlayerStats + BannedChamps
        // 2.1) TeamStats
        for (let i = 0; i < Object.keys(lhgMatchObject['Teams']).length; ++i) {
            let teamSide = Object.keys(lhgMatchObject['Teams'])[i]; // "100" or "200"
            let teamObject = lhgMatchObject['Teams'][teamSide];
            let durationByMinute = lhgMatchObject.GameDuration / 60;
            let thisTeamPId = (teamSide == GLOBAL.BLUE_ID) ? blueTeamPId : redTeamPId;
            let enemyTeamPId = (teamSide == GLOBAL.BLUE_ID) ? redTeamPId : blueTeamPId;
            let insertTeamStatsColumn = {
                'riotMatchId': eventInputObject['RiotMatchId'],
                'teamPId': thisTeamPId,
                'side': GLOBAL.SIDE_STRING[teamSide],
                'win': teamObject.Win,
                'dmgDealtPerMin': (teamObject.TeamDamageDealt / durationByMinute).toFixed(2),
                'goldPerMin': (teamObject.TeamGold / durationByMinute).toFixed(2),
                'csPerMin': (teamObject.TeamCreepScore / durationByMinute).toFixed(2),
                'vsPerMin': (teamObject.TeamVisionScore / durationByMinute).toFixed(2),
                'firstBlood': teamObject.FirstBlood,
                'firstTower': teamObject.FirstTower,
                'totalKills': teamObject.TeamKills,
                'totalDeaths': teamObject.TeamDeaths,
                'totalAssists': teamObject.TeamAssists,
                'totalTowers': teamObject.Towers,
                'totalDragons': teamObject.Dragons.length,
                'totalHeralds': teamObject.Heralds,
                'totalBarons': teamObject.Barons,
                'totalDamageDealt': teamObject.TeamDamageDealt,
                'totalGold': teamObject.TeamGold,
                'totalCreepScore': teamObject.TeamCreepScore,
                'totalVisionScore': teamObject.TeamVisionScore,
                'totalWardsPlaced': teamObject.TeamWardsPlaced,
                'totalControlWardsBought': teamObject.TeamControlWardsBought,
                'totalWardsCleared': teamObject.TeamWardsCleared
            };
            if (lhgMatchObject.GameDuration >= GLOBAL.MINUTE_AT_EARLY * 60) {
                insertTeamStatsColumn['goldAtEarly'] = teamObject.GoldAtEarly;
                insertTeamStatsColumn['goldDiffEarly'] = teamObject.GoldDiffEarly;
                insertTeamStatsColumn['csAtEarly'] = teamObject.CsAtEarly;
                insertTeamStatsColumn['csDiffEarly'] = teamObject.CsDiffEarly;
                insertTeamStatsColumn['xpAtEarly'] = teamObject.XpAtEarly;
                insertTeamStatsColumn['xpDiffEarly'] = teamObject.XpDiffEarly;
                insertTeamStatsColumn['killsAtEarly'] = teamObject.KillsAtEarly;
                insertTeamStatsColumn['killsDiffEarly'] = teamObject.KillsDiffEarly;
            }
            if (lhgMatchObject.GameDuration >= GLOBAL.MINUTE_AT_MID * 60) {
                insertTeamStatsColumn['goldAtMid'] = teamObject.GoldAtMid;
                insertTeamStatsColumn['goldDiffMid'] = teamObject.GoldDiffMid;
                insertTeamStatsColumn['csAtMid'] = teamObject.CsAtMid;
                insertTeamStatsColumn['csDiffMid'] = teamObject.CsDiffMid;
                insertTeamStatsColumn['xpAtMid'] = teamObject.XpAtMid;
                insertTeamStatsColumn['xpDiffMid'] = teamObject.XpDiffMid,
                insertTeamStatsColumn['killsAtMid'] = teamObject.KillsAtMid;
                insertTeamStatsColumn['killsDiffMid'] = teamObject.KillsDiffMid;
            }
            mySql.insertQuery(insertTeamStatsColumn, 'TeamStats');

            // 2.2) BannedChamps
            let insertBannedChampsColumn = {
                'riotMatchId': eventInputObject['RiotMatchId'],
                'sideBannedBy': GLOBAL.SIDE_STRING[teamSide],
                'teamBannedById': thisTeamPId,
                'teamBannedAgainstId': enemyTeamPId
            };
            for (let j = 0; j < teamObject.Bans.length; ++j) {
                let champId = teamObject.Bans[j]
                insertBannedChampsColumn['champId'] = champId;
                mySql.insertQuery(insertBannedChampsColumn, 'BannedChamps');
            }

            // 2.3) PlayerStats
            for (let j = 0; j < Object.values(teamObject['Players']).length; ++j) {
                let playerObject = Object.values(teamObject['Players'])[j];
                let insertPlayerStatsColumn = {
                    'profilePId': helper.getProfilePId(playerObject.ProfileHId),
                    'riotMatchId': eventInputObject['RiotMatchId'],
                    'teamPId': helper.getTeamPId(teamObject.TeamHId),
                    'side': GLOBAL.SIDE_STRING[teamSide],
                    'role': playerObject.Role,
                    'champId': playerObject.ChampId,
                    'win': teamObject.Win,
                    'kills': playerObject.Kills,
                    'deaths': playerObject.Deaths,
                    'assists': playerObject.Assists,
                    'dmgDealtPerMin': (playerObject.TotalDamageDealt / durationByMinute).toFixed(2),
                    'csPerMin': (playerObject.CreepScore / durationByMinute).toFixed(2),
                    'goldPerMin': (playerObject.Gold / durationByMinute).toFixed(2),
                    'vsPerMin': (playerObject.VisionScore / durationByMinute).toFixed(2),
                    'firstBloodKill': playerObject.FirstBloodKill,
                    'firstBloodAssist': playerObject.FirstBloodAssist,
                    'firstTower': playerObject.FirstTower,
                    'damageDealt': playerObject.TotalDamageDealt,
                    'gold': playerObject.Gold,
                    'creepScore': playerObject.CreepScore,
                    'visionScore': playerObject.VisionScore,
                    'wardsPlaced': playerObject.WardsPlaced,
                    'controlWardsBought': playerObject.ControlWardsBought,
                    'wardsCleared': playerObject.WardsCleared,
                    'soloKills': playerObject.SoloKills,
                    'doubleKills': playerObject.DoubleKills,
                    'tripleKills': playerObject.TripleKills,
                    'quadraKills': playerObject.QuadraKills,
                    'pentaKills': playerObject.PentaKills
                };
                if (lhgMatchObject.GameDuration >= GLOBAL.MINUTE_AT_EARLY * 60) {
                    insertPlayerStatsColumn['goldAtEarly'] = playerObject.GoldAtEarly;
                    insertPlayerStatsColumn['goldDiffEarly'] = playerObject.GoldDiffEarly;
                    insertPlayerStatsColumn['csAtEarly'] = playerObject.CsAtEarly;
                    insertPlayerStatsColumn['csDiffEarly'] = playerObject.CsDiffEarly;
                    insertPlayerStatsColumn['xpAtEarly'] = playerObject.XpAtEarly;
                    insertPlayerStatsColumn['xpDiffEarly'] = playerObject.XpDiffEarly;
                    insertPlayerStatsColumn['jungleCsAtEarly'] = playerObject.JungleCsAtEarly;
                    insertPlayerStatsColumn['jungleCsDiffEarly'] = playerObject.JungleCsDiffEarly;
                }
                if (lhgMatchObject.GameDuration >= GLOBAL.MINUTE_AT_MID * 60) {
                    insertPlayerStatsColumn['goldAtMid'] = playerObject.GoldAtMid;
                    insertPlayerStatsColumn['goldDiffMid'] = playerObject.GoldDiffMid;
                    insertPlayerStatsColumn['csAtMid'] = playerObject.CsAtMid;
                    insertPlayerStatsColumn['csDiffMid'] = playerObject.CsDiffMid;
                    insertPlayerStatsColumn['xpAtMid'] = playerObject.XpAtMid;
                    insertPlayerStatsColumn['xpDiffMid'] = playerObject.XpDiffMid;
                    insertPlayerStatsColumn['jungleCsAtMid'] = playerObject.JungleCsAtMid;
                    insertPlayerStatsColumn['jungleCsDiffMid'] = playerObject.JungleCsDiffMid;
                }
                mySql.insertQuery(insertPlayerStatsColumn, 'PlayerStats');
            }
        }

        // 3.3) Objectives
        lhgMatchObject['Timeline'].forEach(function(minuteObject) {
            if ('Events' in minuteObject) {
                minuteObject['Events'].forEach(function(eventObject) {
                    if (['Tower','Inhibitor','Dragon','Baron','Herald'].includes(eventObject.EventType)) {
                        let insertObjectivesColumn = {
                            'riotMatchId': eventInputObject['RiotMatchId'],
                            'teamPId': (eventObject.TeamId == GLOBAL.BLUE_ID) ? blueTeamPId : redTeamPId,
                            'objectiveEvent': eventObject.EventType,
                            'timestamp': eventObject.Timestamp
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
                        mySql.insertQuery(insertObjectivesColumn, 'Objectives');
                    }
                });
            }
        });

        // Confirm
        console.log(`MySQL: All data from '${lhgMatchData.MatchPId}' inserted.`);
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
//#region Helper Functions

/**
 * Gets the DDragon version of the LoL patch based on: https://ddragon.leagueoflegends.com/api/versions.json
 * @param {string} patch    Specified League of Legends patch (i.e. "10.23")
 */
function getDDragonVersion(patch) {
    return new Promise(async function(resolve, reject) {
        try {
            const DDragonVersionList = await kayn.DDragon.Version.list();
            for (let i = 0; i < DDragonVersionList.length; ++i) {
                let DDragonVersion = DDragonVersionList[i];
                if (DDragonVersion.includes(patch)) {
                    resolve(DDragonVersion); 
                    return;    
                }
            }
            resolve(DDragonVersionList[0]); // Just return latest as default
        }
        catch (err) {
            console.error("getDDragonVersion Promise Rejected.");
            reject(err);
        }
    });
}

/**
 * Takes riotMatchObject's game version (i.e. "10.20.337.6704") and only looks at the Major.Minor (returns "10.20")
 * @param {string} patchStr 
 */
function getPatch(patchStr) {
    let patchArr = patchStr.split('.');
    return patchArr[0] + '.' + patchArr[1];
}

/**
 * Ever since Patch 9.23, baron duration is 3 minutes. Before then, it used to be 3.5 minutes.
 * @param {string} thisPatch    patch in string format (i.e. "10.20")
 */
function updateBaronDuration(thisPatch) {
    return (isPatch1LaterThanPatch2(thisPatch, GLOBAL.BARON_DURATION_PATCH_CHANGE)) ? GLOBAL.CURRENT_BARON_DURATION : GLOBAL.OLD_BARON_DURATION;
}

/**
 * Compares the two patch strings and returns "true" if patch1 is later than patch2.
 * Assumption: patch1 and patch2 are formatted in "##.##"
 * @param {string} patch1 
 * @param {string} patch2 
 */
// Assumption: patch1 and patch2 are formatted in "##.##"
function isPatch1LaterThanPatch2(patch1, patch2) {
    let patch1Arr = patch1.split('.');
    let patch2Arr = patch2.split('.');
    season1 = parseInt(patch1Arr[0]);
    season2 = parseInt(patch2Arr[0]);
    version1 = parseInt(patch1Arr[1]);
    version2 = parseInt(patch2Arr[1]);

    if (season1 < season2) { return false; }
    else if (season1 > season2) { return true; }
    return (version1 >= version2) ? true : false;
}

/**
 * returns the Team Gold at the given timestamp. Does a linear approximation in between seconds
 * @param {number} timestamp        Expressed in seconds
 * @param {*} timelineList          List of events from the Riot Timeline API Request
 * @param {*} teamId                "100" == Blue, "200" == Red
 */
function teamGoldAtTimeStamp(timestamp, timelineList, teamId) {
    let timeStampMinute = Math.floor(timestamp / 60);
    let timeStampSeconds = timestamp % 60;
    if ((timeStampMinute + 1) >= timelineList.length) { return null; }

    // Take team gold at marked minute, and from minute + 1. Average them.
    let teamGoldAtMinute = (teamId == GLOBAL.BLUE_ID) ? timelineList[timeStampMinute]['BlueTeamGold'] : timelineList[timeStampMinute]['RedTeamGold'];
    let teamGoldAtMinutePlus1 = (teamId == GLOBAL.BLUE_ID) ? timelineList[timeStampMinute+1]['BlueTeamGold'] : timelineList[timeStampMinute+1]['RedTeamGold'];
    let goldPerSecond = (teamGoldAtMinutePlus1 - teamGoldAtMinute) / 60;
    return (teamGoldAtMinute + Math.floor((goldPerSecond * timeStampSeconds)));
}

/**
 * Modifies the timelineList to compute the Power Play of each Baron event
 * Returns nothing.
 * @param {*} baronObjectiveMinuteIndices   A list of indices where a Baron was taken in the Timeline
 * @param {*} timelineList                  List of events from the Riot Timeline API Request
 * @param {*} patch                         Patch of what the event took place in
 */
function computeBaronPowerPlay(baronObjectiveMinuteIndices, timelineList, patch) {
    return new Promise(function(resolve, reject) {
        try {
            let baronDuration = updateBaronDuration(patch); // in seconds
            Object.keys(baronObjectiveMinuteIndices).forEach(function(minute) {
                let eventIndex = baronObjectiveMinuteIndices[minute];
                let baronEventObject = timelineList[minute]['Events'][eventIndex]; // Make shallow copy and change that
                let thisTeamId = baronEventObject.TeamId;
                let oppTeamId = (thisTeamId == GLOBAL.BLUE_ID) ? GLOBAL.RED_ID : GLOBAL.BLUE_ID;
                let timeStampAtKill = baronEventObject.Timestamp / 1000; // Convert ms -> seconds
                let teamGoldAtKill = teamGoldAtTimeStamp(timeStampAtKill, timelineList, thisTeamId);
                let oppGoldAtKill = teamGoldAtTimeStamp(timeStampAtKill, timelineList, oppTeamId);
                if (teamGoldAtKill == null || oppGoldAtKill == null) { return; }
                let timeStampAtExpire = timeStampAtKill + baronDuration;
                let teamGoldAtExpire = teamGoldAtTimeStamp(timeStampAtExpire, timelineList, thisTeamId);
                let oppGoldAtExpire = teamGoldAtTimeStamp(timeStampAtExpire, timelineList, oppTeamId);
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

//#endregion
