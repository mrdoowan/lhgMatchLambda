// Highest level execution to separate Inputs (for Tests) and comparing them to results.

// Import modules
const match = require('./match/matchProcess');
const lodash = require('lodash');
const assert = require('assert');

// Inputs
const INPUT_LIST = require('./external/matchIdList_F2020_AL_W4');
// Tests
const INPUT_TEST = require('./match/test/testUnit1_Input');
const OUTPUT_TEST = require('./match/test/testUnit1_Output');
const TESTING = true;

async function main() {
    return new Promise(async function (resolve, reject) {
        try {
            // 1) Process Input
            let matchesLoaded = 0;
            const inputObjects = (TESTING) ? INPUT_TEST : INPUT_LIST;

            // 2) Process Match Data from Riot into a DynamoDB Object
            for (let i = 0; i < inputObjects.length; ++i) {
                const eventInputObject = inputObjects[i];
                const lhgMatchDataObject = await match.convertRiotToLhgObject(eventInputObject, TESTING);
                if (lhgMatchDataObject != null) {

                    // 3) Push DynamoDB Object and into MySQL
                    if (!TESTING) {
                        await match.pushIntoDynamoDb(lhgMatchDataObject);
                        await match.pushIntoMySql(lhgMatchDataObject);
                    }
                    else {
                        if (lodash.isEqual(lhgMatchDataObject, OUTPUT_TEST)) {
                            console.log("Match Test passed!");
                        }
                        else {
                            console.log("Match Test failed. Please compare the object to output.");
                            console.log(lhgMatchDataObject);
                        }
                    }
                    matchesLoaded++;
                }
            }

            resolve(`${matchesLoaded} matches successfully loaded into Match Table.`);
        }
        catch (err) {
            console.error("ERROR thrown! Information below.");
            console.error(err);
            reject("ERROR");
        }
    })
}

main().then((response) => { console.log(response); }).catch(() => { console.error('match.js Error happened above'); });