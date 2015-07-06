// Camelot Unchained XMPP bot using node.js
// To use, run `node cu-chat-bot.js`

// Requires node-xmpp
// Based on https://gist.github.com/powdahound/940969
// Much thanks to Mehuge for extensive help.

var sys = require('sys');
var util = require('util');
var fs = require('fs');
var xmpp = require('node-xmpp');

var config = require('./cu-chatbot.cfg');

// Chat commands
var commandChar = '!';
var chatCommands = [
{
    command: 'motdtest',
    exec: function(client, server, room, sender, message, extras) {
        var params = message.replace(/^!motdtest[\ ]*/, '');
        if (extras && extras.motdadmin) {
            var motdadmin = extras.motdadmin;
        } else {
            var motdadmin = 'no';
        }

        if (params.length > 0) {
            if (motdadmin === 'yes') {
                util.log('set motd');
            } else {
                util.log('tell user they cannot set motd');
            }

            // send response
            if (room === 'pm') {
                sendPM(client, server, 'set motd', sender);
            } else {
                //
                // sendChat(client, server, params, room);
            }
        } else {
            // send motd
            if (room === 'pm') {
                sendPM(client, server, 'display motd', sender);
            } else {
                //
                // sendChat(client, server, params, room);
            }
        }
    }
}
];

/*****************************************************************************/

// function to send a message to a group chat
var sendChat = function(client, server, message, room) {
    client[server.name].send(new xmpp.Element('message', { to: room + '/' + server.nickname, type: 'groupchat' }).c('body').t(message));
};

// function to send a private message
var sendPM = function(client, server, message, user) {
    client[server.name].send(new xmpp.Element('message', { to: user, type: 'chat' }).c('body').t(message));
};

// function to find the index of a room
var indexOfRoom = function(client, server, room) {
    for (var i = 0; i < server.rooms.length; i++) {
        if (server.rooms[i].name === room) return i;
    }
    return -1;
};

config.servers.forEach(function(server) {
    // Connect to XMPP servers
    var client = [];
    client[server.name] = new xmpp.Client({
        jid: server.username + '/bot',
        password: server.password
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
            util.log('[STATUS] Client joined \'' + room.name + '\' on server \'' + server.name + '\'.');
        });
    });

    // Parse each stanza from Hatchery
    client[server.name].on('stanza', function(stanza) {
     
        util.log('***** ' + stanza + ' *****');

        // Always log error stanzas
        if (stanza.attrs.type === 'error') {
            util.log('[ERROR] ' + stanza);
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

                if (server.rooms[roomIndex].joined === 'yes' && role !== 'none') {
                    util.log('[STATUS] User \'' + senderName + '\' joined \'' + room + '\' on \'' + server.name + '\'');
                }

                // Status code 110 means initial nicklist on room join is complete
                if (status == "<status code=\"110\"/>") {
                    server.rooms[roomIndex].joined = 'yes';
                }
            }
        } else if (stanza.is('message') && stanza.attrs.type === 'groupchat') {
            /* --------------------------
               Handle group chat messages
               -------------------------- */
            var body = stanza.getChild('body');
            // message without body is probably a topic change
            if (!body) {
                return;
            }
            
            var motdadmin = 'no';
            var message = body.getText();
            var sender = stanza.attrs.from.split('/')[1];
            var room = stanza.attrs.from.split('/')[0];
            var cse = stanza.getChild('cseflags').attrs.cse;

            if (cse === "cse") {
                motdadmin = 'yes';
            } else {
                config.motdAdmins.forEach(function(user) {
                    if (sender === user) {
                        motdadmin = 'yes';
                    }
                });
            }

            if (cse === "cse") {
                util.log('[CHAT-CSE] ' + sender + '@' + server.name + '/' + room.split('@')[0] + ': ' + message);
            } else {
                util.log('[CHAT] ' + sender + '@' + server.name + '/' + room.split('@')[0] + ': ' + message);
            }

            // If message matches a defined command, run it
            if (message[0] === commandChar) {
                var userCommand = message.split(' ')[0].split('!')[1];
                chatCommands.forEach(function(cmd) {
                    if (userCommand === cmd.command) {
                        cmd.exec(client, server, room, sender, message);
                    }
                });
            }

        } else if (stanza.is('message') && stanza.attrs.type === 'chat') {
            /* --------------------------
               Handle private messages
               -------------------------- */
            var body = stanza.getChild('body');
            // message without body is probably a topic change
            if (!body) {
                return;
            }

            var motdadmin = 'no';
            var message = body.getText();
            var sender = stanza.attrs.from;
            var cse = stanza.getChild('cseflags').attrs.cse;

            if (cse === "cse") {
                motdadmin = 'yes';
            } else {
                config.motdAdmins.forEach(function(user) {
                    if (sender.split('@')[0] === user) {
                        motdadmin = 'yes';
                    }
                });
            }

            // Log message
            util.log('[PM] ' + sender + '@' + server.name + ': ' + message);

            // If message matches a defined command, run it
            if (message[0] === commandChar) {
                var userCommand = message.split(' ')[0].split('!')[1];
                chatCommands.forEach(function(cmd) {
                    if (userCommand === cmd.command) {
                        cmd.exec(client, server, 'pm', sender, message, {motdadmin: motdadmin});
                    }
                });
            }

        } else {
            /* --------------------------
               Ignore everything else
               -------------------------- */
            return;
        }
    });
});








// fs.writeFile("/tmp/test", "Hey there!", function(err) {
//   if(err) {
//       return console.log(err);
//   }

//   console.log("The file was saved!");
// }); 
