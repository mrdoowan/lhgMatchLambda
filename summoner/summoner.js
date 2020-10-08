/* 
    AWS LAMBDA FUNCTION 3: Insert a Summoner Name and return its Id
*/

/*  Declaring npm modules */
const { Kayn, REGIONS, BasicJSCache } = require('kayn');
require('dotenv').config({ path: '../.env' });

/*  Configurations of npm modules */
const kaynCache = new BasicJSCache();
const kayn = Kayn(process.env.RIOT_API_KEY)({ // process.env.RIOT_API_KEY
    region: REGIONS.NORTH_AMERICA,
    apiURLPrefix: 'https://%s.api.riotgames.com',
    locale: 'en_US',
    debugOptions: {
        isEnabled: true,
        showKey: false,
    },
    requestOptions: {
        shouldRetry: true,
        numberOfRetriesBeforeAbort: 3,
        delayBeforeRetry: 1000 * 60 * 2, // 2 minutes
        burst: false,
        shouldExitOn403: true,
    },
    cacheOptions: {
        cache: kaynCache,
        timeToLives: {
            useDefault: true,
            byGroup: {
                SUMMONER: 1000 * 60 * 60 * 24 * 7 // Cache for a week
            },
            byMethod: {},
        },
    },
});

/*  Main AWS Lambda Function. We'll come back to this later */
exports.handler = async (event, context) => {
    
};

async function main() {
    var argvArr = process.argv.slice(2);
    if (argvArr.length > 0) {
        var summonerName = argvArr.join(' ');
        kayn.Summoner.by.name(summonerName).then((data) => {
            console.log(data);
        })
    }
    else {
        console.error("ERROR - No summoner name input in Command Line.")
    }
}

main();