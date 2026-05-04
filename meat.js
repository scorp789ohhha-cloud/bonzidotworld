const log = require("./log.js").log;
const Ban = require("./ban.js");
const Utils = require("./utils.js");
const io = require('./index.js').io;
const settings = require("./settings.json");
const sanitize = require('sanitize-html');

const banStore = {};
const kickStore = {};
let roomsPublic = [];
let rooms = {};
let usersAll = [];

const DEFAULT_ROOMS = ['default', 'area_51', 'news', 'poland', 'why'];
const PUBLIC_ROOMS = ['default'];

function normalizeRid(rid) {
    if (typeof rid !== 'string') return rid;
    return rid.toLowerCase();
}

function addBanEntry(guid, ip, end, reason) {
    const entry = { end: end, reason: reason };
    banStore['guid:' + guid] = entry;
    banStore['ip:' + ip] = entry;
}

function getBanEntry(guid, ip) {
    const entry = banStore['guid:' + guid] || banStore['ip:' + ip] || null;
    if (!entry) return null;
    if (new Date() > new Date(entry.end)) {
        delete banStore['guid:' + guid];
        delete banStore['ip:' + ip];
        return null;
    }
    return entry;
}

function isBanned(guid, ip) {
    return !!getBanEntry(guid, ip);
}

function addKickEntry(guid, ip) {
    const expiry = Date.now() + 10000;
    kickStore['guid:' + guid] = expiry;
    kickStore['ip:' + ip] = expiry;
}

function isKicked(guid, ip) {
    const guidKey = 'guid:' + guid;
    const ipKey = 'ip:' + ip;
    if (kickStore[guidKey] && Date.now() < kickStore[guidKey]) return true;
    if (kickStore[ipKey] && Date.now() < kickStore[ipKey]) return true;
    delete kickStore[guidKey];
    delete kickStore[ipKey];
    return false;
}

function initDefaultRooms() {
    DEFAULT_ROOMS.forEach(function(rid) {
        if (rooms[rid]) return;
        var prefs = JSON.parse(JSON.stringify(PUBLIC_ROOMS.indexOf(rid) !== -1 ? settings.prefs.public : settings.prefs.private));
        prefs.owner = null;
        prefs.name = rid;
        newRoom(rid, prefs);
        if (log && log.info) log.info.log('info', 'defaultRoom', { rid: rid });
    });
}

exports.beat = function() {
    try {
        initDefaultRooms();
        if (io) {
            io.on('connection', function(socket) {
                try {
                    new User(socket);
                } catch(e) {
                    if (log && log.info) log.info.log('error', 'connectionError', { error: e.message });
                }
            });
        }
    } catch(e) {
        if (log && log.info) log.info.log('error', 'beatError', { error: e.message });
    }
};

function checkRoomEmpty(room) {
    if (!room || !room.users) return;
    if (room.users.length != 0) return;
    if (DEFAULT_ROOMS.indexOf(room.rid) !== -1) return;

    if (log && log.info) log.info.log('debug', 'removeRoom', { room: room });

    let publicIndex = roomsPublic.indexOf(room.rid);
    if (publicIndex != -1)
        roomsPublic.splice(publicIndex, 1);
    
    if (room.deconstruct) room.deconstruct();
    delete rooms[room.rid];
}

const DEFAULT_ROOM_VIDS = {
    'news':    '9Auq9mYxFEE',
    'why':     '3RpxJT5w7Tc',
    'area_51': 'TRc85qoNo6w',
    'poland':  'rRPQs_kM_nw'
};

class Room {
    constructor(rid, prefs) {
        this.rid = rid;
        this.prefs = prefs;
        this.users = [];
        this.vid = DEFAULT_ROOM_VIDS[rid] || null;
    }

    deconstruct() {
        try {
            if (this.users) {
                this.users.forEach((user) => {
                    if (user && user.disconnect) user.disconnect();
                });
            }
        } catch (e) {
            if (log && log.info) log.info.log('warn', 'roomDeconstruct', { e: e });
        }
    }

    isFull() {
        return this.users.length >= this.prefs.room_max;
    }

    join(user) {
        if (!user || !user.socket) return;
        if (this.users.indexOf(user) !== -1) return;
        try {
            user.socket.join(this.rid);
        } catch(e) {}
        this.users.push(user);
        if (io) io.emit('rooms:update', { _id: this.rid });
        this.updateUser(user);
    }

