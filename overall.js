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
exports.handler = async (event) => {
    
};

async function main() {
    try {
        for (let i = 0; i < inputObjects.length; ++i) {
            let tournamentId = inputObjects[i];
            let tourneyDbObject = await dynamoDb.getItem('Tournament', 'TournamentPId', tournamentId);
            if (tourneyDbObject != null) {
                await updateProfileItemDynamoDb(tourneyDbObject);
                await updateTeamItemDynamoDb(tourneyDbObject);
                await updateTournamentItemDynamoDb(tourneyDbObject);
            }
            else {
                console.error(`TournamentPId '${tournamentId}' doesn't exist in DynamoDB!`);
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
const initProfileTourneyStatsGames = {
    'RoleStats': {}
}
const initTeamSeasonGames = {
    'Matches': {}
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
            const initProfileGameLog = { [seasonPId]: clonedeep(initProfileSeasonGames) };
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
            const initStatsLog = { [tournamentPId]: clonedeep(initProfileTourneyStatsGames) };
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
                await dynamoDb.updateItem('Profile', 'ProfilePId', profilePId,
                    'SET #sLog.#tId = :val',
                    { 
                        '#sLog': 'StatsLog',
                        '#tId': tournamentPId,
                    },
                    { 
                        ':val': initProfileTourneyStatsGames
                    }
                );
                profileDbObject['StatsLog'][tournamentPId] = clonedeep(initProfileTourneyStatsGames);
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
            let matchDataList = await mySql.callSProc('playerMatchesByTournamentPId', profilePId, tournamentPId);
            console.log(`Profile '${profilePId}' played ${matchDataList.length} matches in TournamentPID '${tournamentPId}'.`);
            for (let matchIdx = 0; matchIdx < matchDataList.length; ++matchIdx) {
                let sqlPlayerStats = matchDataList[matchIdx];
                let matchPId = sqlPlayerStats.riotMatchId;
                if (!(matchPId in gameLogProfileItem)) {
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
                        'Role': sqlPlayerStats.role,
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
                }
            }
            /*  
                ----------
                'StatsLog'
                ----------
            */
            let playerStatsTotalData = await mySql.callSProc('playerStatsTotalByTournamentId', profilePId, tournamentPId, GLOBAL.MINUTE_AT_EARLY, GLOBAL.MINUTE_AT_MID);
            for (let idx = 0; idx < playerStatsTotalData.length; ++idx) {
                let playerStatsTotalRow = playerStatsTotalData[idx];
                let role = playerStatsTotalRow.playerRole;
                // Initialize StatsLog Role 
                if (!(role in statsLogProfileItem)) {
                    statsLogProfileItem[role] = {};
                }
                // Get from sProc
                let statsRoleItem = statsLogProfileItem[role];
                statsRoleItem['GamesPlayed'] = playerStatsTotalRow.gamesPlayed;
                statsRoleItem['GamesPlayedOverEarly'] = playerStatsTotalRow.gamesPlayedOverEarly;
                statsRoleItem['GamesPlayedOverMid'] = playerStatsTotalRow.gamesPlayedOverMid;
                statsRoleItem['TotalGameDuration'] = playerStatsTotalRow.totalDuration;
                statsRoleItem['GamesWin'] = playerStatsTotalRow.totalWins;
                statsRoleItem['TotalKills'] = playerStatsTotalRow.totalKills;
                statsRoleItem['TotalDeaths'] = playerStatsTotalRow.totalDeaths;
                statsRoleItem['TotalAssists'] = playerStatsTotalRow.totalAssists;
                statsRoleItem['TotalCreepScore'] = playerStatsTotalRow.totalCreepScore;
                statsRoleItem['TotalDamage'] = playerStatsTotalRow.totalDamage;
                statsRoleItem['TotalGold'] = playerStatsTotalRow.totalGold;
                statsRoleItem['TotalVisionScore'] = playerStatsTotalRow.totalVisionScore;
                statsRoleItem['TotalCsAtEarly'] = playerStatsTotalRow.totalCsAtEarly;
                statsRoleItem['TotalGoldAtEarly'] = playerStatsTotalRow.totalGoldAtEarly;
                statsRoleItem['TotalXpAtEarly'] = playerStatsTotalRow.totalXpAtEarly;
                statsRoleItem['TotalCsDiffEarly'] = playerStatsTotalRow.totalCsDiffEarly;
                statsRoleItem['TotalGoldDiffEarly'] = playerStatsTotalRow.totalGoldDiffEarly;
                statsRoleItem['TotalXpDiffEarly'] = playerStatsTotalRow.totalXpDiffEarly;
                statsRoleItem['TotalFirstBloods'] = playerStatsTotalRow.totalFirstBloods;
                statsRoleItem['TotalTeamKills'] = playerStatsTotalRow.totalTeamKills;
                statsRoleItem['TotalTeamDeaths'] = playerStatsTotalRow.totalTeamDeaths;
                statsRoleItem['TotalTeamDamage'] = playerStatsTotalRow.totalTeamDamage;
                statsRoleItem['TotalTeamGold'] = playerStatsTotalRow.totalTeamGold;
                statsRoleItem['TotalTeamVisionScore'] = playerStatsTotalRow.totalTeamVisionScore;
                statsRoleItem['TotalWardsPlaced'] = playerStatsTotalRow.totalWardsPlaced;
                statsRoleItem['TotalControlWardsBought'] = playerStatsTotalRow.totalControlWardsBought;
                statsRoleItem['TotalWardsCleared'] = playerStatsTotalRow.totalWardsCleared;
                statsRoleItem['TotalSoloKills'] = playerStatsTotalRow.totalSoloKills;
                statsRoleItem['TotalDoubleKills'] = playerStatsTotalRow.totalDoubleKills;
                statsRoleItem['TotalTripleKills'] = playerStatsTotalRow.totalTripleKills;
                statsRoleItem['TotalQuadraKills'] = playerStatsTotalRow.totalQuadraKills;
                statsRoleItem['TotalPentaKills'] = playerStatsTotalRow.totalPentaKills;
            }
            // Push into DynamoDb
            await dynamoDb.updateItem('Profile', 'ProfilePId', profilePId, 
                'SET #slog.#tId.#rStats = :data',
                {
                    '#slog': 'StatsLog',
                    '#tId': tournamentPId,
                    '#rStats': 'RoleStats',
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
                    '#mtch': 'Matches',
                },
                {
                    ':data': gameLogProfileItem
                }
            );
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
            const initTeamScouting = { [seasonPId]: {} };
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
                teamDbObject['Scouting'][seasonPId] = {};
            }
            // Check 'StatsLog' exists in TeamItem
            // {MAIN}/team/<teamName>/stats/<tournamentShortName>
            const initTeamStatsLog = { [tournamentPId]: {} };
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
                teamDbObject['StatsLog'][tournamentPId] = {};
            }
            //#endregion
            // Make shallow copies
            let scoutingItem = teamDbObject['Scouting'][seasonPId];
            let gameLogTeamItem = teamDbObject['GameLog'][seasonPId]['Matches'];
            let tourneyTeamStatsItem = teamDbObject['StatsLog'][tournamentPId];

            /*  
                -------------
                Compile Data
                -------------
            */
            // Loop through all the TeamStats Sql Rows in tournamentId
            let teamMatchesSqlListTourney = await mySql.callSProc('teamMatchesByTournamentPId', teamPId, tournamentPId);
            for (let matchIdx = 0; matchIdx < teamMatchesSqlListTourney.length; ++matchIdx) {
                let sqlTeamMatch = teamMatchesSqlListTourney[matchIdx];
                let matchPId = sqlTeamMatch.riotMatchId;
                if (!(matchPId in gameLogTeamItem)) {
                    // Additional sProcs from MySQL
                    let playerStatsSqlList = await mySql.callSProc('playerStatsByMatchIdTeamId', matchPId, teamPId);
                    let bannedChampMatchSqlList = await mySql.callSProc('bannedChampsByMatchId', matchPId);
                    /*  
                        -------------
                        'GameLog'
                        -------------
                    */
                    let teamGameItem = {
                        'DatePlayed': sqlTeamMatch.datePlayed,
                        'TournamentType': sqlTeamMatch.tournamentType,
                        'GameWeekNumber': 0, // N/A
                        'ChampPicks': {},
                        'Win': (sqlTeamMatch.win == 1) ? true : false,
                        'Vacated': false,
                        'EnemyTeamHId': teamHashIds.encode((sqlTeamMatch.side === 'Blue') ? sqlTeamMatch.redTeamPId : sqlTeamMatch.blueTeamPId),
                        'GameDuration': sqlTeamMatch.duration,
                        'Kills': sqlTeamMatch.totalKills,
                        'Deaths': sqlTeamMatch.totalDeaths,
                        'Assists': sqlTeamMatch.totalAssists,
                        'GoldPerMinute': sqlTeamMatch.goldPerMin,
                        'GoldDiffEarly': sqlTeamMatch.goldDiffEarly,
                        'GoldDiffMid': sqlTeamMatch.goldDiffMid,
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
                        for (let k = 0; k < bannedChampMatchSqlList.length; ++k) {
                            let champSqlRow = bannedChampMatchSqlList[k];
                            if (champSqlRow.phase == phase) {
                                if (champSqlRow.teamBannedById == teamPId) { teamGameItem['BannedByTeam'].push(champSqlRow.champId); }
                                else { teamGameItem['BannedAgainst'].push(champSqlRow.champId); }
                            }
                        }
                    }
                    gameLogTeamItem[matchPId] = teamGameItem;
                }
            }
            /*  
                -------------
                'Scouting' (Season Id dependent)
                -------------
            */
            // Banned Champs List
            const sqlTeamSeasonStats = (await mySql.callSProc('teamStatsBySeasonId', teamPId, seasonPId))[0];
            scoutingItem['Ongoing'] = false;
            scoutingItem['GamesPlayed'] = sqlTeamSeasonStats.gamesPlayed;
            scoutingItem['GamesWin'] = sqlTeamSeasonStats.gamesWin;
            scoutingItem['BannedByTeam'] = {};
            scoutingItem['BannedAgainstTeam'] = {};
            const bannedChampsSeasonSqlList = await mySql.callSProc('bannedChampsByTeamIdSeasonId', teamPId, seasonPId);
            for (let champIdx = 0; champIdx < bannedChampsSeasonSqlList.length; ++champIdx) {
                const champSqlRow = bannedChampsSeasonSqlList[champIdx];
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
            // Player Log
            const playerScoutingSqlList = await mySql.callSProc('playerStatsTotalByTeamIdSeasonId', teamPId, seasonPId);
            let playerLog = {};
            for (let playerIdx = 0; playerIdx < playerScoutingSqlList.length; ++playerIdx) {
                const playerSqlRow = playerScoutingSqlList[playerIdx];
                const role = playerSqlRow.playerRole;
                if (!(role in playerLog)) {
                    playerLog[role] = {};
                }
                const { profilePId } = playerSqlRow;
                const profileHId = profileHashIds.encode(profilePId);
                if (!(profileHId in playerLog[role])) {
                    // New entry
                    playerLog[role][profileHId] = {
                        'GamesPlayed': playerSqlRow.gamesPlayed,
                        'TotalKillsPlayer': playerSqlRow.totalKills,
                        'TotalDeathsPlayer': playerSqlRow.totalDeaths,
                        'TotalAssistsPlayer': playerSqlRow.totalAssists,
                        'TotalDamagePlayer': playerSqlRow.totalDamage,
                        'TotalGoldPlayer': playerSqlRow.totalGold,
                        'TotalVsPlayer': playerSqlRow.totalVisionScore,
                        'TotalKillsTeam': playerSqlRow.totalTeamKills,
                        'TotalDamageTeam': playerSqlRow.totalTeamDamage,
                        'TotalGoldTeam': playerSqlRow.totalTeamGold,
                        'TotalVsTeam': playerSqlRow.totalTeamVisionScore,
                        'ChampsPlayed': {}
                    };
                }
                const champStatsSqlList = await mySql.callSProc('champStatsByProfileIdTeamIdRoleSeasonId', profilePId, teamPId, role, seasonPId, GLOBAL.MINUTE_AT_EARLY);
                let champsPlayed = playerLog[role][profileHId]['ChampsPlayed'];
                for (let champIdx = 0; champIdx < champStatsSqlList.length; ++champIdx) {
                    const champStats = champStatsSqlList[champIdx];
                    const { champId } = champStats;
                    champsPlayed[champId] = {};
                    champsPlayed[champId]['GamesPlayed'] = champStats.gamesPlayed;
                    champsPlayed[champId]['GamesWon'] = champStats.gamesWin;
                    champsPlayed[champId]['TotalKills'] = champStats.totalKills;
                    champsPlayed[champId]['TotalDeaths'] = champStats.totalDeaths;
                    champsPlayed[champId]['TotalAssists'] = champStats.totalAssists;
                    champsPlayed[champId]['TotalDuration'] = champStats.totalDuration;
                    champsPlayed[champId]['TotalGold'] = champStats.totalGold;
                    champsPlayed[champId]['TotalCreepScore'] = champStats.totalCreepScore;
                    champsPlayed[champId]['TotalVisionScore'] = champStats.totalVisionScore;
                    champsPlayed[champId]['GamesPlayedEarly'] = champStats.gamesPlayedOverEarly;
                    champsPlayed[champId]['TotalCsDiffEarly'] = champStats.totalCsDiffEarly;
                    champsPlayed[champId]['TotalGoldDiffEarly'] = champStats.totalGoldDiffEarly;
                    champsPlayed[champId]['TotalXpDiffEarly'] = champStats.totalXpDiffEarly;
                }
            }
            scoutingItem['PlayerLog'] = playerLog;
            
            /*  
                -------------
                'StatsLog' (TournamentId dependent)
                -------------
            */
            let sqlTeamStatsTotal = (await mySql.callSProc('teamStatsTotalByTournamentPId', teamPId, tournamentPId, GLOBAL.MINUTE_AT_EARLY, GLOBAL.MINUTE_AT_MID))[0];
            tourneyTeamStatsItem['GamesPlayed'] = sqlTeamStatsTotal.gamesPlayed;
            tourneyTeamStatsItem['GamesPlayedOverEarly'] = sqlTeamStatsTotal.gamesPlayedOverEarly;
            tourneyTeamStatsItem['GamesPlayedOverMid'] = sqlTeamStatsTotal.gamesPlayedOverMid;
            tourneyTeamStatsItem['GamesWon'] = sqlTeamStatsTotal.totalWins;
            tourneyTeamStatsItem['GamesPlayedOnBlue'] = sqlTeamStatsTotal.gamesPlayedOnBlue;
            tourneyTeamStatsItem['BlueWins'] = sqlTeamStatsTotal.totalBlueWins;
            tourneyTeamStatsItem['TotalGameDuration'] = sqlTeamStatsTotal.totalDuration;
            tourneyTeamStatsItem['TotalXpDiffEarly'] = sqlTeamStatsTotal.totalXpDiffEarly;
            tourneyTeamStatsItem['TotalXpDiffMid'] = sqlTeamStatsTotal.totalXpDiffMid;
            tourneyTeamStatsItem['TotalGold'] = sqlTeamStatsTotal.totalGold;
            tourneyTeamStatsItem['TotalGoldDiffEarly'] = sqlTeamStatsTotal.totalGoldDiffEarly;
            tourneyTeamStatsItem['TotalGoldDiffMid'] = sqlTeamStatsTotal.totalGoldDiffMid;
            tourneyTeamStatsItem['TotalCreepScore'] = sqlTeamStatsTotal.totalCreepScore;
            tourneyTeamStatsItem['TotalCsDiffEarly'] = sqlTeamStatsTotal.totalCsDiffEarly;
            tourneyTeamStatsItem['TotalCsDiffMid'] = sqlTeamStatsTotal.totalCsDiffMid;
            tourneyTeamStatsItem['TotalDamageDealt'] = sqlTeamStatsTotal.totalDamageDealt;
            tourneyTeamStatsItem['TotalFirstBloods'] = sqlTeamStatsTotal.totalFirstBloods;
            tourneyTeamStatsItem['TotalFirstTowers'] = sqlTeamStatsTotal.totalFirstTowers;
            tourneyTeamStatsItem['TotalKills'] = sqlTeamStatsTotal.totalKills;
            tourneyTeamStatsItem['TotalDeaths'] = sqlTeamStatsTotal.totalDeaths;
            tourneyTeamStatsItem['TotalAssists'] = sqlTeamStatsTotal.totalAssists;
            tourneyTeamStatsItem['TotalTowersTaken'] = sqlTeamStatsTotal.totalTeamTowers;
            tourneyTeamStatsItem['TotalTowersLost'] = sqlTeamStatsTotal.totalEnemyTowers;
            tourneyTeamStatsItem['TotalDragonsTaken'] = sqlTeamStatsTotal.totalTeamDragons;
            tourneyTeamStatsItem['TotalEnemyDragons'] = sqlTeamStatsTotal.totalEnemyDragons;
            tourneyTeamStatsItem['TotalHeraldsTaken'] = sqlTeamStatsTotal.totalTeamHeralds;
            tourneyTeamStatsItem['TotalEnemyHeralds'] = sqlTeamStatsTotal.totalEnemyHeralds;
            tourneyTeamStatsItem['TotalBaronsTaken'] = sqlTeamStatsTotal.totalTeamBarons;
            tourneyTeamStatsItem['TotalEnemyBarons'] = sqlTeamStatsTotal.totalEnemyBarons;
            tourneyTeamStatsItem['TotalVisionScore'] = sqlTeamStatsTotal.totalVisionScore;
            tourneyTeamStatsItem['TotalWardsPlaced'] = sqlTeamStatsTotal.totalWardsPlaced;
            tourneyTeamStatsItem['TotalControlWardsBought'] = sqlTeamStatsTotal.totalControlWardsBought;
            tourneyTeamStatsItem['TotalWardsCleared'] = sqlTeamStatsTotal.totalWardsCleared;
            tourneyTeamStatsItem['TotalEnemyWardsPlaced'] = sqlTeamStatsTotal.totalEnemyWardsPlaced;

            // Put into DynamoDb
            await dynamoDb.updateItem('Team', 'TeamPId', teamPId,
                'SET #gLog.#sId.#mtchs = :val',
                {
                    '#gLog': 'GameLog',
                    '#sId': seasonPId,
                    '#mtchs': 'Matches'
                },
                {
                    ':val': gameLogTeamItem
                }
            );
            await dynamoDb.updateItem('Team', 'TeamPId', teamPId, 
                'SET #scout.#sId = :val',
                {
                    '#scout': 'Scouting',
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
    let tournamentPId = tourneyDbObject['TournamentPId'];
    console.log("FUNCTION: updateTournamentItemDynamoDb of tId '" + tournamentPId + "'");
    try {
        /*  
            -------------------
            Init DynamoDB Items
            -------------------
        */
        // Make shallow copies
        let tourneyStatsItem = {
            'NumberGames': 0,
            'BlueSideWins': 0,
            'TotalGameDuration': 0,
            'CloudDrakes': 0,
            'OceanDrakes': 0,
            'InfernalDrakes': 0,
            'MountainDrakes': 0,
            'ElderDrakes': 0,
        }
        let pickBansItem = {};
        let profileHIdSet = new Set();
        let teamHIdSet = new Set();
        let gameLogTourneyItem = {};
        let leaderboardsItem = {};
        /*  
            -------------
            Compile Data
            -------------
        */
        let matchStatsSqlList = await mySql.callSProc('matchStatsByTournamentId', tournamentPId);
        for (let matchIdx = 0; matchIdx < matchStatsSqlList.length; ++matchIdx) {
            let matchStatsSqlRow = matchStatsSqlList[matchIdx];
            let matchPId = matchStatsSqlRow.riotMatchId;
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
        }
        await dynamoDb.updateItem('Tournament', 'TournamentPId', tournamentPId,
            'SET #tStats = :val',
            {
                '#tStats': 'TourneyStats'
            },
            {
                ':val': tourneyStatsItem
            }
        );
        await dynamoDb.updateItem('Tournament', 'TournamentPId', tournamentPId,
            'SET #pb = :val',
            {
                '#pb': 'PickBans'
            },
            {
                ':val': pickBansItem
            }
        );
        await dynamoDb.updateItem('Tournament', 'TournamentPId', tournamentPId,
            'SET #pHIdList = :val',
            {
                '#pHIdList': 'ProfileHIdList'
            },
            {
                ':val': Array.from(profileHIdSet)
            }
        );
        await dynamoDb.updateItem('Tournament', 'TournamentPId', tournamentPId,
            'SET #tHIdList = :val',
            {
                '#tHIdList': 'TeamHIdList'
            },
            {
                ':val': Array.from(teamHIdSet)
            }
        );
        await dynamoDb.updateItem('Tournament', 'TournamentPId', tournamentPId,
            'SET #gLog = :val',
            {
                '#gLog': 'GameLog'
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
        leaderboardsItem['TeamSingleRecords'] = {};
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