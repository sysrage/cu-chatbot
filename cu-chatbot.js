/* Camelot Unchained XMPP bot using Node.js

To use, run `node cu-chat-bot.js`

Requires:
 - Node.js 11.x
 - node-xmpp
 - request
 - Camelot Unchained account

Optional:
 - node-pushover - Needed to send Pushover notifications.
 - node-applescript - Needed to send iMessage notifications. Requires OSX.

Much thanks to mehuge, reallifegobbo, and burfo for their help with learning Node.js.

Originally based on https://gist.github.com/powdahound/940969
*/

var sys = require('sys');
var util = require('util');
var path = require('path');
var fs = require('fs');
var request = require('request');
var xmpp = require('node-xmpp');

var cuRest = require('./cu-rest.js');
var config = require('./cu-chatbot.cfg');

// Chat command definitions
var commandChar = '!';
var chatCommands = [
{ // #### HELP COMMAND ####
    command: 'help',
    help: "The command " + commandChar + "help displays help for using the various available bot commands.\n" +
        "\nUsage: " + commandChar + "help [command]\n" +
        "\nAvailable commands: ##HELPCOMMANDS##",
    exec: function(server, room, sender, message, extras) {
        var params = getParams(this.command, message);

        if (params.length > 0) {
            for (var i = 0; i < chatCommands.length; i++) {
                if (chatCommands[i].command == params) {
                    sendReply(server, room, sender, chatCommands[i].help);
                }
            }
        } else {
            sendReply(server, room, sender, this.help);
        }
    }
},
{ // #### BOTINFO COMMAND ####
    command: 'botinfo',
    help: "The command " + commandChar + "botinfo displays information about this chatbot.\n" +
        "\n" + "Usage: " + commandChar + "botinfo", 
    exec: function(server, room, sender, message, extras) {

        sendReply(server, room, sender, "The bot is written in Node.js and is running on an OpenShift gear. Source code for the bot can be found here: https://github.com/sysrage/cu-chatbot" +
            "\n\nMuch thanks to Mehuge, reallifegobbo, burfo, and the CSE team for their help.");
    }
},
{ // #### MOTD COMMAND ####
    command: 'motd',
    help: "The command " + commandChar + "motd allows setting and viewing the MOTD for a server.\n" +
        "\nUsage: " + commandChar + "motd [server] [new MOTD]\n" +
        "\nIf [server] is specified, all actions will apply to that server. Otherwise, they will apply to the current server.",
    exec: function(server, room, sender, message, extras) {
        if (extras && extras.motdadmin) {
            var motdadmin = extras.motdadmin;
        } else {
            var motdadmin = false;
        }

        var params = getParams(this.command, message);
        if (params.length > 0 && indexOfServer(getParams(this.command, message, 0)) > -1) {
            // first parameter is a server name
            var sn = params.split(' ')[0];
            params = params.slice(sn.length + 1);
            var targetServer = config.servers[indexOfServer(sn)];
        } else {
            var targetServer = server;
        }

        if (params.length > 0) {
            // User is trying to set a new MOTD.
            if (motdadmin) {
                // User is allowed - Set new MOTD.
                fs.writeFile(targetServer.motdFile, "MOTD: " + params, function(err) {
                    if (err) {
                        return util.log("[ERROR] Unable to write to MOTD file.");
                    }
                    targetServer.motd = "MOTD: " + params;
                    sendReply(server, room, sender, "MOTD for " + targetServer.name + " set to: " + params);
                    util.log("[MOTD] New MOTD for server '" + targetServer.name + "' set by user '" + sender + "'.");
                });
            } else {
                // User is not allowed - Send error.
                sendReply(server, room, sender, "You do not have permission to set an MOTD.");
            }
        } else {
            // User requested current MOTD.
            if (room === 'pm') {
                sendPM(server, targetServer.motd.toString(), sender);
                util.log("[MOTD] MOTD sent to user '" + sender + "' on " + server.name + ".");
            } else {
                sendChat(server, targetServer.motd.toString(), room);
                util.log("[MOTD] MOTD sent to '" + server.name + '/' + room.split('@')[0] + "' per user '" + sender + "'.");
            }
        }
    }
},
{ // #### MOTDOFF COMMAND ####
    command: 'motdoff',
    help: "The command " + commandChar + "motdoff allows users to stop receiving a Message of the Day for a particular server.\n" +
        "\nUsage: " + commandChar + "motdoff [server]\n" +
        "\nIf [server] is specified, all actions will apply to that server. Otherwise, they will apply to the current server.",
    exec: function(server, room, sender, message, extras) {
        var ignoredReceiver = false;
        var params = getParams(this.command, message);
        if (params.length > 0) {
            var sn = params.split(' ')[0];
            if (indexOfServer(sn) > -1) {
                targetServer = config.servers[indexOfServer(sn)];
            } else {
                sendReply(server, room, sender, "No server exists named '" + sn + "'.");
                return;
            }
        } else {
            var targetServer = server;
        }

        targetServer.motdIgnore.forEach(function(receiver) {
            if (receiver === sender) ignoredReceiver = true;
        });

        if (! ignoredReceiver) {
            // Add user to MOTD ignore list
            targetServer.motdIgnore.push(sender);
            fs.writeFile(targetServer.nomotdFile, JSON.stringify(targetServer.motdIgnore), function(err) {
                if (err) {
                    return util.log("[ERROR] Unable to write to MOTD Ignore file.");
                }
                sendReply(server, room, sender, "User '" + sender + "' unsubscribed from " + targetServer.name + " MOTD notices.");
                util.log("[MOTD] User '" + sender + "' added to '" + targetServer.name + "' opt-out list.");
            });
        } else {
            // Tell user they already have MOTDs turned off
            sendReply(server, room, sender, "User '" + sender + "' already unsubscribed from " + targetServer.name + " MOTD notices.");
        }
    }
},
{ // #### MOTDON COMMAND ####
    command: 'motdon',
    help: "The command " + commandChar + "motdon allows users to start receiving a Message of the Day for a particular server.\n" +
        "\nUsage: " + commandChar + "motdon [server]\n" +
        "\nIf [server] is specified, all actions will apply to that server. Otherwise, they will apply to the current server.",
    exec: function(server, room, sender, message, extras) {
        var ignoredReceiver = false;
        var params = getParams(this.command, message);
        if (params.length > 0) {
            var sn = params.split(' ')[0];
            if (indexOfServer(sn) > -1) {
                targetServer = config.servers[indexOfServer(sn)];
            } else {
                sendReply(server, room, sender, "No server exists named '" + sn + "'.");
                return;
            }
        } else {
            var targetServer = server;
        }

        targetServer.motdIgnore.forEach(function(receiver) {
            if (receiver === sender) ignoredReceiver = true;
        });

        if (ignoredReceiver) {
            // Remove user from MOTD ignore list
            for (var i = 0; i < targetServer.motdIgnore.length; i++) {
                if (targetServer.motdIgnore[i] === sender) {
                    index = i;
                    break;
                }
            }
            targetServer.motdIgnore.splice(index, 1);

            fs.writeFile(targetServer.nomotdFile, JSON.stringify(targetServer.motdIgnore), function(err) {
                if (err) {
                    return util.log("[ERROR] Unable to write to MOTD Ignore file.");
                }
                sendReply(server, room, sender, "User '" + sender + "' subscribed to " + targetServer.name + " MOTD notices.");
                util.log("[MOTD] User '" + sender + "' removed from '" + targetServer.name + "' opt-out list.");
            });
        } else {
            // Tell user they already have MOTDs turned on
            sendReply(server, room, sender, "User '" + sender + "' already subscribed to " + targetServer.name + " MOTD notices.");
        }
    }
},
{ // #### CLIENTOFF COMMAND ####
    command: 'clientoff',
    help: "The command " + commandChar + "clientoff allows admins to stop the bot from connecting to a particular server.\n" +
        "\nUsage: " + commandChar + "clientoff [server]\n" +
        "\nIf [server] is specified, all actions will apply to that server. Otherwise, they will apply to the current server.",
    exec: function(server, room, sender, message, extras) {
        var params = getParams(this.command, message);
        var serverToStop = {};

        if (extras && extras.motdadmin) {
            // If user specified a server to stop, use that. Otherwise use the server the user is on.
            if (params.length > 0) {
                serverToStop.name = params;
            } else {
                serverToStop.name = server.name;
            }

            if (client[serverToStop.name]) {
                // Client is running - Stop it
                stopClient(serverToStop);
                if (serverToStop.name !== server.name) {
                    sendReply(server, room, sender, "Client for " + serverToStop.name + " has been stopped.");
                }
                util.log("[STATUS] Client for " + serverToStop.name + " stopped by user '" + sender + "'.");
            } else {
                // Client not running - Send error
                sendReply(server, room, sender, "No client is running for server '"+ serverToStop.name + "'.");
            }
        } else {
            // User is not allowed - Send error.
            sendReply(server, room, sender, "You do not have permission to stop a client.");
        }
    }
},
{ // #### CLIENTON COMMAND ####
    command: 'clienton',
    help: "The command " + commandChar + "clienton allows admins to start the bot connecting to a particular server.\n" +
        "\nUsage: " + commandChar + "clienton [server]\n" +
        "\nIf [server] is specified, all actions will apply to that server. Otherwise, they will apply to the current server.",
    exec: function(server, room, sender, message, extras) {
        var params = getParams(this.command, message);
        var serverToStart = {};

        if (extras && extras.motdadmin) {
            // Show error if server was not specified
            if (params.length < 1) {
                sendReply(server, room, sender, "You must specify a server to start.");
            } else {
                serverToStart.name = params;
                if (client[serverToStart.name]) {
                    // Client is already running - Send error
                    sendReply(server, room, sender, "A client for " + serverToStart.name + " is already running.");
                } else {
                    if (indexOfServer(serverToStart.name) < 1) {
                        // No server exists - Send error
                        sendReply(server, room, sender, "A server named '" + serverToStart.name + "' does not exist.");
                    } else {
                        startClient(config.servers[indexOfServer(serverToStart.name)]);
                        sendReply(server, room, sender, "A client for " + serverToStart.name + " has been started.");
                        util.log("[STATUS] Client for " + serverToStart.name + " started by user '" + sender + "'.");
                    }
                }
            }
        } else {
            // User is not allowed - Send error.
            sendReply(server, room, sender, "You do not have permission to start a client.");
        }
    }
},
{ // #### PLAYERS COMMAND ####
    command: 'players',
    help: "The command " + commandChar + "players displays current players on a server.\n" +
        "\nUsage: " + commandChar + "players [server]\n" +
        "\nIf [server] is specified, all actions will apply to that server. Otherwise, they will apply to the current server.",
    exec: function(server, room, sender, message, extras) {
        var params = getParams(this.command, message);
        if (params.length > 0) {
            var sn = params.split(' ')[0];
            if (indexOfServer(sn) > -1) {
                targetServer = config.servers[indexOfServer(sn)];
            } else {
                sendReply(server, room, sender, "No server exists named '" + sn + "'.");
                return;
            }
        } else {
            var targetServer = server;
        }

        targetServer.cuRest.getPlayers(function(data, error) {
            if (! error) {
                var players = data;
                var totalPlayers = players.arthurians + players.tuathaDeDanann + players.vikings;
                sendReply(server, room, sender, "There are currently " + totalPlayers + " players logged in to " + targetServer.name + ":" +
                    "\n   Arthurians: " + players.arthurians +
                    "\n   TuathaDeDanann: " + players.tuathaDeDanann +
                    "\n   Vikings: " + players.vikings);
            } else {
                sendReply(server, room, sender, "Error accessing API. Server may be down.");
            }
        });
    }
},
{ // #### SERVERS COMMAND ####
    command: 'servers',
    help: "The command " + commandChar + "servers displays currently available servers.\n" +
        "\nUsage: " + commandChar + "servers",
    exec: function(server, room, sender, message, extras) {

        server.cuRest.getServers(function(data, error) {
            if (! error) {
                var servers = [];
                var totalServers = 0;
                var serverList = "";
                for (var i = 0; i < data.length; i++) {
                    if (data[i].name !== "localhost") {
                        servers.push({name: data[i].name, host: data[i].host, playerMaximum: data[i].playerMaximum, accessLevel: data[i].accessLevel});
                        if (totalServers > 0) serverList = serverList + ", ";
                        serverList = serverList + data[i].name;
                        totalServers++;
                    }
                }
                sendReply(server, room, sender, "There are currently " + totalServers + " servers online: " + serverList);
            } else {
                sendReply(server, room, sender, "Error accessing API. Server may be down.");
            }
        });
    }
},
{ // #### EVENTS COMMAND ####
    command: 'events',
    help: "The command " + commandChar + "events displays scheduled events for a server.\n" +
        "\nUsage: " + commandChar + "events [server]\n" +
        "\nIf [server] is specified, all actions will apply to that server. Otherwise, they will apply to the current server.",
    exec: function(server, room, sender, message, extras) {
        var params = getParams(this.command, message);
        if (params.length > 0) {
            var sn = params.split(' ')[0];
            if (indexOfServer(sn) > -1) {
                targetServer = config.servers[indexOfServer(sn)];
            } else {
                sendReply(server, room, sender, "No server exists named '" + sn + "'.");
                return;
            }
        } else {
            var targetServer = server;
        }

        targetServer.cuRest.getEvents(function(data, error) {
            if (! error) {
                if (data.length < 1) {
                    sendReply(server, room, sender, "There are currently no events scheduled for " + targetServer.name + ".");
                } else {
                    data.forEach(function(e) {
                        util.log(e);
                    });
                }
            } else {
                sendReply(server, room, sender, "Error accessing API. Server may be down.");
            }
        });
    }
},
{ // #### SCORE COMMAND ####
    command: 'score',
    help: "The command " + commandChar + "score displays information for the control game running a server.\n" +
        "\nUsage: " + commandChar + "score [server]\n" +
        "\nIf [server] is specified, all actions will apply to that server. Otherwise, they will apply to the current server.",
    exec: function(server, room, sender, message, extras) {
        var params = getParams(this.command, message);
        if (params.length > 0) {
            var sn = params.split(' ')[0];
            if (indexOfServer(sn) > -1) {
                targetServer = config.servers[indexOfServer(sn)];
            } else {
                sendReply(server, room, sender, "No server exists named '" + sn + "'.");
                return;
            }
        } else {
            var targetServer = server;
        }

        targetServer.cuRest.getControlGame(null, function(data, error) {
            if (! error) {
                var artScore = data.arthurianScore;
                var tuaScore = data.tuathaDeDanannScore;
                var vikScore = data.vikingScore;
                var timeLeft = data.timeLeft;
                var minLeft = Math.floor(timeLeft / 60);
                var secLeft = Math.floor(timeLeft % 60);
                if (data.gameState === 1) {
                    var gameState = "Waiting For Next Round";                
                } else if (data.gameState === 2) {
                    var gameState = "Basic Game Active";                
                } else if (data.gameState === 3) {
                    var gameState = "Advanced Game Active";                
                }

                sendReply(server, room, sender, "There is currently " + minLeft + " minutes and " + secLeft + " seconds left in the round." +
                    "\nGame State: " + gameState +
                    "\nArthurian Score: " + artScore +
                    "\nTuathaDeDanann Score: " + tuaScore +
                    "\nViking Score: " + vikScore);
            } else {
                sendReply(server, room, sender, "Error accessing API. Server may be down.");
            }
        });
    }
},
{ // #### WINS COMMAND ####
    command: 'wins',
    help: "The command " + commandChar + "wins displays realm standings for a server.\n" +
        "\nUsage: " + commandChar + "wins [server]\n" +
        "\nIf [server] is specified, all actions will apply to that server. Otherwise, they will apply to the current server.",
    exec: function(server, room, sender, message, extras) {
        var params = getParams(this.command, message);
        if (params.length > 0) {
            var sn = params.split(' ')[0];
            if (indexOfServer(sn) > -1) {
                targetServer = config.servers[indexOfServer(sn)];
            } else {
                sendReply(server, room, sender, "No server exists named '" + sn + "'.");
                return;
            }
        } else {
            var targetServer = server;
        }

        var firstGame = gameStats[server.name].firstGame;
        var gameNumber = gameStats[server.name].gameNumber;
        var artWins = gameStats[server.name].artWins;
        var tuaWins = gameStats[server.name].tuaWins;
        var vikWins = gameStats[server.name].vikWins;

        sendReply(server, room, sender, "Out of " + gameStats[server.name].gameNumber + " games played, each realm has won as follows:" +
            "\nArthurian Wins: " + gameStats[server.name].artWins +
            "\nTuathaDeDanann Wins: " + gameStats[server.name].tuaWins +
            "\nViking Wins: " + gameStats[server.name].vikWins);
    }
},
{ // #### LEADERBOARD COMMAND ####
    command: 'leaderboard',
    help: "The command " + commandChar + "leaderboard displays players with the most kills/deaths.\n" +
        "\nUsage: " + commandChar + "leaderboard [server]\n" +
        "\nIf [server] is specified, all actions will apply to that server. Otherwise, they will apply to the current server.",
    exec: function(server, room, sender, message, extras) {
        var params = getParams(this.command, message);
        if (params.length > 0) {
            var sn = params.split(' ')[0];
            if (indexOfServer(sn) > -1) {
                targetServer = config.servers[indexOfServer(sn)];
            } else {
                sendReply(server, room, sender, "No server exists named '" + sn + "'.");
                return;
            }
        } else {
            var targetServer = server;
        }

        for (var i = 0; i < 10; i++) {
            if (! playerStats[i]) playerStats[i] = {name: 'Nobody', kills: 0, deaths: 0};
        }

        var playersSortedByKills = playerStats.concat().sort(function(a, b) { return b.kills - a.kills; });
        var playersSortedByDeaths = playerStats.concat().sort(function(a, b) { return b.deaths - a.deaths; });

        sendReply(server, room, sender, "Current Leaderbord for " + server.name + " - Kills:" +
            "\n   #1 " + playersSortedByKills[0].name + ' - ' + playersSortedByKills[0].kills +
            "\n   #2 " + playersSortedByKills[1].name + ' - ' + playersSortedByKills[1].kills +
            "\n   #3 " + playersSortedByKills[2].name + ' - ' + playersSortedByKills[2].kills +
            "\n   #4 " + playersSortedByKills[3].name + ' - ' + playersSortedByKills[3].kills +
            "\n   #5 " + playersSortedByKills[4].name + ' - ' + playersSortedByKills[4].kills +
            "\n   #6 " + playersSortedByKills[5].name + ' - ' + playersSortedByKills[5].kills +
            "\n   #7 " + playersSortedByKills[6].name + ' - ' + playersSortedByKills[6].kills +
            "\n   #8 " + playersSortedByKills[7].name + ' - ' + playersSortedByKills[7].kills +
            "\n   #9 " + playersSortedByKills[8].name + ' - ' + playersSortedByKills[8].kills +
            "\n   #10 " + playersSortedByKills[9].name + ' - ' + playersSortedByKills[9].kills);
        sendReply(server, room, sender, "Current Leaderbord for " + server.name + " - Deaths:" +
            "\n   #1 " + playersSortedByDeaths[0].name + ' - ' + playersSortedByDeaths[0].deaths +
            "\n   #2 " + playersSortedByDeaths[1].name + ' - ' + playersSortedByDeaths[1].deaths +
            "\n   #3 " + playersSortedByDeaths[2].name + ' - ' + playersSortedByDeaths[2].deaths +
            "\n   #4 " + playersSortedByDeaths[3].name + ' - ' + playersSortedByDeaths[3].deaths +
            "\n   #5 " + playersSortedByDeaths[4].name + ' - ' + playersSortedByDeaths[4].deaths +
            "\n   #6 " + playersSortedByDeaths[5].name + ' - ' + playersSortedByDeaths[5].deaths +
            "\n   #7 " + playersSortedByDeaths[6].name + ' - ' + playersSortedByDeaths[6].deaths +
            "\n   #8 " + playersSortedByDeaths[7].name + ' - ' + playersSortedByDeaths[7].deaths +
            "\n   #9 " + playersSortedByDeaths[8].name + ' - ' + playersSortedByDeaths[8].deaths +
            "\n   #10 " + playersSortedByDeaths[9].name + ' - ' + playersSortedByDeaths[9].deaths);
    }
}
];

