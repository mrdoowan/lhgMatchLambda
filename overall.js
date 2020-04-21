/* 
    AWS LAMBDA FUNCTION 2: Insert a tournamentId and update overall stats for Profile, Team, and Tournament
    This function affects the following:
    - DynamoDB: Tournament, Team, Profile table
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
const MINUTE_AT_EARLY = 15;
const MINUTE_AT_MID = 25;

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
        //await updateProfileItemDynamoDb(tournamentId);
        //await updateTeamItemDynamoDb(tournamentId);
        await updateTournamentItemDynamoDb(tournamentId);
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
        var profileIdsSqlList = await sProcMySqlQuery('profilePIdsByTournamentPId', tournamentPId);
        var tournamentDbObject = await getItemInDynamoDB('Tournament', 'TournamentPId', tournamentPId);
        var seasonPId = tournamentDbObject['SeasonPId'];
        var seasonDbObject = await getItemInDynamoDB('Season', 'SeasonPId', seasonPId);
        for (var i = 0; i < profileIdsSqlList.length; ++i) {
        //for (var i = 0; i < 1; ++i) {
            var profilePId = profileIdsSqlList[i]['profilePId'];
            //var profilePId = '42338541';
            var profileDbObject = await getItemInDynamoDB('Profile', 'ProfilePId', profilePId); // Note this is the current state in code
            /*  
                -------------------
                Init DynamoDB Items
                -------------------
            */
            // Check 'GameLog' exists in ProfileDbObject
            // {MAIN}/profile/<profileName>/games/<seasonShortName>
            var initSeasonPIdGames = {
                'SeasonTime': seasonDbObject.seasonTime,
                'Matches': {}
            }
            var initGameLog = {
                [seasonPId]: initSeasonPIdGames
            };
            // Check if 'GameLog' exists in Profile
            if (!('GameLog' in profileDbObject)) {
                await updateItemInDynamoDB('Profile', 'ProfilePId', profilePId,
                    'SET #gLog = :val',
                    { 
                        '#gLog': 'GameLog'
                    },
                    { 
                        ':val': initGameLog
                    }
                );
                profileDbObject['GameLog'] = initGameLog;
            }
            // Check if that season exists in the GameLogs
            else if (!(seasonPId in profileDbObject['GameLog'])) {
                await updateItemInDynamoDB('Profile', 'ProfilePId', profilePId,
                    'SET #gLog.#sId = :val',
                    { 
                        '#gLog': 'GameLog', 
                        '#sId': seasonPId
                    },
                    { 
                        ':val': initSeasonPIdGames
                    }
                );
                profileDbObject['GameLog'][seasonPId] = initSeasonPIdGames;
            }
            // Check if 'StatsLog' exists in Profile
            // {MAIN}/profile/<profileName>/stats/<seasonShortName>
            var initTourneyPIdStats = {
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
            var initStatsLog = {
                [tournamentPId]: initTourneyPIdStats
            };
            if (!('StatsLog' in profileDbObject)) {
                await updateItemInDynamoDB('Profile', 'ProfilePId', profilePId,
                    'SET #sLog = :val',
                    { 
                        '#sLog': 'StatsLog'
                    },
                    { 
                        ':val': initStatsLog
                    }
                );
                profileDbObject['StatsLog'] = initStatsLog;
            }
            // Check if that TournamentPId in StatsLog
            if (!(tournamentPId in profileDbObject['StatsLog'])) {
                await updateItemInDynamoDB('Profile', 'ProfilePId', profilePId,
                    'SET #sLog.#tId = :val',
                    { 
                        '#sLog': 'GameLog', 
                        '#tId': tournamentPId
                    },
                    { 
                        ':val': initTourneyPIdStats 
                    }
                );
                profileDbObject['StatsLog'][tournamentPId] = initTourneyPIdStats;
            }
            // Check if 'ChampsPlayed' exists in Profile
            if (!('ChampsPlayed' in profileDbObject)) {
                await updateItemInDynamoDB('Profile', 'ProfilePId', profilePId,
                    'SET #cPlayed = :val',
                    { 
                        '#cPlayed': 'ChampsPlayed'
                    },
                    { 
                        ':val': {}
                    }
                );
                profileDbObject['ChampsPlayed'] = {};
            }
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
            var matchDataList = await sProcMySqlQuery('playerStatsByTournamentPId', profilePId, tournamentPId);
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
                    tourneyProfileStatsItem['GamesPlayed']++;
                    tourneyProfileStatsItem['GamesPlayedOverEarly'] += (sqlPlayerStats.duration >= MINUTE_AT_EARLY * 60);
                    tourneyProfileStatsItem['GamesPlayedOverMid'] += (sqlPlayerStats.duration >= MINUTE_AT_MID * 60);
                    tourneyProfileStatsItem['TotalGameDuration'] += sqlPlayerStats.duration;
                    tourneyProfileStatsItem['GamesWin'] += sqlPlayerStats.win;
                    tourneyProfileStatsItem['TotalKills'] += sqlPlayerStats.kills;
                    tourneyProfileStatsItem['TotalDeaths'] += sqlPlayerStats.deaths;
                    tourneyProfileStatsItem['TotalAssists'] += sqlPlayerStats.assists;
                    tourneyProfileStatsItem['TotalCreepScore'] += sqlPlayerStats.creepScore;
                    tourneyProfileStatsItem['TotalDamage'] += sqlPlayerStats.damageDealt;
                    tourneyProfileStatsItem['TotalGold'] += sqlPlayerStats.gold;
                    tourneyProfileStatsItem['TotalVisionScore'] += sqlPlayerStats.visionScore;
                    tourneyProfileStatsItem['TotalCsAtEarly'] += sqlPlayerStats.csAtEarly;
                    tourneyProfileStatsItem['TotalGoldAtEarly'] += sqlPlayerStats.goldAtEarly;
                    tourneyProfileStatsItem['TotalXpAtEarly'] += sqlPlayerStats.xpAtEarly;
                    tourneyProfileStatsItem['TotalCsDiffEarly'] += sqlPlayerStats.csDiffEarly;
                    tourneyProfileStatsItem['TotalGoldDiffEarly'] += sqlPlayerStats.goldDiffEarly;
                    tourneyProfileStatsItem['TotalXpDiffEarly'] += sqlPlayerStats.xpDiffEarly;
                    tourneyProfileStatsItem['TotalFirstBloods'] += (sqlPlayerStats.firstBloodKill + sqlPlayerStats.firstBloodAssist);
                    tourneyProfileStatsItem['TotalFirstTowers'] += sqlPlayerStats.firstTower;
                    tourneyProfileStatsItem['TotalTeamKills'] += sqlPlayerStats.teamKills;
                    tourneyProfileStatsItem['TotalTeamDeaths'] += sqlPlayerStats.teamDeaths;
                    tourneyProfileStatsItem['TotalTeamDamage'] += sqlPlayerStats.teamDamage;
                    tourneyProfileStatsItem['TotalTeamGold'] += sqlPlayerStats.teamGold;
                    tourneyProfileStatsItem['TotalTeamVisionScore'] += sqlPlayerStats.teamVS;
                    tourneyProfileStatsItem['TotalWardsPlaced'] += sqlPlayerStats.wardsPlaced;
                    tourneyProfileStatsItem['TotalControlWardsBought'] += sqlPlayerStats.controlWardsBought;
                    tourneyProfileStatsItem['TotalWardsCleared'] += sqlPlayerStats.wardsCleared;
                    tourneyProfileStatsItem['TotalSoloKills'] += sqlPlayerStats.soloKills;
                    tourneyProfileStatsItem['TotalDoubleKills'] += sqlPlayerStats.doubleKills;
                    tourneyProfileStatsItem['TotalTripleKills'] += sqlPlayerStats.tripleKills;
                    tourneyProfileStatsItem['TotalQuadraKills'] += sqlPlayerStats.quadraKills;
                    tourneyProfileStatsItem['TotalPentaKills'] += sqlPlayerStats.pentaKills;
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
                    //gameLogProfileItem[matchPId] = profileGameItem; // Do we need to do this? It's all static
                    await updateItemInDynamoDB('Profile', 'ProfilePId', profilePId,
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
            await updateItemInDynamoDB('Profile', 'ProfilePId', profilePId,
                'SET #cPlayed = :val',
                { 
                    '#cPlayed': 'ChampsPlayed'
                },
                { 
                    ':val': champsPlayedItem
                }
            );
            await updateItemInDynamoDB('Profile', 'ProfilePId', profilePId, 
                'SET #slog.#tId = :data',
                {
                    '#slog': 'StatsLog',
                    '#tId': tournamentPId
                },
                {
                    ':data': tourneyProfileStatsItem
                }
            );
            console.log(tourneyProfileStatsItem);
        }
    }
    catch (error) {
        throw error;
    }
}

