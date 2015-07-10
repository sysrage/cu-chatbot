# cu-chatbot
Chatbot for Camelot Unchained

This is a general-purpose bot written in Node.js for use with Camelot Unchained. There are currently two base functionalities:
 1. Monitoring for users joining the XMPP server or game client and sending them a Message of the Day (MOTD).
 2. Monitoring chat rooms for messages sent by CSE staff members and sending those messages to users not connected to the XMPP server.

Additional commands can easily be added in the chatCommands object at the top of the script.

Requires:
 - [Node.js 11.x](https://nodejs.org/dist/v0.11.16/)
 - [node-xmpp](https://github.com/node-xmpp/node-xmpp)
 - [request](https://github.com/request/request)
 - [Camelot Unchained](http://camelotunchained.com/) account

Optional:
 - [node-pushover](https://github.com/SamDecrock/node-pushover) - Needed to send Pushover notifications.
 - [node-applescript](https://github.com/TooTallNate/node-applescript) - Needed to send iMessage notifications. Requires OSX.

Much thanks to mehuge, reallifegobbo, and burfo for their help with learning Node.js.

Originally based on https://gist.github.com/powdahound/940969
