#!/bin/env node
//  OpenShift sample Node application
var express = require('express');
var fs      = require('fs');

var cuRestAPI = require('./cu-rest.js');
var config = require('./cu-chatbot.cfg');



// function to read in the saved game stats
function getGameStats(server, callback) {
    fs.readFile(server.gameFile, function(err, data) {
        if (err && err.code === 'ENOENT') {
            var gameStats = {
                firstGame: Math.floor((new Date).getTime() / 1000),
                gameNumber: 0,
                lastStartTime: 0,
                artWins: 0,
                tuaWins: 0,
                vikWins: 0
            };

            fs.writeFile(server.gameFile, JSON.stringify(gameStats), function(err) {
                if (err) {
                    return console.log("[ERROR] Unable to create game stats file.");
                }
                console.log("[STATUS] Game stats file did not exist. Empty file created.");
            });
        } else {
            var gameStats = JSON.parse(data);
        }
        callback(gameStats);
    });
}

// function to read in the saved player stats
function getPlayerStats(server, callback) {
    fs.readFile(server.playerFile, function(err, data) {
        if (err && err.code === 'ENOENT') {
            var playerStats = [];

            fs.writeFile(server.playerFile, JSON.stringify(playerStats), function(err) {
                if (err) {
                    return console.log("[ERROR] Unable to create player stats file.");
                }
                console.log("[STATUS] Player stats file did not exist. Empty file created.");
            });
        } else {
            var playerStats = JSON.parse(data);
        }
        callback(playerStats);
    });    
}

/**
 *  Define the sample application.
 */
