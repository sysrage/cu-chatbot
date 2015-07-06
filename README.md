# cu-chatbot
Chatbot for Camelot Unchained

Originally based on https://gist.github.com/powdahound/940969

This is a general-purpose bot written in Node.js for use with Camelot Unchained. There are currently two base functionalities:
 1. Monitoring chat rooms for messages sent by CSE staff members and sending those to users not connected to the XMPP server.
 2. Monitoring for users joining the XMPP server or game client and sending them a Message of the Day (MOTD).

Any !command can also be dynamically added within the configuration file.

Requires:
 - Node.js 11.x
 - node-xmpp

Much thanks to Mehuge, reallifegobbo, and burfo for their help with learning Node.js.
