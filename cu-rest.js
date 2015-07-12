/* Module to access Camelot Unchained's REST API

This entire module is simply a Node.js version of code from Mehuge.

https://github.com/Mehuge/cu-ui/blob/mehuge-ui/mehuge/mehuge-rest.ts

*/

var request = require('request');

var servers = [];
var server = "Hatchery";

function restAPI(options) {
    if(!options.server) {
        server = "Hatchery";
    } else {
        server = options.server;
    }

    return this;
}

function getServerInfo(server) {
    var domain = "camelotunchained.com";
    if (server) {
        for (var i = 0; i < servers.length; i++) {
            if (servers[i].name === server) {
                return servers[i];
            }
        }
        return {
            host: (server === "Hatchery" ? "hatchery" : server.toLowerCase()) + "." + domain
        };
    }
    return {
        host: "api.citystateentertainment.com"
    };
}

function getServerURI(verb) {
    var host = "";
    var port = 8000;
    var protocol = "http:";
    switch (verb) {
        case "servers":
            port = 8001;
            host = getServerInfo().host;
            break;
        case "characters":
            protocol = "https:";
            port = 4443;
            host = getServerInfo(server).host;
            break;
        default:
            host = getServerInfo(server).host;
            break;
    }
    return protocol + "//" + host + ":" + port + "/api/";
}

restAPI.prototype.call = function(verb, params, callback) {
    var serverURI = getServerURI(verb);

    // Raw call to the CU REST API
    params = params || {};

    request({
        uri: serverURI + verb,
        method: params.type || "GET",
        qs: params.query,
        timeout: params.timeout,

    },
    function (error, response, body) {
        if (callback && typeof callback === "function"){
            if(error){
                console.error('Unable to read API:', error);
                callback(error);
            }else{
                callback(JSON.parse(body));
            }
        } else {
            if (error) {
                return console.error('Unable to read API:', error);
            }
            console.log('Success!  Server responded with:', body);
            return JSON.parse(body);            
        }
    });
};

restAPI.prototype.selectServer = function(name) {
    server = name;
};

restAPI.prototype.getServers = function(callback) {
    return restAPI.prototype.call("servers", {}, callback);
};

restAPI.prototype.getFactions = function(callback) {
    return restAPI.prototype.call("game/factions", { timeout: 2000 }, callback);
};

restAPI.prototype.getRaces = function(callback) {
    return restAPI.prototype.call("game/races", { timeout: 2000 }, callback);
};

restAPI.prototype.getPlayers = function(callback) {
    return restAPI.prototype.call("game/players", { timeout: 2000 }, callback);
};

restAPI.prototype.getControlGame = function(query, callback) {
    return restAPI.prototype.call("game/controlgame", { query: query, timeout: 2000 }, callback);
};

restAPI.prototype.getBanes = function(callback) {
    return restAPI.prototype.call("game/banes", {}, callback);
};

restAPI.prototype.getBoons = function(callback) {
    return restAPI.prototype.call("game/boons", {}, callback);
};

restAPI.prototype.getAttributes = function(callback) {
    return restAPI.prototype.call("game/attributes", {}, callback);
};

restAPI.prototype.getCharacters = function(loginToken, callback) {
    return restAPI.prototype.call("characters", { query: { loginToken: loginToken } }, callback);
};

restAPI.prototype.getAbilities = function(callback) {
    return restAPI.prototype.call("abilities", {}, callback);
};

restAPI.prototype.getCraftedAbilities = function(query, callback) {
    return restAPI.prototype.call("craftedabilities", { query: query }, callback);
};

restAPI.prototype.getPatchNotes = function(callback) {
    return restAPI.prototype.call("patchnotes", {}, callback);
};

restAPI.prototype.getBanners = function(callback) {
    return restAPI.prototype.call("banners", {}, callback);
};

restAPI.prototype.getEvents = function(callback) {
    return restAPI.prototype.call("scheduledevents", {}, callback);
};

restAPI.prototype.getKills = function(query, callback) {
    return restAPI.prototype.call("kills", { query: query }, callback);
};

module.exports = restAPI;