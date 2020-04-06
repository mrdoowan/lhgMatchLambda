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

/*  Configurations of npm modules */
AWS.config.update({ region: 'us-east-2' });
var dynamoDB = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' });
const profileHashIds = new Hashids(envVars.PROFILE_HID_SALT, HID_LENGTH); // process.env.PROFILE_HID_SALT
const teamHashIds = new Hashids(envVars.TEAM_HID_SALT, HID_LENGTH); // process.env.TEAM_HID_SALT
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
    var tournamentId = inputObjects[0];

    // The below fxns can happen all asynchoronously
    //putProfileItemDynamoDb(tournamentId);
    //putTeamItemDynamoDb(tournamentId);
    //putTournamentItemDynamoDb(tournamentId);
}

main();

/*  
    ----------------------
    Database Functions
    ----------------------
*/

async function putProfileItemDynamoDb(tournamentId) {

}

async function putTeamItemDynamoDb(tournamentId) {
    
}

async function putTournamentItemDynamoDb(tournamentId) {
    
}