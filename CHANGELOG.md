# 0.2.0
* Split into 2 separate AWS functions. 
    * match.js: Does what 0.1.0 originally did
    * overall.js: Takes in a tournamentId and updates corresponding DynamoDB tables
* Prototype finished for match.js; able to take in 1 example of matchID

# 0.1.0 
* First Github commit
* Processed Riot MatchV4 endpoint into a Match Table DynamoDb and MySQL