# cu-chatbot
Chatbot for Camelot Unchained

This is a general-purpose bot written in Node.js for use with Camelot Unchained. There are currently two base functionalities:
 1. Monitoring for users joining the XMPP server or game client and sending them a Message of the Day (MOTD).
 2. Monitoring chat rooms for messages sent by CSE staff members and sending those messages to users not connected to the XMPP server.

Additional commands can easily be added in the chatCommands object at the top of the script.

Requires:
 - Node.js 11.x
 - node-xmpp
 - Camelot Unchained account

Much thanks to mehuge, reallifegobbo, and burfo for their help with learning Node.js.
Originally based on https://gist.github.com/powdahound/940969
