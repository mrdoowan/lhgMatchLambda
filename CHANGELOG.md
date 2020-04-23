# 0.7.0
* Added module dependencies for dynamoDB and mySql helper functions

# 0.6.0
* overall.js finished Team & Profile Tables for DynamoDB

# 0.5.0
* match.js variables at15 -> atEarly, at25 -> atMid
* overall.js update Team DynamoDB still in process

# 0.4.0
* overall.js update Profile DynamoDB completed
* match.js added csAt15, csDiff15, csAt25, csDiff25 for TeamStats

# 0.3.0
* match.js operational locally. Not yet production ready for AWS.

# 0.2.0
* Split into 2 separate AWS functions. 
    * match.js: Does what 0.1.0 originally did
    * overall.js: Takes in a tournamentId and updates corresponding DynamoDB tables
* Prototype finished for match.js; able to take in 1 example of matchID

# 0.1.0 
* First Github commit
* Processed Riot MatchV4 endpoint into a Match Table DynamoDb and MySQL