    leave(user) {
        try {
            if (!user) return;
            this.emit('leave', { guid: user.guid });
            let userIndex = this.users.indexOf(user);
            if (userIndex == -1) return;
            this.users.splice(userIndex, 1);
            checkRoomEmpty(this);
        } catch(e) {
            if (log && log.info) log.info.log('warn', 'roomLeave', { e: e });
        }
    }

    updateUser(user) {
        if (!user || !user.guid) return;
        this.emit('update', {
            guid: user.guid,
            userPublic: user.public
        });
    }

    getUsersPublic() {
        let usersPublic = {};
        if (!this.users) return usersPublic;
        this.users.forEach((user) => {
            if (user && user.guid && user.public) usersPublic[user.guid] = user.public;
        });
        return usersPublic;
    }

    emit(cmd, data) {
        try {
            if (io && this.rid) io.to(this.rid).emit(cmd, data);
        } catch(e) {}
    }
}

function newRoom(rid, prefs) {
    if (rooms[rid]) return;
    rooms[rid] = new Room(rid, prefs);
    if (PUBLIC_ROOMS.indexOf(rid) !== -1 && roomsPublic.indexOf(rid) === -1) {
        roomsPublic.push(rid);
    }
    if (log && log.info) log.info.log('debug', 'newRoom', { rid: rid });
}

