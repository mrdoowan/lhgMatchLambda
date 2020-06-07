/* 
    AWS LAMBDA FUNCTION 2: Insert a tournamentId and update overall stats for Profile, Team, and Tournament
    This function affects the following:
    - DynamoDB: Tournament, Team, Profile table
*/

/*  Declaring npm modules */
const Hashids = require('hashids/cjs'); // For hashing and unhashing
const clonedeep = require('lodash.clonedeep'); // for deep cloning

/*  Import helper function modules */
const GLOBAL = require('./globals');
const dynamoDb = require('./dynamoDbHelper');
const mySql = require('./mySqlHelper');
require('dotenv').config();

/* 
    Import from other files that are not committed to Github
    Contact doowan about getting a copy of these files
*/
const inputObjects = require('./external/tournamentTest');

/*  Configurations of npm modules */
const profileHashIds = new Hashids(process.env.PROFILE_HID_SALT, parseInt(process.env.HID_LENGTH));
const teamHashIds = new Hashids(process.env.TEAM_HID_SALT, parseInt(process.env.HID_LENGTH));

/*  Main AWS Lambda Function. We'll come back to this later */
exports.handler = async (event, context) => {
    
};

async function main() {
    try {
        for (let i = 0; i < inputObjects.length; ++i) {
            let tournamentId = inputObjects[i];
            let tourneyDbObject = await dynamoDb.getItem('Tournament', 'TournamentPId', tournamentId);
            if (!(tourneyDbObject == undefined || tourneyDbObject == null)) {
                await updateProfileItemDynamoDb(tourneyDbObject);
                await updateTeamItemDynamoDb(tourneyDbObject);
                await updateTournamentItemDynamoDb(tourneyDbObject);
            }
            else {
                console.error("TournamentPId '" + tournamentId + "' doesn't exist in DynamoDB!");
            }
        }
    }
    catch (err) {
        console.log("ERROR thrown! Info below.");
        console.log("Stack: ", err.stack);
        console.log("Name: ", err.name);
        console.log("Message: ", err.message);
    }
}

main();

/*
    ----------------------
    Const Inits
    ----------------------
*/
//#region Consts
const initProfileSeasonGames = {
    'Matches': {}
}
const initProfileTourneyStats = {
    'GamesPlayed': 0,
    'GamesPlayedOverEarly': 0,
    'GamesPlayedOverMid': 0,
    'TotalGameDuration': 0,
    'GamesWin': 0,
    'TotalKills': 0,
    'TotalDeaths': 0,
    'TotalAssists': 0,
    'TotalCreepScore': 0,
    'TotalDamage': 0,
    'TotalGold': 0,
    'TotalVisionScore': 0,
    'TotalCsAtEarly': 0,
    'TotalGoldAtEarly': 0,
    'TotalXpAtEarly': 0,
    'TotalCsDiffEarly': 0,
    'TotalGoldDiffEarly': 0,
    'TotalXpDiffEarly': 0,
    'TotalFirstBloods': 0,
    'TotalTeamKills': 0,
    'TotalTeamDeaths': 0,
    'TotalTeamDamage': 0,
    'TotalTeamGold': 0,
    'TotalTeamVisionScore': 0,
    'TotalWardsPlaced': 0,
    'TotalControlWardsBought': 0,
    'TotalWardsCleared': 0,
    'TotalSoloKills': 0,
    'TotalDoubleKills': 0,
    'TotalTripleKills': 0,
    'TotalQuadraKills': 0,
    'TotalPentaKills': 0,
};
const initTeamSeasonGames = {
    'Matches': {}
};
const initTeamSeasonScouting = {
    'Ongoing': false,
    'GamesPlayed': 0,
    'GamesWin': 0,
    'BannedByTeam': {},
    'BannedAgainstTeam': {},
    'PlayerLog': {}
};
const initTeamTourneyStats = {
    'GamesPlayed': 0,
    'GamesPlayedOverEarly': 0,
    'GamesPlayedOverMid': 0,
    'GamesWon': 0,
    'GamesPlayedOnBlue': 0,
    'BlueWins': 0,
    'TotalGameDuration': 0,
    'TotalXpDiffEarly': 0,
    'TotalXpDiffMid': 0,
    'TotalGold': 0,
    'TotalGoldDiffEarly': 0,
    'TotalGoldDiffMid': 0,
    'TotalCreepScore': 0,
    'TotalCsDiffEarly': 0,
    'TotalCsDiffMid': 0,
    'TotalDamageDealt': 0,
    'TotalFirstBloods': 0,
    'TotalFirstTowers': 0,
    'TotalKills': 0,
    'TotalDeaths': 0,
    'TotalAssists': 0,
    'TotalTowersTaken': 0,
    'TotalTowersLost': 0,
    'TotalDragonsTaken': 0,
    'TotalEnemyDragons': 0,
    'TotalHeraldsTaken': 0,
    'TotalEnemyHeralds': 0,
    'TotalBaronsTaken': 0,
    'TotalEnemyBarons': 0,
    'TotalVisionScore': 0,
    'TotalWardsPlaced': 0,
    'TotalControlWardsBought': 0,
    'TotalWardsCleared': 0,
    'TotalEnemyWardsPlaced': 0
};
const initTourneyStats = {
    'NumberGames': 0,
    'BlueSideWins': 0,
    'TotalGameDuration': 0,
    'CloudDrakes': 0,
    'OceanDrakes': 0,
    'InfernalDrakes': 0,
    'MountainDrakes': 0,
    'ElderDrakes': 0,
};
const initTourneyPickBans = {
    'BluePicks': 0,
    'RedPicks': 0,
    'NumWins': 0,
    'Phase1Bans': 0,
    'Phase2Bans': 0,
    'BluePhase1Bans': 0,
    'RedPhase1Bans': 0,
    'BluePhase2Bans': 0,
    'RedPhase2Bans': 0
};
//#endregion

/*
    ----------------------
    Database Functions
    ----------------------
*/

