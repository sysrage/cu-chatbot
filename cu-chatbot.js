/* Camelot Unchained XMPP bot using Node.js

To use, run `node cu-chatbot.js`

Requires:
 - Node.js 11.x
 - node-xmpp
 - request
 - bluebird*
 - Camelot Unchained account

* The bluebird module is only required when using older versions of Node.js
which don't have Promise support.

Optional:
 - node-pushover - Needed to send Pushover notifications.
 - node-applescript - Needed to send iMessage notifications. Requires OSX.
 - aws-sdk - Needed to send push notifications (SMS/email/etc.) via AWS SNS.

Much thanks to the CU Mod Squad for their help with learning Node.js.

Originally based on https://gist.github.com/powdahound/940969
*/

var sys = require('sys');
var util = require('util');
var path = require('path');
var fs = require('fs');
var moment = require('moment');
var request = require('request');
var xmpp = require('node-xmpp');

var cuRestAPI = require('./cu-rest.js');
var config = require('./cu-chatbot.cfg');

if (typeof Promise === 'undefined') Promise = require('bluebird');

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
{ // #### BACON COMMAND ####
    command: 'bacon',
    help: "The command " + commandChar + "bacon displays information about bacon.\n" +
        "\nUsage: " + commandChar + "bacon", 
    exec: function(server, room, sender, message, extras) {
        sendReply(server, room, sender, "http://ft.trillian.im/2bdaf99da85722bb4ec225c39b393404d0afcfd9/6B5pYQdHc32HYGlIrmutnpu4hDY21.jpg");
    }
},
{ // #### BLOCKS COMMAND ####
    command: 'blocks',
    help: "The command " + commandChar + "blocks displays the total number of blocks placed within CUBE.\n" +
        "\nUsage: " + commandChar + "blocks", 
    exec: function(server, room, sender, message, extras) {
        getCUBECount(function (cubeCount) {
            sendReply(server, room, sender, "Players have placed a total of " + cubeCount + " blocks within the world.");
        });
    }
},
{ // #### BOTINFO COMMAND ####
    command: 'botinfo',
    help: "The command " + commandChar + "botinfo displays information about this chatbot.\n" +
        "\nUsage: " + commandChar + "botinfo", 
    exec: function(server, room, sender, message, extras) {
        sendReply(server, room, sender, "The bot is written in Node.js and is running on an OpenShift gear. Source code for the bot can be found here: https://github.com/sysrage/cu-chatbot" +
            "\n\nMuch thanks to the CU Mod Squad for their help.");
    }
},
{ // #### CHATLOG COMMAND ####
    command: 'chatlog',
    help: "The command " + commandChar + "chatlog sends a private message with logged chat messages from a monitored room.\n" +
        "\nUsage: " + commandChar + "chatlog <parameters>\n" +
        "\nAvailable Parameters:" +
        "\n  -h <number> = Specify the number of hours to include in displayed results (maximum of " + config.chatlogLimit + ")" +
        "\n  -m <number> = Specify the number of minutes to include in displayed results (maximum of " + (config.chatlogLimit * 60) + ")" +
        "\n  -r <room> = Specify the chat room to include in displayed results" +
        "\n  -u <user> = Specify the user name to include in displayed results" +
        "\n  -t <text> = Specify the message text to include in displayed results (regular expressions allowed)",
    exec: function(server, room, sender, message, extras) {
        var curISODate = new Date().toISOString();
        var searchRoom = null;
        var searchHours = null;
        var searchMins = null;
        var searchUser = null;
        var searchText = null;

        // Parse parameters passed to command
        var params = getParams(this.command, message);
        if (params.length > 0) {
            var paramArray = params.split(' ');
            for (var i = 0; i < paramArray.length; i++) {
                switch(paramArray[i]) {
                    case '-r':
                        // verify next param is a monitored room then set room to search
                        var validRoom = false;
                        server.rooms.forEach(function(r){
                            if (r.name === paramArray[i + 1]) {
                                if (r.privateRoom) {
                                    // If privateRoom is true, only allow command from that room
                                    if (r.name === room) validRoom = true;
                                } else {
                                    validRoom = true;
                                }
                            }
                        });
                        if (validRoom) {
                            searchRoom = paramArray[i + 1];
                            i++;
                        } else {
                            sendReply(server, room, sender, "The room '" + paramArray[i + 1] + "' is not being logged.");
                            return;
                        }
                        break;
                    case '-h':
                        // verify next param is a positive integer then set hours to search
                        if (paramArray[i + 1] % 1 !== 0 || paramArray[i + 1] < 1) {
                            sendReply(server, room, sender, "The value following '-h' must be a positive number.");
                            return;
                        }
                        searchHours = parseInt(paramArray[i + 1]);
                        i++;
                        break;
                    case '-m':
                        // verify next param is a positive integer then set mins to search
                        if (paramArray[i + 1] % 1 !== 0 || paramArray[i + 1] < 1) {
                            sendReply(server, room, sender, "The value following '-m' must be a positive number.");
                            return;
                        }
                        searchMins = parseInt(paramArray[i + 1]);
                        i++;
                        break;
                    case '-u':
                        // verify next param is a word then set user to search
                        if (paramArray[i + 1].search(/^[^\-]+/) === -1) {
                            sendReply(server, room, sender, "The value following '-u' must be a user name.");
                            return;
                        }
                        searchUser = paramArray[i + 1];
                        i++;
                        break;
                    case '-t':
                        // verify next param exists, then combine all params up to next - or end
                        if (paramArray[i + 1].search(/^[^\-]+/) === -1) {
                            sendReply(server, room, sender, "The value following '-t' must be text to search for.");
                            return;
                        }
                        var sTxt = "";
                        for (var t = i + 1; t < paramArray.length; t++) {
                            if (paramArray[t].search(/^[^\-]+/) !== -1) {
                                if (sTxt.length > 0) sTxt += " ";
                                sTxt += paramArray[t];
                            } else {
                                break;
                            }
                        }
                        searchText = sTxt;
                        break;
                    default:
                        // Allow ##h and ##m for hours and minutes
                        if (paramArray[i].search(/[0-9]+[Hh]/) !== -1) searchHours = parseInt(paramArray[i]);
                        if (paramArray[i].search(/[0-9]+[Mm]/) !== -1) searchMins = parseInt(paramArray[i]);
                        if (paramArray[i].search(/[0-9]+/) !== -1) searchHours = parseInt(paramArray[i]);
                        break;
                }
            }
        } else {
            sendReply(server, room, sender, "Please specify a filter to limit the number of messages displayed. Type `" + commandChar + "help chatlog` for more information.");
            return;
        }

        if (! searchHours && ! searchMins && ! searchRoom && ! searchUser && ! searchText) {
            sendReply(server, room, sender, "Invalid parameters supplied to command. Type `" + commandChar + "help chatlog` for more information.");
            return;            
        }

        if (! searchHours && ! searchMins) searchHours = config.chatlogLimit;

        if (searchHours && searchMins) {
            searchMins += searchHours * 60;
            searchHours = null;
        }

        if (room === 'pm') {
            if (searchRoom) {
                var roomName = searchRoom;
            } else {
                sendReply(server, room, sender, "You must specify a room to search with the '-r' parameter.");
                return;
            }
        } else {
            if (searchRoom) {
                var roomName = searchRoom;
            } else {
                var roomName = room.split('@')[0];
            }
            room = 'pm';
            sender = sender + '@' + server.address;
        }

        if (! server.chatlog[roomName]) {
            sendReply(server, room, sender, "No logs are currently saved for the room '" + roomName + "'.");
            return;
        }

        var logResults = "Chat history with filter '";
        if (searchHours) logResults += "hours:" + searchHours + " ";
        if (searchMins) logResults += "mins:" + searchMins + " ";
        if (searchUser) logResults += "user:" + searchUser + " ";
        if (searchText) logResults += "text:" + searchText + " ";
        logResults += "room: " + roomName + "':";

        var matchingChat = [];
        for (var i = 0; i < server.chatlog[roomName].length; i++) {
            if (searchHours) {
                if (moment(curISODate).diff(server.chatlog[roomName][i].timestamp, "hours") < searchHours) matchingChat.push(server.chatlog[roomName][i]);
            }
            if (searchMins) {
                if (moment(curISODate).diff(server.chatlog[roomName][i].timestamp, "minutes") < searchMins) matchingChat.push(server.chatlog[roomName][i]);
            }
        }
        matchingChat.forEach(function(msg) {
            var isMatch = true;
            if (searchUser && msg.sender !== searchUser) isMatch = false;
            if (searchText && msg.message.search(new RegExp(searchText)) === -1) isMatch = false;

            if (isMatch) logResults += "\n   [" + moment(msg.timestamp).format("HH:mm") + "] <" + msg.sender + "> " + msg.message;
        });
        sendReply(server, room, sender, logResults);
    }
},
{ // #### CONFIRMED COMMAND ####
    command: 'confirmed',
    help: "The command " + commandChar + "confirmed displays information about confirmed functionality.\n" +
        "\nUsage: " + commandChar + "confirmed", 
    exec: function(server, room, sender, message, extras) {
        sendReply(server, room, sender, "http://ft.trillian.im/af0f242d455e9f185639905ece7a631f656553c6/6AZkvU0ukO6wr5Gaqil7C2hmOqy6H.gif");
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
            var sn = params.split(' ')[0].toLowerCase();
            if (indexOfServer(sn) > -1) {
                targetServer = config.servers[indexOfServer(sn)];
            } else {
                sendReply(server, room, sender, "No server exists named '" + sn + "'.");
                return;
            }
        } else {
            var targetServer = server;
        }

        sendReply(server, room, sender, "Calendar showing upcomming events: http://bit.ly/1PopbEY");

        targetServer.cuRest.getEvents().then(function(data) {
            if (data.length < 1) {
                sendReply(server, room, sender, "There are currently no events scheduled for " + targetServer.name + ".");
            } else {
                data.forEach(function(e) {
                    util.log(e);
                    // WAT??? Need CSE to add an event to know what happens here.
                });
            }
        }, function(error) {
            sendReply(server, room, sender, "Error accessing API. Server may be down.");
        });
    }
},
{ // #### FPS COMMAND ####
    command: 'fps',
    help: "The command " + commandChar + "fps displays information about increasing frame rate.\n" +
        "\nUsage: " + commandChar + "fps", 
    exec: function(server, room, sender, message, extras) {
        sendReply(server, room, sender, "If you are having issues with low FPS, please see this pinned post in the bug #4 forum on how to change your active GPU: http://bit.ly/1JmKCUR");
    }
},
{ // #### FRIAR COMMAND ####
    command: 'friar',
    help: "The command " + commandChar + "friar displays information about friars.\n" +
        "\nUsage: " + commandChar + "friar", 
    exec: function(server, room, sender, message, extras) {
        sendReply(server, room, sender, "Out of the frying pan, into the friar. It has been confirmed that there will be frying in the game." +
            "\n\nUnfortunately for Friarjon, the type of frying is still unknown. Get your Monkfish ready!");
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
            var sn = params.split(' ')[0].toLowerCase();
            if (indexOfServer(sn) > -1) {
                targetServer = config.servers[indexOfServer(sn)];
            } else {
                sendReply(server, room, sender, "No server exists named '" + sn + "'.");
                return;
            }
        } else {
            var targetServer = server;
        }

        var pStats = playerStats[targetServer.name].concat();

        // Remove bots from rankings
        for (var i = 0; i < pStats.length; i++) {
            if (['SuperFireBot','SuperWaterBot','SuperEarthBot'].indexOf(pStats[i].playerName) > -1) {
                pStats.splice(i, 1);
                i--;
            }
        }

        // Ensure at least 10 entries exist. Create dummy entries if not.
        for (var i = 0; i < 10; i++) {
            if (! pStats[i]) pStats[i] = {
                playerName: 'Nobody',
                playerFaction: 'None',
                playerRace: 'None',
                playerType: 'None',
                kills: 0,
                deaths: 0,
                gamesPlayed: 0
            };
        }

        var playersSortedByKills = pStats.concat().sort(function(a, b) { return b.kills - a.kills; });
        var playersSortedByDeaths = pStats.concat().sort(function(a, b) { return b.deaths - a.deaths; });

        sendReply(server, room, sender, "Current Leaderbord for " + targetServer.name + " - Kills:" +
            "\n   #1 " + playersSortedByKills[0].playerName + ' (' + playersSortedByKills[0].playerRace + ') - ' + playersSortedByKills[0].kills +
            "\n   #2 " + playersSortedByKills[1].playerName + ' (' + playersSortedByKills[1].playerRace + ') - ' + playersSortedByKills[1].kills +
            "\n   #3 " + playersSortedByKills[2].playerName + ' (' + playersSortedByKills[2].playerRace + ') - ' + playersSortedByKills[2].kills);
        sendReply(server, room, sender, "Current Leaderbord for " + targetServer.name + " - Deaths:" +
            "\n   #1 " + playersSortedByDeaths[0].playerName + ' (' + playersSortedByDeaths[0].playerRace + ') - ' + playersSortedByDeaths[0].deaths +
            "\n   #2 " + playersSortedByDeaths[1].playerName + ' (' + playersSortedByDeaths[1].playerRace + ') - ' + playersSortedByDeaths[1].deaths +
            "\n   #3 " + playersSortedByDeaths[2].playerName + ' (' + playersSortedByDeaths[2].playerRace + ') - ' + playersSortedByDeaths[2].deaths);
        sendReply(server, room, sender, "Top 10 (and more): http://chatbot-sysrage.rhcloud.com");
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
        if (params.length > 0) {
            var sn = params.split(' ')[0].toLowerCase();
            if (indexOfServer(sn) > -1) {
                // first parameter is a server name
                params = params.slice(sn.length + 1);
                var targetServer = config.servers[indexOfServer(sn)];
            } else {
                var targetServer = server;
            }
        } else {
            targetServer = server;
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
            var sn = params.split(' ')[0].toLowerCase();
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
            var sn = params.split(' ')[0].toLowerCase();
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
{ // #### MUMBLE COMMAND ####
    command: 'mumble',
    help: "The command " + commandChar + "mumble displays information about the community Mumble server.\n" +
        "\nUsage: " + commandChar + "mumble", 
    exec: function(server, room, sender, message, extras) {
        sendReply(server, room, sender, "CSE's JB has been kind enough to provide a public Mumble server. This can be used for voice" +
            "chat during CU test events." +
            "\n\nMumble Server: veilstorm.net (default port)");
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
            var sn = params.split(' ')[0].toLowerCase();
            if (indexOfServer(sn) > -1) {
                targetServer = config.servers[indexOfServer(sn)];
            } else {
                sendReply(server, room, sender, "No server exists named '" + sn + "'.");
                return;
            }
        } else {
            var targetServer = server;
        }

        targetServer.cuRest.getPlayers().then(function(players) {
            switch(onlineStats[targetServer.name].accessLevel) {
                case 0:
                    var accessLevel = "Public";
                    break;
                case 1:
                    var accessLevel = "Beta 3";
                    break;
                case 2:
                    var accessLevel = "Beta 2";
                    break;
                case 3:
                    var accessLevel = "Beta 1";
                    break;
                case 4:
                    var accessLevel = "Alpha";
                    break;
                case 5:
                    var accessLevel = "IT";
                    break;
                case 6:
                    var accessLevel = "Development";
                    break;
                default:
                    var accessLevel = "Unknown";
            }

            var totalPlayers = players.arthurians + players.tuathaDeDanann + players.vikings;
            sendReply(server, room, sender, "Allowed player type on " + targetServer.name + ": " + accessLevel);
            sendReply(server, room, sender, "There are currently " + totalPlayers + " players logged in to " + targetServer.name + ":" +
                "\n   Arthurians: " + players.arthurians +
                "\n   TuathaDeDanann: " + players.tuathaDeDanann +
                "\n   Vikings: " + players.vikings);
        }, function(error) {
            sendReply(server, room, sender, "Error accessing API. Server may be down.");
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
            var sn = params.split(' ')[0].toLowerCase();
            if (indexOfServer(sn) > -1) {
                targetServer = config.servers[indexOfServer(sn)];
            } else {
                sendReply(server, room, sender, "No server exists named '" + sn + "'.");
                return;
            }
        } else {
            var targetServer = server;
        }

        targetServer.cuRest.getControlGame().then(function(data) {
            var artScore = data.arthurianScore;
            var tuaScore = data.tuathaDeDanannScore;
            var vikScore = data.vikingScore;
            var timeLeft = data.timeLeft;
            var minLeft = Math.floor(timeLeft / 60);
            var secLeft = Math.floor(timeLeft % 60);
            if (data.gameState === 0) {
                var gameState = "Disabled";
            } else if (data.gameState === 1) {
                var gameState = "Waiting For Next Round";                
            } else if (data.gameState === 2) {
                var gameState = "Basic Game Active";                
            } else if (data.gameState === 3) {
                var gameState = "Advanced Game Active";                
            }

            if (gameState === "Disabled") {
                sendReply(server, room, sender, "The game is currently disabled.");
            } else {
                sendReply(server, room, sender, "There is currently " + minLeft + " minutes and " + secLeft + " seconds left in the round." +
                    "\nGame State: " + gameState +
                    "\nArthurian Score: " + artScore +
                    "\nTuathaDeDanann Score: " + tuaScore +
                    "\nViking Score: " + vikScore);
            }
        }, function(error) {
            sendReply(server, room, sender, "Error accessing API. Server may be down.");
        });
    }
},
{ // #### SERVERS COMMAND ####
    command: 'servers',
    help: "The command " + commandChar + "servers displays currently available servers.\n" +
        "\nUsage: " + commandChar + "servers",
    exec: function(server, room, sender, message, extras) {

        server.cuRest.getServers().then(function(data) {
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
        }, function(error) {
            sendReply(server, room, sender, "Error accessing API. Server may be down.");
        });
    }
},
{ // #### TEAMSPEAK COMMAND ####
    command: 'teamspeak',
    help: "The command " + commandChar + "teamspeak displays information about the community Teamspeak server.\n" +
        "\nUsage: " + commandChar + "teamspeak", 
    exec: function(server, room, sender, message, extras) {
        sendReply(server, room, sender, "Community member Xirrin has been kind enough to provide a Teamspeak server. This can be used for voice" +
            "chat during CU test events. Request access to the appropriate channels via _global chat or a PM on the forums." +
            "\n\nTeamspeak Server: oppositionunchained.com (default port)");
    }
},
{ // #### TIPS COMMAND ####
    command: 'tips',
    help: "The command " + commandChar + "tips displays tips for new Camelot Unchained users.\n" +
        "\nUsage: " + commandChar + "tips [user]\n" +
        "\nIf [user] is specified, tips will be sent to that user. If 'chat' is specified as the user, tips will be sent to chat.", 
    exec: function(server, room, sender, message, extras) {
        var params = getParams(this.command, message);
        if (params.length > 0) {
            var pn = params.split(' ')[0].toLowerCase();
            if (pn !== 'chat') {
                if (room === 'pm') {
                    // Only allow tips requested via PM to be sent to requester to avoid abuse
                    sendReply(server, room, sender, "Tips sent to " + sender.split("@")[0] + ".");
                } else {
                    // send message as PM to specified user
                    sendReply(server, room, sender, "Tips sent to " + pn + ".");
                    room = 'pm';
                    sender = pn + '@' + server.address;
                }
            }
        } else {
            // send message as PM to user calling !tips
            sendReply(server, room, sender, "Tips sent to " + sender.split("@")[0] + ".");
            if (room !== 'pm') {
                room = 'pm';
                sender = sender + '@' + server.address;               
            }
        }

        sendReply(server, room, sender, "Quick Tips: Press V to create new spells/abilities || Press B to open spellbook to delete spells/abilities || Type '/hideui perfhud' to hide the statistics window || Type '/suicide' to quickly spawn in a new location");
        sendReply(server, room, sender, "To help increase performance on older systems type 'shadowMaxDist 0', hold Shift, and press Enter.");
        sendReply(server, room, sender, "To run the game in full screen at higher resolution hold Alt while clicking the 'Play' button on the launcher and enter 'windowWidth=1920; windowHeight=1080'.");
        sendReply(server, room, sender, "If you have poor performance on a laptop which contains both integrated and descrete video cards, see this post: http://bit.ly/1JmKCUR");
        sendReply(server, room, sender, "If something crashes when you do it, don't do it. -Tim");
        sendReply(server, room, sender, "For other very useful information, please click the 'Alpha Manual' link on the game patcher.");
    }
},
{ // #### TOS COMMAND ####
    command: 'tos',
    help: "The command " + commandChar + "tos displays a link to the Terms Of Service forum thread.\n" +
        "\nUsage: " + commandChar + "tos", 
    exec: function(server, room, sender, message, extras) {
        sendReply(server, room, sender, "Be sure to carefully read and abide by the Terms Of Service found here: http://bit.ly/1fLZ5Pk");
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
            var sn = params.split(' ')[0].toLowerCase();
            if (indexOfServer(sn) > -1) {
                targetServer = config.servers[indexOfServer(sn)];
            } else {
                sendReply(server, room, sender, "No server exists named '" + sn + "'.");
                return;
            }
        } else {
            var targetServer = server;
        }

        var firstGame = gameStats[targetServer.name].firstGame;
        var gameNumber = gameStats[targetServer.name].gameNumber;
        var artWins = gameStats[targetServer.name].artWins;
        var tuaWins = gameStats[targetServer.name].tuaWins;
        var vikWins = gameStats[targetServer.name].vikWins;

        sendReply(server, room, sender, "Out of " + gameStats[targetServer.name].gameNumber + " games played on " + targetServer.name + ", each realm has won as follows:" +
            "\nArthurian Wins: " + gameStats[targetServer.name].artWins +
            "\nTuathaDeDanann Wins: " + gameStats[targetServer.name].tuaWins +
            "\nViking Wins: " + gameStats[targetServer.name].vikWins);
    }
},
// { // #### CLIENTOFF COMMAND ####
//     command: 'clientoff',
//     help: "The command " + commandChar + "clientoff allows admins to stop the bot from connecting to a particular server.\n" +
//         "\nUsage: " + commandChar + "clientoff [server]\n" +
//         "\nIf [server] is specified, all actions will apply to that server. Otherwise, they will apply to the current server.",
//     exec: function(server, room, sender, message, extras) {
//         if (extras && extras.motdadmin) {
//             var params = getParams(this.command, message);
//             if (params.length > 0) {
//                 var sn = params.split(' ')[0].toLowerCase();
//                 if (indexOfServer(sn) > -1) {
//                     targetServer = config.servers[indexOfServer(sn)];
//                 } else {
//                     sendReply(server, room, sender, "No server exists named '" + sn + "'.");
//                     return;
//                 }
//             } else {
//                 var targetServer = server;
//             }

//             if (client[targetServer.name]) {
//                 // Client is running - Stop it
//                 stopClient(targetServer);
//                 if (targetServer.name !== server.name) {
//                     sendReply(server, room, sender, "Client for " + targetServer.name + " has been stopped.");
//                 }
//                 util.log("[STATUS] Client for " + targetServer.name + " stopped by user '" + sender + "'.");
//             } else {
//                 // Client not running - Send error
//                 sendReply(server, room, sender, "No client is running for server '"+ targetServer.name + "'.");
//             }
//         } else {
//             // User is not allowed - Send error.
//             sendReply(server, room, sender, "You do not have permission to stop a client.");
//         }
//     }
// },
// { // #### CLIENTON COMMAND ####
//     command: 'clienton',
//     help: "The command " + commandChar + "clienton allows admins to start the bot connecting to a particular server.\n" +
//         "\nUsage: " + commandChar + "clienton [server]\n" +
//         "\nIf [server] is specified, all actions will apply to that server. Otherwise, they will apply to the current server.",
//     exec: function(server, room, sender, message, extras) {
//         if (extras && extras.motdadmin) {
//             var params = getParams(this.command, message);
//             if (params.length > 0) {
//                 var sn = params.split(' ')[0].toLowerCase();
//                 if (indexOfServer(sn) > -1) {
//                     targetServer = config.servers[indexOfServer(sn)];
//                 } else {
//                     sendReply(server, room, sender, "No server exists named '" + sn + "'.");
//                     return;
//                 }
//             } else {
//                 sendReply(server, room, sender, "You must specify a client to start.");
//                 return;
//             }

//             if (client[targetServer.name]) {
//                 // Client is already running - Send error
//                 sendReply(server, room, sender, "A client for " + targetServer.name + " is already running.");
//             } else {
//                 startClient(targetServer);
//                 sendReply(server, room, sender, "A client for " + targetServer.name + " has been started.");
//                 util.log("[STATUS] Client for " + targetServer.name + " started by user '" + sender + "'.");
//             }
//         } else {
//             // User is not allowed - Send error.
//             sendReply(server, room, sender, "You do not have permission to stop a client.");
//         }
//     }
// },
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
    });
}

