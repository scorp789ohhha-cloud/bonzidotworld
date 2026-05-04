const log = require("./log.js").log;
const Ban = require("./ban.js");
const Utils = require("./utils.js");
const io = require('./index.js').io;
const settings = require("./settings.json");
const sanitize = require('sanitize-html');

let roomsPublic = [];
let rooms = {};
let usersAll = [];

const DEFAULT_ROOMS = ['area_51', 'news', 'poland', 'why'];

function normalizeRid(rid) {
    if (typeof rid !== 'string') return rid;
    return rid.toLowerCase();
}

function initDefaultRooms() {
    DEFAULT_ROOMS.forEach(function(rid) {
        var prefs = JSON.parse(JSON.stringify(settings.prefs.private));
        prefs.owner = null;
        prefs.name = rid;
        newRoom(rid, prefs);
        log.info.log('info', 'defaultRoom', { rid: rid });
    });
}

exports.beat = function() {
    initDefaultRooms();
    io.on('connection', function(socket) {
        new User(socket);
    });
};

function checkRoomEmpty(room) {
    if (room.users.length != 0) return;

    // Never remove default rooms
    if (DEFAULT_ROOMS.indexOf(room.rid) !== -1) return;

    log.info.log('debug', 'removeRoom', {
        room: room
    });

    let publicIndex = roomsPublic.indexOf(room.rid);
    if (publicIndex != -1)
        roomsPublic.splice(publicIndex, 1);
    
    room.deconstruct();
    delete rooms[room.rid];
    delete room;
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
            this.users.forEach((user) => {
                user.disconnect();
            });
        } catch (e) {
            log.info.log('warn', 'roomDeconstruct', {
                e: e,
                thisCtx: this
            });
        }
        //delete this.rid;
        //delete this.prefs;
        //delete this.users;
    }

    isFull() {
        return this.users.length >= this.prefs.room_max;
    }

    join(user) {
        // Guard against duplicate joins causing ghost clones
        if (this.users.indexOf(user) !== -1) return;
        user.socket.join(this.rid);
        this.users.push(user);
        io.emit('rooms:update', { _id: this.rid });
        this.updateUser(user);
    }

    leave(user) {
        // HACK
        try {
            this.emit('leave', {
                 guid: user.guid
            });
     
            let userIndex = this.users.indexOf(user);
     
            if (userIndex == -1) return;
            this.users.splice(userIndex, 1);
     
            checkRoomEmpty(this);
        } catch(e) {
            log.info.log('warn', 'roomLeave', {
                e: e,
                thisCtx: this
            });
        }
    }

    updateUser(user) {
                this.emit('update', {
                        guid: user.guid,
                        userPublic: user.public
        });
    }

    getUsersPublic() {
        let usersPublic = {};
        this.users.forEach((user) => {
            usersPublic[user.guid] = user.public;
        });
        return usersPublic;
    }

    emit(cmd, data) {
                io.to(this.rid).emit(cmd, data);
    }
}

function newRoom(rid, prefs) {
    rooms[rid] = new Room(rid, prefs);
    log.info.log('debug', 'newRoom', {
        rid: rid
    });
}