async function updateProfileItemDynamoDb(tourneyDbObject) {
    let tournamentPId = tourneyDbObject['TournamentPId'];
    console.log("FUNCTION: updateProfileItemDynamoDb of tId '" + tournamentPId + "'");
    try {
        let seasonPId = tourneyDbObject['Information']['SeasonPId'];
        let profileIdsSqlList = await mySql.callSProc('profilePIdsByTournamentPId', tournamentPId);
        for (let playerIdx = 0; playerIdx < profileIdsSqlList.length; ++playerIdx) {
            let profilePId = profileIdsSqlList[playerIdx]['profilePId'];
            let profileDbObject = await dynamoDb.getItem('Profile', 'ProfilePId', profilePId); // Note this is the current state in code
            /*  
                -------------------
                Init DynamoDB Items
                -------------------
            */
            // #region Init Items
            // Check 'GameLog' exists in ProfileDbObject
            // {MAIN}/profile/<profileName>/games/<seasonShortName>
            const initProfileGameLog = { [seasonPId]: initProfileSeasonGames };
            // Check if 'GameLog' exists in Profile
            if (!('GameLog' in profileDbObject)) {
                await dynamoDb.updateItem('Profile', 'ProfilePId', profilePId,
                    'SET #gLog = :val',
                    { 
                        '#gLog': 'GameLog'
                    },
                    { 
                        ':val': initProfileGameLog
                    }
                );
                profileDbObject['GameLog'] = clonedeep(initProfileGameLog);
            }
            // Check if that season exists in the GameLogs
            else if (!(seasonPId in profileDbObject['GameLog'])) {
                await dynamoDb.updateItem('Profile', 'ProfilePId', profilePId,
                    'SET #gLog.#sId = :val',
                    {
                        '#gLog': 'GameLog',
                        '#sId': seasonPId
                    },
                    {
                        ':val': initProfileSeasonGames
                    }
                );
                profileDbObject['GameLog'][seasonPId] = clonedeep(initProfileSeasonGames);
            }
            // Check if 'StatsLog' exists in Profile
            // {MAIN}/profile/<profileName>/stats/<seasonShortName>
            const initStatsLog = { [tournamentPId]: { RoleStats: {} } };
            if (!('StatsLog' in profileDbObject)) {
                await dynamoDb.updateItem('Profile', 'ProfilePId', profilePId,
                    'SET #sLog = :val',
                    { 
                        '#sLog': 'StatsLog'
                    },
                    { 
                        ':val': initStatsLog
                    }
                );
                profileDbObject['StatsLog'] = clonedeep(initStatsLog);
            }
            // Check if that TournamentPId in StatsLog
            else if (!(tournamentPId in profileDbObject['StatsLog'])) {
                profileDbObject['StatsLog'][tournamentPId] = {};
            }
            //#endregion
            // Make shallow copies
            let statsLogProfileItem = profileDbObject['StatsLog'][tournamentPId]['RoleStats'];
            let gameLogProfileItem = profileDbObject['GameLog'][seasonPId]['Matches'];
            
            /*  
                -------------
                Compile Data
                -------------
            */
            // Load each Stat into Profile in tournamentId
            let matchDataList = await mySql.callSProc('playerStatsByTournamentPId', profilePId, tournamentPId);
            let matchLoaded = false;
            console.log("Profile \'" + profilePId + "\' played " + matchDataList.length + " matches.");
            for (let matchIdx = 0; matchIdx < matchDataList.length; ++matchIdx) {
                let sqlPlayerStats = matchDataList[matchIdx];
                let matchPId = sqlPlayerStats.riotMatchId;
                if (!(matchPId in gameLogProfileItem)) {
                    /*  
                        ----------
                        'StatsLog'
                        ----------
                    */
                    // Check if the Role they played exists
                    let role = sqlPlayerStats.role;
                    if (!(role in statsLogProfileItem)) {
                        statsLogProfileItem[role] = clonedeep(initProfileTourneyStats);
                    }
                    statsLogProfileItem[role]['GamesPlayed']++;
                    statsLogProfileItem[role]['GamesPlayedOverEarly'] += (sqlPlayerStats.duration >= GLOBAL.MINUTE_AT_EARLY * 60);
                    statsLogProfileItem[role]['GamesPlayedOverMid'] += (sqlPlayerStats.duration >= GLOBAL.MINUTE_AT_MID * 60);
                    statsLogProfileItem[role]['TotalGameDuration'] += sqlPlayerStats.duration;
                    statsLogProfileItem[role]['GamesWin'] += sqlPlayerStats.win;
                    statsLogProfileItem[role]['TotalKills'] += sqlPlayerStats.kills;
                    statsLogProfileItem[role]['TotalDeaths'] += sqlPlayerStats.deaths;
                    statsLogProfileItem[role]['TotalAssists'] += sqlPlayerStats.assists;
                    statsLogProfileItem[role]['TotalCreepScore'] += sqlPlayerStats.creepScore;
                    statsLogProfileItem[role]['TotalDamage'] += sqlPlayerStats.damageDealt;
                    statsLogProfileItem[role]['TotalGold'] += sqlPlayerStats.gold;
                    statsLogProfileItem[role]['TotalVisionScore'] += sqlPlayerStats.visionScore;
                    statsLogProfileItem[role]['TotalCsAtEarly'] += sqlPlayerStats.csAtEarly;
                    statsLogProfileItem[role]['TotalGoldAtEarly'] += sqlPlayerStats.goldAtEarly;
                    statsLogProfileItem[role]['TotalXpAtEarly'] += sqlPlayerStats.xpAtEarly;
                    statsLogProfileItem[role]['TotalCsDiffEarly'] += sqlPlayerStats.csDiffEarly;
                    statsLogProfileItem[role]['TotalGoldDiffEarly'] += sqlPlayerStats.goldDiffEarly;
                    statsLogProfileItem[role]['TotalXpDiffEarly'] += sqlPlayerStats.xpDiffEarly;
                    statsLogProfileItem[role]['TotalFirstBloods'] += (sqlPlayerStats.firstBloodKill + sqlPlayerStats.firstBloodAssist);
                    statsLogProfileItem[role]['TotalTeamKills'] += sqlPlayerStats.teamKills;
                    statsLogProfileItem[role]['TotalTeamDeaths'] += sqlPlayerStats.teamDeaths;
                    statsLogProfileItem[role]['TotalTeamDamage'] += sqlPlayerStats.teamDamage;
                    statsLogProfileItem[role]['TotalTeamGold'] += sqlPlayerStats.teamGold;
                    statsLogProfileItem[role]['TotalTeamVisionScore'] += sqlPlayerStats.teamVS;
                    statsLogProfileItem[role]['TotalWardsPlaced'] += sqlPlayerStats.wardsPlaced;
                    statsLogProfileItem[role]['TotalControlWardsBought'] += sqlPlayerStats.controlWardsBought;
                    statsLogProfileItem[role]['TotalWardsCleared'] += sqlPlayerStats.wardsCleared;
                    statsLogProfileItem[role]['TotalSoloKills'] += sqlPlayerStats.soloKills;
                    statsLogProfileItem[role]['TotalDoubleKills'] += sqlPlayerStats.doubleKills;
                    statsLogProfileItem[role]['TotalTripleKills'] += sqlPlayerStats.tripleKills;
                    statsLogProfileItem[role]['TotalQuadraKills'] += sqlPlayerStats.quadraKills;
                    statsLogProfileItem[role]['TotalPentaKills'] += sqlPlayerStats.pentaKills;
                    /*  
                        ----------
                        'GameLog'
                        ----------
                    */
                    let profileGameItem = {
                        'DatePlayed': sqlPlayerStats.datePlayed,
                        'TournamentType': sqlPlayerStats.tournamentType,
                        'GameWeekNumber': 0, // N/A
                        'TeamHId': teamHashIds.encode(sqlPlayerStats.teamPId),
                        'ChampionPlayed': sqlPlayerStats.champId,
                        'Role': role,
                        'Win': (sqlPlayerStats.win == 1) ? true : false,
                        'Vacated': false,
                        'EnemyTeamHId': teamHashIds.encode((sqlPlayerStats.side === 'Blue') ? sqlPlayerStats.redTeamPId : sqlPlayerStats.blueTeamPId),
                        'GameDuration': sqlPlayerStats.duration,
                        'Kills': sqlPlayerStats.kills,
                        'Deaths': sqlPlayerStats.deaths,
                        'Assists': sqlPlayerStats.assists,
                        'DamageDealt': sqlPlayerStats.damageDealt,
                        'Gold': sqlPlayerStats.gold,
                        'VisionScore': sqlPlayerStats.visionScore,
                        'TeamKills': sqlPlayerStats.teamKills,
                        'TeamDamage': sqlPlayerStats.teamDamage,
                        'TeamGold': sqlPlayerStats.teamGold,
                        'TeamVS': sqlPlayerStats.teamVS,
                    };
                    gameLogProfileItem[matchPId] = profileGameItem;
                    matchLoaded = true;
                }
            }
            if (matchLoaded) {
                await dynamoDb.updateItem('Profile', 'ProfilePId', profilePId, 
                    'SET #slog.#tId = :data',
                    {
                        '#slog': 'StatsLog',
                        '#tId': tournamentPId
                    },
                    {
                        ':data': statsLogProfileItem
                    }
                );
                await dynamoDb.updateItem('Profile', 'ProfilePId', profilePId,
                    'SET #log.#sId.#mtch = :data',
                    {
                        '#log': 'GameLog',
                        '#sId': seasonPId,
                        '#mtch': 'Matches'
                    },
                    {
                        ':data': gameLogProfileItem
                    }
                );
            }
        }
    }
    catch (error) {
        throw error;
    }
}

