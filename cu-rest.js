/* Module to access Camelot Unchained's REST API

This entire module is simply a Node.js version of code from Mehuge.

https://github.com/Mehuge/cu-ui/blob/mehuge-ui/mehuge/mehuge-rest.ts

*/

var request = require('request');
var util = require('util');

var servers = [];

function restAPI(name) {
    if(!name) {
        this.server = "Hatchery";
    } else {
        this.server = name;
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

function getServerURI(server, verb) {
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

restAPI.prototype.call = function(server, verb, params, callback) {
    var serverURI = getServerURI(server, verb);

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
                util.log("[ERROR] Unable to read API (" + verb + "): " + error);
                callback(null, error);
            }else{
                callback(JSON.parse(body), null);
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

restAPI.prototype.getServers = function(callback) {
    return restAPI.prototype.call(this.server, "servers", {}, callback);
};

restAPI.prototype.getFactions = function(callback) {
    return restAPI.prototype.call(this.server, "game/factions", { timeout: 2000 }, callback);
};

restAPI.prototype.getRaces = function(callback) {
    return restAPI.prototype.call(this.server, "game/races", { timeout: 2000 }, callback);
};

restAPI.prototype.getPlayers = function(callback) {
    return restAPI.prototype.call(this.server, "game/players", { timeout: 2000 }, callback);
};

restAPI.prototype.getControlGame = function(query, callback) {
    return restAPI.prototype.call(this.server, "game/controlgame", { query: query, timeout: 2000 }, callback);
};

restAPI.prototype.getBanes = function(callback) {
    return restAPI.prototype.call(this.server, "game/banes", {}, callback);
};

restAPI.prototype.getBoons = function(callback) {
    return restAPI.prototype.call(this.server, "game/boons", {}, callback);
};

restAPI.prototype.getAttributes = function(callback) {
    return restAPI.prototype.call(this.server, "game/attributes", {}, callback);
};

restAPI.prototype.getCharacters = function(loginToken, callback) {
    return restAPI.prototype.call(this.server, "characters", { query: { loginToken: loginToken } }, callback);
};

restAPI.prototype.getAbilities = function(callback) {
    return restAPI.prototype.call(this.server, "abilities", {}, callback);
};

restAPI.prototype.getCraftedAbilities = function(query, callback) {
    return restAPI.prototype.call(this.server, "craftedabilities", { query: query }, callback);
};

restAPI.prototype.getPatchNotes = function(callback) {
    return restAPI.prototype.call(this.server, "patchnotes", {}, callback);
};

restAPI.prototype.getBanners = function(callback) {
    return restAPI.prototype.call(this.server, "banners", {}, callback);
};

restAPI.prototype.getEvents = function(callback) {
    return restAPI.prototype.call(this.server, "scheduledevents", {}, callback);
};

restAPI.prototype.getKills = function(query, callback) {
    return restAPI.prototype.call(this.server, "kills", { query: query }, callback);
};

module.exports = restAPI;