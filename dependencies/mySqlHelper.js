// Modularize the MySQL functions
module.exports = {
    insertQuery: insertMySQLQuery,
    callSProc: sProcMySqlQuery,
    makeQuery: makeSqlQuery,
}

/*  Declaring MySQL npm modules */
const mysql = require('mysql'); // Interfacing with mysql DB
require('dotenv').config({ path: '../.env' });

/*  Configurations of npm modules */
const sqlPool = mysql.createPool({
    connectionLimit: 20,
    host: process.env.MYSQL_ENDPOINT,           //process.env.MYSQL_ENDPOINT
    user: process.env.MYSQL_USER,               //process.env.MYSQL_USER
    password: process.env.MYSQL_PASSWORD,       //process.env.MYSQL_PASSWORD
    port: process.env.MYSQL_PORT,               //process.env.MYSQL_PORT
    database: process.env.MYSQL_DATABASE_STATS, //process.env.MYSQL_DATABASE_STATS
});

/*  Put 'false' to test without affecting the databases. */
const INSERT_INTO_MYSQL = true;     // 'true' when comfortable to push into MySQL
/*  Put 'false' to not debug. */
const DEBUG_MYSQL = false;

/**
 * MySQL Insert query
 * @param {object} queryObject  Each key is the "Column Name" for its values
 * @param {string} tableName    Table name in MySQL
 */
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
                    if (err) { reject(err); return; }
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

/**
 * Call Stored Procedure from MySQL
 * @param {string} sProcName 
 */
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
                if (err) { reject(err); return; }
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

/**
 * MySQL query command
 * @param {string} queryString      Generic MySQL query in string format
 */
function makeSqlQuery(queryString) {
    if (INSERT_INTO_MYSQL) {
        return new Promise(async function(resolve, reject) {
            try {
                sqlPool.getConnection(function(err, connection) {
                    if (err) { reject(err); return; }
                    connection.query(queryString, function(error, results, fields) {
                        connection.release();
                        if (error) { reject(error); }
                        console.log("MySQL: Called query command '" + queryString + "'");
                        resolve(results);
                    })
                })
            }
            catch (error) {
                console.error({
                    error: error,
                    message: "ERROR - makeQuery '" + queryString + "' Promise rejected."
                });
            }
        })
    }
    
}