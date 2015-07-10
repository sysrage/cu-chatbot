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

var config = require('./cu-chatbot.cfg');

// Chat command definitions
var commandChar = '!';
var chatCommands = [
{
    command: 'motd',
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
                fs.writeFile(targetServer.motdfile, "MOTD: " + params, function(err) {
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
{
    command: 'motdoff',
    exec: function(server, room, sender, message, extras) {
        var ignoredReceiver = false;
        var params = getParams(this.command, message);
        if (params.length > 0) {
            if (indexOfServer(getParams(this.command, message, 0)) > -1) {
                var sn = params.split(' ')[0];
                var targetServer = config.servers[indexOfServer(sn)];
            } else {
                sendReply(server, room, sender, "No server exists named '" + params.split(' ')[0] + "'.");
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
            fs.writeFile(targetServer.nomotdfile, JSON.stringify(targetServer.motdIgnore), function(err) {
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
{
    command: 'motdon',
    exec: function(server, room, sender, message, extras) {
        var ignoredReceiver = false;
        var params = getParams(this.command, message);
        if (params.length > 0) {
            if (indexOfServer(getParams(this.command, message, 0)) > -1) {
                var sn = params.split(' ')[0];
                var targetServer = config.servers[indexOfServer(sn)];
            } else {
                sendReply(server, room, sender, "No server exists named '" + params.split(' ')[0] + "'.");
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

            fs.writeFile(targetServer.nomotdfile, JSON.stringify(targetServer.motdIgnore), function(err) {
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
{
    command: 'clientoff',
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
{
    command: 'clienton',
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
}
];

/*****************************************************************************/
/*****************************************************************************/

// function to check internet connectivity
function checkInternet(server, cb) {
    require('dns').lookup(server.name, function(err) {
        if (err && err.code == "ENOTFOUND") {
            cb(false);
        } else {
            cb(true);
        }
    })
}

// function to read in the MOTD file
function getMOTD(server) {
    fs.readFile(server.motdfile, function(err, data) {
        if (err && err.code === 'ENOENT') {
            fs.writeFile(server.motdfile, "MOTD: ", function(err) {
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
    fs.readFile(server.nomotdfile, function(err, data) {
        if (err && err.code === 'ENOENT') {
            server.motdIgnore = [];
            fs.writeFile(server.nomotdfile, JSON.stringify(server.motdIgnore), function(err) {
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
    epochTime = Math.floor((new Date).getTime() / 1000);
    if (epochTime - server.lastStanza > 65) {
        util.log("[ERROR] No stanza for 65 seconds on " + server.name + ". Reconnecting...");
        server.lastStanza = epochTime;
        stopClient(server);
        startClient(server);
    }
}

// Timer to send MOTD messages to joining users.
var timerMOTD = function(server) { return setInterval(function() { sendMOTD(server); }, 500); };
function sendMOTD(server) {
    server.motdReceivers.forEach(function(receiver) {
        epochTime = Math.floor((new Date).getTime() / 1000);
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
            server.motdReceivers = [];

            // Connect to XMPP servers
            client[server.name] = {
                xmpp: new xmpp.Client({
                    jid: server.username + '/bot',
                    password: server.password,
                    reconnect: true
                })
            };

            // client[server.name].xmpp.connection.socket.setTimeout(0);
            // client[server.name].xmpp.connection.socket.setKeepAlive(true, 10000);

            // Handle client errors
            client[server.name].xmpp.on('error', function(err) {
                if (err.code === "EADDRNOTAVAIL" || err.code === "ETIMEDOUT" || err.code === "ENOTFOUND") {
                    util.log("[ERROR] No internet connection available.");
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
                util.log("[STATUS] Client connected to server: " + server.name);
             
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
//                    } else if (motdadmin && roomIsMonitored) {
                        // Message is from CSE staff in a monitored room and isn't a command
                        sendToAll(senderName + "@" + roomName + ": " + message);
                        util.log("[CHAT] Message from " + senderName + "@" + roomName + " sent to users. (ALL)");

                        if (isTestMessage(message)) {
                            // Message is a test alert.
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
                        sendToAll("ADMIN NOTICE: " + message);
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
    client[server.name].xmpp.end();
    client[server.name].xmpp = undefined;
    clearInterval(client[server.name].motdTimer);
    clearInterval(client[server.name].connTimer);
    client[server.name] = undefined;
    util.log("Client for " + server.name + " has been stopped.");
}

// Initial startup
var client = [];
config.servers.forEach(function(server) {
    startClient(server);
});