// Add list of available commands to the output of !help
var commandList = "";
chatCommands.forEach(function(cmd) {
    if (commandList.length > 0) commandList = commandList + ", ";
    commandList = commandList + cmd.command;
});
chatCommands[0].help = chatCommands[0].help.replace("##HELPCOMMANDS##", commandList);

/*****************************************************************************/
/*****************************************************************************/

// function to check internet connectivity
function checkInternet(server, callback) {
    require('dns').lookup(server.address, function(err) {
        if (err && err.code == "ENOTFOUND") {
            callback(false);
        } else {
            callback(true);
        }
    })
}

// function to read in the saved game stats
function getGameStats(server) {
    fs.readFile(server.gameFile, function(err, data) {
        if (err && err.code === 'ENOENT') {
            gameStats[server.name] = {
                firstGame: Math.floor((new Date).getTime() / 1000),
                gameNumber: 0,
                lastStartTime: 0,
                artWins: 0,
                tuaWins: 0,
                vikWins: 0
            };

            fs.writeFile(server.gameFile, JSON.stringify(gameStats[server.name]), function(err) {
                if (err) {
                    return util.log("[ERROR] Unable to create game stats file.");
                }
                util.log("[STATUS] Game stats file did not exist. Empty file created.");
            });
        } else {
            gameStats[server.name] = JSON.parse(data);
        }
    });
}

