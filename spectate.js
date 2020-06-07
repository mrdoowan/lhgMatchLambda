/* 
    AWS LAMBDA FUNCTION 4: Insert a Summoner Name and return its current game
    Will also load into Match['Setup'] as well
*/

/*  Declaring npm modules */
const { Kayn, REGIONS, BasicJSCache, METHOD_NAMES } = require('kayn');
require('dotenv').config();

/*  Configurations of npm modules */
const kaynCache = new BasicJSCache();
const kayn = Kayn(process.env.RIOT_API_KEY)({
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
            byMethod: {
                [METHOD_NAMES.SPECTATOR.GET_CURRENT_GAME_INFO_BY_SUMMONER_V4]: 1000 * 60 * 20 // Cache for 20 minutes
            },
        },
    },
});

/*  Main AWS Lambda Function. We'll come back to this later */
exports.handler = async (event) => {
    
};

async function main() {
    var argvArr = process.argv.slice(2);
    if (argvArr.length > 0) {
        let summonerName = argvArr.join(' ');
        kayn.Summoner.by.name(summonerName).then((summData) => {
            let summId = summData['id'];
            kayn.CurrentGame.by.summonerID(summId).then((spectateData) => {
                let newMatchObject = {};
                newMatchObject['MatchPId'] = spectateData.gameId;
                newMatchObject['RiotMatchId'] = spectateData.gameId;
                newMatchObject['Setup'] = {};
                newMatchObject['Setup']['BlueTeam'] = {};
                newMatchObject['Setup']['RedTeam'] = {};
                let { BlueTeam } = newMatchObject['Setup'];
                let { RedTeam } = newMatchObject['Setup'];
                BlueTeam['Bans'] = [];
                BlueTeam['Players'] = [];
                RedTeam['Bans'] = [];
                RedTeam['Players'] = [];
                const { bannedChampions } = spectateData;
                for (let i = 0; i < bannedChampions.length; ++i) {
                    let bannedChamp = bannedChampions[i];
                    if (bannedChamp.teamId == 100) {
                        BlueTeam['Bans'].push(bannedChamp.championId);
                    }
                    else if (bannedChamp.teamId == 200) {
                        RedTeam['Bans'].push(bannedChamp.championId);
                    }
                }
                const { participants } = spectateData;
                for (let i = 0; i < participants.length; ++i) {
                    let player = participants[i];
                    let playerItem = {
                        'SummonerId': player.summonerId,
                        'SummonerName': player.summonerName,
                        'ChampId': player.championId,
                        'Spell1Id': player.spell1Id,
                        'Spell2Id': player.spell2Id,
                    };
                    if (player.teamId == 100) {
                        BlueTeam['Players'].push(playerItem);
                    }
                    else if (player.teamId == 200) {
                        RedTeam['Players'].push(playerItem);
                    }
                }
            });
        });
    }
    else {
        console.error("ERROR - No summoner name input in Command Line.")
    }
}

main();