let userCommands = {
    "godmode": function(word) {
        if (!this.room || !this.room.prefs) return;
        let success = word == this.room.prefs.godword;
        if (success) {
            this.private.runlevel = 3;
            this.public.flags = this.public.flags || {};
            this.public.flags.admin = true;
            if (this.socket) this.socket.emit("update", {
                guid: this.guid,
                userPublic: this.public
            });
        }
        if (log && log.info) log.info.log('debug', 'godmode', { guid: this.guid, success: success });
    },
    "kick": function(targetGuid, ...reasonParts) {
        if (this.private.runlevel < 3) return;
        if (!this.room || !this.room.users) return;
        let reason = reasonParts.join(" ") || null;
        let target = this.room.users.find(u => u && u.guid === targetGuid);
        if (!target) {
            if (this.socket) this.socket.emit('commandFail', { reason: "userNotFound" });
            return;
        }
        if (target.socket) target.socket.emit("kick", { reason: reason });
        addKickEntry(target.guid, target.getIp());
        if (target.socket) target.socket.disconnect(true);
        if (this.room) this.room.emit("bzw-o-kicked", { bonzi: target.public, reason: reason });
        if (log && log.info) log.info.log('info', 'kick', { by: this.guid, target: target.guid, reason: reason });
    },
    "ban": function(targetGuid, ...reasonParts) {
        if (this.private.runlevel < 3) return;
        let duration = 1440;
        let reason = reasonParts.join(" ") || null;
        let target = this.room.users.find(u => u && u.guid === targetGuid);
        if (!target) {
            if (this.socket) this.socket.emit('commandFail', { reason: "userNotFound" });
            return;
        }
        let end = new Date(Date.now() + duration * 60 * 1000);
        addBanEntry(target.guid, target.getIp(), end, reason);
        if (target.socket) target.socket.emit("ban", { reason: reason, end: end });
        if (target.socket) target.socket.disconnect(true);
        if (this.room) this.room.emit("bzw-o-banned", { bonzi: target.public, length: duration, reason: reason });
        if (log && log.info) log.info.log('info', 'ban', { by: this.guid, target: target.guid, duration: duration, reason: reason });
    },
    "sanitize": function() {
        let sanitizeTerms = ["false", "off", "disable", "disabled", "f", "no", "n"];
        let argsString = Utils.argsString(arguments);
        this.private.sanitize = !sanitizeTerms.includes(argsString.toLowerCase());
    },
    "joke": function() {
        if (this.room) this.room.emit("joke", { guid: this.guid, rng: Math.random() });
    },
    "fact": function() {
        if (this.room) this.room.emit("fact", { guid: this.guid, rng: Math.random() });
    },
    "youtube": function(vidRaw) {
        var vid = this.private.sanitize ? sanitize(vidRaw) : vidRaw;
        if (this.room) this.room.emit("youtube", { guid: this.guid, vid: vid });
    },
    "gif": function(vidRaw) {
        var vid = this.private.sanitize ? sanitize(vidRaw) : vidRaw;
        if (this.room) this.room.emit("youtube", { guid: this.guid, vid: vid });
    },
    "image": function(urlRaw) {
        var url = this.private.sanitize ? sanitize(urlRaw) : urlRaw;
        if (this.room) this.room.emit("image", { guid: this.guid, url: url });
    },
    "img": function(urlRaw) {
        var url = this.private.sanitize ? sanitize(urlRaw) : urlRaw;
        if (this.room) this.room.emit("image", { guid: this.guid, url: url });
    },
    "video": function(urlRaw) {
        var url = this.private.sanitize ? sanitize(urlRaw) : urlRaw;
        if (this.room) this.room.emit("video", { guid: this.guid, src: { mp4: url } });
    },
    "backflip": function(swag) {
        if (this.room) this.room.emit("backflip", { guid: this.guid, swag: swag == "swag" });
    },
    "linux": "passthrough",
    "pawn": "passthrough",
    "bees": "passthrough",
    "color": function(color) {
        if (typeof color != "undefined") {
            if (settings.bonziColors.indexOf(color) == -1) return;
            this.public.color = color;
        } else {
            let bc = settings.bonziColors;
            this.public.color = bc[Math.floor(Math.random() * bc.length)];
        }
        if (this.room) this.room.updateUser(this);
    },
    "pope": function() {
        this.public.color = "pope";
        if (this.room) this.room.updateUser(this);
    },
    "asshole": function() {
        if (this.room) this.room.emit("asshole", { guid: this.guid, target: sanitize(Utils.argsString(arguments)) });
    },
    "owo": function() {
        if (this.room) this.room.emit("owo", { guid: this.guid, target: sanitize(Utils.argsString(arguments)) });
    },
    "triggered": "passthrough",
    "vaporwave": function() {
        if (this.socket) this.socket.emit("vaporwave");
        if (this.room) this.room.emit("youtube", { guid: this.guid, vid: "_4gl-FX2RvI" });
    },
    "unvaporwave": function() {
        if (this.socket) this.socket.emit("unvaporwave");
    },
    "name": function() {
        let argsString = Utils.argsString(arguments);
        if (argsString.length > this.room.prefs.name_limit) return;
        let name = argsString || this.room.prefs.defaultName;
        this.public.name = this.private.sanitize ? sanitize(name) : name;
        if (this.room) this.room.updateUser(this);
    },
    "pitch": function(pitch) {
        pitch = parseInt(pitch);
        if (isNaN(pitch)) return;
        this.public.pitch = Math.max(Math.min(parseInt(pitch), this.room.prefs.pitch.max), this.room.prefs.pitch.min);
        if (this.room) this.room.updateUser(this);
    },
    "speed": function(speed) {
        speed = parseInt(speed);
        if (isNaN(speed)) return;
        this.public.speed = Math.max(Math.min(parseInt(speed), this.room.prefs.speed.max), this.room.prefs.speed.min);
        if (this.room) this.room.updateUser(this);
    }
};

class User {
    constructor(socket) {
        if (!socket) return;
        this.guid = Utils.guidGen();
        this.socket = socket;

        try {
            if (isBanned(this.guid, this.getIp())) {
                const entry = getBanEntry(this.guid, this.getIp());
                if (entry) {
                    this.socket.emit("ban", { reason: entry.reason, end: entry.end });
                    this.socket.disconnect(true);
                    return;
                }
            }

            if (isKicked(this.guid, this.getIp())) {
                this.socket.emit("kick", { reason: "You were kicked." });
                this.socket.disconnect(true);
                return;
            }
        } catch(e) {
            this.socket.disconnect(true);
            return;
        }

        this.private = {
            login: false,
            sanitize: true,
            runlevel: 0
        };

        this.public = {
            color: settings.bonziColors[Math.floor(Math.random() * settings.bonziColors.length)]
        };

        if (log && log.access) log.access.log('info', 'connect', { guid: this.guid, ip: this.getIp() });

        this.socket.on('login', this.login.bind(this));
        this.socket.on('rooms:get', this.roomsGet.bind(this));
    }