// function to read in the MOTD file
function getMOTD(server) {
    fs.readFile(server.motdFile, function(err, data) {
        if (err && err.code === 'ENOENT') {
            fs.writeFile(server.motdFile, "MOTD: ", function(err) {
                if (err) {
                    return util.log("[ERROR] Unable to create MOTD file.");
                }
                util.log("[STATUS] MOTD file did not exist. Empty file created.");
            });
            server.motd = "MOTD: ";
        } else {
            server.motd = data;
        }
    });
}

// function to read in the MOTD ignore list
function getMOTDIgnore(server) {
    fs.readFile(server.nomotdFile, function(err, data) {
        if (err && err.code === 'ENOENT') {
            server.motdIgnore = [];
            fs.writeFile(server.nomotdFile, JSON.stringify(server.motdIgnore), function(err) {
                if (err) {
                    return util.log("[ERROR] Unable to create MOTD Ignore file.");
                }
                util.log("[STATUS] MOTD Ignore file did not exist. Empty file created.");
            });
        } else {
            server.motdIgnore = JSON.parse(data);
        }
    });
}

// function to get parameters from a message
function getParams(command, message, index) {
    re = new RegExp('^' + commandChar + command +'[\ ]*', 'i');
    params = message.replace(re, '');
    if (params.length > 0) {
        if (index === undefined) {
            return params;
        } else {
            return params.split(' ')[index];
        }
    } else {
        return -1;
    }
}