async function updateTeamItemDynamoDb(tourneyDbObject) {
    let tournamentPId = tourneyDbObject['TournamentPId'];
    console.log("FUNCTION: updateTeamItemDynamoDb of tId '" + tournamentPId + "'");
    try {
        let seasonPId = tourneyDbObject['Information']['SeasonPId'];
        let teamIdsSqlList = await mySql.callSProc('teamPIdsByTournamentPId', tournamentPId);
        for (let teamIdx = 0; teamIdx < teamIdsSqlList.length; ++teamIdx) {
            let teamPId = teamIdsSqlList[teamIdx]['teamPId'];
            let teamDbObject = await dynamoDb.getItem('Team', 'TeamPId', teamPId); // Note this is the current state in code
            /*  
                -------------------
                Init DynamoDB Items
                -------------------
            */
            // #region Init Items
            // Check 'GameLog' exists in TeamItem
            // {MAIN}/team/<teamName>/games/<seasonShortName>
            const initTeamGameLog = { [seasonPId]: initTeamSeasonGames };
            if (!('GameLog' in teamDbObject)) {
                await dynamoDb.updateItem('Team', 'TeamPId', teamPId,
                    'SET #gLog = :val',
                    {
                        '#gLog': 'GameLog'
                    }, 
                    {
                        ':val': initTeamGameLog
                    }
                );
                teamDbObject['GameLog'] = clonedeep(initTeamGameLog);
            }
            else if (!(seasonPId in teamDbObject['GameLog'])) {
                await dynamoDb.updateItem('Team', 'TeamPId', teamPId,
                    'SET #gLog.#sId = :val',
                    {
                        '#gLog': 'GameLog',
                        '#sId': seasonPId,
                    },
                    {
                        ':val': initTeamSeasonGames
                    }
                );
                teamDbObject['GameLog'][seasonPId] = clonedeep(initTeamSeasonGames);
            }
            // Check 'Scouting' exists in TeamItem 
            // {MAIN}/team/<teamName>/scouting/<seasonShortName>
            const initTeamScouting = { [seasonPId]: initTeamSeasonScouting };
            if (!('Scouting' in teamDbObject)) {
                await dynamoDb.updateItem('Team', 'TeamPId', teamPId, 
                    'SET #sct = :val',
                    {
                        '#sct': 'Scouting'
                    },
                    {
                        ':val': initTeamScouting
                    }
                );
                teamDbObject['Scouting'] = clonedeep(initTeamScouting);
            }
            else if (!(seasonPId in teamDbObject['Scouting'])) {
                teamDbObject['Scouting'][seasonPId] = clonedeep(initTeamSeasonScouting);
            }
            // Check 'StatsLog' exists in TeamItem
            // {MAIN}/team/<teamName>/stats/<tournamentShortName>
            const initTeamStatsLog = { [tournamentPId]: initTeamTourneyStats };
            if (!('StatsLog' in teamDbObject)) {
                await dynamoDb.updateItem('Team', 'TeamPId', teamPId,
                    'SET #sLog = :val',
                    { 
                        '#sLog': 'StatsLog'
                    },
                    { 
                        ':val': initTeamStatsLog
                    }
                );
                teamDbObject['StatsLog'] = clonedeep(initTeamStatsLog);
            }
            // Check if that tournamentId in StatsLog
            else if (!(tournamentPId in teamDbObject['StatsLog'])) {
                teamDbObject['StatsLog'][tournamentPId] = clonedeep(initTeamTourneyStats);
            }
            //#endregion
            // Make shallow copies
            let tourneyTeamStatsItem = teamDbObject['StatsLog'][tournamentPId];
            let scoutingItem = teamDbObject['Scouting'][seasonPId];
            let gameLogTeamItem = teamDbObject['GameLog'][seasonPId]['Matches'];

            /*  
                -------------
                Compile Data
                -------------
            */
            // Loop through all the TeamStats in tournamentId
            let teamStatsSqlListTourney = await mySql.callSProc('teamStatsByTeamIdTournamentPId', teamPId, tournamentPId);
            let matchLoaded = false;
            for (let matchIdx = 0; matchIdx < teamStatsSqlListTourney.length; ++matchIdx) {
                let sqlTeamStats = teamStatsSqlListTourney[matchIdx];
                let matchPId = sqlTeamStats.riotMatchId;
                if (!(matchPId in gameLogTeamItem)) {
                    // Additional sProcs from MySQL
                    let playerStatsSqlList = await mySql.callSProc('playerStatsByMatchIdTeamId', sqlTeamStats.riotMatchId, teamPId);
                    let bannedChampSqlList = await mySql.callSProc('bannedChampsByMatchId', matchPId);
                    /*  
                        -------------
                        'StatsLog'
                        -------------
                    */
                    tourneyTeamStatsItem['GamesPlayed']++;
                    tourneyTeamStatsItem['GamesPlayedOverEarly'] += (sqlTeamStats.duration >= GLOBAL.MINUTE_AT_EARLY * 60);
                    tourneyTeamStatsItem['GamesPlayedOverMid'] += (sqlTeamStats.duration >= GLOBAL.MINUTE_AT_MID * 60);
                    tourneyTeamStatsItem['GamesWon'] += sqlTeamStats.win;
                    tourneyTeamStatsItem['GamesPlayedOnBlue'] += (sqlTeamStats.side === 'Blue');
                    tourneyTeamStatsItem['BlueWins'] += (sqlTeamStats.win && (sqlTeamStats.side === 'Blue'));
                    tourneyTeamStatsItem['TotalGameDuration'] += sqlTeamStats.duration;
                    tourneyTeamStatsItem['TotalXpDiffEarly'] += sqlTeamStats.xpDiffEarly;
                    tourneyTeamStatsItem['TotalXpDiffMid'] += sqlTeamStats.xpDiffMid;
                    tourneyTeamStatsItem['TotalGold'] += sqlTeamStats.totalGold;
                    tourneyTeamStatsItem['TotalGoldDiffEarly'] += sqlTeamStats.goldDiffEarly;
                    tourneyTeamStatsItem['TotalGoldDiffMid'] += sqlTeamStats.goldDiffMid;
                    tourneyTeamStatsItem['TotalCreepScore'] += sqlTeamStats.totalCreepScore;
                    tourneyTeamStatsItem['TotalCsDiffEarly'] += sqlTeamStats.csDiffEarly;
                    tourneyTeamStatsItem['TotalCsDiffMid'] += sqlTeamStats.csDiffMid;
                    tourneyTeamStatsItem['TotalDamageDealt'] += sqlTeamStats.totalDamageDealt;
                    tourneyTeamStatsItem['TotalFirstBloods'] += sqlTeamStats.firstBlood;
                    tourneyTeamStatsItem['TotalFirstTowers'] += sqlTeamStats.firstTower;
                    tourneyTeamStatsItem['TotalKills'] += sqlTeamStats.totalKills;
                    tourneyTeamStatsItem['TotalDeaths'] += sqlTeamStats.totalDeaths;
                    tourneyTeamStatsItem['TotalAssists'] += sqlTeamStats.totalAssists;
                    tourneyTeamStatsItem['TotalTowersTaken'] += sqlTeamStats.totalTowers;
                    tourneyTeamStatsItem['TotalTowersLost'] += sqlTeamStats.oppTowers;
                    tourneyTeamStatsItem['TotalDragonsTaken'] += sqlTeamStats.totalDragons;
                    tourneyTeamStatsItem['TotalEnemyDragons'] += sqlTeamStats.oppDragons;
                    tourneyTeamStatsItem['TotalHeraldsTaken'] += sqlTeamStats.totalHeralds;
                    tourneyTeamStatsItem['TotalEnemyHeralds'] += sqlTeamStats.oppHeralds;
                    tourneyTeamStatsItem['TotalBaronsTaken'] += sqlTeamStats.totalBarons;
                    tourneyTeamStatsItem['TotalEnemyBarons'] += sqlTeamStats.oppBarons;
                    tourneyTeamStatsItem['TotalVisionScore'] += sqlTeamStats.totalVisionScore;
                    tourneyTeamStatsItem['TotalWardsPlaced'] += sqlTeamStats.totalWardsPlaced;
                    tourneyTeamStatsItem['TotalControlWardsBought'] += sqlTeamStats.totalControlWardsBought;
                    tourneyTeamStatsItem['TotalWardsCleared'] += sqlTeamStats.totalWardsCleared;
                    tourneyTeamStatsItem['TotalEnemyWardsPlaced'] += sqlTeamStats.oppWardsPlaced;
                    /*  
                        -------------
                        'Scouting'
                        -------------
                    */
                    scoutingItem['GamesPlayed']++;
                    scoutingItem['GamesWin'] += sqlTeamStats.win;
                    for (let champIdx = 0; champIdx < bannedChampSqlList.length; ++champIdx) {
                        let champSqlRow = bannedChampSqlList[champIdx];
                        if (champSqlRow.teamBannedById == teamPId) { 
                            if (!(champSqlRow.champId in scoutingItem['BannedByTeam'])) {
                                scoutingItem['BannedByTeam'][champSqlRow.champId] = 0;
                            }
                            scoutingItem['BannedByTeam'][champSqlRow.champId]++;
                        }
                        else {
                            if (!(champSqlRow.champId in scoutingItem['BannedAgainstTeam'])) {
                                scoutingItem['BannedAgainstTeam'][champSqlRow.champId] = 0;
                            }
                            scoutingItem['BannedAgainstTeam'][champSqlRow.champId]++;
                        }
                    }
                    let playerLog = scoutingItem['PlayerLog'];
                    for (let playerIdx = 0; playerIdx < playerStatsSqlList.length; ++playerIdx) {
                        let playerSqlRow = playerStatsSqlList[playerIdx];
                        let role = playerSqlRow.role;
                        if (!(role in playerLog)) {
                            playerLog[role] = {};
                        }
                        let profileHId = profileHashIds.encode(playerSqlRow.profilePId);
                        if (!(profileHId in playerLog[role])) {
                            // New entry
                            playerLog[role][profileHId] = {
                                'GamesPlayed': 0,
                                'TotalKillsPlayer': 0,
                                'TotalDeathsPlayer': 0,
                                'TotalAssistsPlayer': 0,
                                'TotalDamagePlayer': 0,
                                'TotalGoldPlayer': 0,
                                'TotalVsPlayer': 0,
                                'TotalKillsTeam': 0,
                                'TotalDamageTeam': 0,
                                'TotalGoldTeam': 0,
                                'TotalVsTeam': 0,
                                'ChampsPlayed': {}
                            };
                        }
                        let thisPlayer = playerLog[role][profileHId]; // Shallow copy
                        thisPlayer['GamesPlayed']++;
                        thisPlayer['TotalKillsPlayer'] += playerSqlRow.kills;
                        thisPlayer['TotalDeathsPlayer'] += playerSqlRow.deaths;
                        thisPlayer['TotalAssistsPlayer'] += playerSqlRow.assists;
                        thisPlayer['TotalDamagePlayer'] += playerSqlRow.damageDealt;
                        thisPlayer['TotalGoldPlayer'] += playerSqlRow.gold;
                        thisPlayer['TotalVsPlayer'] += playerSqlRow.visionScore;
                        thisPlayer['TotalKillsTeam'] += sqlTeamStats.totalKills;
                        thisPlayer['TotalDamageTeam'] += sqlTeamStats.totalDamageDealt;
                        thisPlayer['TotalGoldTeam'] += sqlTeamStats.totalGold;
                        thisPlayer['TotalVsTeam'] += sqlTeamStats.totalVisionScore;
                        if (!(playerSqlRow.champId in thisPlayer['ChampsPlayed'])) {
                            thisPlayer['ChampsPlayed'][playerSqlRow.champId] = {};
                            thisPlayer['ChampsPlayed'][playerSqlRow.champId]['GamesPlayed'] = 0;
                            thisPlayer['ChampsPlayed'][playerSqlRow.champId]['GamesWon'] = 0;
                        }
                        thisPlayer['ChampsPlayed'][playerSqlRow.champId]['GamesPlayed']++;
                        thisPlayer['ChampsPlayed'][playerSqlRow.champId]['GamesWon'] += playerSqlRow.win;
                    }
                    /*  
                        -------------
                        'GameLog'
                        -------------
                    */
                    let teamGameItem = {
                        'DatePlayed': sqlTeamStats.datePlayed,
                        'TournamentType': sqlTeamStats.tournamentType,
                        'GameWeekNumber': 0, // N/A
                        'ChampPicks': {},
                        'Win': (sqlTeamStats.win == 1) ? true : false,
                        'Vacated': false,
                        'EnemyTeamHId': teamHashIds.encode((sqlTeamStats.side === 'Blue') ? sqlTeamStats.redTeamPId : sqlTeamStats.blueTeamPId),
                        'GameDuration': sqlTeamStats.duration,
                        'Kills': sqlTeamStats.totalKills,
                        'Deaths': sqlTeamStats.totalDeaths,
                        'Assists': sqlTeamStats.totalAssists,
                        'GoldPerMinute': sqlTeamStats.goldPerMin,
                        'GoldDiffEarly': sqlTeamStats.goldDiffEarly,
                        'GoldDiffMid': sqlTeamStats.goldDiffMid,
                        'BannedByTeam': [],
                        'BannedAgainst': []
                    };
                    for (let playerIdx = 0; playerIdx < playerStatsSqlList.length; ++playerIdx) {
                        let playerSqlRow = playerStatsSqlList[playerIdx];
                        teamGameItem['ChampPicks'][playerSqlRow.role] = { 
                            'ProfileHId': profileHashIds.encode(playerSqlRow.profilePId),
                            'ChampId': playerSqlRow.champId
                        };
                    }
                    for (let phase = 1; phase <= 2; ++phase) {
                        for (let k = 0; k < bannedChampSqlList.length; ++k) {
                            let champSqlRow = bannedChampSqlList[k];
                            if (champSqlRow.phase == phase) {
                                if (champSqlRow.teamBannedById == teamPId) { teamGameItem['BannedByTeam'].push(champSqlRow.champId); }
                                else { teamGameItem['BannedAgainst'].push(champSqlRow.champId); }
                            }
                        }
                    }
                    gameLogTeamItem[matchPId] = teamGameItem;
                    matchLoaded = true;
                }
            }
            if (matchLoaded) {
                await dynamoDb.updateItem('Team', 'TeamPId', teamPId, 
                    'SET #sct.#sId = :val',
                    {
                        '#sct': 'Scouting',
                        '#sId': seasonPId
                    },
                    {
                        ':val': scoutingItem
                    }
                );
                await dynamoDb.updateItem('Team', 'TeamPId', teamPId,
                    'SET #key1.#sId.#key2 = :val',
                    {
                        '#key1': 'GameLog',
                        '#sId': seasonPId,
                        '#key2': 'Matches'
                    },
                    {
                        ':val': gameLogTeamItem
                    }
                );
                dynamoDb.updateItem('Team', 'TeamPId', teamPId,
                    'SET #sLog.#tId = :val',
                    {
                        '#sLog': 'StatsLog',
                        '#tId': tournamentPId
                    },
                    {
                        ':val': tourneyTeamStatsItem
                    }
                );
            }
        }
    }
    catch (error) {
        throw error;
    }
}