// function to read in the saved chatlog
function getChatlog(server) {
    fs.readFile(server.chatlogFile, function(err, data) {
        if (err && err.code === 'ENOENT') {
            server.chatlog = {};
            fs.writeFile(server.chatlogFile, JSON.stringify(server.chatlog), function(err) {
                if (err) {
                    return util.log("[ERROR] Unable to create chatlog file.");
                }
                util.log("[STATUS] Chatlog file did not exist. Empty file created.");
            });
        } else {
            server.chatlog = JSON.parse(data);
        }
    });
}

// function to get CUBE count
function getCUBECount(callback) {
    var url = "http://camelotunchained.com/v2/c-u-b-e/";
    request(url, function(error, response, body) {
        if (!error) {
            var re = /<h2 id="cube_count_number">([0-9,]+)<\/h2>/ig;
            var cubeCount = re.exec(body);
            if (cubeCount !== null) {
                callback(cubeCount[1]);
            } else {
                callback("Unknown");
            }
        }
    });
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

// function to read in the saved server online stats
function getOnlineStats(server) {
    fs.readFile(server.onlineFile, function(err, data) {
        if (err && err.code === 'ENOENT') {
            onlineStats[server.name] = {
                name: server.name,
                lastNotice: 0,
                online: false,
                accessLevel: 6
            };

            fs.writeFile(server.onlineFile, JSON.stringify(onlineStats[server.name]), function(err) {
                if (err) {
                    return util.log("[ERROR] Unable to create server online stats file.");
                }
                util.log("[STATUS] Server online stats file did not exist. Empty file created.");
            });
        } else {
            onlineStats[server.name] = JSON.parse(data);
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

// function to obtain all kill data during a time range
function getRoundKills(server, start, end, attempt, callback) {
    var roundKills = [];
    server.cuRest.getKills({start: start, end: end}).then(function(data) {
        data.forEach(function(killEntry) {
            if (killEntry.killer && killEntry.victim) {
                var killerName = killEntry.killer.name;
                var killerFaction = killEntry.killer.faction;
                var killerRace = killEntry.killer.race;
                var killerType = killEntry.killer.archetype;
                var victimName = killEntry.victim.name;
                var victimFaction = killEntry.victim.faction;
                var victimRace = killEntry.victim.race;
                var victimType = killEntry.victim.archetype;

                roundKills.push({
                    killerName: killerName, 
                    killerFaction: killerFaction,
                    killerRace: killerRace,
                    killerType: killerType,
                    victimName: victimName,
                    victimFaction: victimFaction,
                    victimRace: victimRace,
                    victimType: victimType
                });
            }
        });
        callback(roundKills);
    }, function(error) {
        // Retry twice before giving up.
        if (attempt < 2) {
            getRoundKills(server, start, end, attempt+1, callback);
        } else {
            util.log("[ERROR] Unable to query kills API.");
            callback(roundKills);
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
function isGameServerUp(server, attempt, callback) {
    server.cuRest.getServers().then(function(data) {
        for (var i = 0; i < data.length; i++) {
            if (data[i].name.toLowerCase() === server.name.toLowerCase()) {
                callback(true);
                return;
            }
        }
        callback(false);
    }, function(error) {
        // Retry twice before giving up.
        if (attempt < 2) {
            isGameServerUp(server, attempt+1, callback);
        } else {
            util.log("[ERROR] Unable to query servers API.");
            callback(false);
        }
    });
}

// function to check if user is an MOTD admin
var isMOTDAdmin = function(name) {
    for (var i = 0; i < config.motdAdmins.length; i++) {
        if (config.motdAdmins[i].toLowerCase() === name.toLowerCase()) return true;
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

// function to send AWS SNS notification
function sendSNS(arn, message, subject) {
    var AWS = require('aws-sdk');
    AWS.config.region = 'us-east-1';
    var sns = new AWS.SNS();

    var params = {
      Message: message,
      Subject: subject,
      TopicArn: arn
    };

    sns.publish(params, function(err, data) {
        if (err) util.log("[ERROR] Error sending SNS: " + err);
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

// function to send a server notification to Alpha players
function sendToAlpha(message) {
    config.poAlphaNotices.forEach(function(poID) {
        sendPushover(poID, "[CU]", message);
    });
    config.snsAlphaNotices.forEach(function(arn) {
        sendSNS(arn, message, message);
    });
}

// function to send a server notification to Beta1 players
function sendToBeta1(message) {
    config.poBeta1Notices.forEach(function(poID) {
        sendPushover(poID, "[CU]", message);
    });
    config.snsBeta1Notices.forEach(function(arn) {
        sendSNS(arn, message, message);
    });
}

// function to send a server notification to Beta2 players
function sendToBeta2(message) {
    config.poBeta2Notices.forEach(function(poID) {
        sendPushover(poID, "[CU]", message);
    });
    config.snsBeta2Notices.forEach(function(arn) {
        sendSNS(arn, message, message);
    });
}

// function to send a server notification to Beta3 players
function sendToBeta3(message) {
    config.poBeta3Notices.forEach(function(poID) {
        sendPushover(poID, "[CU]", message);
    });
    config.snsBeta3Notices.forEach(function(arn) {
        sendSNS(arn, message, message);
    });
}

// function to send a server notification to IT players
function sendToIT(message) {
    config.poITNotices.forEach(function(poID) {
        sendPushover(poID, "[CU]", message);
    });
    config.snsITNotices.forEach(function(arn) {
        sendSNS(arn, message, message);
    });
}

// function to add message to chat log and expire old messages
function updateChatlog(server, room, message) {
    var curISODate = new Date().toISOString();
    server.chatlog[room].push(message);

    // Remove expired messages
    for (var roomName in server.chatlog) {
        for (var i = 0; i < server.chatlog[roomName].length; i++) {
            if (moment(curISODate).diff(server.chatlog[roomName][i].timestamp, "hours") > config.chatlogLimit) {
                server.chatlog[roomName].splice(i, 1);
                i--;
            }            
        }
    }

    fs.writeFile(server.chatlogFile, JSON.stringify(server.chatlog), function(err) {
        if (err) {
            util.log("[ERROR] Unable to write chatlog file (" + server.name + ").");
        }
    });
}

// Timer to verify client is still connected
var timerConnected = function(server) { return setInterval(function() { checkLastStanza(server); }, 1000); };
function checkLastStanza(server) {
    var epochTime = Math.floor((new Date).getTime() / 1000);
    if (epochTime - server.lastStanza > 65) {
        util.log("[ERROR] No stanza for 65 seconds on " + server.name + ". Reconnecting...");
        server.lastStanza = epochTime;
        restartClient(server);
    }
}

// Timer to monitor server online status for Alpha/Beta notices
var timerServerOnline = function(server) { return setInterval(function() { checkServerOnline(server); }, 60000); };
function checkServerOnline(server) {
    var epochTime = Math.floor((new Date).getTime() / 1000);

    server.cuRest.getServers().then(function(data) {
        var currentOnline = false;
        var currentAccess = 6;
        var statusChange = false;
        for (var j = 0; j < data.length; j++) {
            var serverEntry = data[j];
            if (serverEntry.name.toLowerCase() === server.name.toLowerCase()) {
                currentOnline = true;
                currentAccess = serverEntry.accessLevel;

                // Access Levels:
                // Invalid = -1,
                // Public = 0,
                // Beta3 = 1,
                // Beta2 = 2,
                // Beta1 = 3,
                // Alpha = 4,
                // IT = 5, // called InternalTest on /api/servers
                // Devs = 6, // called Employees on /api/servers

                if (! onlineStats[server.name].online && currentOnline) {
                    // Server was offline, is now online.
                    statusChange = true;
                    for (var i = 5; i > currentAccess - 1; i--) {
                        switch(i) {
                            case 5:
                                // Server now open to IT -- Send notice to IT
                                sendToIT("The server '" + server.name + "' is now online and allowing access to IT players.");
                                util.log("[GAME] Server access status message sent to users. (IT)");
                                break;
                            case 4:
                                // Server now open to Alpha -- Send notice to Alpha
                                sendToAlpha("The server '" + server.name + "' is now online and allowing access to Alpha players.");
                                util.log("[GAME] Server access status message sent to users. (Alpha)");
                                break;
                            case 3:
                                // Server now open to Beta1 -- Send notice to Beta1
                                sendToBeta1("The server '" + server.name + "' is now online and allowing access to Beta1 players.");
                                util.log("[GAME] Server access status message sent to users. (Beta1)");
                                break;
                            case 2:
                                // Server now open to Beta2 -- Send notice to Beta2
                                sendToBeta2("The server '" + server.name + "' is now online and allowing access to Beta2 players.");
                                util.log("[GAME] Server access status message sent to users. (Beta2)");
                                break;
                            case 1:
                                // Server now open to Beta3 -- Send notice to Beta3
                                sendToBeta3("The server '" + server.name + "' is now online and allowing access to Beta3 players.");
                                util.log("[GAME] Server access status message sent to users. (Beta3)");
                                break;
                        }
                    }
                } else {
                    if (onlineStats[server.name].accessLevel < currentAccess) {
                        // Server was online but access level has gone up
                        statusChange = true;
                        for (var i = onlineStats[server.name].accessLevel; i < currentAccess; i++) {
                            switch(i) {
                                case 5:
                                    // Server no longer open to IT -- Send notice to IT
                                    sendToIT("The server '" + server.name + "' is no longer allowing access to IT players.");
                                    util.log("[GAME] Server access status message sent to users. (IT)");
                                    break;
                                case 4:
                                    // Server no longer open to Alpha -- Send notice to Alpha
                                    sendToAlpha("The server '" + server.name + "' is no longer allowing access to Alpha players.");
                                    util.log("[GAME] Server access status message sent to users. (Alpha)");
                                    break;
                                case 3:
                                    // Server no longer open to Beta1 -- Send notice to Beta1
                                    sendToBeta1("The server '" + server.name + "' is no longer allowing access to Beta1 players.");
                                    util.log("[GAME] Server access status message sent to users. (Beta1)");
                                    break;
                                case 2:
                                    // Server no longer open to Beta2 -- Send notice to Beta2
                                    sendToBeta2("The server '" + server.name + "' is no longer allowing access to Beta2 players.");
                                    util.log("[GAME] Server access status message sent to users. (Beta2)");
                                    break;
                                case 1:
                                    // Server no longer open to Beta3 -- Send notice to Beta3
                                    sendToBeta3("The server '" + server.name + "' is no longer allowing access to Beta3 players.");
                                    util.log("[GAME] Server access status message sent to users. (Beta3)");
                                    break;
                            }
                        }
                    } else if (onlineStats[server.name].accessLevel > currentAccess) {
                        // Server was online but access level has gone down
                        statusChange = true;
                        for (var i = onlineStats[server.name].accessLevel - 1; i > currentAccess - 1; i--) {
                            switch(i) {
                                case 5:
                                    // Server now open to IT -- Send notice to IT
                                    sendToIT("The server '" + server.name + "' is now allowing access to IT players.");
                                    util.log("[GAME] Server access status message sent to users. (IT)");
                                    break;
                                case 4:
                                    // Server now open to Alpha -- Send notice to Alpha
                                    sendToAlpha("The server '" + server.name + "' is now allowing access to Alpha players.");
                                    util.log("[GAME] Server access status message sent to users. (Alpha)");
                                    break;
                                case 3:
                                    // Server now open to Beta1 -- Send notice to Beta1
                                    sendToBeta1("The server '" + server.name + "' is now allowing access to Beta1 players.");
                                    util.log("[GAME] Server access status message sent to users. (Beta1)");
                                    break;
                                case 2:
                                    // Server now open to Beta2 -- Send notice to Beta2
                                    sendToBeta2("The server '" + server.name + "' is now allowing access to Beta2 players.");
                                    util.log("[GAME] Server access status message sent to users. (Beta2)");
                                    break;
                                case 1:
                                    // Server now open to Beta3 -- Send notice to Beta3
                                    sendToBeta3("The server '" + server.name + "' is now allowing access to Beta3 players.");
                                    util.log("[GAME] Server access status message sent to users. (Beta3)");
                                    break;
                            }
                        }
                    }
                }
                break;
            }
        }

        if (onlineStats[server.name].online && ! currentOnline) {
            // Server was online, is now offline.
            statusChange = true;
            for (var i = 5; i > onlineStats[server.name].accessLevel - 1; i--) {
                switch(i) {
                    case 5:
                        // Server now open to IT -- Send notice to IT
                        sendToIT("The server '" + server.name + "' is now offline.");
                        util.log("[GAME] Server access status message sent to users. (IT)");
                        break;
                    case 4:
                        // Server now open to Alpha -- Send notice to Alpha
                        sendToAlpha("The server '" + server.name + "' is now offline.");
                        util.log("[GAME] Server access status message sent to users. (Alpha)");
                        break;
                    case 3:
                        // Server now open to Beta1 -- Send notice to Beta1
                        sendToBeta1("The server '" + server.name + "' is now offline.");
                        util.log("[GAME] Server access status message sent to users. (Beta1)");
                        break;
                    case 2:
                        // Server now open to Beta2 -- Send notice to Beta2
                        sendToBeta2("The server '" + server.name + "' is now offline.");
                        util.log("[GAME] Server access status message sent to users. (Beta2)");
                        break;
                    case 1:
                        // Server now open to Beta3 -- Send notice to Beta3
                        sendToBeta3("The server '" + server.name + "' is now offline.");
                        util.log("[GAME] Server access status message sent to users. (Beta3)");
                        break;
                }
            }
        }

        if (statusChange) {
            onlineStats[server.name].online = currentOnline;
            onlineStats[server.name].accessLevel = currentAccess;
            onlineStats[server.name].lastNotice = epochTime;

            fs.writeFile(server.onlineFile, JSON.stringify(onlineStats[server.name]), function(err) {
                if (err) {
                    return util.log("[ERROR] Unable to write server access status stats file (" + server.name + ").");
                }
                util.log("[STATUS] Server access status stats file saved (" + server.name + ").");
            });
        }
    }, function(error) {
        util.log("[ERROR] Poll of server data failed.");
    });
}


// Timer to monitor control game
var timerControlGame = function(server) { return setInterval(function() {controlGame(server); }, 30000); };
function controlGame(server) {
    var epochTime = Math.floor((new Date).getTime() / 1000);
    if (typeof server.currentGame === 'undefined') {
        // Timer just started, perform initialization
        server.currentGame = { 
            startTime: 0,
            ended: true,
            artScore: 0,
            tuaScore: 0,
            vikScore: 0,
            downCount: 0,
            lastBegTime: epochTime
        };
    }

    // Check to make sure game server is up. If not, skip this iteration of the timer.
    isGameServerUp(server, 0, function(up) {
        if (! up) {
            server.currentGame.downCount++;
            if (server.currentGame.downCount > 2 && ! server.currentGame.ended) server.currentGame.ended = true;
            return;
        } else {
            server.currentGame.downCount = 0;
            // Poll API for latest control game data.
            server.cuRest.getControlGame().then(function(cgData) {
                server.cuRest.getPlayers().then(function(pData) {
                    var artScore = cgData.arthurianScore;
                    var tuaScore = cgData.tuathaDeDanannScore;
                    var vikScore = cgData.vikingScore;
                    var timeLeft = cgData.timeLeft;
                    var minLeft = Math.floor(timeLeft / 60);
                    var secLeft = Math.floor(timeLeft % 60);
                    var gameState = cgData.gameState; // 0 = Disabled / 1 = Waiting / 2 = Basic Game / 3 = Advanced Game

                    var artCount = pData.arthurians;
                    var tuaCount = pData.tuathaDeDanann;
                    var vikCount = pData.vikings;
                    var totalPlayers = pData.arthurians + pData.tuathaDeDanann + pData.vikings;

                    if ((gameState === 1) && ! server.currentGame.ended) {
                        // Game we were monitoring has ended. Save stats.
                        util.log("[GAME] A round has ended on " + server.name + " (" + (gameStats[server.name].gameNumber + 1) + ").");
                        gameStats[server.name].gameNumber++;
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

                        gameStats[server.name].lastStartTime = server.currentGame.startTime;

                        // Write gameStats to disk
                        fs.writeFile(server.gameFile, JSON.stringify(gameStats[server.name]), function(err) {
                            if (err) {
                                return util.log("[ERROR] Unable to write to game stats file.");
                            }
                        });

                        // Add new entries to playerStats based on kills API
                        roundStartTime = new Date(server.currentGame.startTime * 1000).toISOString();
                        // roundEndTime = new Date((server.currentGame.startTime + server.roundTime) * 1000).toISOString();
                        roundEndTime = '';
                        getRoundKills(server, roundStartTime, roundEndTime, 0, function(roundKills) {
                            var playersInRound = [];
                            roundKills.forEach(function(rkEntry) {
                                // Skip suicides
                                if (rkEntry.killerName !== rkEntry.victimName) {
                                    // Check to see if these players already had their gameCount increased for this round.
                                    var killerAlreadyCounted = false;
                                    var victimAlreadyCounted = false;
                                    for (var i = 0; i < playersInRound.length; i++) {
                                        if (playersInRound[i] === rkEntry.killerName) killerAlreadyCounted = true;
                                        if (playersInRound[i] === rkEntry.victimName) victimAlreadyCounted = true;
                                    }
                                    if (! killerAlreadyCounted) playersInRound.push(rkEntry.killerName);
                                    if (! victimAlreadyCounted) playersInRound.push(rkEntry.victimName);

                                    // Update data for players already existing in playerStats
                                    var existingKiller = false;
                                    var existingVictim = false;
                                    for (var i = 0; i < playerStats[server.name].length; i++) {
                                        if (playerStats[server.name][i].playerName === rkEntry.killerName) {
                                            playerStats[server.name][i].kills++;
                                            playerStats[server.name][i].playerType = rkEntry.killerType;
                                            if (! killerAlreadyCounted) playerStats[server.name][i].gamesPlayed++;
                                            existingKiller = true;
                                        }
                                        if (playerStats[server.name][i].playerName === rkEntry.victimName) {
                                            playerStats[server.name][i].deaths++;
                                            playerStats[server.name][i].playerType = rkEntry.victimType;
                                            if (! victimAlreadyCounted) playerStats[server.name][i].gamesPlayed++;
                                            existingVictim = true;
                                        }
                                    }

                                    // Add new players to playerStats
                                    if (! existingKiller) playerStats[server.name].push({
                                        playerName: rkEntry.killerName,
                                        playerFaction: rkEntry.killerFaction,
                                        playerRace: rkEntry.killerRace,
                                        playerType: rkEntry.killerType,
                                        kills: 1,
                                        deaths: 0,
                                        gamesPlayed: 1
                                    });
                                    if (! existingVictim) playerStats[server.name].push({
                                        playerName: rkEntry.victimName,
                                        playerFaction: rkEntry.victimFaction,
                                        playerRace: rkEntry.victimRace,
                                        playerType: rkEntry.victimType,
                                        kills: 0,
                                        deaths: 1,
                                        gamesPlayed: 1
                                    });
                                }
                            });

                            // Write playerStats to disk
                            fs.writeFile(server.playerFile, JSON.stringify(playerStats[server.name]), function(err) {
                                if (err) {
                                    return util.log("[ERROR] Unable to write to player stats file.");
                                }
                            });

                            server.currentGame.ended = true;
                            util.log("[GAME] Game and player statistics saved for last round.");
                        });
                    }

                    if ((gameState === 2 || gameState === 3) && server.currentGame.ended) {
                        // New game has started
                        server.currentGame = { 
                            startTime: epochTime - (server.roundTime - timeLeft),
                            ended: false,
                            artScore: artScore,
                            tuaScore: tuaScore,
                            vikScore: vikScore,
                            downCount: 0,
                            lastBegTime: epochTime
                        };

                        util.log("[GAME] A new round has started on " + server.name + " (" + (gameStats[server.name].gameNumber + 1) + ").");
                    }

                    // Beg for users to join the game.
                    // if ((gameState === 1) && ((epochTime - gameStats[server.name].lastStartTime) > 3600) && ((epochTime - server.currentGame.lastBegTime) > 3600) && (totalPlayers > 0)) {
                    //     // Game hasn't started for over an hour, we haven't sent a beg notice for an hour, and at least 1 player is in game
                    //     server.rooms.forEach(function(r) {
                    //         if (r.announce === true) {
                    //             sendChat(server, "Players are waiting for a new round to begin on " + server.name + ". Join the battle!", r.name + "@" + server.service + "." + server.address);
                    //         }
                    //     });
                    //     server.currentGame.lastBegTime = epochTime;
                    // }
                }, function(error) {
                    util.log("[ERROR] Poll of player data failed.");
                });
            }, function(error) {
                util.log("[ERROR] Poll of control game data failed.");
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
            // Start to XMPP client
            client[server.name] = {
                xmpp: new xmpp.Client({
                    jid: server.username + '/bot-' + random(6),
                    password: server.password,
                    reconnect: true
                })
            };

            // client[server.name].xmpp.connection.socket.setTimeout(0);
            // client[server.name].xmpp.connection.socket.setKeepAlive(true, 10000);

            // Handle client errors
            client[server.name].xmpp.on('error', function(err) {
                if (err.code === "EADDRNOTAVAIL" || err.code === "ENOTFOUND") {
                    util.log("[ERROR] Unable to resolve the server's DNS address (" + server.name + ").");
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
                util.log("[STATUS] Client disconnected from " + server.name + ". Reconnecting...");
            });

            // Once connected, set available presence and join rooms
            client[server.name].xmpp.on('online', function() {
                util.log("[STATUS] Client connected to " + server.name + ".");

                // Set ourselves as online
                client[server.name].xmpp.send(new xmpp.Element('presence', { type: 'available' }).c('show').t('chat'));

                // Join rooms (and request no chat history)
                server.rooms.forEach(function(room) {
                    var roomJID = room.name + '@' + server.service + '.' + server.address;
                    client[server.name].xmpp.send(new xmpp.Element('presence', { to: roomJID + '/' + server.nickname }).
                        c('x', { xmlns: 'http://jabber.org/protocol/muc' })
                    );
                    util.log("[STATUS] Client joined '" + room.name + "' on " + server.name + ".");

                    // Chatlog initialization
                    if (room.log) {
                        if (! server.chatlog[room.name]) server.chatlog[room.name] = [];
                    }
                });

                // Start sending MOTDs
                client[server.name].motdTimer = timerMOTD(server);

                // Start verifying client is still receiving stanzas
                server.lastStanza = Math.floor((new Date).getTime() / 1000);
                client[server.name].connTimer = timerConnected(server);

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

                    var curISODate = new Date().toISOString();
                    var message = body.getText();
                    var sender = stanza.attrs.from.split('/')[1];
                    var senderName = sender.split('@')[0];
                    var room = stanza.attrs.from.split('/')[0];
                    var roomName = room.split('@')[0];
                    if (stanza.getChild('cseflags')) {
                        var cse = stanza.getChild('cseflags').attrs.cse;
                    }
                    var roomIsMonitored = server.rooms[indexOfRoom(server, roomName)].monitor;
                    var roomIsLogged = server.rooms[indexOfRoom(server, roomName)].log;

                    if (cse === "cse" || isMOTDAdmin(senderName)) {
                        motdadmin = true;
                    } else motdadmin = false;

                    // Store message for logged rooms and clean up existing logs
                    if (roomIsLogged) {
                        var newLogMsg = {
                            timestamp: curISODate,
                            sender: senderName,
                            message: message
                        }
                        updateChatlog(server, roomName, newLogMsg);
                    }

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
                        if (message.indexOf("Hatchery will reboot for an update in") > -1) {
                            if (server.name === "hatchery" && message.indexOf("30 seconds") > -1) {
                                sendToAll("ADMIN NOTICE (" + server.name + "): " + message);
                                util.log("[CHAT] Server reboot message sent to users. (ALL)");                                                            
                            }
                        } else if (message.indexOf("Wyrmling will reboot for an update in") > -1) {
                            if (server.name === "wyrmling" && message.indexOf("30 seconds") > -1) {
                                sendToAll("ADMIN NOTICE (" + server.name + "): " + message);
                                util.log("[CHAT] Server reboot message sent to users. (ALL)");                                                            
                            }
                        } else {
                            sendToAll("ADMIN NOTICE (" + server.name + "): " + message);
                            util.log("[CHAT] Server warning message sent to users. (ALL)");
                        }
                    }

                    if (cse === "cse" || isMOTDAdmin(senderName)) {
                        motdadmin = true;
                    } else motdadmin = false;

                    // If message matches a defined command, run it
                    if (message[0] === commandChar && server.allowPMCommands) {
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
    if (typeof client[server.name] !== 'undefined' && typeof client[server.name].xmpp !== 'undefined') {
        client[server.name].xmpp.connection.reconnect = false;
        // client[server.name].xmpp.removeAllListeners('error');
        client[server.name].xmpp.removeAllListeners('disconnect');
        client[server.name].xmpp.removeAllListeners('online');
        client[server.name].xmpp.removeAllListeners('stanza');
        client[server.name].xmpp.end();
        client[server.name].xmpp = undefined;
        server.rooms.forEach(function(room) {
            room.joined = false;
        });
        clearInterval(client[server.name].motdTimer);
        clearInterval(client[server.name].connTimer);
        client[server.name] = undefined;
    }
}

// function to restart a client for a particular server
function restartClient(server) {
    stopClient(server);
    startClient(server);
}

// Initial startup
var client = [];
var onlineStats = [];
var gameStats = [];
var playerStats = [];
config.servers.forEach(function(server) {
    // Connect to REST API
    server.cuRest = new cuRestAPI(server.name);

    // Server initialization
    getChatlog(server);
    getMOTD(server);
    getMOTDIgnore(server);
    getOnlineStats(server);
    getGameStats(server);
    getPlayerStats(server);
    server.motdReceivers = [];

    // Start watching server online status for Alpha/Beta notices
    server.onlineTimer = timerServerOnline(server);

    // Start watching Control Game
    server.gameTimer = timerControlGame(server);

    // Start XMPP client
    startClient(server);
});