// function to read in the saved player stats
function getPlayerStats(server) {
    fs.readFile(server.playerFile, function(err, data) {
        if (err && err.code === 'ENOENT') {
            playerStats[server.name] = [];

            fs.writeFile(server.playerFile, JSON.stringify(playerStats[server.name]), function(err) {
                if (err) {
                    return util.log("[ERROR] Unable to create player stats file.");
                }
                util.log("[STATUS] Player stats file did not exist. Empty file created.");
            });
        } else {
            playerStats[server.name] = JSON.parse(data);
        }
    });    
}

// function to find the index of a room
var indexOfRoom = function(server, room) {
    for (var i = 0; i < server.rooms.length; i++) {
        if (server.rooms[i].name === room) return i;
    }
    return -1;
};

// function to find the index of a server
var indexOfServer = function(server) {
    for (var i = 0; i < config.servers.length; i++) {
        if (config.servers[i].name === server) return i;
    }
    return -1;
};

// function to check if game server is up
var isGameServerUp = function(server, callback) {
    server.cuRest.getServers(function(data, error) {
        if (! error) {
            for (var i = 0; i < data.length; i++) {
                if (data[i].name.toLowerCase() === server.name.toLowerCase()) callback(true);
            }
            callback(false);
        } else {
            util.log("[ERROR] Unable to poll server list API.");
            callback(false);
        }
    });
}