var SampleApp = function() {

    //  Scope.
    var self = this;


    /*  ================================================================  */
    /*  Helper functions.                                                 */
    /*  ================================================================  */

    /**
     *  Set up server IP address and port # using env variables/defaults.
     */
    self.setupVariables = function() {
        //  Set the environment variables we need.
        self.ipaddress = process.env.OPENSHIFT_NODEJS_IP;
        self.port      = process.env.OPENSHIFT_NODEJS_PORT || 8080;

        if (typeof self.ipaddress === "undefined") {
            //  Log errors on OpenShift but continue w/ 127.0.0.1 - this
            //  allows us to run/test the app locally.
            console.warn('No OPENSHIFT_NODEJS_IP var, using 127.0.0.1');
            // self.ipaddress = "127.0.0.1";
            self.ipaddress = "127.0.0.1";

        };
    };


    /**
     *  Populate the cache.
     */
    self.populateCache = function() {
        if (typeof self.zcache === "undefined") {
            self.zcache = { 'index.html': '' };
        }

        //  Local cache for static content.
        self.zcache['index.html'] = fs.readFileSync('./index.html');
    };


    /**
     *  Retrieve entry (content) from cache.
     *  @param {string} key  Key identifying content to retrieve from cache.
     */
    self.cache_get = function(key) { return self.zcache[key]; };


    /**
     *  terminator === the termination handler
     *  Terminate server on receipt of the specified signal.
     *  @param {string} sig  Signal to terminate on.
     */
    self.terminator = function(sig){
        if (typeof sig === "string") {
           console.log('%s: Received %s - terminating sample app ...',
                       Date(Date.now()), sig);
           n.kill();
           process.exit(1);
        }
        console.log('%s: Node server stopped.', Date(Date.now()) );
    };


    /**
     *  Setup termination handlers (for exit and a list of signals).
     */
    self.setupTerminationHandlers = function(){
        //  Process on exit and signals.
        process.on('exit', function() { self.terminator(); });

        // Removed 'SIGPIPE' from the list - bugz 852598.
        ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
         'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
        ].forEach(function(element, index, array) {
            process.on(element, function() { self.terminator(element); });
        });
    };


    /*  ================================================================  */
    /*  App server functions (main app logic here).                       */
    /*  ================================================================  */

    /**
     *  Create the routing table entries + handlers for the application.
     */
    self.createRoutes = function() {
        self.routes = { };

        self.routes['/asciimo'] = function(req, res) {
            var link = "http://i.imgur.com/kmbjB.png";
            res.send("<html><body><img src='" + link + "'></body></html>");
        };

        self.routes['/test'] = function(req, res) {
            var hatcheryScore = 'Score for Hatchery';

            res.setHeader('Content-Type', 'text/html');
            res.send('test');
        };

        self.routes['/'] = function(req, res) {
            server = {};
            pageContent = "";
            config.servers.forEach(function(s, index) {
                server[s.name] = s;
                server[s.name].rAPI = new cuRestAPI(s.name);
                server[s.name].rAPI.getControlGame(null, function(data, error) {
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

                        server[s.name].score = "<b>Game State:</b> " + gameState +
                            "<br /><b>Time Remaining:</b> " + minLeft + " min. " + secLeft + " sec." +
                            "<br /><b>Arthurian Score:</b> " + artScore +
                            "<br /><b>TuathaDeDanann Score:</b> " + tuaScore +
                            "<br /><b>Viking Score:</b> " + vikScore;
                    } else {
                        server[s.name].score = '<p style="color: #610B0B; margin-top: 1px; margin-bottom: 1px; margin-left: 1px; margin-right: 1px;">Error accessing API. Server may be down.';
                    }

                    getGameStats(server[s.name], function(gs) {
                        server[s.name].wins = "<b>Total Rounds Played:</b> " + gs.gameNumber +
                            "<br /><b>Arthurian Wins:</b> " + gs.artWins +
                            "<br /><b>TuathaDeDanann Wins:</b> " + gs.tuaWins +
                            "<br /><b>Viking Wins:</b> " + gs.vikWins;

                        getPlayerStats(server[s.name], function(ps) {

                            for (var i = 0; i < 10; i++) {
                                if (! ps[i]) ps[i] = {name: 'Nobody', kills: 0, deaths: 0};
                            }

                            var playersSortedByKills = ps.concat().sort(function(a, b) { return b.kills - a.kills; });
                            var playersSortedByDeaths = ps.concat().sort(function(a, b) { return b.deaths - a.deaths; });

                            server[s.name].leaderboard = '<center><table width="95%" style="border-collapse: collapse;">' +
                                '<tr><td colspan="3" width="50%" class="leaderBoardTitle"><center><p class="leaderBoardTitle">Kills</p></center></td><td>&nbsp;</td><td colspan="3" width="50%" class="leaderBoardTitle"><center><p class="leaderBoardTitle">Deaths</p></center></td></tr>';
                            for (var i = 0; i < 10; i++) {
                                server[s.name].leaderboard = server[s.name].leaderboard +
                                    '<tr><td width="3%" class="leaderBoardLine1L"><b>#' + (i + 1) + '</b></td><td width="33%" class="leaderBoardLine1M">' + playersSortedByKills[i].name + '</td><td width="10%" align="right" class="leaderBoardLine1R">' + playersSortedByKills[i].kills + '</td>' +
                                    '<td>&nbsp;</td><td width="3%" class="leaderBoardLine1L"><b>#' + (i + 1) + '</b></td><td width="33%" class="leaderBoardLine1M">' + playersSortedByDeaths[i].name + '</td><td width="10%" align="right" class="leaderBoardLine1R">' + playersSortedByDeaths[i].deaths + '</td></tr>'
                            }
                            server[s.name].leaderboard = server[s.name].leaderboard + '</table></center>';


                            server[s.name].rAPI.getPlayers(function(data, error) {
                                if (! error) {
                                    var players = data;
                                    var totalPlayers = players.arthurians + players.tuathaDeDanann + players.vikings;
                                    server[s.name].players = "<b>Current Player Count:</b> " + totalPlayers +
                                        "<br /><b>Arthurians:</b> " + players.arthurians +
                                        "<br /><b>TuathaDeDanann:</b> " + players.tuathaDeDanann +
                                        "<br /><b>Vikings:</b> " + players.vikings;
                                } else {
                                    server[s.name].players = '<p style="color: #610B0B; margin-top: 1px; margin-bottom: 1px; margin-left: 1px; margin-right: 1px;">Error accessing API. Server may be down.';
                                }

                                pageContent = pageContent +
                                        '<tr><td colspan="3"><center><p class="serverTitle">' + s.name.charAt(0).toUpperCase() + s.name.slice(1) + '</h2></center></td></tr><tr>' +
                                        '<td valign="top" width="33%" bgcolor="#606060" style="border-style:groove; border-color:#C0C0C0"><table width="100%">' +
                                            '<tr><td bgcolor="#F3E2A9"><center><p class="sectionTitle">Current Score</p></center></td></tr>' +
                                            '<tr><td>' + server[s.name].score + '</td></tr>' +
                                        '</table></td>' +
                                        '<td valign="top" width="34%" bgcolor="#606060" style="border-style:groove; border-color:#C0C0C0"><table width="100%">' +
                                            '<tr><td bgcolor="#F3E2A9"><center><p class="sectionTitle">Current Players</p></center></td></tr>' +
                                            '<tr><td>' + server[s.name].players + '</td></tr>' +
                                        '</table></td>' +
                                        '<td valign="top" width="33%" bgcolor="#606060" style="border-style:groove; border-color:#C0C0C0"><table width="100%">' +
                                            '<tr><td bgcolor="#F3E2A9"><center><p class="sectionTitle">Realm History</p></center></td></tr>' +
                                            '<tr><td>' + server[s.name].wins + '</td></tr>' +
                                        '</table></td></tr>' +

                                        '<tr><td colspan="3" valign="top" width="40%" bgcolor="#606060" style="border-style:groove; border-color:#C0C0C0"><table width="100%">' +
                                            '<tr><td bgcolor="#F3E2A9"><center><p class="sectionTitle">Leaderboard</p></center></td></tr>' +
                                            '<tr><td>' + server[s.name].leaderboard + '</td></tr>' +
                                        '</table></td></tr>';

                                if ((config.servers.length -1) === index) {
                                    res.setHeader('Content-Type', 'text/html');
                                    res.send(self.cache_get('index.html').toString().replace('##PAGECONTENT##', pageContent));
                                }
                            });
                        });
                    });
                });
            });
        };
    };


    /**
     *  Initialize the server (express) and create the routes and register
     *  the handlers.
     */
    self.initializeServer = function() {
        self.createRoutes();
        self.app = express.createServer();

        self.app.use('/images', express.static(__dirname+'/images'));

        //  Add handlers for the app (from the routes).
        for (var r in self.routes) {
            self.app.get(r, self.routes[r]);
        }
    };


    /**
     *  Initializes the sample application.
     */
    self.initialize = function() {
        self.setupVariables();
        self.populateCache();
        self.setupTerminationHandlers();

        // Create the express server and routes.
        self.initializeServer();
    };


    /**
     *  Start the server (starts up the sample application).
     */
    self.start = function() {
        //  Start the app on the specific interface (and port).
        self.app.listen(self.port, self.ipaddress, function() {
            console.log('%s: Node server started on %s:%d ...',
                        Date(Date.now() ), self.ipaddress, self.port);
        });
    };

};   /*  Sample Application.  */



/**
 *  main():  Main code.
 */
var zapp = new SampleApp();
zapp.initialize();
zapp.start();

var n = require('child_process').fork(__dirname + '/cu-chatbot.js');
