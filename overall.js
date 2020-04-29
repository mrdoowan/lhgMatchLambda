/* 
    AWS LAMBDA FUNCTION 2: Insert a tournamentId and update overall stats for Profile, Team, and Tournament
    This function affects the following:
    - DynamoDB: Tournament, Team, Profile table
*/

/*  Declaring npm modules */
const Hashids = require('hashids/cjs'); // For hashing and unhashing

/*  Import helper function modules */
const GLOBAL = require('./globals');
const dynamoDb = require('./dynamoDbHelper');
const mySql = require('./mySqlHelper');

/* 
    Import from other files that are not committed to Github
    Contact doowan about getting a copy of these files
*/
const inputObjects = require('./external/tournamentTest');
const envVars = require('./external/env');

/*  Configurations of npm modules */
const profileHashIds = new Hashids(envVars.PROFILE_HID_SALT, envVars.HID_LENGTH); // process.env.PROFILE_HID_SALT
const teamHashIds = new Hashids(envVars.TEAM_HID_SALT, envVars.HID_LENGTH); // process.env.TEAM_HID_SALT

/*  Main AWS Lambda Function. We'll come back to this later */
exports.handler = async (event, context) => {
    
};

async function main() {
    try {
        var tournamentId = inputObjects[0];
        var tourneyDbObject = await dynamoDb.getItem('Tournament', 'TournamentPId', tournamentId);
        if (!(tourneyDbObject == undefined || tourneyDbObject == null)) {
            //await updateProfileItemDynamoDb(tourneyDbObject);
            //await updateTeamItemDynamoDb(tourneyDbObject);
            await updateTournamentItemDynamoDb(tourneyDbObject);
        }
        else {
            console.error("TournamentPId '" + tournamentId + "' doesn't exist in DynamoDB!");
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
    'MultiOpgg': '',
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
const initTourneyInformation = {
    'SeasonPId': 0,
    'NumberGames': 0,
    'BlueSideWins': 0,
    'TotalDragonsKilled': 0,
    'CloudDrakes': 0,
    'OceanDrakes': 0,
    'InfernalDrakes': 0,
    'MountainDrakes': 0,
    'ElderDrakes': 0,
};
const initTourneyPickBans = {
    'BluePicks': 0,
    'RedPicks': 0,
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
    try {
        var tourneyInfoObject = tourneyDbObject['Information'];
        var tournamentPId = tourneyDbObject['TournamentPId'];
        var profileIdsSqlList = await mySql.callSProc('profilePIdsByTournamentPId', tournamentPId);
        var seasonPId = tourneyInfoObject['SeasonPId'];
        var seasonInfoObject = await dynamoDb.getItem('Season', 'SeasonPId', seasonPId)['Information'];
        //for (var i = 0; i < profileIdsSqlList.length; ++i) {
        for (var i = 0; i < 1; ++i) {
            //var profilePId = profileIdsSqlList[i]['profilePId'];
            var profilePId = '93339240';
            var profileDbObject = await dynamoDb.getItem('Profile', 'ProfilePId', profilePId); // Note this is the current state in code
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
                profileDbObject['GameLog'] = Object.assign({}, initProfileGameLog);
            }
            // Check if that season exists in the GameLogs
            else if (!(seasonPId in profileDbObject['GameLog'])) {
                profileDbObject['GameLog'][seasonPId] = Object.assign({}, initProfileSeasonGames);
            }
            // Check if 'StatsLog' exists in Profile
            // {MAIN}/profile/<profileName>/stats/<seasonShortName>
            const initStatsLog = { [tournamentPId]: {} };
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
                profileDbObject['StatsLog'] = Object.assign({}, initStatsLog);
            }
            // Check if that TournamentPId in StatsLog
            else if (!(tournamentPId in profileDbObject['StatsLog'])) {
                profileDbObject['StatsLog'][tournamentPId] = {};
            }
            // Check if 'ChampsPlayed' exists in Profile
            if (!('ChampsPlayed' in profileDbObject)) {
                profileDbObject['ChampsPlayed'] = {};
            }
            //#endregion
            // Make shallow copies
            var champsPlayedItem = profileDbObject['ChampsPlayed'];
            var tourneyProfileStatsItem = profileDbObject['StatsLog'][tournamentPId];
            var gameLogProfileItem = profileDbObject['GameLog'][seasonPId]['Matches'];
            
            /*  
                -------------
                Compile Data
                -------------
            */
            // Load each Stat into Profile in tournamentId
            var matchDataList = await mySql.callSProc('playerStatsByTournamentPId', profilePId, tournamentPId);
            for (var j = 0; j < matchDataList.length; ++j) {
                var sqlPlayerStats = matchDataList[j];
                var matchPId = sqlPlayerStats.riotMatchId;
                if (!(matchPId in gameLogProfileItem)) {
                    /*  
                        ----------------
                        'ChampsPlayed'
                        ----------------
                    */
                    if (!(sqlPlayerStats.champId in champsPlayedItem)) {
                        champsPlayedItem[sqlPlayerStats.champId] = {};
                        champsPlayedItem[sqlPlayerStats.champId]['GamesPlayed'] = 0;
                        champsPlayedItem[sqlPlayerStats.champId]['GamesWon'] = 0;
                    }
                    champsPlayedItem[sqlPlayerStats.champId]['GamesPlayed']++;
                    champsPlayedItem[sqlPlayerStats.champId]['GamesWon'] += sqlPlayerStats.win;
                    /*  
                        ----------
                        'StatsLog'
                        ----------
                    */
                    // Check if the Role they played exists
                    var role = sqlPlayerStats.role;
                    if (!(role in tourneyProfileStatsItem)) {
                        tourneyProfileStatsItem[role] = Object.assign({}, initProfileTourneyStats);
                    }
                    tourneyProfileStatsItem[role]['GamesPlayed']++;
                    tourneyProfileStatsItem[role]['GamesPlayedOverEarly'] += (sqlPlayerStats.duration >= GLOBAL.MINUTE_AT_EARLY * 60);
                    tourneyProfileStatsItem[role]['GamesPlayedOverMid'] += (sqlPlayerStats.duration >= GLOBAL.MINUTE_AT_MID * 60);
                    tourneyProfileStatsItem[role]['TotalGameDuration'] += sqlPlayerStats.duration;
                    tourneyProfileStatsItem[role]['GamesWin'] += sqlPlayerStats.win;
                    tourneyProfileStatsItem[role]['TotalKills'] += sqlPlayerStats.kills;
                    tourneyProfileStatsItem[role]['TotalDeaths'] += sqlPlayerStats.deaths;
                    tourneyProfileStatsItem[role]['TotalAssists'] += sqlPlayerStats.assists;
                    tourneyProfileStatsItem[role]['TotalCreepScore'] += sqlPlayerStats.creepScore;
                    tourneyProfileStatsItem[role]['TotalDamage'] += sqlPlayerStats.damageDealt;
                    tourneyProfileStatsItem[role]['TotalGold'] += sqlPlayerStats.gold;
                    tourneyProfileStatsItem[role]['TotalVisionScore'] += sqlPlayerStats.visionScore;
                    tourneyProfileStatsItem[role]['TotalCsAtEarly'] += sqlPlayerStats.csAtEarly;
                    tourneyProfileStatsItem[role]['TotalGoldAtEarly'] += sqlPlayerStats.goldAtEarly;
                    tourneyProfileStatsItem[role]['TotalXpAtEarly'] += sqlPlayerStats.xpAtEarly;
                    tourneyProfileStatsItem[role]['TotalCsDiffEarly'] += sqlPlayerStats.csDiffEarly;
                    tourneyProfileStatsItem[role]['TotalGoldDiffEarly'] += sqlPlayerStats.goldDiffEarly;
                    tourneyProfileStatsItem[role]['TotalXpDiffEarly'] += sqlPlayerStats.xpDiffEarly;
                    tourneyProfileStatsItem[role]['TotalFirstBloods'] += (sqlPlayerStats.firstBloodKill + sqlPlayerStats.firstBloodAssist);
                    tourneyProfileStatsItem[role]['TotalTeamKills'] += sqlPlayerStats.teamKills;
                    tourneyProfileStatsItem[role]['TotalTeamDeaths'] += sqlPlayerStats.teamDeaths;
                    tourneyProfileStatsItem[role]['TotalTeamDamage'] += sqlPlayerStats.teamDamage;
                    tourneyProfileStatsItem[role]['TotalTeamGold'] += sqlPlayerStats.teamGold;
                    tourneyProfileStatsItem[role]['TotalTeamVisionScore'] += sqlPlayerStats.teamVS;
                    tourneyProfileStatsItem[role]['TotalWardsPlaced'] += sqlPlayerStats.wardsPlaced;
                    tourneyProfileStatsItem[role]['TotalControlWardsBought'] += sqlPlayerStats.controlWardsBought;
                    tourneyProfileStatsItem[role]['TotalWardsCleared'] += sqlPlayerStats.wardsCleared;
                    tourneyProfileStatsItem[role]['TotalSoloKills'] += sqlPlayerStats.soloKills;
                    tourneyProfileStatsItem[role]['TotalDoubleKills'] += sqlPlayerStats.doubleKills;
                    tourneyProfileStatsItem[role]['TotalTripleKills'] += sqlPlayerStats.tripleKills;
                    tourneyProfileStatsItem[role]['TotalQuadraKills'] += sqlPlayerStats.quadraKills;
                    tourneyProfileStatsItem[role]['TotalPentaKills'] += sqlPlayerStats.pentaKills;
                    /*  
                        ----------
                        'GameLog'
                        ----------
                    */
                    var profileGameItem = {
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
                    //gameLogProfileItem[matchPId] = profileGameItem; // Do we need to do this? It's all static
                    await dynamoDb.updateItem('Profile', 'ProfilePId', profilePId,
                        'SET #log.#sId.#mtch.#mId = :data',
                        {
                            '#log': 'GameLog',
                            '#sId': seasonPId,
                            '#mtch': 'Matches',
                            '#mId': sqlPlayerStats.riotMatchId
                        },
                        {
                            ':data': profileGameItem
                        }
                    );
                }
            }
            await dynamoDb.updateItem('Profile', 'ProfilePId', profilePId,
                'SET #cPlayed = :val',
                { 
                    '#cPlayed': 'ChampsPlayed'
                },
                { 
                    ':val': champsPlayedItem
                }
            );
            await dynamoDb.updateItem('Profile', 'ProfilePId', profilePId, 
                'SET #slog.#tId = :data',
                {
                    '#slog': 'StatsLog',
                    '#tId': tournamentPId
                },
                {
                    ':data': tourneyProfileStatsItem
                }
            );
        }
    }
    catch (error) {
        throw error;
    }
}

async function updateTeamItemDynamoDb(tourneyDbObject) {
    try {
        var tourneyInfoObject = tourneyDbObject['Information'];
        var tournamentPId = tourneyDbObject['TournamentPId'];
        var teamIdsSqlList = await mySql.callSProc('teamPIdsByTournamentPId', tournamentPId);
        var seasonPId = tourneyInfoObject['SeasonPId'];
        var seasonInfoObject = await dynamoDb.getItem('Season', 'SeasonPId', seasonPId)['Information'];
        for (var i = 0; i < teamIdsSqlList.length; ++i) {
        //for (var i = 0; i < 1; ++i) {
            var teamPId = teamIdsSqlList[i]['teamPId'];
            //var teamPId = '01930253';
            var teamDbObject = await dynamoDb.getItem('Team', 'TeamPId', teamPId ); // Note this is the current state in code
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
                teamDbObject['GameLog'] = Object.assign({}, initTeamGameLog);
            }
            else if (!(seasonPId in teamDbObject['GameLog'])) {
                teamDbObject['GameLog'][seasonPId] = Object.assign({}, initTeamSeasonGames);
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
                )
                teamDbObject['Scouting'] = Object.assign({}, initTeamScouting);
            }
            else if (!(seasonPId in teamDbObject['Scouting'])) {
                teamDbObject['Scouting'][seasonPId] = Object.assign({}, initTeamSeasonScouting);
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
                teamDbObject['StatsLog'] = Object.assign({}, initTeamStatsLog);
            }
            // Check if that tournamentId in StatsLog
            else if (!(tournamentPId in teamDbObject['StatsLog'])) {
                teamDbObject['StatsLog'][tournamentPId] = Object.assign({}, initTeamTourneyStats);
            }
            //#endregion
            // Make shallow copies
            var tourneyTeamStatsItem = teamDbObject['StatsLog'][tournamentPId];
            var scoutingItem = teamDbObject['Scouting'][seasonPId];
            var gameLogTeamItem = teamDbObject['GameLog'][seasonPId]['Matches'];

            /*  
                -------------
                Compile Data
                -------------
            */
            // Loop through all the TeamStats in tournamentId
            var teamStatsSqlListTourney = await mySql.callSProc('teamStatsByTournamentPId', teamPId, tournamentPId);
            for (var j = 0; j < teamStatsSqlListTourney.length; ++j) {
                var sqlTeamStats = teamStatsSqlListTourney[j];
                var matchPId = sqlTeamStats.riotMatchId;
                if (!(matchPId in gameLogTeamItem)) {
                    // Additional sProcs from MySQL
                    var playerStatsSqlList = await mySql.callSProc('playerStatsByMatchIdTeamId', sqlTeamStats.riotMatchId, teamPId);
                    var bannedChampSqlList = await mySql.callSProc('bannedChampsByMatchId', matchPId);
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
                    for (var k = 0; k < bannedChampSqlList.length; ++k) {
                        var champSqlRow = bannedChampSqlList[k];
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
                    var playerLog = scoutingItem['PlayerLog'];
                    for (var k = 0; k < playerStatsSqlList.length; ++k) {
                        var playerSqlRow = playerStatsSqlList[k];
                        var role = playerSqlRow.role;
                        if (!(role in playerLog)) {
                            playerLog[role] = {};
                        }
                        var profileHId = profileHashIds.encode(playerSqlRow.profilePId);
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
                        var thisPlayer = playerLog[role][profileHId]; // Shallow copy
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
                    var teamGameItem = {
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
                    for (var k = 0; k < playerStatsSqlList.length; ++k) {
                        var playerSqlRow = playerStatsSqlList[k];
                        teamGameItem['ChampPicks'][playerSqlRow.role] = { 
                            'ProfileHId': profileHashIds.encode(playerSqlRow.profilePId),
                            'ChampId': playerSqlRow.champId
                        };
                    }
                    for (var phase = 1; phase <= 2; ++phase) {
                        for (var k = 0; k < bannedChampSqlList.length; ++k) {
                            var champSqlRow = bannedChampSqlList[k];
                            if (champSqlRow.phase == phase) {
                                if (champSqlRow.teamBannedById == teamPId) { teamGameItem['BannedByTeam'].push(champSqlRow.champId); }
                                else { teamGameItem['BannedAgainst'].push(champSqlRow.champId); }
                            }
                        }
                    }
                    //gameLogTeamItem[matchPId] = teamGameItem; // Do we need to do this? It's all static
                    await dynamoDb.updateItem('Team', 'TeamPId', teamPId,
                        'SET #key1.#sId.#key2.#mId = :val',
                        {
                            '#key1': 'GameLog',
                            '#sId': seasonPId,
                            '#key2': 'Matches',
                            '#mId': matchPId
                        },
                        {
                            ':val': teamGameItem
                        }
                    );
                }
            }
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
    catch (error) {
        throw error;
    }
}

async function updateTournamentItemDynamoDb(tourneyDbObject) {
    try {
        var tournamentPId = tourneyInfoObject['TournamentPId'];
        /*  
            -------------------
            Init DynamoDB Items
            -------------------
        */
        // #region Init Items
        // Check 'Information' exists in tourneyDbObject
        // {MAIN}/tournaments/<tournamentShortName>
        if (!('Information' in tourneyDbObject)) {
            tourneyDbObject['Information'] = Object.assign({}, initTourneyInformation);
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
        var tourneyInfoItem = tourneyDbObject['Information'];           // Add onto
        if (!('NumberGames' in tourneyInfoItem)) { tourneyInfoItem['NumberGames'] = 0; }
        if (!('TotalGameDuration' in tourneyInfoItem)) { tourneyInfoItem['TotalGameDuration'] = 0; }
        if (!('BlueSideWins' in tourneyInfoItem)) { tourneyInfoItem['BlueSideWins'] = 0; }
        if (!('CloudDrakes' in tourneyInfoItem)) { tourneyInfoItem['CloudDrakes'] = 0; }
        if (!('OceanDrakes' in tourneyInfoItem)) { tourneyInfoItem['OceanDrakes'] = 0; }
        if (!('InfernalDrakes' in tourneyInfoItem)) { tourneyInfoItem['InfernalDrakes'] = 0; }
        if (!('MountainDrakes' in tourneyInfoItem)) { tourneyInfoItem['MountainDrakes'] = 0; }
        if (!('ElderDrakes' in tourneyInfoItem)) { tourneyInfoItem['ElderDrakes'] = 0; }
        var pickBansItem = teamDbObject['PickBans'];                    // Add onto
        var profileHIdSet = new Set(teamDbObject['ProfileHIdList']);    // Add onto
        var teamHIdSet = new Set(teamDbObject['TeamHIdList']);          // Add onto
        var gameLogTourneyItem = tourneyDbObject['GameLog'];            // Add onto
        var leaderboardsItem = teamDbObject['Leaderboards'];
        /*  
            -------------
            Compile Data
            -------------
        */
        var matchStatsSqlList = await mySql.callSProc('matchStatsByTournamentId', tournamentPId, false);
        var matchLoaded = false;
        for (var i = 0; i < matchStatsSqlList.length; ++i) {
            var sqlMatchStats = matchStatsSqlList[i];
            var matchPId = sqlMatchStats.riotMatchId;
            if (!(matchPId in gameLogTourneyItem)) {
                /*  
                    --------------
                    'Information'
                    --------------
                */
                tourneyInfoItem['NumberGames']++;
                tourneyInfoItem['BlueSideWins'] += sqlMatchStats.blueWin;
                tourneyInfoItem['CloudDrakes'] += sqlMatchStats.cloudDragons;
                tourneyInfoItem['OceanDrakes'] += sqlMatchStats.oceanDragons;
                tourneyInfoItem['InfernalDrakes'] += sqlMatchStats.infernalDragons;
                tourneyInfoItem['MountainDrakes'] += sqlMatchStats.mountainDragons;
                tourneyInfoItem['ElderDrakes'] += sqlMatchStats.elderDragons;

                var matchObject = await dynamoDb.getItem('Matches', 'MatchPId', matchPId);
                for (var j = 0; j < Object.keys(matchObject['Teams']).length; ++j) {
                    var teamId = Object.keys(matchObject['Teams'])[j];
                    var teamObject = matchObject['Teams'][teamId];    
                    /*
                        --------------
                        'PickBans'
                        --------------
                    */
                    // Bans
                    var phase1BanArray = teamObject['Phase1Bans'];
                    addBansToTourneyItem(pickBansItem, phase1BanArray, teamId, 1);
                    var phase2BanArray = teamObject['Phase2Bans'];
                    addBansToTourneyItem(pickBansItem, phase2BanArray, teamId, 2);
                    // Picks
                    addPicksToTourneyItem(pickBansItem, teamObject['Players'], teamId);
                    /*
                        --------------
                        'ProfileHIdList' / 'TeamHIdList'
                        --------------
                    */
                    for (var k = 0; k < Object.values(teamObject['Players']).length; ++k) {
                        var playerObject = Object.values(teamObject['Players'][k]);
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
                    'DatePlayed': matchObject['datePlayed'],
                    'BlueTeamHId': teamHashIds.encode(matchObject['blueTeamPId']),
                    'RedTeamHId': teamHashIds.encode(matchObject['redTeamPId']),
                    'Duration': matchObject['duration'],
                    'BlueWin': matchObject['blueWin']
                };
                matchLoaded = true;
            }
        }
        if (matchLoaded) {
            await dynamoDb.updateItem('Tournament', 'TournamentPId', tournamentPId,
                'SET #key = :val',
                {
                    '#key': 'Information'
                },
                {
                    ':val': tourneyInfoItem
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
            // Shortest Game
            var shortestGameSqlRow = matchStatsSqlList[0];
            leaderboardsItem['ShortestGame'] = buildDefaultLeaderboardItem(shortestGameSqlRow);
            // Longest Game
            var longestGameSqlRow = matchStatsSqlList[matchStatsSqlList.length - 1];
            leaderboardsItem['LongestGame'] = buildDefaultLeaderboardItem(longestGameSqlRow);
            // Most Kills
            var mostKillsGameSqlRow = await mySql.callSProc('mostKillsGameByTournamentId', tournamentPId)[0];
            leaderboardsItem['MostKillGame'] = buildDefaultLeaderboardItem(mostKillsGameSqlRow);
            leaderboardsItem['MostKillGame']['Kills'] = mostKillsGameSqlRow.totalKills;
            // Players Most Damage
            var playerMostDamageList = [];
            var mostDamageListSql = await mySql.callSProc('playerMostDamageByTournamentId', tournamentPId);
            for (var j = 0; j < GLOBAL.LEADERBOARD_NUM; ++j) {
                var mostDamageRowSql = mostDamageListSql[j];
                var playerMostDamageItem = buildDefaultLeaderboardItem(mostDamageRowSql);
                playerMostDamageItem['ProfileHId'] = profileHashIds.encode(mostDamageRowSql.profilePId);
                playerMostDamageItem['ChampId'] = mostDamageRowSql.champId;
                playerMostDamageItem['DamagePerMin'] = mostDamageRowSql.dmgDealtPerMin;
                playerMostDamageItem['DamageDealt'] = mostDamageRowSql.damageDealt;
                playerMostDamageList.push(playerMostDamageList);
            }
            leaderboardsItem['PlayerMostDamage'] = playerMostDamageList;
            // Player Most Farm
            var playerMostFarmList = [];
            leaderboardsItem['PlayerMostFarm'] = playerMostFarmList;
            // Player Most GD@Early
            var playerMostGdEarlyList = [];
            leaderboardsItem['PlayerMostGoldDiffEarly'] = playerMostGdEarlyList;
            // Player Most XPD@Early
            var playerMostXpEarlyList = [];
            leaderboardsItem['PlayerMostXpDiffEarly'] = playerMostXpEarlyList;
            // Player Most Vision
            var playerMostVisionList = [];
            leaderboardsItem['PlayerMostVision'] = playerMostVisionList;
            // Team Top Baron Power Plays
            var teamTopBaronPpList = [];
            leaderboardsItem['TeamTopBaronPowerPlay'] = teamTopBaronPpList;
            // Team Earliest Towers
            var teamEarliestTowerList = [];
            leaderboardsItem['TeamEarliestTower'] = teamEarliestTowerList;
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

function addBansToTourneyItem(pickBansItem, banArray, teamId, phaseNum) {
    var banPhaseString = 'Phase' + phaseNum + 'Bans';
    for (var k = 0; k < banArray.length; ++k) {
        var champBanned = banArray[k];
        if (!(champBanned in pickBansItem)) {
            Object.assign(pickBansItem[champBanned], initTourneyPickBans);
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

function addPicksToTourneyItem(pickBansItem, playersObject, teamId) {
    for (var k = 0; k < Object.values(playersObject).length; ++k) {
        var playerObject = Object.values(playersObject)[k];
        var champPicked = playerObject['ChampId'];
        if (!(champPicked in pickBansItem)) {
            Object.assign(pickBansItem[champPicked], initTourneyPickBans);
        }
        if (teamId == GLOBAL.BLUE_ID) {
            pickBansItem[champPicked]['BluePicks']++;
        }
        else if (teamId == GLOBAL.RED_ID) {
            pickBansItem[champPicked]['RedPicks']++;
        }
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