let userCommands = {
    "godmode": function(word) {
        let success = word == this.room.prefs.godword;
        if (success) {
            this.private.runlevel = 3;
            this.public.flags = this.public.flags || {};
            this.public.flags.admin = true;
            this.socket.emit("update", {
                guid: this.guid,
                userPublic: this.public
            });
        }
        log.info.log('debug', 'godmode', {
            guid: this.guid,
            success: success
        });
    },
    "sanitize": function() {
        let sanitizeTerms = ["false", "off", "disable", "disabled", "f", "no", "n"];
        let argsString = Utils.argsString(arguments);
        this.private.sanitize = !sanitizeTerms.includes(argsString.toLowerCase());
    },
    "joke": function() {
        this.room.emit("joke", {
            guid: this.guid,
            rng: Math.random()
        });
    },
    "fact": function() {
        this.room.emit("fact", {
            guid: this.guid,
            rng: Math.random()
        });
    },
    "youtube": function(vidRaw) {
        var vid = this.private.sanitize ? sanitize(vidRaw) : vidRaw;
        this.room.emit("youtube", {
            guid: this.guid,
            vid: vid
        });
    },
    "gif": function(vidRaw) {
        var vid = this.private.sanitize ? sanitize(vidRaw) : vidRaw;
        this.room.emit("youtube", {
            guid: this.guid,
            vid: vid
        });
    },
    "image": function(urlRaw) {
        var url = this.private.sanitize ? sanitize(urlRaw) : urlRaw;
        this.room.emit("image", {
            guid: this.guid,
            url: url
        });
    },
    "img": function(urlRaw) {
        var url = this.private.sanitize ? sanitize(urlRaw) : urlRaw;
        this.room.emit("image", {
            guid: this.guid,
            url: url
        });
    },
    "video": function(urlRaw) {
        var url = this.private.sanitize ? sanitize(urlRaw) : urlRaw;
        this.room.emit("video", {
            guid: this.guid,
            src: { mp4: url }
        });
    },
    "backflip": function(swag) {
        this.room.emit("backflip", {
            guid: this.guid,
            swag: swag == "swag"
        });
    },
    "linux": "passthrough",
    "pawn": "passthrough",
    "bees": "passthrough",
    "color": function(color) {
        if (typeof color != "undefined") {
            if (settings.bonziColors.indexOf(color) == -1)
                return;
            
            this.public.color = color;
        } else {
            let bc = settings.bonziColors;
            this.public.color = bc[
                Math.floor(Math.random() * bc.length)
            ];
        }

        this.room.updateUser(this);
    },
    "pope": function() {
        this.public.color = "pope";
        this.room.updateUser(this);
    },
    "asshole": function() {
        this.room.emit("asshole", {
            guid: this.guid,
            target: sanitize(Utils.argsString(arguments))
        });
    },
    "owo": function() {
        this.room.emit("owo", {
            guid: this.guid,
            target: sanitize(Utils.argsString(arguments))
        });
    },
    "triggered": "passthrough",
    "vaporwave": function() {
        this.socket.emit("vaporwave");
        this.room.emit("youtube", {
            guid: this.guid,
            vid: "_4gl-FX2RvI"
        });
    },
    "unvaporwave": function() {
        this.socket.emit("unvaporwave");
    },
    "name": function() {
        let argsString = Utils.argsString(arguments);
        if (argsString.length > this.room.prefs.name_limit)
            return;

        let name = argsString || this.room.prefs.defaultName;
        this.public.name = this.private.sanitize ? sanitize(name) : name;
        this.room.updateUser(this);
    },
    "pitch": function(pitch) {
        pitch = parseInt(pitch);

        if (isNaN(pitch)) return;

        this.public.pitch = Math.max(
            Math.min(
                parseInt(pitch),
                this.room.prefs.pitch.max
            ),
            this.room.prefs.pitch.min
        );

        this.room.updateUser(this);
    },
    "speed": function(speed) {
        speed = parseInt(speed);

        if (isNaN(speed)) return;

        this.public.speed = Math.max(
            Math.min(
                parseInt(speed),
                this.room.prefs.speed.max
            ),
            this.room.prefs.speed.min
        );
        
        this.room.updateUser(this);
    }
};


class User {
    constructor(socket) {
        this.guid = Utils.guidGen();
        this.socket = socket;

        // Handle ban
            if (Ban.isBanned(this.getIp())) {
            Ban.handleBan(this.socket);
        }

        this.private = {
            login: false,
            sanitize: true,
            runlevel: 0
        };

        this.public = {
            color: settings.bonziColors[Math.floor(
                Math.random() * settings.bonziColors.length
            )]
        };

        log.access.log('info', 'connect', {
            guid: this.guid,
            ip: this.getIp()
        });

       this.socket.on('login', this.login.bind(this));
        this.socket.on('rooms:get', this.roomsGet.bind(this));
    }

    getIp() {
        return this.socket.request.connection.remoteAddress;
    }

    getPort() {
        return this.socket.handshake.address.port;
    }