    getIp() {
        try {
            return this.socket.request.connection.remoteAddress;
        } catch(e) {
            return "unknown";
        }
    }

    getPort() {
        try {
            return this.socket.handshake.address.port;
        } catch(e) {
            return "unknown";
        }
    }

    login(data) {
        try {
            if (typeof data != 'object') return;
            if (this.private.login) return;
            if (log && log.info) log.info.log('info', 'login', { guid: this.guid });
            
            let rid = normalizeRid(data.room);
            var roomSpecified = true;

            if ((typeof rid == "undefined") || (rid === "")) {
                rid = roomsPublic[Math.max(roomsPublic.length - 1, 0)];
                roomSpecified = false;
            }

            if (roomSpecified) {
                if (sanitize(rid) != rid) {
                    this.socket.emit("loginFail", { reason: "nameMal" });
                    return;
                }

                if (typeof rooms[rid] == "undefined") {
                    var tmpPrefs = JSON.parse(JSON.stringify(settings.prefs.private));
                    tmpPrefs.owner = this.guid;
                    newRoom(rid, tmpPrefs);
                } else if (rooms[rid].isFull()) {
                    if (log && log.info) log.info.log('debug', 'loginFail', { guid: this.guid, reason: "full" });
                    this.socket.emit("loginFail", { reason: "full" });
                    return;
                }
            } else {
                if ((typeof rooms[rid] == "undefined") || rooms[rid].isFull()) {
                    rid = Utils.guidGen();
                    roomsPublic.push(rid);
                    newRoom(rid, settings.prefs.public);
                }
            }
            
            this.room = rooms[rid];
            if (!this.room) return;

            this.socket.emit("room", { room: rid, name: rid });
            this.public.name = sanitize(data.name) || this.room.prefs.defaultName;

            if (this.public.name.length > this.room.prefs.name_limit) {
                this.socket.emit("loginFail", { reason: "nameLength" });
                return;
            }
        
            if (this.room.prefs.speed.default == "random")
                this.public.speed = Utils.randomRangeInt(this.room.prefs.speed.min, this.room.prefs.speed.max);
            else this.public.speed = this.room.prefs.speed.default;

            if (this.room.prefs.pitch.default == "random")
                this.public.pitch = Utils.randomRangeInt(this.room.prefs.pitch.min, this.room.prefs.pitch.max);
            else this.public.pitch = this.room.prefs.pitch.default;

            let ghostIndex = this.room.users.indexOf(this);
            if (ghostIndex !== -1) this.room.users.splice(ghostIndex, 1);

            this.room.join(this);
            this.private.login = true;
            this.socket.removeAllListeners("login");

            this.socket.emit('identity', { guid: this.guid, name: this.public.name, room: rid });
            this.socket.emit('updateAll', { usersPublic: this.room.getUsersPublic() });

            var isPublicRoom = roomsPublic.indexOf(rid) != -1;
            this.socket.emit('room', { id: rid, room: rid, name: isPublicRoom ? 'default' : rid, code: isPublicRoom ? null : rid, isOwner: this.room.prefs.owner == this.guid, isPublic: isPublicRoom });

            this.socket.on('talk', this.talk.bind(this));
            this.socket.on('command', this.command.bind(this));
            this.socket.on('disconnect', this.disconnect.bind(this));
            this.socket.on('room:join', this.roomJoin.bind(this));
        } catch(e) {
            if (log && log.info) log.info.log('error', 'loginError', { error: e.message });
            this.socket.disconnect(true);
        }
    }

    roomsGet(callback) {
        if (typeof callback !== 'function') callback = function() {};
        var list = [];
        if (roomsPublic) {
            roomsPublic.forEach(function(rid) {
                var room = rooms[rid];
                if (room) list.push({
                    _id: rid,
                    name: room.prefs.name || 'default',
                    users: room.users.length,
                    full: room.isFull(),
                    locked: !!room.prefs.passcode,
                    isPublic: true
                });
            });
        }
        if (rooms) {
            Object.keys(rooms).forEach(function(rid) {
                if (roomsPublic.indexOf(rid) !== -1) return;
                var room = rooms[rid];
                if (room) list.push({
                    _id: rid,
                    name: rid,
                    users: room.users.length,
                    full: room.isFull(),
                    locked: !!room.prefs.passcode,
                    isPublic: false
                });
            });
        }
        callback(list);
    }