// function to check if user is an MOTD admin
var isMOTDAdmin = function(name) {
    for (var i = 0; i < config.motdAdmins.length; i++) {
        if (config.motdAdmins[i] === name) return true;
    }
    return false;
};

// function to check if a message matches test keywords
var isTestMessage = function(message) {
    for (var i = 0; i < config.testKeywords.length; i++) {
        re = new RegExp(config.testKeywords[i], 'i');
        if (message.search(re) != -1) return true;
    }
    return false;
};

function random(howMany) {
    chars = "abcdefghijklmnopqrstuwxyzABCDEFGHIJKLMNOPQRSTUWXYZ0123456789";
    var rnd = require('crypto').randomBytes(howMany)
        , value = new Array(howMany)
        , len = chars.length;

    for (var i = 0; i < howMany; i++) {
        value[i] = chars[rnd[i] % len]
    };

    return value.join('');
}

// function to send a message to a group chat
function sendChat(server, message, room) {
    client[server.name].xmpp.send(new xmpp.Element('message', { to: room + '/' + server.nickname, type: 'groupchat' }).c('body').t(message));
}

// function to send iMessage notification
function sendiMessage(user, message) {
    var applescript = require('applescript');
    applescript.execFile('imessage.applescript', ['imessage.applescript', user, message], function(err, rtn) {
        if (err) {
            util.log("[ERROR] Error sending iMessage: " + err);
        }
    });
}

// function to send a private message
function sendPM(server, message, user) {
    client[server.name].xmpp.send(new xmpp.Element('message', { to: user, type: 'chat' }).c('body').t(message));
}

// function to send Pushover notification
function sendPushover(user, title, message) {
    var pushover = require('node-pushover');
    var push = new pushover({token: config.poAppToken});
    push.send(user, title, message);
}

// function to send a reply message
function sendReply(server, room, sender, message) {
    if (room === 'pm') {
        sendPM(server, message, sender);
    } else {
        sendChat(server, message, room);
    }
}

// function to send SMS notification
function sendSMS(phone, message) {
    var url = "http://textbelt.com/text?number=" + phone + "&message=" + message;
    var req = {
        headers: {'content-type' : 'application/x-www-form-urlencoded'},
        url: 'http://textbelt.com/text',
        body: 'number=' + phone + '&message=' + message
    };
    request.post(req, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            if (! JSON.parse(body).success) {
                util.log("[ERROR] Error sending SMS: " + JSON.parse(body).message);
            }
        }
    });
}

// function to send a notification to "ALL"
function sendToAll(message) {
    config.poReceiversAll.forEach(function(poID) {
        sendPushover(poID, "[CSE IT]", message);
    });
    config.imsgReceiversAll.forEach(function(imsgID) {
        sendiMessage(imsgID, "[CSE IT] " + message);
    });
}

// function to send a notification to "MIN"
function sendToMin(message) {
    config.poReceiversMin.forEach(function(poID) {
        sendPushover(poID, "[CSE IT]", message);
    });
    config.smsReceiversMin.forEach(function(smsNumber) {
        sendSMS(smsNumber, "<CSE IT> " + message);
    });
    config.imsgReceiversMin.forEach(function(imsgID) {
        sendiMessage(imsgID, "[CSE IT] " + message);
    });
}

// Timer to verify client is still connected
var timerConnected = function(server) { return setInterval(function() { checkLastStanza(server); }, 1000); };
function checkLastStanza(server) {
    var epochTime = Math.floor((new Date).getTime() / 1000);
    if (epochTime - server.lastStanza > 65) {
        util.log("[ERROR] No stanza for 65 seconds on " + server.name + ". Reconnecting...");
        server.lastStanza = epochTime;
        stopClient(server);
        startClient(server);
    }
}

