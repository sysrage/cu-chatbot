// Camelot Unchained XMPP bot using node.js
// To use, run `node cu-chat-bot.js`

// Requires node-xmpp
// Based on https://gist.github.com/powdahound/940969
// Much thanks to Mehuge, reallifegobbo, and burfo for extensive help.

var sys = require('sys');
var util = require('util');
var path = require('path');
var fs = require('fs');
var xmpp = require('node-xmpp');

var config = require('./cu-chatbot.cfg');

// Chat commands
var commandChar = '!';
var chatCommands = [
{
    command: 'motd',
    exec: function(server, room, sender, message, extras) {
        re = new RegExp('^.' + this.command +'[\ ]*');
        var params = message.replace(re, '');
        if (extras && extras.motdadmin) {
            var motdadmin = extras.motdadmin;
        } else {
            var motdadmin = false;
        }

        if (params.length > 0) {
            // User is trying to set a new MOTD.
            if (motdadmin) {
                // User is allowed - Set new MOTD.
                fs.writeFile(server.motdfile, "MOTD: " + params, function(err) {
                    if (err) {
                        return util.log("[ERROR] Unable to write to MOTD file.");
                    }
                    server.motd = "MOTD: " + params;
                    sendReply(server, room, sender, "MOTD for " + server.name + " set to: " + params);
                    util.log("[MOTD] New MOTD for server '" + server.name + "' set by user '" + sender + "'.");
                });
            } else {
                // User is not allowed - Send error.
                sendReply(server, room, sender, "You do not have permission to set an MOTD.");
            }
        } else {
            // User requested current MOTD.
            if (room === 'pm') {
                sendPM(server, server.motd.toString(), sender);
                util.log("[MOTD] MOTD sent to user '" + sender + "' on " + server.name + ".");
            } else {
                sendChat(server, server.motd.toString(), room);
                util.log("[MOTD] MOTD sent to '" + server.name + '/' + room.split('@')[0] + "' per user '" + sender + "'.");
            }
        }
    }
},
{
    command: 'motdoff',
    exec: function(server, room, sender, message, extras) {
        var ignoredReceiver = false;
        server.motdIgnore.forEach(function(receiver) {
            if (receiver === sender) ignoredReceiver = true;
        });

        if (! ignoredReceiver) {
            // Add user to MOTD ignore list
            server.motdIgnore.push(sender);
            fs.writeFile(server.nomotdfile, JSON.stringify(server.motdIgnore), function(err) {
                if (err) {
                    return util.log("[ERROR] Unable to write to MOTD Ignore file.");
                }
                sendReply(server, room, sender, "User '" + sender + "' unsubscribed from " + server.name + " MOTD notices.");
                util.log("[MOTD] User '" + sender + "' added to '" + server.name + "' opt-out list.");
            });
        } else {
            // Tell user they already have MOTDs turned off
            sendReply(server, room, sender, "User '" + sender + "' already unsubscribed from " + server.name + " MOTD notices.");
        }
    }
},
{
    command: 'motdon',
    exec: function(server, room, sender, message, extras) {
        var ignoredReceiver = false;
        server.motdIgnore.forEach(function(receiver) {
            if (receiver === sender) ignoredReceiver = true;
        });

        if (ignoredReceiver) {
            // Remove user from MOTD ignore list
            for (var i = 0; i < server.motdIgnore.length; i++) {
                if (server.motdIgnore[i] === sender) {
                    index = i;
                    break;
                }
            }
            server.motdIgnore.splice(index, 1);

            fs.writeFile(server.nomotdfile, JSON.stringify(server.motdIgnore), function(err) {
                if (err) {
                    return util.log("[ERROR] Unable to write to MOTD Ignore file.");
                }
                sendReply(server, room, sender, "User '" + sender + "' subscribed to " + server.name + " MOTD notices.");
                util.log("[MOTD] User '" + sender + "' removed from '" + server.name + "' opt-out list.");
            });
        } else {
            // Tell user they already have MOTDs turned on
            sendReply(server, room, sender, "User '" + sender + "' already subscribed to " + server.name + " MOTD notices.");
        }
    }
},
{
    command: 'stopclient',
    exec: function(server, room, sender, message, extras) {
        re = new RegExp('^.' + this.command +'[\ ]*');
        var params = message.replace(re, '');
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
    command: 'startclient',
    exec: function(server, room, sender, message, extras) {
        re = new RegExp('^.' + this.command +'[\ ]*');
        var params = message.replace(re, '');
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

// function to send a reply message
function sendReply(server, room, sender, message) {
    if (room === 'pm') {
        sendPM(server, message, sender);
    } else {
        sendChat(server, message, room);
    }
}

// function to send a message to a group chat
function sendChat(server, message, room) {
    client[server.name].xmpp.send(new xmpp.Element('message', { to: room + '/' + server.nickname, type: 'groupchat' }).c('body').t(message));
}

// function to send a private message
function sendPM(server, message, user) {
    client[server.name].xmpp.send(new xmpp.Element('message', { to: user, type: 'chat' }).c('body').t(message));
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

// function to stop a client for a particular server
function stopClient(server) {
    client[server.name].xmpp.connection.reconnect = false;
    client[server.name].xmpp.end();
    client[server.name].xmpp = undefined;
    clearInterval(client[server.name].motdTimer);
    clearInterval(client[server.name].connTimer);
    client[server.name] = undefined;
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
                    /* --------------------------
                       Handle channel joins/parts
                       -------------------------- */
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
                    /* --------------------------
                       Handle group chat messages
                       -------------------------- */
                    var body = stanza.getChild('body');
                    // message without body is probably a topic change
                    if (! body) {
                        return;
                    }
                    
                    var motdadmin = false;
                    var message = body.getText();
                    var sender = stanza.attrs.from.split('/')[1];
                    var room = stanza.attrs.from.split('/')[0];
                    if (stanza.getChild('cseflags')) {
                        var cse = stanza.getChild('cseflags').attrs.cse;
                    }

                    if (cse === "cse") {
                        motdadmin = true;
                    } else {
                        config.motdAdmins.forEach(function(user) {
                            if (sender === user) {
                                motdadmin = true;
                            }
                        });
                    }

                    // If message matches a defined command, run it
                    if (message[0] === commandChar) {
                        var userCommand = message.split(' ')[0].split(commandChar)[1];
                        chatCommands.forEach(function(cmd) {
                            if (userCommand === cmd.command) {
                                cmd.exec(server, room, sender, message, {motdadmin: motdadmin});
                            }
                        });
                    }

                    // // Log each message
                    // if (cse === "cse") {
                    //     util.log("[CHAT-CSE] " + sender + "@" + server.name + "/" + room.split('@')[0] + ": " + message);
                    // } else {
                    //     util.log("[CHAT] " + sender + "@" + server.name + "/" + room.split('@')[0] + ": " + message);
                    // }

                } else if (stanza.is('message') && stanza.attrs.type === 'chat') {
                    /* --------------------------
                       Handle private messages
                       -------------------------- */
                    var body = stanza.getChild('body');
                    // message without body is probably a topic change
                    if (! body) {
                        return;
                    }

                    var motdadmin = false;
                    var message = body.getText();
                    var sender = stanza.attrs.from;
                    if (stanza.getChild('cseflags')) {
                        var cse = stanza.getChild('cseflags').attrs.cse;
                    }

                    if (cse === "cse") {
                        motdadmin = true;
                    } else {
                        config.motdAdmins.forEach(function(user) {
                            if (sender.split('@')[0] === user) {
                                motdadmin = true;
                            }
                        });
                    }

                    // If message matches a defined command, run it
                    if (message[0] === commandChar) {
                        var userCommand = message.split(' ')[0].split(commandChar)[1];
                        chatCommands.forEach(function(cmd) {
                            if (userCommand === cmd.command) {
                                cmd.exec(server, 'pm', sender, message, {motdadmin: motdadmin});
                            }
                        });
                    }

                    // // Log each message
                    // util.log("[PM] " + sender + "@" + server.name + ": " + message);

                } else {
                    /* --------------------------
                       Ignore everything else
                       -------------------------- */
                    return;
                }
            });
        }
    });
}

// Initial startup
var client = [];
config.servers.forEach(function(server) {
    startClient(server);
});