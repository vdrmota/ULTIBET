// import functions

var helpers = require('./functions.js');
var colors = require('colors/safe')
var fs = require('fs');

// load classes

var classes = require('./classes.js');
var Block = classes.Block;
var LoadBlock = classes.LoadBlock;
var LoadBlockchain = classes.LoadBlockchain;
var config = require('./config.js')

const blockchainFile = config.blockchainFile
const timeDifference = config.timeDifference

var alreadyEscrow = []

function removeEscrow (server, event)
{
    return function (element)
    {
        return !(element.server == server && element.event == event)
    }
}

module.exports = {

  // updates local state of blockchain

  read: function (blockchainFile, difficulty, interval, verbose) {

  	if (verbose)
			console.log("Loading blockchain...")

		var blockchain = fs.readFileSync(blockchainFile).toString()

		contents = JSON.parse(blockchain)

		// load blockchain from text file including the genesis block

		var newChain = new LoadBlockchain(
        difficulty, 
        interval, 
        contents.chain[0].timestamp, 
        contents.chain[0].issuer, 
        contents.chain[0].signature, 
        contents.chain[0].hash, 
        contents.chain[0].nonce
      )

		// load all already-mined blocks from text file into blockchain

		var l = contents.chain.length;

		for (var i = 1; i < l; i++) 
		{
		    newChain.oldBlock(new LoadBlock(contents.chain[i].height, contents.chain[i].timestamp, contents.chain[i].payload, contents.chain[i].issuer, contents.chain[i].signature, contents.chain[i].hash, contents.chain[i].nonce, contents.chain[i].previousHash));
		    if (verbose)	
		    	console.log("Loading block " + i + "...")
		}

		if (verbose)
			console.log(colors.green("Successfully loaded " + (l) + " blocks"))

		return newChain

  },

  // iterates through the blocks in two chains and returns any blocks that are missing in first chain
  // returns an array

  blocksDiff: function (localChain, remoteChain)
  {
  		var chain = remoteChain.chain
  		var localChainLength = localChain.chain.length
  		var newBlocks = []
  		for (var i = 1, n = chain.length; i < n; i++)
        {
        	// check all the way to the end of local chain
        	if (localChainLength > i)
        	{
	        	// check if this hash is at the same index in local chain
	        	if (chain[i].hash == localChain.chain[i].hash)
	        		continue
	        	else 
	        		newBlocks.push(chain[i])
        	}
        	else
        	{
        		newBlocks.push(chain[i])
        	}
        }
        return newBlocks
  },

  getHash: function ()
  {
      return helpers.generateHash(fs.readFileSync(blockchainFile).toString())
  },

  getCoinbase: function(player, server)
  {
		try { var chain = JSON.parse(fs.readFileSync(blockchainFile).toString()).chain } catch (err) { return 0 }

		var coinbaseAmount = 0

		for (var i = 0, n = chain.length; i < n; i++)
		{
			var block = chain[i]
			if (block.payload.type == "coinbase" && block.payload.to.indexOf(player) != -1)
				coinbaseAmount += parseFloat(block.payload.amount[block.payload.to.indexOf(player)]) // return coinbase amount
		}

		return coinbaseAmount // return coinbase amounts
  },

  getWins: function(player, server)
  {
		try { var chain = JSON.parse(fs.readFileSync(blockchainFile).toString()).chain } catch (err) { return 0 }

		var winAmount = 0

		for (var i = 0, n = chain.length; i < n; i++)
		{
			var block = chain[i]
			if (block.payload.type == "transfer" && block.payload.to.indexOf(player) != -1)
			{
				for (var j = 0, k = block.payload.to.length; j < k; j++)
				{
					if (block.payload.to[j] == player)
						winAmount += parseFloat(block.payload.amount[j])
				}
			}
		}

		return winAmount // return winning amounts
  },

  getLosses: function(player, server)
  {
		try { var chain = JSON.parse(fs.readFileSync(blockchainFile).toString()).chain } catch (err) { return 0 }

		var lossAmount = 0

		for (var i = 0, n = chain.length; i < n; i++)
		{
			var block = chain[i]
			if (block.payload.type == "escrow" && block.payload.from.indexOf(player) != -1)
			{
				for (var j = 0, k = block.payload.from.length; j < k; j++)
				{
					if (block.payload.from[j] == player)
						lossAmount += parseFloat(block.payload.amount[j])
				}
			}
		}

		return lossAmount // return loss amounts
  },

  trackEvent: function(eventid, server)
  {
		// if an escrow for this event exists
		// whose bets haven't been transferred yet for the same event
		// return true because there already exists an escrow
		// else, this is a new escrow, and return false

		try { var chain = JSON.parse(fs.readFileSync(blockchainFile).toString()).chain } catch (err) { return false }

		for (var i = 0, n = chain.length; i < n; i++)
		{
			var block = chain[i]
			var escrows = 0

			if (block.payload.type == "escrow" && block.payload.event == eventid && block.payload.server == server)
			{
				escrows += 1
			}

			if (block.payload.type == "transfer" && block.payload.event == eventid && block.payload.server == server)
			{
				escrows -= 1
			}
		}

		if (escrows > 0)
			return true
		else
			return false
  },

  findPayouts: function (eventid, team, matchid)
  {
		// iterate through blocks
		// save escrows, including wagers, players, server, and amounts
		// look for transfers
		// remove escrows that have been transferred
		// calculate amounts that should be paid and to whom
		// return transactions to be pushed

		try { var chain = JSON.parse(fs.readFileSync(blockchainFile).toString()).chain } catch (err) { return {} }
		var escrows = []
		
		for (var i = 0, n = chain.length; i < n; i++)
		{
			var block = chain[i]

			// push escrow
			if (block.payload.type == "escrow" && block.payload.event == eventid && block.payload.match == matchid)
			{
				// only push if escrow for this event and server doesn't yet exist
				if (alreadyEscrow.indexOf(block.hash) == -1)
				{
					escrows.push(
						{
							"players": block.payload.from, 
							"wagers": block.payload.wagers, 
							"amounts": block.payload.amount, 
							"server": block.payload.server,
							"event": block.payload.event
						}
					)
					alreadyEscrow.push(block.hash)
				}
			}

			// pop escrow based on server and event
			if (block.payload.type == "transfer" && block.payload.event == eventid && block.payload.match == matchid)
				escrows = escrows.filter(removeEscrow(block.payload.server, block.payload.event))

		}

		// if there are no escrows for this event, return
		if (escrows.length < 1)
			return []

		// find winners and generate transactions
		// escrows now holds all the relevant escrows to this event
		for (var i = 0, n = escrows.length; i < n; i++)
		{
			var payouts = {"from": [], "to": [], "amount": [], "event": eventid, "server": escrows[i].server, "match": matchid}
			var losers = []
			var winners = []
			
			for (var j = 0, k = escrows[i].players.length; j < k; j++)
			{
				// if player won, transfer escrow to him
				if (escrows[i].wagers[j] == team)
				{
					payouts.from.push(escrows[i].players[j])
					payouts.to.push(escrows[i].players[j])
					payouts.amount.push(escrows[i].amounts[j])
					winners.push({"player": escrows[i].players[j], "amount": escrows[i].amounts[j]})
				}
				// if player lost, transfer (his escrow)/winners to each winner
				else
				{	
					losers.push({"player": escrows[i].players[j], "amount": escrows[i].amounts[j]})
				}
			}

			// iterate through losers, adding payouts to winners
			for (var j = 0, k = losers.length; j < k; j++)
			{
				var remainingAmount = losers[j].amount
				for (var z = 0, y = winners.length; z < y; z++)
				{
					payouts.from.push(losers[j].player)
					payouts.to.push(winners[z].player)
					var deservedWin = (losers[j].amount / winners.length) > (winners[z].amount / winners.length) ? winners[z].amount / winners.length : losers[j].amount / winners.length // winner can only win as much as he bet
					payouts.amount.push(parseFloat(deservedWin))
					remainingAmount -= parseFloat(deservedWin)
				}
				// return what winners haven't deserved to loser
				payouts.from.push(losers[j].player)
				payouts.to.push(losers[j].player)
				payouts.amount.push(remainingAmount)
			}
		}

		return payouts
  },

  timeDiff: function(server, event, currentTime)
  {
		// find the block where the escrow took place
		try { var chain = JSON.parse(fs.readFileSync(blockchainFile).toString()).chain } catch (err) { return false }
		var timestamp = 0
		
		for (var i = 0, n = chain.length; i < n; i++)
		{
			var block = chain[i]

			if (block.payload.type == "escrow" && block.payload.server == server && block.payload.event == event)
				timestamp = block.timestamp
		}

		if (timestamp == 0)
			return false // couldn't find escrow: big problem

		if ((currentTime - timestamp) > timeDifference)
			return true // more than 2 mins passed
		else
			return false // less than 2 mins passed
  },

  findCoinbase: function (server, players)
  {
	try { var chain = JSON.parse(fs.readFileSync(blockchainFile).toString()).chain } catch (err) { return false }
	for (var i = 0, n = chain.length; i < n; i++)
	{
		block = chain[i]
		if (block.payload.type == "coinbase" && block.payload.server == server)
		{
			for (var j = 0, k = players.length; j < k; j++)
			{
				if (block.payload.to.indexOf(players[j]) != -1)
					return true // if a coinbase for this player on this server already exists
			}
		}
	}
	return false // if there is not yet a coinbase
  },

  getPayoutHistory: function (server, addressToUsername)
  {
	try { var chain = JSON.parse(fs.readFileSync(blockchainFile).toString()).chain } catch (err) { return [] }
	var payoutHistory = []
	for (var i = 0, n = chain.length; i < n; i++)
	{
		block = chain[i]
		if (block.payload.server == server && block.payload.type == "transfer")
		{
			_from = []
			_to = []
			block.payload.from.forEach(function(el) { _from.push(addressToUsername[el]) })
			block.payload.to.forEach(function(el) { _to.push(addressToUsername[el]) })
			if (block.payload.oracle.length > 1) // only if this is a transfer triggered by oracle
				payoutHistory.push({ "from": _from, "to": _to, "amount": block.payload.amount, "hash": block.hash, "event": block.payload.event, "minute": block.payload.oracle[0], "team": block.payload.oracle[2] })
		}
	}

	return payoutHistory
  },

  findStatement: function(public)
  {
		var balance = 0
		var history = []

		balance += module.exports.getCoinbase(public, "nothing")
		balance += module.exports.getWins(public, "nothing")
		balance -= module.exports.getLosses(public, "nothing")

		// todo: generate account history

		return [balance, history]
  }

}