// Time to monitor control game.
var timerControlGame = function(server) { return setInterval(function() {controlGame(server); }, 1000); };
function controlGame(server) {
    // Check to make sure game server is up. If not, skip this iteration of the timer.
    isGameServerUp(server, function(up) {
        if (! up) {
            client[server.name].currentGame = {ended: true};
            return;
        } else {
            // Poll API for latest control game data.
            server.cuRest.getControlGame(null, function(cgData, cgError) {
                if (! cgError) {
                    server.cuRest.getPlayers(function(pData, pError) {
                        if (! pError) {
                            var epochTime = Math.floor((new Date).getTime() / 1000);
                            var artScore = cgData.arthurianScore;
                            var tuaScore = cgData.tuathaDeDanannScore;
                            var vikScore = cgData.vikingScore;
                            var timeLeft = cgData.timeLeft;
                            var minLeft = Math.floor(timeLeft / 60);
                            var secLeft = Math.floor(timeLeft % 60);
                            var gameState = cgData.gameState; // 1 = Over / 2 = Basic Game / 3 = Advanced Game

                            var artCount = pData.arthurians;
                            var tuaCount = pData.tuathaDeDanann;
                            var vikCount = pData.vikings;
                            var totalPlayers = pData.arthurians + pData.tuathaDeDanann + pData.vikings;

                            if (! client[server.name].currentGame) {
                                // Bot was just started, do some initialization
                                client[server.name].currentGame = {
                                    startTime: 0,
                                    ended: false,
                                    artScore: artScore,
                                    tuaScore: tuaScore,
                                    vikScore: vikScore,
                                    killCount: [],
                                    deathCount: []
                                };

                                if (gameState === 2 || gameState === 3) {
                                    client[server.name].currentGame.startTime = epochTime - timeLeft;
                                    if (epochTime - gameStats[server.name].lastStartTime > server.roundTime) gameStats[server.name].gameNumber++;
                                } else {
                                    client[server.name].currentGame.ended = true;
                                }

                                client[server.name].lastBegTime = epochTime;
                            }

                            if ((gameState === 1) && ! client[server.name].currentGame.ended) {
                                // Game we were monitoring has ended. Save stats.
                                if (artScore === tuaScore && artScore === vikScore) {
                                    // Three way tie
                                    gameStats[server.name].artWins++;
                                    gameStats[server.name].tuaWins++;
                                    gameStats[server.name].vikWins++;
                                } else if (artScore === tuaScore && artScore > vikScore) {
                                    // Arthurians and TDD tie
                                    gameStats[server.name].artWins++;
                                    gameStats[server.name].tuaWins++;
                                } else if (artScore === vikScore && artScore > tuaScore) {
                                    // Arthurians and Vikings tie
                                    gameStats[server.name].artWins++;
                                    gameStats[server.name].vikWins++;
                                } else if (tuaScore === vikScore && tuaScore > artScore) {
                                    // TDD and Vikings tie
                                    gameStats[server.name].tuaWins++;
                                    gameStats[server.name].vikWins++;
                                } else {
                                    if (artScore > tuaScore) {
                                        if (artScore > vikScore) {
                                            // Arthurians win
                                            gameStats[server.name].artWins++;
                                        } else {
                                            // Vikings win
                                            gameStats[server.name].vikWins++;
                                        }
                                    } else {
                                        if (tuaScore > vikScore) {
                                            // TDD win
                                            gameStats[server.name].tuaWins++;
                                        } else {
                                            // Vikings win
                                            gameStats[server.name].vikWins++;
                                        }
                                    }
                                }

                                gameStats[server.name].lastStartTime = client[server.name].currentGame.startTime;

                                // Write gameStats to disk
                                fs.writeFile(server.gameFile, JSON.stringify(gameStats[server.name]), function(err) {
                                    if (err) {
                                        return util.log("[ERROR] Unable to write to game stats file.");
                                    }
                                });

                                // Write playerStats to disk
                                client[server.name].currentGame.killCount.forEach(function(killCountEntry) {
                                    // Parse each killCount entry
                                    var existingPlayer = false;
                                    for (var i = 0; i < playerStats[server.name].length; i++) {
                                        if (playerStats[server.name][i].name === killCountEntry.playerName) {
                                            playerStats[server.name][i].kills += killCountEntry.kills;
                                            playerStats[server.name][i].gamesPlayed++;
                                            existingPlayer = true;
                                        }
                                    }
                                    if (! existingPlayer) playerStats[server.name].push({playerName: killCountEntry.playerName, kills: killCountEntry.kills, deaths: 0, gamesPlayed: 1});
                                });

                                client[server.name].currentGame.killCount.forEach(function(deathCountEntry) {
                                    // Parse each deathCount entry
                                    var existingPlayer = false;
                                    for (var i = 0; i < playerStats[server.name].length; i++) {
                                        if (playerStats[server.name][i].name === deathCountEntry.playerName) {
                                            playerStats[server.name][i].deaths += deathCountEntry.deaths;
                                            var onlyDied = true;
                                            client[server.name].currentGame.killCount.forEach(function(killCountEntry) {
                                                if (killCountEntry.playerName === deathCountEntry.playerName) onlyDied = false;
                                            });
                                            if (onlyDied) playerStats[server.name][i].gamesPlayed++;
                                            existingPlayer = true;
                                        }
                                    }
                                    if (! existingPlayer) playerStats[server.name].push({playerName: deathCountEntry.playerName, kills: 0, deaths: deathCountEntry.deaths, gamesPlayed: 1});
                                });

                                fs.writeFile(server.playerFile, JSON.stringify(playerStats[server.name]), function(err) {
                                    if (err) {
                                        return util.log("[ERROR] Unable to write to player stats file.");
                                    }
                                });

                                client[server.name].currentGame.ended = true;
                                util.log("[GAME] A round has ended on " + server.name + ". Game and player statistics saved.");
                            }

                            if ((gameState === 2 || gameState === 3) && client[server.name].currentGame.ended) {
                                // New game has started
                                client[server.name].currentGame = {
                                    startTime: epochTime - timeLeft,
                                    ended: false,
                                    artScore: artScore,
                                    tuaScore: tuaScore,
                                    vikScore: vikScore,
                                    killCount: [],
                                    deathCount: []
                                }

                                // increase game counter
                                gameStats[server.name].gameNumber++;
                                util.log("[GAME] A new round (" + gameStats[server.name].gameNumber + ") has started on " + server.name);
                            }

                            // Beg for users to join the game.
                            // if ((gameState === 1) && ((epochTime - gameStats[server.name].lastStartTime) > 3600) && ((epochTime - client[server.name].lastBegTime) > 3600) && (totalPlayers > 0)) {
                            //     // Game hasn't started for over an hour, we haven't sent a beg notice for an hour, and at least 1 player is in game
                            //     server.rooms.forEach(function(r) {
                            //         if (r.announce === true) {
                            //             sendChat(server, "Players are waiting for a new round to begin on " + server.name + ". Join the battle!", r.name + "@" + server.service + "." + server.address);
                            //         }
                            //     });
                            //     client[server.name].lastBegTime = epochTime;
                            // }
                        }
                    });
                } else {
                    // Unable to pull API data. Server is likely down.
                    var gameState = -1;
                    util.log("[ERROR] Server is up but controlgame API is not responding.");
                }
            });
        }
    });
}

