// Modularize the MySQL functions
module.exports = {
    insertQuery: insertMySQLQuery,
    callSProc: sProcMySqlQuery
}

/* 
    Import from other files that are not committed to Github
    Contact doowan about getting a copy of these files
*/
const envVars = require('./external/env');

/*  Declaring MySQL npm modules */
const mysql = require('mysql'); // Interfacing with mysql DB
/*  Configurations of npm modules */
const sqlPool = mysql.createPool({
    connectionLimit: 10,
    host: envVars.MYSQL_ENDPOINT,           //process.env.MYSQL_ENDPOINT
    user: envVars.MYSQL_USER,               //process.env.MYSQL_USER
    password: envVars.MYSQL_PASSWORD,       //process.env.MYSQL_PASSWORD
    port: envVars.MYSQL_PORT,               //process.env.MYSQL_PORT
    database: envVars.MYSQL_DATABASE_STATS  //process.env.MYSQL_DATABASE_STATS
});

/*  Put 'false' to test without affecting the databases. */
const INSERT_INTO_MYSQL = true;     // 'true' when comfortable to push into MySQL
/*  Put 'false' to not debug. */
const DEBUG_MYSQL = false;

// DETAILED FUNCTION DESCRIPTION XD
function insertMySQLQuery(queryObject, tableName) {
    if (INSERT_INTO_MYSQL) {
        return new Promise(function(resolve, reject) {
            try {
                let queryStr = 'INSERT INTO ' + tableName + ' (';
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

// DETAILED FUNCTION DESCRIPTION XD
function sProcMySqlQuery(sProcName) {
    let argArray = arguments; // Because arguments gets replaced by the function below
    return new Promise(function(resolve, reject) {
        try {
            let queryStr = "CALL " + sProcName + "(";
            for (let i = 1; i < argArray.length; ++i) {
                let arg = argArray[i];
                arg = (typeof arg === "string") ? '\'' + arg + '\'' : arg;
                queryStr += arg + ",";
            }
            if (argArray.length > 1) {
                queryStr = queryStr.slice(0, -1); // trimEnd of last comma
            }
            queryStr += ");";

            sqlPool.getConnection(function(err, connection) {
                if (err) { reject(err); }
                connection.query(queryStr, function(error, results, fields) {
                    connection.release();
                    if (error) { reject(error); }
                    console.log("MySQL: Called SProc \"" + sProcName + "\" with params '" + Array.from(argArray).slice(1) + "'");
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