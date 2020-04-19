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
        putProfileItemDynamoDb(tournamentId);
        putTeamItemDynamoDb(tournamentId);
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
async function putProfileItemDynamoDb(tournamentPId) {
    try {
        var profileIdList = await sProcMySqlQuery('profilePIdsByTournamentPId', tournamentPId);
        var tournamentItem = await getItemInDynamoDB('Tournament', 'TournamentPId', tournamentPId);
        var seasonPId = tournamentItem['SeasonPId'];
        var seasonItem = await getItemInDynamoDB('Season', 'SeasonPId', seasonPId);
        for (var i = 0; i < profileIdList.length; ++i) {
            var profilePId = profileIdList[i]['profilePId'];
            var profileItem = await getItemInDynamoDB('Profile', 'ProfilePId', profilePId); // Note this is the current state in code
            // Add 'GameLog' and 'StatsLog' to the Profiles if they do not exist
            var newSeasonPIdItem = {
                'SeasonTime': seasonItem.seasonTime
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
                'GamesLoss': 0,
                'TotalKills': 0,
                'TotalDeaths': 0,
                'TotalAssists': 0,
                'TotalCreepScore': 0,
                'TotalDamage': 0,
                'TotalGold': 0,
                'TotalVisionScore': 0,
                'TotalCsAt15': 0,
                'TotalGoldAt15': 0,
                'TotalXpAt15': 0,
                'TotalCsDiff15': 0,
                'TotalGoldDiff15': 0,
                'TotalXpDiff15': 0,
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
                    TournamentType: sqlData.tourneyType,
                    DatePlayed: sqlData.datePlayed,
                    TeamHId: teamHashIds.encode(sqlData.teamPId),
                    GameWeekNumber: 0, // N/A
                    ChampionPlayed: sqlData.champId,
                    Role: sqlData.role,
                    Win: (sqlData.win == 1) ? true : false,
                    Vacated: false,
                    EnemyTeamHId: teamHashIds.encode((sqlData.side == 'blue') ? sqlData.redTeamPId : sqlData.blueTeamPId),
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
                        'SET #log.#sId.#mId = :data',
                        {
                            '#log': 'GameLog',
                            '#sId': seasonPId,
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
                profileTournamentStats['GamesLoss'] += (sqlData.win == 0) ? 1 : 0;
                profileTournamentStats['TotalKills'] += sqlData.kills;
                profileTournamentStats['TotalDeaths'] += sqlData.deaths;
                profileTournamentStats['TotalAssists'] += sqlData.assists;
                profileTournamentStats['TotalCreepScore'] += sqlData.creepScore;
                profileTournamentStats['TotalDamage'] += sqlData.damageDealt;
                profileTournamentStats['TotalGold'] += sqlData.gold;
                profileTournamentStats['TotalVisionScore'] += sqlData.visionScore;
                profileTournamentStats['TotalCsAt15'] += sqlData.csAt15;
                profileTournamentStats['TotalGoldAt15'] += sqlData.goldAt15;
                profileTournamentStats['TotalXpAt15'] += sqlData.xpAt15;
                profileTournamentStats['TotalCsDiff15'] += sqlData.csDiff15;
                profileTournamentStats['TotalGoldDiff15'] += sqlData.goldDiff15;
                profileTournamentStats['TotalXpDiff15'] += sqlData.xpDiff15;
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

async function putTeamItemDynamoDb(tournamentId) {
    try {
        var teamIdList = await sProcMySqlQuery('teamPIdsByTournamentPId', tournamentId);
        var tournamentItem = await getItemInDynamoDB('Tournament', 'TournamentPId', tournamentPId);
        var seasonPId = tournamentItem['SeasonPId'];
        var seasonItem = await getItemInDynamoDB('Season', 'SeasonPId', seasonPId);
        for (var i = 0; i < teamIdList.length; ++i) {
            var teamPId = teamIdList[i]['teamPId'];
            var teamItem = await getItemInDynamoDB('Team', 'TeamPId', teamPId ); // Note this is the current state in code
            // Add 'GameLog' into TeamItem
            var newSeasonPIdItem = {
                'SeasonTime': seasonItem.seasonTime
            }
            var newGameLogItem = {
                [seasonPId]: newSeasonPIdItem
            };
            if (!('GameLog' in teamItem)) {
                await updateItemInDynamoDB('Team', 'TeamPId', teamPId,
                    'SET #gLog = :val',
                    {
                        '#gLog': 'GameLog'
                    }, 
                    {
                        ':val': newGameLogItem
                    }
                );
                teamItem['GameLog'] = newGameLogItem;
            }
            // Check 'StatsLog' exists in TeamItem
            var newTourneyPIdItem = {}; // Nothing added here for now
            var newStatsLogItem = {
                [tournamentPId]: newTourneyPIdItem
            };
            if (!('StatsLog' in teamItem)) {
                await updateItemInDynamoDB('Team', 'TeamPId', teamPId,
                    'SET #sLog = :val',
                    { 
                        '#sLog': 'StatsLog'
                    },
                    { 
                        ':val': newStatsLogItem
                    }
                );
                teamItem['StatsLog'] = newStatsLogItem;
            }
            // Check if that TournamentPId in StatsLog
            if (!(tournamentPId in teamItem['StatsLog'])) {
                await updateItemInDynamoDB('Team', 'TeamPId', teamPId,
                    'SET #sLog.#tId = :val',
                    { 
                        '#sLog': 'GameLog', 
                        '#tId': tournamentPId
                    },
                    { 
                        ':val': newTourneyPIdItem 
                    }
                );
                teamItem['StatsLog'][tournamentPId] = newTourneyPIdItem;
            }

            // Load into TeamItem
            
        }
    }
    catch (error) {
        throw error;
    }
}

async function putTournamentItemDynamoDb(tournamentId) {
    
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
                reject(error); 
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
                    reject(error); 
                }
                else {
                    console.log("Dynamo DB: Update Item \'" + key + "\' in Table \"" + tableName + "\"");
                    resolve(data);
                }
            });
        });
    }
}