async function updateTeamItemDynamoDb(tournamentPId) {
    try {
        var teamIdsSqlList = await sProcMySqlQuery('teamPIdsByTournamentPId', tournamentPId);
        var tournamentDbObject = await getItemInDynamoDB('Tournament', 'TournamentPId', tournamentPId);
        var seasonPId = tournamentDbObject['SeasonPId'];
        var seasonDbObject = await getItemInDynamoDB('Season', 'SeasonPId', seasonPId);
        for (var i = 0; i < teamIdsSqlList.length; ++i) {
        //for (var i = 0; i < 1; ++i) {
            var teamPId = teamIdsSqlList[i]['teamPId'];
            //var teamPId = '01930253';
            var teamDbObject = await getItemInDynamoDB('Team', 'TeamPId', teamPId ); // Note this is the current state in code
            /*  
                -------------------
                Init DynamoDB Items
                -------------------
            */
            // Check 'GameLog' exists in TeamItem
            // {MAIN}/team/<teamName>/games/<seasonShortName>
            var initSeasonPIdGames = {
                'SeasonTime': seasonDbObject.seasonTime,
                'Matches': {}
            }
            var initGameLog = {
                [seasonPId]: initSeasonPIdGames
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
                        ':val': initSeasonPIdGames
                    }
                )
                teamDbObject['GameLog'][seasonPId] = initSeasonPIdGames;
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
            var tourneyTeamStatsItem = teamDbObject['StatsLog'][tournamentPId];
            var scoutingItem = teamDbObject['Scouting'][seasonPId];
            var gameLogTeamItem = teamDbObject['GameLog'][seasonPId]['Matches'];

            /*  
                -------------
                Compile Data
                -------------
            */
            // Loop through all the TeamStats in tournamentId
            var teamStatsSqlListTourney = await sProcMySqlQuery('teamStatsByTournamentPId', teamPId, tournamentPId);
            for (var j = 0; j < teamStatsSqlListTourney.length; ++j) {
                var sqlTeamStats = teamStatsSqlListTourney[j];
                var matchPId = sqlTeamStats.riotMatchId;
                if (!(matchPId in gameLogTeamItem)) {
                    // Additional sProcs from MySQL
                    var playerStatsSqlList = await sProcMySqlQuery('playerStatsByMatchIdTeamId', sqlTeamStats.riotMatchId, teamPId);
                    var bannedChampSqlList = await sProcMySqlQuery('bannedChampsByMatchId', matchPId);
                    /*  
                        -------------
                        'StatsLog'
                        -------------
                    */
                    tourneyTeamStatsItem['GamesPlayed']++;
                    tourneyTeamStatsItem['GamesPlayedOverEarly'] += (sqlTeamStats.duration >= MINUTE_AT_EARLY * 60);
                    tourneyTeamStatsItem['GamesPlayedOverMid'] += (sqlTeamStats.duration >= MINUTE_AT_MID * 60);
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
            updateItemInDynamoDB('Team', 'TeamPId', teamPId,
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

async function updateTournamentItemDynamoDb(tournamentId) {
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
                    console.log("MySQL: Called SProc \"" + sProcName + "\" with params '" + Array.from(argArr).slice(1) + "'");
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