    login(data) {
        if (typeof data != 'object') return; // Crash fix (issue #9)
        
        if (this.private.login) return;

                log.info.log('info', 'login', {
                        guid: this.guid,
        });
        
        let rid = normalizeRid(data.room);
        
                // Check if room was explicitly specified
                var roomSpecified = true;

                // If not, set room to public
                if ((typeof rid == "undefined") || (rid === "")) {
                        rid = roomsPublic[Math.max(roomsPublic.length - 1, 0)];
                        roomSpecified = false;
                }
                log.info.log('debug', 'roomSpecified', {
                        guid: this.guid,
                        roomSpecified: roomSpecified
        });
        
                // If private room
                if (roomSpecified) {
            if (sanitize(rid) != rid) {
                this.socket.emit("loginFail", {
                    reason: "nameMal"
                });
                return;
            }

                        // If room does not yet exist
                        if (typeof rooms[rid] == "undefined") {
                                // Clone default settings
                                var tmpPrefs = JSON.parse(JSON.stringify(settings.prefs.private));
                                // Set owner
                                tmpPrefs.owner = this.guid;
                newRoom(rid, tmpPrefs);
                        }
                        // If room is full, fail login
                        else if (rooms[rid].isFull()) {
                                log.info.log('debug', 'loginFail', {
                                        guid: this.guid,
                                        reason: "full"
                                });
                                return this.socket.emit("loginFail", {
                                        reason: "full"
                                });
                        }
                // If public room
                } else {
                        // If room does not exist or is full, create new room
                        if ((typeof rooms[rid] == "undefined") || rooms[rid].isFull()) {
                                rid = Utils.guidGen();
                                roomsPublic.push(rid);
                                // Create room
                                newRoom(rid, settings.prefs.public);
                        }
        }
        
        this.room = rooms[rid];

        // Emit room immediately so client can start BonziTV before other setup.
        // Must include 'name' so the chat log "You joined room X" message isn't undefined.
        this.socket.emit("room", { room: rid, name: rid });
                this.public.name = sanitize(data.name) || this.room.prefs.defaultName;

                if (this.public.name.length > this.room.prefs.name_limit)
                        return this.socket.emit("loginFail", {
                                reason: "nameLength"
                        });
        
                if (this.room.prefs.speed.default == "random")
                        this.public.speed = Utils.randomRangeInt(
                                this.room.prefs.speed.min,
                                this.room.prefs.speed.max
                        );
                else this.public.speed = this.room.prefs.speed.default;

                if (this.room.prefs.pitch.default == "random")
                        this.public.pitch = Utils.randomRangeInt(
                                this.room.prefs.pitch.min,
                                this.room.prefs.pitch.max
                        );
                else this.public.pitch = this.room.prefs.pitch.default;

        // Join room
        // Evict any ghost entries for this socket that may still linger from a prior
        // dropped connection — prevents the same person appearing twice in room.users.
        let ghostIndex = this.room.users.indexOf(this);
        if (ghostIndex !== -1) this.room.users.splice(ghostIndex, 1);

        this.room.join(this);

        this.private.login = true;
        this.socket.removeAllListeners("login");

                // Send identity so client knows its own guid
                this.socket.emit('identity', {
                        guid: this.guid,
                        name: this.public.name,
                        room: rid
                });

                // Send all user info
                this.socket.emit('updateAll', {
                        usersPublic: this.room.getUsersPublic()
                });

                // Send room info
                var isPublicRoom = roomsPublic.indexOf(rid) != -1;
                this.socket.emit('room', {
                        id: rid,
                        room: rid,
                        name: isPublicRoom ? 'default' : rid,
                        code: isPublicRoom ? null : rid,
                        isOwner: this.room.prefs.owner == this.guid,
                        isPublic: isPublicRoom
                });

        this.socket.on('talk', this.talk.bind(this));
        this.socket.on('command', this.command.bind(this));
        this.socket.on('disconnect', this.disconnect.bind(this));
        this.socket.on('room:join', this.roomJoin.bind(this));
    }

    roomsGet(callback) {
        if (typeof callback !== 'function') callback = function() {};
        var list = [];
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
        Object.keys(rooms).forEach(function(rid) {
            if (roomsPublic.indexOf(rid) !== -1) return;
            var room = rooms[rid];
            list.push({
                _id: rid,
                name: rid,
                users: room.users.length,
                full: room.isFull(),
                locked: !!room.prefs.passcode,
                isPublic: false
            });
        });
        callback(list);
    }