    roomJoin(data, callback) {
        if (typeof data != 'object') return;
        if (typeof callback != 'function') callback = function() {};

        var rid = normalizeRid((typeof data.room === 'string') ? data.room : String(data.room || 'default'));

        if (!rid || rid === '') rid = 'default';

        if (this.room) {
            this.room.leave(this);
        }

        if (typeof rooms[rid] == 'undefined') {
            var tmpPrefs = JSON.parse(JSON.stringify(settings.prefs.private));
            tmpPrefs.owner = this.guid;
            newRoom(rid, tmpPrefs);
        } else if (rooms[rid].isFull()) {
            return callback({ success: false, message: 'Room is full.' });
        }

        this.room = rooms[rid];
        if (this.room) {
            this.room.join(this);
            callback({ success: true });

            var isPublicRoom = roomsPublic.indexOf(rid) != -1;
            this.socket.emit('room', { id: rid, room: rid, name: isPublicRoom ? 'default' : rid, code: isPublicRoom ? null : rid, isOwner: this.room.prefs.owner == this.guid, isPublic: isPublicRoom });
            this.socket.emit('updateAll', { usersPublic: this.room.getUsersPublic() });
            this.room.emit('room:changed');
        } else {
            callback({ success: false, message: 'Failed to join room' });
        }
    }

    talk(data) {
        if (typeof data != 'object') {
            data = { text: "HEY EVERYONE LOOK AT ME I'M TRYING TO SCREW WITH THE SERVER LMAO" };
        }

        if (log && log.info) log.info.log('debug', 'talk', { guid: this.guid, text: data.text });

        if (typeof data.text == "undefined") return;

        let text = this.private.sanitize ? sanitize(data.text) : data.text;
        if ((text.length <= this.room.prefs.char_limit) && (text.length > 0)) {
            const pitch = Math.max(Math.min(parseInt(this.public.pitch) || 100, 400), 50);
            const speed = Math.max(Math.min(parseInt(this.public.speed) || 150, 250), 50);
            const sapiUrl = "https://www.tetyys.com/SAPI4/SAPI4?text=" + encodeURIComponent(text) + "&voice=Adult%20Male%20%232%2C%20American%20English%20(TruVoice)&pitch=" + pitch + "&speed=" + speed;
            const audioId = "sapi_" + Date.now() + "_" + Math.random().toString(36).slice(2);
            if (this.room) this.room.emit('talk', { guid: this.guid, text: text, extra: { audio: { url: sapiUrl, id: audioId } } });
        }
    }

    command(data) {
        if (typeof data != 'object') return;

        var command;
        var args;
        
        try {
            var list = data.list;
            if (!list || !list.length) return;
            command = list[0].toLowerCase();
            args = list.slice(1);
    
            if (log && log.info) log.info.log('debug', command, { guid: this.guid, args: args });

            if (this.private.runlevel >= ((this.room.prefs.runlevel && this.room.prefs.runlevel[command]) || 0)) {
                let commandFunc = userCommands[command];
                if (commandFunc == "passthrough") {
                    if (this.room) this.room.emit(command, { "guid": this.guid });
                } else if (typeof commandFunc === 'function') {
                    commandFunc.apply(this, args);
                }
            } else if (this.socket) {
                this.socket.emit('commandFail', { reason: "runlevel" });
            }
        } catch(e) {
            if (log && log.info) log.info.log('debug', 'commandFail', { guid: this.guid, command: command, args: args, reason: "unknown", exception: e.message });
            if (this.socket) this.socket.emit('commandFail', { reason: "unknown" });
        }
    }

    disconnect() {
        let ip = "N/A";
        let port = "N/A";

        try {
            ip = this.getIp();
            port = this.getPort();
        } catch(e) { 
            if (log && log.info) log.info.log('warn', "exception", { guid: this.guid, exception: e.message });
        }

        if (log && log.access) log.access.log('info', 'disconnect', { guid: this.guid, ip: ip, port: port });
         
        if (this.socket) {
            this.socket.removeAllListeners('talk');
            this.socket.removeAllListeners('command');
            this.socket.removeAllListeners('disconnect');
        }

        if (this.room) this.room.leave(this);
    }
}
