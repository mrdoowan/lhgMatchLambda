/* 
    AWS LAMBDA FUNCTION 2: Insert a tournamentId and update overall stats for Profile, Team, and Tournament
    This function affects the following:
    - DynamoDB: Match table
*/

/*  Declaring npm modules */
const Hashids = require('hashids/cjs'); // For hashing and unhashing
const mysql = require('mysql'); // Interfacing with mysql DB
var AWS = require('aws-sdk'); // Interfacing with DynamoDB

/* 
    Import from other files that are not committed to Github
    Contact doowan about getting a copy of these files
*/
const inputObjects = require('./external/tournamentTest');
const envVars = require('./external/env');

/*  Global variable constants */
const MINUTE_AT1 = 15;
const MINUTE_AT2 = 25;

/*  Put 'false' to test without affecting the databases. */
const PUT_INTO_DYNAMO = false;       // 'true' when comfortable to push into DynamoDB
/*  Put 'false' to not debug. */
const DEBUG_DYNAMO = false;
const DEBUG_MYSQL = true;

/*  Configurations of npm modules */
AWS.config.update({ region: 'us-east-2' });
var dynamoDB = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' });
const profileHashIds = new Hashids(envVars.PROFILE_HID_SALT, envVars.HID_LENGTH); // process.env.PROFILE_HID_SALT
const teamHashIds = new Hashids(envVars.TEAM_HID_SALT, envVars.HID_LENGTH); // process.env.TEAM_HID_SALT
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
    
};