    roomJoin(data, callback) {
        if (typeof data != 'object') return;
        if (typeof callback != 'function') callback = function() {};

        var rid = normalizeRid((typeof data.room === 'string') ? data.room : String(data.room || 'default'));

        if (!rid || rid === '') rid = 'default';

        // Leave current room
        if (this.room) {
            this.room.leave(this);
        }

        // Create room if it doesn't exist
        if (typeof rooms[rid] == 'undefined') {
            var tmpPrefs = JSON.parse(JSON.stringify(settings.prefs.private));
            tmpPrefs.owner = this.guid;
            newRoom(rid, tmpPrefs);
        } else if (rooms[rid].isFull()) {
            return callback({ success: false, message: 'Room is full.' });
        }

        this.room = rooms[rid];
        this.room.join(this);

        callback({ success: true });

        var isPublicRoom = roomsPublic.indexOf(rid) != -1;
        this.socket.emit('room', {
            id: rid,
            room: rid,
            name: isPublicRoom ? 'default' : rid,
            code: isPublicRoom ? null : rid,
            isOwner: this.room.prefs.owner == this.guid,
            isPublic: isPublicRoom
        });

        this.socket.emit('updateAll', {
            usersPublic: this.room.getUsersPublic()
        });

        this.room.emit('room:changed');
    }

    talk(data) {
        if (typeof data != 'object') { // Crash fix (issue #9)
            data = {
                text: "HEY EVERYONE LOOK AT ME I'M TRYING TO SCREW WITH THE SERVER LMAO"
            };
        }

        log.info.log('debug', 'talk', {
            guid: this.guid,
            text: data.text
        });

        if (typeof data.text == "undefined")
            return;

        let text = this.private.sanitize ? sanitize(data.text) : data.text;
        if ((text.length <= this.room.prefs.char_limit) && (text.length > 0)) {
            const pitch = Math.max(Math.min(parseInt(this.public.pitch) || 100, 400), 50);
            const speed = Math.max(Math.min(parseInt(this.public.speed) || 150, 250), 50);
            const sapiUrl = "https://www.tetyys.com/SAPI4/SAPI4?text=" + encodeURIComponent(text) +
                "&voice=Adult%20Male%20%232%2C%20American%20English%20(TruVoice)" +
                "&pitch=" + pitch + "&speed=" + speed;
            const audioId = "sapi_" + Date.now() + "_" + Math.random().toString(36).slice(2);
            this.room.emit('talk', {
                guid: this.guid,
                text: text,
                extra: {
                    audio: {
                        url: sapiUrl,
                        id: audioId
                    }
                }
            });
        }
    }

    command(data) {
        if (typeof data != 'object') return; // Crash fix (issue #9)

        var command;
        var args;
        
        try {
            var list = data.list;
            command = list[0].toLowerCase();
            args = list.slice(1);
    
            log.info.log('debug', command, {
                guid: this.guid,
                args: args
            });

            if (this.private.runlevel >= (this.room.prefs.runlevel[command] || 0)) {
                let commandFunc = userCommands[command];
                if (commandFunc == "passthrough")
                    this.room.emit(command, {
                        "guid": this.guid
                    });
                else commandFunc.apply(this, args);
            } else
                this.socket.emit('commandFail', {
                    reason: "runlevel"
                });
        } catch(e) {
            log.info.log('debug', 'commandFail', {
                guid: this.guid,
                command: command,
                args: args,
                reason: "unknown",
                exception: e
            });
            this.socket.emit('commandFail', {
                reason: "unknown"
            });
        }
    }

    disconnect() {
                let ip = "N/A";
                let port = "N/A";

                try {
                        ip = this.getIp();
                        port = this.getPort();
                } catch(e) { 
                        log.info.log('warn', "exception", {
                                guid: this.guid,
                                exception: e
                        });
                }

                log.access.log('info', 'disconnect', {
                        guid: this.guid,
                        ip: ip,
                        port: port
                });
         
        this.socket.removeAllListeners('talk');
        this.socket.removeAllListeners('command');
        this.socket.removeAllListeners('disconnect');

        // room.leave() already emits 'leave' to the room — no server-wide broadcast needed.
        // The old broadcast.emit('leave') fired to ALL rooms, causing ghost clones when a
        // client received a 'leave' for an unknown guid and then adopted the next 'update'.
        this.room.leave(this);
    }
}
