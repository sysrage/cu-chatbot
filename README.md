# cu-chatbot.js
Chatbot for Camelot Unchained

This is a general-purpose bot written in Node.js for use with Camelot Unchained. The following functionalities exist:
 1. Monitoring for users joining the XMPP server or game client and sending them a Message of the Day (MOTD).
 2. Monitoring chat rooms for messages sent by CSE staff members and sending those messages to users not connected to the XMPP server.
 3. Providing chat-based commands to access the Camelot Unchained REST API.

Additional commands can easily be added in the chatCommands object at the top of the script.

Requires:
 - [Node.js 11.x](https://nodejs.org/dist/v0.11.16/)
 - [node-xmpp](https://github.com/node-xmpp/node-xmpp)
 - [request](https://github.com/request/request)
 - [bluebird](https://github.com/petkaantonov/bluebird)*
 - [Camelot Unchained](http://camelotunchained.com/) account

<nowiki>*</nowiki> The bluebird module is only required when using older versions of Node.js which don't have Promise support.

Optional:
 - [node-pushover](https://github.com/SamDecrock/node-pushover) - Needed to send Pushover notifications.
 - [node-applescript](https://github.com/TooTallNate/node-applescript) - Needed to send iMessage notifications. Requires OSX.

Much thanks to mehuge, reallifegobbo, and burfo for their help with learning Node.js.

Originally based on https://gist.github.com/powdahound/940969

# server.js
OpenShift server script which provides a web interface to game statistics and starts the chatbot.