async function updateTournamentItemDynamoDb(tourneyDbObject) {
    let tournamentPId = tourneyDbObject['TournamentPId'];
    console.log("FUNCTION: updateTournamentItemDynamoDb of tId '" + tournamentPId + "'");
    try {
        /*  
            -------------------
            Init DynamoDB Items
            -------------------
        */
        // #region Init Items
        // Check 'TourneyStats' exists in tourneyDbObject
        // {MAIN}/tournaments/<tournamentShortName>
        if (!('TourneyStats' in tourneyDbObject)) {
            tourneyDbObject['TourneyStats'] = clonedeep(initTourneyStats);
        }
        // Check 'PickBans' in tourneyDbObject
        // {MAIN}/tournament/<tournamentShortName>/pickbans
        if (!('PickBans' in tourneyDbObject)) {
            tourneyDbObject['PickBans'] = {};
        }
        // Check 'ProfileHIdList' in tourneyDbObject
        // {MAIN}/tournament/<tournamentShortName>/players
        if (!('ProfileHIdList' in tourneyDbObject)) {
            tourneyDbObject['ProfileHIdList'] = [];
        }
        // Check 'TeamHIdList' in tourneyDbObject
        // {MAIN}/tournament/<tournamentShortName>/teams
        if (!('TeamHIdList' in tourneyDbObject)) {
            tourneyDbObject['TeamHIdList'] = [];
        }
        // Check 'GameLog' in tourneyDbObject
        // {MAIN}/tournament/<tournamentShortName>/games
        if (!('GameLog' in tourneyDbObject)) {
            tourneyDbObject['GameLog'] = {};
        }
        // Check 'Leaderboards' exists in tourneyDbObject
        // {MAIN}/tournaments/<tournamentShortName>
        if (!('Leaderboards' in tourneyDbObject)) {
            tourneyDbObject['Leaderboards'] = {};
        }
        //#endregion
        // Make shallow copies
        let tourneyStatsItem = tourneyDbObject['TourneyStats'];             // Add onto
        let pickBansItem = tourneyDbObject['PickBans'];                     // Add onto
        let profileHIdSet = new Set(tourneyDbObject['ProfileHIdList']);     // Add onto
        let teamHIdSet = new Set(tourneyDbObject['TeamHIdList']);           // Add onto
        let gameLogTourneyItem = tourneyDbObject['GameLog'];                // Add onto
        let leaderboardsItem = tourneyDbObject['Leaderboards'];
        /*  
            -------------
            Compile Data
            -------------
        */
        let matchStatsSqlList = await mySql.callSProc('matchStatsByTournamentId', tournamentPId);
        let matchLoaded = false;
        for (let matchIdx = 0; matchIdx < matchStatsSqlList.length; ++matchIdx) {
            let matchStatsSqlRow = matchStatsSqlList[matchIdx];
            let matchPId = matchStatsSqlRow.riotMatchId;
            if (!(matchPId in gameLogTourneyItem)) {
                /*  
                    --------------
                    'TourneyStats'
                    --------------
                */
                tourneyStatsItem['NumberGames']++;
                tourneyStatsItem['BlueSideWins'] += matchStatsSqlRow.blueWin;
                tourneyStatsItem['TotalGameDuration'] += matchStatsSqlRow.duration;
                tourneyStatsItem['CloudDrakes'] += matchStatsSqlRow.cloudDragons;
                tourneyStatsItem['OceanDrakes'] += matchStatsSqlRow.oceanDragons;
                tourneyStatsItem['InfernalDrakes'] += matchStatsSqlRow.infernalDragons;
                tourneyStatsItem['MountainDrakes'] += matchStatsSqlRow.mountainDragons;
                tourneyStatsItem['ElderDrakes'] += matchStatsSqlRow.elderDragons;

                let matchObject = await dynamoDb.getItem('Matches', 'MatchPId', matchPId.toString());
                for (let teamIdx = 0; teamIdx < Object.keys(matchObject['Teams']).length; ++teamIdx) {
                    let teamId = Object.keys(matchObject['Teams'])[teamIdx];
                    let teamObject = matchObject['Teams'][teamId];    
                    /*
                        --------------
                        'PickBans'
                        --------------
                    */
                    // Bans
                    let phase1BanArray = teamObject['Phase1Bans'];
                    addBansToTourneyItem(pickBansItem, phase1BanArray, teamId, 1);
                    let phase2BanArray = teamObject['Phase2Bans'];
                    addBansToTourneyItem(pickBansItem, phase2BanArray, teamId, 2);
                    // Picks
                    addWinPicksToTourneyItem(pickBansItem, teamObject, teamId);
                    /*
                        --------------
                        'ProfileHIdList' / 'TeamHIdList'
                        --------------
                    */
                    for (let playerIdx = 0; playerIdx < Object.values(teamObject['Players']).length; ++playerIdx) {
                        let playerObject = Object.values(teamObject['Players'])[playerIdx];
                        profileHIdSet.add(playerObject['ProfileHId']);
                    }
                    teamHIdSet.add(teamObject['TeamHId']);
                }
                /*
                    --------------
                    'GameLog'
                    --------------
                */
                gameLogTourneyItem[matchPId] = {
                    'DatePlayed': matchObject.DatePlayed,
                    'BlueTeamHId': matchObject['Teams'][GLOBAL.BLUE_ID]['TeamHId'],
                    'RedTeamHId': matchObject['Teams'][GLOBAL.RED_ID]['TeamHId'],
                    'Duration': matchObject.GameDuration,
                    'BlueWin': Boolean(matchObject['Teams'][GLOBAL.BLUE_ID]['Win']),
                };
                matchLoaded = true;
            }
        }
        if (matchLoaded) {
            await dynamoDb.updateItem('Tournament', 'TournamentPId', tournamentPId,
                'SET #key = :val',
                {
                    '#key': 'TourneyStats'
                },
                {
                    ':val': tourneyStatsItem
                }
            );
            await dynamoDb.updateItem('Tournament', 'TournamentPId', tournamentPId,
                'SET #key = :val',
                {
                    '#key': 'PickBans'
                },
                {
                    ':val': pickBansItem
                }
            );
            await dynamoDb.updateItem('Tournament', 'TournamentPId', tournamentPId,
                'SET #key = :val',
                {
                    '#key': 'ProfileHIdList'
                },
                {
                    ':val': Array.from(profileHIdSet)
                }
            );
            await dynamoDb.updateItem('Tournament', 'TournamentPId', tournamentPId,
                'SET #key = :val',
                {
                    '#key': 'TeamHIdList'
                },
                {
                    ':val': Array.from(teamHIdSet)
                }
            );
            await dynamoDb.updateItem('Tournament', 'TournamentPId', tournamentPId,
                'SET #key = :val',
                {
                    '#key': 'GameLog'
                },
                {
                    ':val': gameLogTourneyItem
                }
            );
            /*  
                -----------------
                'Leaderboards'
                -----------------
            */
            leaderboardsItem['GameRecords'] = {};
            let gameRecords = leaderboardsItem['GameRecords'];
            //#region GameRecords
            // Shortest Game
            let shortestGameSqlRow = matchStatsSqlList[0];
            gameRecords['ShortestGame'] = buildDefaultLeaderboardItem(shortestGameSqlRow);
            // Longest Game
            let longestGameSqlRow = matchStatsSqlList[matchStatsSqlList.length - 1];
            gameRecords['LongestGame'] = buildDefaultLeaderboardItem(longestGameSqlRow);
            // Most Kills
            let mostKillsGameSqlRow = (await mySql.callSProc('mostKillsGameByTournamentId', tournamentPId))[0];
            gameRecords['MostKillGame'] = buildDefaultLeaderboardItem(mostKillsGameSqlRow);
            gameRecords['MostKillGame']['Kills'] = mostKillsGameSqlRow.totalKills;
            //#endregion
            leaderboardsItem['PlayerSingleRecords'] = {};
            let playerRecords = leaderboardsItem['PlayerSingleRecords'];
            //#region PlayerSingleRecords
            // Players Most Damage
            let playerMostDamageList = [];
            let mostDamageListSql = await mySql.callSProc('playerMostDamageByTournamentId', tournamentPId);
            for (let j = 0; j < GLOBAL.LEADERBOARD_NUM; ++j) {
                let mostDamageRowSql = mostDamageListSql[j];
                let playerMostDamageItem = buildDefaultLeaderboardItem(mostDamageRowSql);
                playerMostDamageItem['ProfileHId'] = profileHashIds.encode(mostDamageRowSql.profilePId);
                playerMostDamageItem['ChampId'] = mostDamageRowSql.champId;
                playerMostDamageItem['Role'] = mostDamageRowSql.role;
                playerMostDamageItem['DamagePerMin'] = mostDamageRowSql.dmgDealtPerMin;
                playerMostDamageItem['DamageDealt'] = mostDamageRowSql.damageDealt;
                playerMostDamageList.push(playerMostDamageItem);
            }
            playerRecords['PlayerMostDamage'] = playerMostDamageList;
            // Player Most Farm
            let playerMostFarmList = [];
            let mostFarmListSql = await mySql.callSProc('playerMostFarmByTournamentId', tournamentPId);
            for (let j = 0; j < GLOBAL.LEADERBOARD_NUM; ++j) {
                let mostFarmRowSql = mostFarmListSql[j];
                let playerMostFarmItem = buildDefaultLeaderboardItem(mostFarmRowSql);
                playerMostFarmItem['ProfileHId'] = profileHashIds.encode(mostFarmRowSql.profilePId);
                playerMostFarmItem['ChampId'] = mostFarmRowSql.champId;
                playerMostFarmItem['Role'] = mostFarmRowSql.role;
                playerMostFarmItem['CsPerMin'] = mostFarmRowSql.csPerMin;
                playerMostFarmItem['CreepScore'] = mostFarmRowSql.creepScore;
                playerMostFarmList.push(playerMostFarmItem);
            }
            playerRecords['PlayerMostFarm'] = playerMostFarmList;
            // Player Most GD@Early
            let playerMostGDiffEarlyList = [];
            let mostGDiffEarlyList = await mySql.callSProc('playerMostGDEarlyByTournamentId', tournamentPId);
            for (let j = 0; j < GLOBAL.LEADERBOARD_NUM; ++j) {
                let mostGDiffEarlyRowSql = mostGDiffEarlyList[j];
                let playerMostGDiffEarlyItem = buildDefaultLeaderboardItem(mostGDiffEarlyRowSql);
                playerMostGDiffEarlyItem['ProfileHId'] = profileHashIds.encode(mostGDiffEarlyRowSql.profilePId);
                playerMostGDiffEarlyItem['ChampId'] = mostGDiffEarlyRowSql.champId;
                playerMostGDiffEarlyItem['Role'] = mostGDiffEarlyRowSql.role;
                playerMostGDiffEarlyItem['GDiffEarly'] = mostGDiffEarlyRowSql.goldDiffEarly;
                playerMostGDiffEarlyItem['GAtEarly'] = mostGDiffEarlyRowSql.goldAtEarly;
                playerMostGDiffEarlyList.push(playerMostGDiffEarlyItem);
            }
            playerRecords['PlayerMostGoldDiffEarly'] = playerMostGDiffEarlyList;
            // Player Most XPD@Early
            let playerMostXpDiffEarlyList = [];
            let mostXpDiffListSql = await mySql.callSProc('playerMostXPDEarlyByTournamentId', tournamentPId);
            for (let j = 0; j < GLOBAL.LEADERBOARD_NUM; ++j) {
                let mostXpDiffEarlyRowSql = mostXpDiffListSql[j];
                let playerMostXpDiffEarlyItem = buildDefaultLeaderboardItem(mostXpDiffEarlyRowSql);
                playerMostXpDiffEarlyItem['ProfileHId'] = profileHashIds.encode(mostXpDiffEarlyRowSql.profilePId);
                playerMostXpDiffEarlyItem['ChampId'] = mostXpDiffEarlyRowSql.champId;
                playerMostXpDiffEarlyItem['Role'] = mostXpDiffEarlyRowSql.role;
                playerMostXpDiffEarlyItem['XpDiffEarly'] = mostXpDiffEarlyRowSql.xpDiffEarly;
                playerMostXpDiffEarlyItem['XpAtEarly'] = mostXpDiffEarlyRowSql.xpAtEarly;
                playerMostXpDiffEarlyList.push(playerMostXpDiffEarlyItem);
            }
            playerRecords['PlayerMostXpDiffEarly'] = playerMostXpDiffEarlyList;
            // Player Most Vision
            let playerMostVisionList = [];
            let mostVisionListSql = await mySql.callSProc('playerMostVisionByTournamentId', tournamentPId);
            for (let j = 0; j < GLOBAL.LEADERBOARD_NUM; ++j) {
                let mostVisionRowSql = mostVisionListSql[j];
                let playerMostVisionItem = buildDefaultLeaderboardItem(mostVisionRowSql);
                playerMostVisionItem['ProfileHId'] = profileHashIds.encode(mostVisionRowSql.profilePId);
                playerMostVisionItem['ChampId'] = mostVisionRowSql.champId;
                playerMostVisionItem['Role'] = mostVisionRowSql.role;
                playerMostVisionItem['VsPerMin'] = mostVisionRowSql.vsPerMin;
                playerMostVisionItem['VisionScore'] = mostVisionRowSql.visionScore;
                playerMostVisionList.push(playerMostVisionItem);
            }
            playerRecords['PlayerMostVision'] = playerMostVisionList;
            //#endregion
            leaderboardsItem['TeamRecords'] = {};
            let teamRecords = leaderboardsItem['TeamSingleRecords'];
            //#region TeamSingleRecords
            // Team Top Baron Power Plays
            let teamTopBaronPPList = [];
            let topBaronPPListSql = await mySql.callSProc('teamTopBaronPPByTournamentId', tournamentPId);
            for (let j = 0; j < GLOBAL.LEADERBOARD_NUM; ++j) {
                let topBaronPPRowSql = topBaronPPListSql[j];
                let teamBaronPPItem = buildDefaultLeaderboardItem(topBaronPPRowSql);
                teamBaronPPItem['TeamHId'] = teamHashIds.encode(topBaronPPRowSql.teamPId);
                teamBaronPPItem['Timestamp'] = topBaronPPRowSql.timestamp;
                teamBaronPPItem['BaronPowerPlay'] = topBaronPPRowSql.baronPowerPlay;
                teamTopBaronPPList.push(teamBaronPPItem);
            }
            teamRecords['TeamTopBaronPowerPlay'] = teamTopBaronPPList;
            // Team Earliest Towers
            let teamEarliestTowerList = [];
            let earliestTowerListSql = await mySql.callSProc('teamEarliestTowerByTournamentId', tournamentPId);
            for (let j = 0; j < GLOBAL.LEADERBOARD_NUM; ++j) {
                let earliestTowerRowSql = earliestTowerListSql[j];
                let teamEarliestTowerItem = buildDefaultLeaderboardItem(earliestTowerRowSql);
                teamEarliestTowerItem['TeamHId'] = teamHashIds.encode(earliestTowerRowSql.teamPId);
                teamEarliestTowerItem['Timestamp'] = earliestTowerRowSql.timestamp;
                teamEarliestTowerItem['Lane'] = earliestTowerRowSql.lane;
                teamEarliestTowerItem['TowerType'] = earliestTowerRowSql.towerType;
                teamEarliestTowerList.push(teamEarliestTowerItem);
            }
            teamRecords['TeamEarliestTower'] = teamEarliestTowerList;
            //#endregion
            // Update DynamoDB
            await dynamoDb.updateItem('Tournament', 'TournamentPId', tournamentPId,
                'SET #key = :val',
                {
                    '#key': 'Leaderboards'
                },
                {
                    ':val': leaderboardsItem
                }
            );
        }
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
//#region Helper
function addBansToTourneyItem(pickBansItem, banArray, teamId, phaseNum) {
    let banPhaseString = 'Phase' + phaseNum + 'Bans';
    for (let k = 0; k < banArray.length; ++k) {
        let champBanned = banArray[k];
        if (!(champBanned in pickBansItem)) {
            pickBansItem[champBanned] = clonedeep(initTourneyPickBans);
        }
        pickBansItem[champBanned][banPhaseString]++;
        if (teamId == GLOBAL.BLUE_ID) {
            pickBansItem[champBanned]['Blue'+banPhaseString]++;
        }
        else if (teamId == GLOBAL.RED_ID) {
            pickBansItem[champBanned]['Red'+banPhaseString]++;
        }
    }
}

function addWinPicksToTourneyItem(pickBansItem, teamObject, teamId) {
    let playersObject = teamObject['Players'];
    for (let k = 0; k < Object.values(playersObject).length; ++k) {
        let playerObject = Object.values(playersObject)[k];
        let champPicked = playerObject['ChampId'];
        if (!(champPicked in pickBansItem)) {
            pickBansItem[champPicked] = clonedeep(initTourneyPickBans);
        }
        if (teamId == GLOBAL.BLUE_ID) {
            pickBansItem[champPicked]['BluePicks']++;
        }
        else if (teamId == GLOBAL.RED_ID) {
            pickBansItem[champPicked]['RedPicks']++;
        }
        pickBansItem[champPicked]['NumWins'] += teamObject['Win'];
    }
}

function buildDefaultLeaderboardItem(matchSqlRow) {
    return {
        'GameDuration': matchSqlRow.duration,
        'MatchPId': matchSqlRow.riotMatchId,
        'BlueTeamHId': teamHashIds.encode(matchSqlRow.blueTeamPId),
        'RedTeamHId': teamHashIds.encode(matchSqlRow.redTeamPId)
    };
}

//#endregion