// Timer to send MOTD messages to joining users.
var timerMOTD = function(server) { return setInterval(function() { sendMOTD(server); }, 500); };
function sendMOTD(server) {
    // sendChat(server, "0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789", "agotest@conference.chat.camelotunchained.com");

    server.motdReceivers.forEach(function(receiver) {
        var epochTime = Math.floor((new Date).getTime() / 1000);
        if ((epochTime - receiver.joinTime > 2) && receiver.sendTime === 0) {
            // User joined 2 seconds ago, send the MOTD.
            receiver.sendTime = epochTime;
            var user = receiver.name + '@' + server.address;
            sendPM(server, server.motd.toString(), user);
            util.log("[MOTD] MOTD sent to user '" + receiver.name + "' on " + server.name + ".");
        } else if ((receiver.sendTime > 0) && (epochTime - receiver.sendTime > 300)) {
            // User was sent MOTD 5 minutes ago, remove from receiver list so they can get it again.
            for (var i = 0; i < server.motdReceivers.length; i++) {
                if (server.motdReceivers[i].name === receiver.name) {
                    index = i;
                    break;
                }
            }
            server.motdReceivers.splice(index, 1);
        }
    });
}

// function to start a new client for a particular server
function startClient(server) {
    // Verify internet connectivity or node-xmpp will barf
    checkInternet(server, function(isConnected) {
        if (! isConnected) {
            util.log("[ERROR] No network connectivity. Retrying in 2 seconds...");
            setTimeout(function() { startClient(server); }, 2000);
            return;
        } else {
            // Server initialization
            getMOTD(server);
            getMOTDIgnore(server);
            getGameStats(server);
            getPlayerStats(server);
            server.motdReceivers = [];

            // Connect to XMPP servers
            client[server.name] = {
                xmpp: new xmpp.Client({
                    jid: server.username + '/bot-' + random(6),
                    password: server.password,
                    reconnect: true
                })
            };

            client[server.name].connected = false;

            // client[server.name].xmpp.connection.socket.setTimeout(0);
            // client[server.name].xmpp.connection.socket.setKeepAlive(true, 10000);

            // Handle client errors
            client[server.name].xmpp.on('error', function(err) {
                if (err.code === "EADDRNOTAVAIL" || err.code === "ENOTFOUND") {
                    util.log("[ERROR] No internet connection available.");
                } else if (err.code === "ETIMEDOUT") {
                    util.log("[ERROR] Connection timed out (" + server.name + ").")
                } else {
                    util.log("[ERROR] Unknown " + err);
                }
            });

            // Handle disconnect
            client[server.name].xmpp.on('disconnect', function() {
                server.rooms.forEach(function(room) {
                    room.joined = false;
                });
                client[server.name].connected = false;
                util.log("[STATUS] Client disconnected from " + server.name + ". Reconnecting...");
            });

            // Once connected, set available presence and join rooms
            client[server.name].xmpp.on('online', function() {
                util.log("[STATUS] Client connected to " + server.name + ".");
                client[server.name].connected = true;

                // Set ourselves as online
                client[server.name].xmpp.send(new xmpp.Element('presence', { type: 'available' }).c('show').t('chat'));

                // Join rooms (and request no chat history)
                server.rooms.forEach(function(room) {
                    var roomJID = room.name + '@' + server.service + '.' + server.address;
                    client[server.name].xmpp.send(new xmpp.Element('presence', { to: roomJID + '/' + server.nickname }).
                        c('x', { xmlns: 'http://jabber.org/protocol/muc' })
                    );
                    util.log("[STATUS] Client joined '" + room.name + "' on " + server.name + ".");
                });

                // Start sending MOTDs
                client[server.name].motdTimer = timerMOTD(server);

                // Start verifying connectivity
                server.lastStanza = Math.floor((new Date).getTime() / 1000);
                client[server.name].connTimer = timerConnected(server);

                // Start watching Control Game
                client[server.name].gameTimer = timerControlGame(server);
            });

            // Parse each stanza from the XMPP server
            client[server.name].xmpp.on('stanza', function(stanza) {

                 // util.log('***** ' + stanza + ' *****');

                // Store time of last received stanza for checking connection status
                server.lastStanza = Math.floor((new Date).getTime() / 1000);

                // Always log error stanzas
                if (stanza.attrs.type === 'error') {
                    util.log("[ERROR] " + stanza);
                    return;
                }
             
                if (stanza.is('presence')) {
/*****************************************************************************/
// Handle channel joins/parts
/*****************************************************************************/
                    if (stanza.getChild('x') !== undefined) {
                        var status = stanza.getChild('x').getChild('status');
                        var role = stanza.getChild('x').getChild('item').attrs.role;
                        var sender = stanza.attrs.from;
                        var senderName = stanza.attrs.from.split('/')[1];
                        var room = stanza.attrs.from.split('@')[0];
                        var roomIndex = indexOfRoom(server, room);

                        if (server.rooms[roomIndex].joined && server.rooms[roomIndex].motd && role !== 'none') {
                            // Check to see if user is already on list to receive the MOTD.
                            var existingReceiver = false;
                            server.motdReceivers.forEach(function(receiver) {
                                if (receiver.name == senderName) existingReceiver = true;
                            });

                            // Check to see if user is on the ignore list.
                            var ignoredReceiver = false;
                            server.motdIgnore.forEach(function(receiver) {
                                if (receiver == senderName) ignoredReceiver = true;
                            });

                            // If new user and not on ignore list, add to MOTD receiver list.
                            if (! existingReceiver && ! ignoredReceiver) {
                                server.motdReceivers.push({ name: senderName, joinTime: Math.floor((new Date).getTime() / 1000), sendTime: 0 });
                            }
                            util.log("[STATUS] User '" + senderName + "' joined '" + room + "' on " + server.name + ".");
                        }

                        // Status code 110 means initial nicklist on room join is complete
                        if (status == "<status code=\"110\"/>") {
                            server.rooms[roomIndex].joined = true;
                        }
                    }
                } else if (stanza.is('message') && stanza.attrs.type === 'groupchat') {
/*****************************************************************************/
// Handle group chat messages
/*****************************************************************************/
                    var body = stanza.getChild('body');
                    // message without body is probably a topic change
                    if (! body) {
                        return;
                    }

                    var message = body.getText();
                    var sender = stanza.attrs.from.split('/')[1];
                    var senderName = sender.split('@')[0];
                    var room = stanza.attrs.from.split('/')[0];
                    var roomName = room.split('@')[0];
                    if (stanza.getChild('cseflags')) {
                        var cse = stanza.getChild('cseflags').attrs.cse;
                    }
                    var roomIsMonitored = server.rooms[indexOfRoom(server, roomName)].monitor;

                    if (cse === "cse" || isMOTDAdmin(senderName)) {
                        motdadmin = true;
                    } else motdadmin = false;

                    // If message matches a defined command, run it
                    if (message[0] === commandChar) {
                        var userCommand = message.split(' ')[0].split(commandChar)[1].toLowerCase();
                        chatCommands.forEach(function(cmd) {
                            if (userCommand === cmd.command.toLowerCase()) {
                                cmd.exec(server, room, sender, message, {motdadmin: motdadmin});
                            }
                        });
                    } else if (cse === "cse" && roomIsMonitored) {
                        // Message is from CSE staff in a monitored room and isn't a command
                        sendToAll(senderName + "@" + roomName + ": " + message);
                        util.log("[CHAT] Message from " + senderName + "@" + roomName + " sent to users. (ALL)");

                        if (isTestMessage(message)) {
                            // Message is a test alert from CSE staff
                            sendToMin(senderName + "@" + roomName + ": " + message);
                            util.log("[CHAT] Message from " + senderName + "@" + roomName + " sent to users. (MIN)");
                        }
                    } else if (stanza.attrs.from === server.combatBot) {
                        // Message is kill spam
                        var killerName = message.match(/^(.*) killed (.*)\.$/)[1];
                        var killedName = message.match(/^(.*) killed (.*)\.$/)[2];

                        if (killerName !== killedName) {
                            // Update killCount list
                            var existingPlayer = false;
                            for (var i = 0; i < client[server.name].currentGame.killCount; i++) {
                                if (client[server.name].currentGame.killCount[i].playerName === killerName) {
                                    client[server.name].currentGame.killCount[i].kills++;
                                    existingPlayer = true;
                                }
                            }
                            if (! existingPlayer) client[server.name].currentGame.killCount.push({playerName: killerName, kills: 1});

                            // Update deathCount list
                            var existingPlayer = false;
                            for (var i = 0; i < client[server.name].currentGame.deathCount; i++) {
                                if (client[server.name].currentGame.deathCount[i].playerName === killedName) {
                                    client[server.name].currentGame.deathCount[i].deaths++;
                                    existingPlayer = true;
                                }
                            }
                            if (! existingPlayer) client[server.name].currentGame.deathCount.push({playerName: killedName, deaths: 1});
                        }
                    }
                } else if (stanza.is('message') && stanza.attrs.type === 'chat') {
/*****************************************************************************/
// Handle private messages
/*****************************************************************************/
                    var body = stanza.getChild('body');
                    // message without body is probably a topic change
                    if (! body) {
                        return;
                    }

                    var message = body.getText();
                    var sender = stanza.attrs.from;
                    var senderName = sender.split('@')[0];
                    if (stanza.getChild('cseflags')) {
                        var cse = stanza.getChild('cseflags').attrs.cse;
                    }

                    // If message is a server warning, send it out
                    if (sender === server.address + "/Warning") {
                        sendToAll("ADMIN NOTICE (" + server.name + "): " + message);
                        util.log("[CHAT] Server warning message sent to users. (ALL)");
                    }

                    if (cse === "cse" || isMOTDAdmin(senderName)) {
                        motdadmin = true;
                    } else motdadmin = false;

                    // If message matches a defined command, run it
                    if (message[0] === commandChar) {
                        var userCommand = message.split(' ')[0].split(commandChar)[1];
                        chatCommands.forEach(function(cmd) {
                            if (userCommand === cmd.command) {
                                cmd.exec(server, 'pm', sender, message, {motdadmin: motdadmin});
                            }
                        });
                    }
                } else {
/*****************************************************************************/
// Ignore everything else
/*****************************************************************************/
                    return;
                }
            });
        }
    });
}

// function to stop a client for a particular server
function stopClient(server) {
    client[server.name].xmpp.connection.reconnect = false;
    // client[server.name].xmpp.removeAllListeners('error');
    client[server.name].xmpp.removeAllListeners('disconnect');
    client[server.name].xmpp.removeAllListeners('online');
    client[server.name].xmpp.removeAllListeners('stanza');
    client[server.name].xmpp.end();
    client[server.name].xmpp = undefined;
    clearInterval(client[server.name].motdTimer);
    clearInterval(client[server.name].connTimer);
    clearInterval(client[server.name].gameTimer);
    client[server.name] = undefined;
    gameStats[server.name] = undefined;
    playerStats[server.name] = undefined;
}

// Initial startup
var client = [];
var gameStats = [];
var playerStats = [];
config.servers.forEach(function(server) {
    // Connect to REST API
    server.cuRest = new cuRest({server:server.name});

    // Start XMPP client
    startClient(server);
});