// Modularize the DynamoDB functions
module.exports = {
    getItem: getItemInDynamoDB,
    updateItem: updateItemInDynamoDB,
    doesItemExist: doesItemExistInDynamoDB,
    putItem: putItemInDynamoDB,
    scanTable: scanTableLoopInDynamoDB,
}

/*  Declaring AWS npm modules */
var AWS = require('aws-sdk'); // Interfacing with DynamoDB
/*  Configurations of npm modules */
AWS.config.update({ region: 'us-east-2' });
var dynamoDB = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' });

/*  Put 'false' to test without affecting the databases. */
const PUT_INTO_DYNAMO = true;       // 'true' when comfortable to push into DynamoDB
/*  Put 'false' to not debug. */
const DEBUG_DYNAMO = false;

// DETAILED FUNCTION DESCRIPTION XD
function getItemInDynamoDB(tableName, partitionName, itemName) {
    var params = {
        TableName: tableName,
        Key: {
            [partitionName]: itemName
        }
    };
    return new Promise(function(resolve, reject) {
        try {
            dynamoDB.get(params, function(err, data) {
                if (err) {
                    reject(err);
                }
                else {
                    console.log("Dynamo DB: Get Item \'" + itemName + "\' from Table \"" + tableName + "\"");
                    resolve(data['Item']);
                }
            });
        }
        catch (error) {
            console.error("ERROR - getItemInDynamoDB \'" + tableName + "\' Promise rejected with Item \'" + itemName + "\'.")
            reject(error);
        }
    });
}

// DETAILED FUNCTION DESCRIPTION XD
function doesItemExistInDynamoDB(tableName, partitionName, itemName) {
    var params = {
        TableName: tableName,
        Key: {
            [partitionName]: itemName
        },
        AttributesToGet: [partitionName],
    };
    return new Promise(function(resolve, reject) {
        try {
            dynamoDB.get(params, function(err, data) {
                if (err) {
                    reject(err);
                }
                else {
                    resolve('Item' in data);
                }
            });
        }
        catch (error) {
            console.error("ERROR - doesItemExistInDynamoDB \'" + tableName + "\' Promise rejected with Item \'" + itemName + "\'.");
            reject(error);
        }
    });
}

// DETAILED FUNCTION DESCRIPTION XD
function putItemInDynamoDB(tableName, items, itemName) {
    if (PUT_INTO_DYNAMO) {
        var params = {
            TableName: tableName,
            Item: items
        };
        return new Promise(function(resolve, reject) {
            dynamoDB.put(params, function(err, data) {
                if (err) {
                    console.error("ERROR - putItemInDynamoDB \'" + tableName + "\' Promise rejected with Item \'" + itemName + "\'.");
                    reject(err);
                }
                else {
                    console.log("Dynamo DB: Put Item \'" + itemName + "\' into \"" + tableName + "\" Table!");
                    resolve(data);
                }
            });
        });
    }
    else {
        // debugging
        if (DEBUG_DYNAMO) { console.log("DynamoDB Table", "\'" + tableName + "\'"); console.log(JSON.stringify(items)); }
    }
}

// DETAILED FUNCTION DESCRIPTION XD
function updateItemInDynamoDB(tableName, partitionName, itemName, updateExp, expAttNames, expAttValues) {
    var params = {
        TableName: tableName,
        Key: {
            [partitionName]: itemName
        },
        UpdateExpression: updateExp,
        ExpressionAttributeNames: expAttNames,
        ExpressionAttributeValues: expAttValues
    };
    if (PUT_INTO_DYNAMO) {
        return new Promise(function(resolve, reject) {
            dynamoDB.update(params, function(err, data) {
                if (err) {
                    console.error("ERROR - updateItemInDynamoDB \'" + tableName + "\' Promise rejected with Item \'" + itemName + "\' and key(s) \"" + Object.values(expAttNames) + "\".")
                    reject(err); 
                }
                else {
                    console.log("Dynamo DB: Update Item \'" + itemName + "\' in Table \"" + tableName + "\" with key(s) \"" + Object.values(expAttNames) + "\"");
                    resolve(data);
                }
            });
        });
    }
}

// DETAILED FUNCTION DESCRIPTION XD
// https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB/DocumentClient.html#scan-property
// https://stackoverflow.com/questions/44589967/how-to-fetch-scan-all-items-from-aws-dynamodb-using-node-js
function scanTableLoopInDynamoDB(tableName) {
    const params = {
        TableName: tableName
    };
    return new Promise(async function(resolve, reject) {
        try {
            let scanResults = [];
            let data;
            do{
                data = await dynamoDB.scan(params).promise();
                data.Items.forEach((item) => scanResults.push(item));
                params.ExclusiveStartKey  = data.LastEvaluatedKey;
                console.log("Dynamo DB: Scan operation on Table '" + tableName + "' LastEvaluatedKey: '" + data.LastEvaluatedKey + "'");
            }while(typeof data.LastEvaluatedKey != "undefined");
            resolve(scanResults);
        }
        catch (err) {
            reject(err);
        }
    });
}