async function main() {
    try {
        var tournamentId = inputObjects[0];
        //updateProfileItemDynamoDb(tournamentId);
        updateTeamItemDynamoDb(tournamentId);
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
    Database Functions
    ----------------------
*/

/*
    Get list of players that played in tournamentId and update their GameLogs
*/
async function updateProfileItemDynamoDb(tournamentPId) {
    try {
        var profileIdList = await sProcMySqlQuery('profilePIdsByTournamentPId', tournamentPId);
        var tournamentDbObject = await getItemInDynamoDB('Tournament', 'TournamentPId', tournamentPId);
        var seasonPId = tournamentDbObject['SeasonPId'];
        var seasonDbObject = await getItemInDynamoDB('Season', 'SeasonPId', seasonPId);
        for (var i = 0; i < profileIdList.length; ++i) {
            var profilePId = profileIdList[i]['profilePId'];
            var profileItem = await getItemInDynamoDB('Profile', 'ProfilePId', profilePId); // Note this is the current state in code
            // Add 'GameLog' and 'StatsLog' to the Profiles if they do not exist
            var newSeasonPIdItem = {
                'SeasonTime': seasonDbObject.seasonTime,
                'Matches': {}
            }
            var newGameLogItem = {
                [seasonPId]: newSeasonPIdItem
            };
            // Check if 'GameLog' exists in Profile
            if (!('GameLog' in profileItem)) {
                await updateItemInDynamoDB('Profile', 'ProfilePId', profilePId,
                    'SET #gLog = :val',
                    { 
                        '#gLog': 'GameLog'
                    },
                    { 
                        ':val': newGameLogItem
                    }
                );
                profileItem['GameLog'] = newGameLogItem;
            }
            // Check if that season exists in the GameLogs
            else if (!(seasonPId in profileItem['GameLog'])) {
                await updateItemInDynamoDB('Profile', 'ProfilePId', profilePId,
                    'SET #gLog.#sId = :val',
                    { 
                        '#gLog': 'GameLog', 
                        '#sId': seasonPId
                    },
                    { 
                        ':val': newSeasonPIdItem
                    }
                );
                profileItem['GameLog'][seasonPId] = newSeasonPIdItem;
            }
            // Check if 'StatsLog' exists in Profile
            var newTourneyPIdItem = {}; // Nothing added here for now
            var newStatsLogItem = {
                [tournamentPId]: newTourneyPIdItem
            };
            if (!('StatsLog' in profileItem)) {
                await updateItemInDynamoDB('Profile', 'ProfilePId', profilePId,
                    'SET #sLog = :val',
                    { 
                        '#sLog': 'StatsLog'
                    },
                    { 
                        ':val': newStatsLogItem
                    }
                );
                profileItem['StatsLog'] = newStatsLogItem;
            }
            // Check if that TournamentPId in StatsLog
            if (!(tournamentPId in profileItem['StatsLog'])) {
                await updateItemInDynamoDB('Profile', 'ProfilePId', profilePId,
                    'SET #sLog.#tId = :val',
                    { 
                        '#sLog': 'GameLog', 
                        '#tId': tournamentPId
                    },
                    { 
                        ':val': newTourneyPIdItem 
                    }
                );
                profileItem['StatsLog'][tournamentPId] = newTourneyPIdItem;
            }
            // Check if 'ChampsPlayed' exists in Profile
            if (!('ChampsPlayed' in profileItem)) {
                await updateItemInDynamoDB('Profile', 'ProfilePId', profilePId,
                    'SET #cPlayed = :val',
                    { 
                        '#cPlayed': 'ChampsPlayed'
                    },
                    { 
                        ':val': {}
                    }
                );
                profileItem['ChampsPlayed'] = {};
            }

            // Load each Stat into Profile
            var matchDataList = await sProcMySqlQuery('playerStatsByTournamentPId', profilePId, tournamentPId);
            var profileTournamentStats = {
                'GamesPlayed': 0,
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
                'TotalFirstTowers': 0,
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
            for (var j = 0; j < matchDataList.length; ++j) {
                var sqlData = matchDataList[j];
                // 1) {MAIN}/profile/<profileName>/games/<seasonShortName> (add to the log)
                var playerMatchData = {
                    TournamentType: tournamentDbObject.TournamentType,
                    DatePlayed: sqlData.datePlayed,
                    TeamHId: teamHashIds.encode(sqlData.teamPId),
                    GameWeekNumber: 0, // N/A
                    ChampionPlayed: sqlData.champId,
                    Role: sqlData.role,
                    Win: (sqlData.win == 1) ? true : false,
                    Vacated: false,
                    EnemyTeamHId: teamHashIds.encode((sqlData.side === 'Blue') ? sqlData.redTeamPId : sqlData.blueTeamPId),
                    GameDuration: sqlData.duration,
                    Kills: sqlData.kills,
                    Deaths: sqlData.deaths,
                    Assists: sqlData.assists,
                    KillPct: ((sqlData.kills + sqlData.assists) / sqlData.teamKills).toFixed(4),
                    DamagePct: (sqlData.damageDealt / sqlData.teamDamage).toFixed(4),
                    GoldPct: (sqlData.gold / sqlData.teamGold).toFixed(4),
                    VsPct: (sqlData.visionScore / sqlData.teamVS).toFixed(4),
                };
                if (!(sqlData.riotMatchId in profileItem['GameLog'][seasonPId])) {
                    await updateItemInDynamoDB('Profile', 'ProfilePId', profilePId,
                        'SET #log.#sId.#mtch.#mId = :data',
                        {
                            '#log': 'GameLog',
                            '#sId': seasonPId,
                            '#mtch': 'Matches',
                            '#mId': sqlData.riotMatchId
                        },
                        {
                            ':data': playerMatchData
                        }
                    );
                }
                // {MAIN}/profile/<profileName>/stats/<tournamentShortName>
                profileTournamentStats['GamesPlayed']++;
                profileTournamentStats['TotalGameDuration'] += sqlData.duration;
                profileTournamentStats['GamesWin'] += sqlData.win;
                profileTournamentStats['TotalKills'] += sqlData.kills;
                profileTournamentStats['TotalDeaths'] += sqlData.deaths;
                profileTournamentStats['TotalAssists'] += sqlData.assists;
                profileTournamentStats['TotalCreepScore'] += sqlData.creepScore;
                profileTournamentStats['TotalDamage'] += sqlData.damageDealt;
                profileTournamentStats['TotalGold'] += sqlData.gold;
                profileTournamentStats['TotalVisionScore'] += sqlData.visionScore;
                profileTournamentStats['TotalCsAtEarly'] += sqlData.csAtEarly;
                profileTournamentStats['TotalGoldAtEarly'] += sqlData.goldAtEarly;
                profileTournamentStats['TotalXpAtEarly'] += sqlData.xpAtEarly;
                profileTournamentStats['TotalCsDiffEarly'] += sqlData.csDiffEarly;
                profileTournamentStats['TotalGoldDiffEarly'] += sqlData.goldDiffEarly;
                profileTournamentStats['TotalXpDiffEarly'] += sqlData.xpDiffEarly;
                profileTournamentStats['TotalFirstBloods'] += (sqlData.firstBloodKill + sqlData.firstBloodAssist);
                profileTournamentStats['TotalFirstTowers'] += sqlData.firstTower;
                profileTournamentStats['TotalTeamKills'] += sqlData.teamKills;
                profileTournamentStats['TotalTeamDeaths'] += sqlData.teamDeaths;
                profileTournamentStats['TotalTeamDamage'] += sqlData.teamDamage;
                profileTournamentStats['TotalTeamGold'] += sqlData.teamGold;
                profileTournamentStats['TotalTeamVisionScore'] += sqlData.teamVS;
                profileTournamentStats['TotalWardsPlaced'] += sqlData.wardsPlaced;
                profileTournamentStats['TotalControlWardsBought'] += sqlData.controlWardsBought;
                profileTournamentStats['TotalWardsCleared'] += sqlData.wardsCleared;
                profileTournamentStats['TotalSoloKills'] += sqlData.soloKills;
                profileTournamentStats['TotalDoubleKills'] += sqlData.doubleKills;
                profileTournamentStats['TotalTripleKills'] += sqlData.tripleKills;
                profileTournamentStats['TotalQuadraKills'] += sqlData.quadraKills;
                profileTournamentStats['TotalPentaKills'] += sqlData.pentaKills;
            }
            await updateItemInDynamoDB('Profile', 'ProfilePId', profilePId, 
                'SET #slog.#tId = :data',
                {
                    '#slog': 'StatsLog',
                    '#tId': tournamentPId
                },
                {
                    ':data': profileTournamentStats
                }
            );
            // Load ChampsPlayed into Profile
            if (!(sqlData.champId in profileItem['ChampsPlayed'])) {
                profileItem['ChampsPlayed'][sqlData.champId] = {};
                profileItem['ChampsPlayed'][sqlData.champId]['GamesPlayed'] = 0;
                profileItem['ChampsPlayed'][sqlData.champId]['GamesWon'] = 0;
            }
            profileItem['ChampsPlayed'][sqlData.champId]['GamesPlayed']++;
            profileItem['ChampsPlayed'][sqlData.champId]['GamesWon'] += sqlData.win;
            await updateItemInDynamoDB('Profile', 'ProfilePId', profilePId,
                'SET #cPlayed = :val',
                { 
                    '#cPlayed': 'ChampsPlayed'
                },
                { 
                    ':val': profileItem['ChampsPlayed']
                }
            );
        }
    }
    catch (error) {
        throw error;
    }
}

async function updateTeamItemDynamoDb(tournamentPId) {
    try {
        var teamIdSqlList = await sProcMySqlQuery('teamPIdsByTournamentPId', tournamentPId);
        var tournamentDbObject = await getItemInDynamoDB('Tournament', 'TournamentPId', tournamentPId);
        var seasonPId = tournamentDbObject['SeasonPId'];
        var seasonDbObject = await getItemInDynamoDB('Season', 'SeasonPId', seasonPId);
        for (var i = 0; i < 1; ++i) {
            //var teamPId = teamIdSqlList[i]['teamPId'];
            teamPId = '01930253';
            var teamDbObject = await getItemInDynamoDB('Team', 'TeamPId', teamPId ); // Note this is the current state in code
            /*  
                ----------
                Init Items
                ----------
            */
            // Check 'GameLog' exists in TeamItem
            // {MAIN}/team/<teamName>/games/<seasonShortName>
            var initGameSeason = {
                'SeasonTime': seasonDbObject.seasonTime,
                'Matches': {}
            }
            var initGameLog = {
                [seasonPId]: initGameSeason
            };
            if (!('GameLog' in teamDbObject)) {
                await updateItemInDynamoDB('Team', 'TeamPId', teamPId,
                    'SET #gLog = :val',
                    {
                        '#gLog': 'GameLog'
                    }, 
                    {
                        ':val': initGameLog
                    }
                );
                teamDbObject['GameLog'] = initGameLog;
            }
            else if (!(seasonPId in teamDbObject['GameLog'])) {
                await updateItemInDynamoDB('Team', 'TeamPId', teamPId,
                    'SET #gLog.#sId',
                    {
                        '#gLog': 'GameLog',
                        '#sId': seasonPId
                    },
                    {
                        ':val': initGameSeason
                    }
                )
                teamDbObject['GameLog'][seasonPId] = initGameSeason;
            }
            // Check 'Scouting' exists in TeamItem 
            // {MAIN}/team/<teamName>/scouting/<seasonShortName>
            var initScoutingSeason = { 
                'SeasonTime': seasonDbObject.SeasonTime,
                'Ongoing': false,
                'MultiOpgg': '',
                'GamesPlayed': 0,
                'GamesWin': 0,
                'BannedByTeam': {},
                'BannedAgainstTeam': {},
                'PlayerLog': {}
            }
            var initScouting = { [seasonPId]: initScoutingSeason };
            if (!('Scouting' in teamDbObject)) {
                await updateItemInDynamoDB('Team', 'TeamPId', teamPId, 
                    'SET #sct = :val',
                    {
                        '#sct': 'Scouting'
                    },
                    {
                        ':val': initScouting
                    }
                )
                teamDbObject['Scouting'] = initScouting;
            }
            else if (!(seasonPId in teamDbObject['Scouting'])) {
                await updateItemInDynamoDB('Team', 'TeamPId', teamPId, 
                    'SET #sct.#sId = :val',
                    {
                        '#sct': 'Scouting',
                        '#sId': seasonPId
                    },
                    {
                        ':val': initScoutingSeason
                    }
                );
                teamDbObject['Scouting'][seasonPId] = initScoutingSeason;
            }
            // Check 'StatsLog' exists in TeamItem
            // {MAIN}/team/<teamName>/stats/<tournamentShortName>
            var initTourneyPId = {
                'GamesPlayed': 0,
                'TotalGameDuration': 0,
                'GamesPlayedOver15Min': 0,
                'GamesPlayedOver25Min': 0,
                'GamesWon': 0,
                'BlueWins': 0,
                'BlueLoss': 0,
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
            var initStatsLog = {
                [tournamentPId]: initTourneyPId
            };
            if (!('StatsLog' in teamDbObject)) {
                await updateItemInDynamoDB('Team', 'TeamPId', teamPId,
                    'SET #sLog = :val',
                    { 
                        '#sLog': 'StatsLog'
                    },
                    { 
                        ':val': initStatsLog
                    }
                );
                teamDbObject['StatsLog'] = initStatsLog;
            }
            // Check if that tournamentId in StatsLog
            if (!(tournamentPId in teamDbObject['StatsLog'])) {
                await updateItemInDynamoDB('Team', 'TeamPId', teamPId,
                    'SET #sLog.#tId = :val',
                    { 
                        '#sLog': 'GameLog', 
                        '#tId': tournamentPId
                    },
                    { 
                        ':val': initTourneyPId 
                    }
                );
                teamDbObject['StatsLog'][tournamentPId] = initTourneyPId;
            }
            // Make shallow copies
            var tourneyStatsItem = teamDbObject['StatsLog'][tournamentPId];
            var gameLogTeamItem = teamDbObject['GameLog'][seasonPId]['Matches'];
            var scoutingItem = teamDbObject['Scouting'][seasonPId];

            /*  
                ----------
                'StatsLog'
                ----------
            */
            // Loop through all the TeamStats in tournamentId
            var teamStatsSqlListTourney = await sProcMySqlQuery('teamStatsByTournamentPId', teamPId, tournamentPId);
            for (var j = 0; j < teamStatsSqlListTourney.length; ++j) {
                var sqlTeamStats = teamStatsSqlListTourney[j];
                var matchPId = sqlTeamStats.riotMatchId;
                if (!(matchPId in gameLogTeamItem)) {
                    tourneyStatsItem['GamesPlayed']++;
                    tourneyStatsItem['TotalGameDuration'] += sqlTeamStats.duration;
                    tourneyStatsItem['GamesPlayedOverEarly'] += (sqlTeamStats.duration >= 15 * 60);
                    tourneyStatsItem['GamesPlayedOverMid'] += (sqlTeamStats.duration >= 25 * 60);
                    tourneyStatsItem['GamesWon'] += sqlTeamStats.win;
                    tourneyStatsItem['BlueWins'] += (sqlTeamStats.win && (sqlTeamStats.side === 'Blue'));
                    tourneyStatsItem['BlueLoss'] += (!sqlTeamStats.win && (sqlTeamStats.side === 'Blue'));
                    tourneyStatsItem['TotalXpDiffEarly'] += sqlTeamStats.xpDiffEarly;
                    tourneyStatsItem['TotalXpDiffMid'] += sqlTeamStats.xpDiffMid;
                    tourneyStatsItem['TotalGold'] += sqlTeamStats.totalGold;
                    tourneyStatsItem['TotalGoldDiffEarly'] += sqlTeamStats.goldDiffEarly;
                    tourneyStatsItem['TotalGoldDiffMid'] += sqlTeamStats.goldDiffMid;
                    tourneyStatsItem['TotalCreepScore'] += sqlTeamStats.totalCreepScore;
                    tourneyStatsItem['TotalCsDiffEarly'] += sqlTeamStats.csDiffEarly;
                    tourneyStatsItem['TotalCsDiffMid'] += sqlTeamStats.csDiffMid;
                    tourneyStatsItem['TotalFirstBloods'] += sqlTeamStats.firstBlood;
                    tourneyStatsItem['TotalFirstTowers'] += sqlTeamStats.firstTower;
                    tourneyStatsItem['TotalKills'] += sqlTeamStats.totalKills;
                    tourneyStatsItem['TotalDeaths'] += sqlTeamStats.totalDeaths;
                    tourneyStatsItem['TotalAssists'] += sqlTeamStats.totalAssists;
                    tourneyStatsItem['TotalDragonsTaken'] += sqlTeamStats.totalDragons;
                    tourneyStatsItem['TotalEnemyDragons'] += sqlTeamStats.oppDragons;
                    tourneyStatsItem['TotalHeraldsTaken'] += sqlTeamStats.totalHeralds;
                    tourneyStatsItem['TotalEnemyHeralds'] += sqlTeamStats.oppHeralds;
                    tourneyStatsItem['TotalBaronsTaken'] += sqlTeamStats.totalBarons;
                    tourneyStatsItem['TotalEnemyBarons'] += sqlTeamStats.oppBarons;
                    tourneyStatsItem['TotalVisionScore'] += sqlTeamStats.totalVisionScore;
                    tourneyStatsItem['TotalWardsPlaced'] += sqlTeamStats.totalWardsPlaced;
                    tourneyStatsItem['TotalControlWardsBought'] += sqlTeamStats.totalControlWardsBought;
                    tourneyStatsItem['TotalWardsCleared'] += sqlTeamStats.totalWardsCleared;
                    tourneyStatsItem['TotalEnemyWardsPlaced'] += sqlTeamStats.oppWardsPlaced;
                }
            }
            console.log(tourneyStatsItem);

            /*  
                ------------------------
                'Scouting' and 'GameLog'
                ------------------------
            */
            // Loop through all of the matchPIds teamPId has played in seasonPId
            var teamStatsSqlListSeason = await sProcMySqlQuery('teamStatsBySeasonPId', teamPId, seasonPId);
            for (var j = 0; j < teamStatsSqlListSeason.length; ++j) {
                var sqlTeamStats = teamStatsSqlListSeason[j];
                var matchPId = sqlTeamStats.riotMatchId;
                if (!(matchPId in gameLogTeamItem)) {
                    // sProcs from MySQL
                    var playerStatsSqlList = await sProcMySqlQuery('playerStatsByMatchIdTeamId', sqlTeamStats.riotMatchId, teamPId);
                    var bannedChampSqlList = await sProcMySqlQuery('bannedChampsByMatchId', matchPId);

                    // 'Scouting'
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

                    // 'GameLog'
                    var teamGameItem = {
                        'DatePlayed': sqlTeamStats.datePlayed,
                        'TournamentType': sqlTeamStats.tournamentType,
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
                    //gameLogTeamItem[matchPId] = teamGameItem; // Do we need to do this? We aren't adding matchPIds...
                    await updateItemInDynamoDB('Team', 'TeamPId', teamPId,
                        'SET #gLog.#sId.#mtch.#mId = :val',
                        {
                            '#gLog': 'GameLog',
                            '#sId': seasonPId,
                            '#mtch': 'Matches',
                            '#mId': matchPId
                        },
                        {
                            ':val': teamGameItem
                        }
                    );
                }
            }
            await updateItemInDynamoDB('Team', 'TeamPId', teamPId, 
                'SET #sct.#sId = :val',
                {
                    '#sct': 'Scouting',
                    '#sId': seasonPId
                },
                {
                    ':val': scoutingItem
                }
            );
        }
    }
    catch (error) {
        throw error;
    }
}

async function putTournamentItemDynamoDb(tournamentId) {
    try {

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
function sProcMySqlQuery(sProcName) {
    var argArr = arguments; // Because arguments gets replaced by the function below
    return new Promise(function(resolve, reject) {
        try {
            var queryStr = "CALL " + sProcName + "(";
            for (var i = 1; i < argArr.length; ++i) {
                var arg = argArr[i];
                arg = (typeof arg === "string") ? '\'' + arg + '\'' : arg;
                queryStr += arg + ",";
            }
            if (argArr.length > 1) {
                queryStr = queryStr.slice(0, -1); // trimEnd of last comma
            }
            queryStr += ");";

            sqlPool.getConnection(function(err, connection) {
                if (err) { reject(err); }
                connection.query(queryStr, function(error, results, fields) {
                    connection.release();
                    if (error) { reject(error); }
                    console.log("MySQL: Called SProc \"" + sProcName + "\"");
                    resolve(results[0]);
                    // Returns an Array of 'RowDataPacket'
                });
            });
        }
        catch (error) {
            console.error("ERROR - sProcMySqlQuery \'" + sProcName + "\' Promise rejected.");
            reject(error);
        }
    });
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
        dynamoDB.get(params, function(err, data) {
            if (err) { 
                console.error("ERROR - getItemInDynamoDB \'" + tableName + "\' Promise rejected.")
                reject(err); 
            }
            else {
                console.log("Dynamo DB: Get Item \'" + key + "\' from Table \"" + tableName + "\"");
                resolve(data['Item']); 
            }
        });
    });
}

// Returns a Promise
function updateItemInDynamoDB(tableName, partitionName, key, updateExp, expAttNames, expAttValues) {
    var params = {
        TableName: tableName,
        Key: {
            [partitionName]: key
        },
        UpdateExpression: updateExp,
        ExpressionAttributeNames: expAttNames,
        ExpressionAttributeValues: expAttValues
    };
    if (PUT_INTO_DYNAMO) {
        return new Promise(function(resolve, reject) {
            dynamoDB.update(params, function(err, data) {
                if (err) {
                    console.error("ERROR - updateItemInDynamoDB \'" + tableName + "\' Promise rejected.")
                    reject(err); 
                }
                else {
                    console.log("Dynamo DB: Update Item \'" + key + "\' in Table \"" + tableName + "\"");
                    resolve(data);
                }
            });
        });
    }
}