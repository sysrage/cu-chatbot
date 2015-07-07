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
    exec: function(client, server, room, sender, message, extras) {
        var params = message.replace(/^.motd[\ ]*/, '');
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
                    if (room === 'pm') {
                        sendPM(client, server, "MOTD for " + server.name + " set to: " + params, sender);
                    } else {
                        sendChat(client, server, "MOTD for " + server.name + " set to: " + params, room);
                    }
                    util.log("[MOTD] New MOTD for server '" + server.name + "' set by user '" + sender + "'.");
                });
            } else {
                // User is not allowed - Send error.
                if (room === 'pm') {
                    sendPM(client, server, "You do not have permission to set an MOTD.", sender);
                } else {
                    sendChat(client, server, "You do not have permission to set an MOTD.", room);
                }
            }
        } else {
            // User requested current MOTD.
            if (room === 'pm') {
                sendPM(client, server, server.motd.toString(), sender);
                util.log("[MOTD] MOTD sent to user '" + sender + "' on " + server.name + ".");
            } else {
                sendChat(client, server, server.motd.toString(), room);
                util.log("[MOTD] MOTD sent to '" + server.name + '/' + room.split('@')[0] + "' per user '" + sender + "'.");
            }
        }
    }
},
{
    command: 'motdoff',
    exec: function(client, server, room, sender, message, extras) {
        var ignoredReceiver = false;
        server.motdIgnore.forEach(function(receiver) {
            if (receiver == sender) ignoredReceiver = true;
        });

        if (! ignoredReceiver) {
            // Add user to MOTD ignore list
            server.motdIgnore.push(sender);
            fs.writeFile(server.nomotdfile, JSON.stringify(server.motdIgnore), function(err) {
                if (err) {
                    return util.log("[ERROR] Unable to write to MOTD Ignore file.");
                }
                if (room === 'pm') {
                    sendPM(client, server, "User '" + sender + "' unsubscribed from " + server.name + " MOTD notices.", sender);
                } else {
                    sendChat(client, server, "User '" + sender + "' unsubscribed from " + server.name + " MOTD notices.", room);
                }
                util.log("[MOTD] User '" + sender + "' added to '" + server.name + "' opt-out list.");
            });
        } else {
            // Tell user they already have MOTDs turned off
            if (room === 'pm') {
                sendPM(client, server, "User '" + sender + "' already unsubscribed from " + server.name + " MOTD notices.", sender);
            } else {
                sendChat(client, server, "User '" + sender + "' already unsubscribed from " + server.name + " MOTD notices.", room);
            }
        }
    }
},
{
    command: 'motdon',
    exec: function(client, server, room, sender, message, extras) {
        var ignoredReceiver = false;
        server.motdIgnore.forEach(function(receiver) {
            if (receiver == sender) ignoredReceiver = true;
        });

        if (! ignoredReceiver) {
            // Remove user to MOTD ignore list
            for (var i = 0; i < server.motdIgnore.length; i++) {
                if (server.motdIgnore[i] === sender) index = i;
            }
            server.motdIgnore.splice(index, 1);

            fs.writeFile(server.nomotdfile, JSON.stringify(server.motdIgnore), function(err) {
                if (err) {
                    return util.log("[ERROR] Unable to write to MOTD Ignore file.");
                }
                if (room === 'pm') {
                    sendPM(client, server, "User '" + sender + "' subscribed to " + server.name + " MOTD notices.", sender);
                } else {
                    sendChat(client, server, "User '" + sender + "' subscribed to " + server.name + " MOTD notices.", room);
                }
                util.log("[MOTD] User '" + sender + "' removed from '" + server.name + "' opt-out list.");
            });
        } else {
            // Tell user they already have MOTDs turned on
            if (room === 'pm') {
                sendPM(client, server, "User '" + sender + "' already subscribed to " + server.name + " MOTD notices.", sender);
            } else {
                sendChat(client, server, "User '" + sender + "' already subscribed to " + server.name + " MOTD notices.", room);
            }
        }
    }
}
];

/*****************************************************************************/

// function to find the index of a room
var indexOfRoom = function(client, server, room) {
    for (var i = 0; i < server.rooms.length; i++) {
        if (server.rooms[i].name === room) return i;
    }
    return -1;
};

// function to send a message to a group chat
function sendChat(client, server, message, room) {
    client[server.name].send(new xmpp.Element('message', { to: room + '/' + server.nickname, type: 'groupchat' }).c('body').t(message));
}

// function to send a private message
function sendPM(client, server, message, user) {
    client[server.name].send(new xmpp.Element('message', { to: user, type: 'chat' }).c('body').t(message));
}

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

// Timer to send MOTD messages to joining users.
function timerMOTD(client, server) { setInterval(function() { sendMOTD(client, server); }, 500); }
function sendMOTD(client, server) {
    server.motdReceivers.forEach(function(receiver) {
        epochTime = Math.floor((new Date).getTime() / 1000);
        if ((epochTime - receiver.joinTime > 2) && receiver.sendTime === 0) {
            // User joined 2 seconds ago, send the MOTD.
            receiver.sendTime = epochTime;
            var user = receiver.name + '@' + server.address;
            sendPM(client, server, server.motd.toString(), user);
            util.log("[MOTD] MOTD sent to user '" + receiver.name + "' on " + server.name + ".");
        } else if ((receiver.sendTime > 0) && (epochTime - receiver.sendTime > 300)) {
            // User was sent MOTD 5 minutes ago, remove from receiver list so they can get it again.
            for (var i = 0; i < server.motdReceivers.length; i++) {
                if (server.motdReceivers[i].name === receiver.name) index = i;
            }
            server.motdReceivers.splice(index, 1);
        }
    });
}

var client = [];
config.servers.forEach(function(server) {
    // Server initialization
    getMOTD(server);
    getMOTDIgnore(server);
    server.motdReceivers = [];

    // Connect to XMPP servers
    client[server.name] = new xmpp.Client({
        jid: server.username + '/bot',
        password: server.password,
        reconnect: true
    });

    // Handle client errors
    client[server.name].on('error', function(err) {
        util.log("[ERROR] Unknown: " + err);
    });

    // Handle disconnect
    client[server.name].on('disconnect', function() {
        server.rooms.forEach(function(room) {
            room.joined = false;
        });
        util.log("[STATUS] Client disconnected from " + server.name + ". Reconnecting...");
    });

    // Once connected, set available presence and join rooms
    client[server.name].on('online', function() {
        util.log("[STATUS] Client connected to server: " + server.name);
     
        // Set ourselves as online
        client[server.name].send(new xmpp.Element('presence', { type: 'available' }).c('show').t('chat'));
     
        // Join rooms (and request no chat history)
        server.rooms.forEach(function(room) {
            var roomJID = room.name + '@' + server.service + '.' + server.address;
            client[server.name].send(new xmpp.Element('presence', { to: roomJID + '/' + server.nickname }).
                c('x', { xmlns: 'http://jabber.org/protocol/muc' })
            );
            util.log("[STATUS] Client joined '" + room.name + "' on " + server.name + ".");
        });

        // Start sending MOTDs
        timerMOTD(client, server);
    });

    // Parse each stanza from the XMPP server
    client[server.name].on('stanza', function(stanza) {
     
        // util.log('***** ' + stanza + ' *****');

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
                var roomIndex = indexOfRoom(client, server, room);

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
                        cmd.exec(client, server, room, sender, message, {motdadmin: motdadmin});
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
                        cmd.exec(client, server, 'pm', sender, message, {motdadmin: motdadmin});
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
});