// Muaz Khan      - www.MuazKhan.com
// MIT License    - www.WebRTC-Experiment.com/licence

// 2017-12-31 updated by gaetan siry to work with the iConfRTC SDK 
// AVSPEED RTC Signaling Server
// info@avspeed.com

module.exports = exports = function(app, socketCallback) {
    var listOfUsers = {};
    var users = {};
    var shiftedModerationControls = {};
    var ScalableBroadcast;

    var io = require('socket.io');
    var _ = require('./underscore-min.js');


    try {
        io = io(app, {
            log: false,
            origins: '*:*'
        });
        io.on('connection', onConnection);
    } catch (e) {
        io = io.listen(app, {
            log: true,
            origins: '*:*'
        });

        io.set('transports', [
            'websocket', // 'disconnect' EVENT will work only with 'websocket'
            'xhr-polling',
            'jsonp-polling'
        ]);

        io.sockets.on('connection', onConnection);
    }

    function findClientsSocket(roomId, namespace) {
        var res = []
            // the default namespace is "/"
            ,
            ns = io.of(namespace || "/");

        if (ns) {
            for (var id in ns.connected) {
                if (roomId) {
                    var index = ns.connected[id].rooms.indexOf(roomId);
                    if (index !== -1) {
                        res.push(ns.connected[id]);
                    }
                } else {
                    res.push(ns.connected[id]);
                }
            }
        }
        return res;
    }

    function onConnection(socket) {
        var params = socket.handshake.query;
        var socketMessageEvent = params.msgEvent || 'RTCConnection-Message';

        // temporarily disabled
        if (false && !!listOfUsers[params.userid]) {
            params.dontUpdateUserId = true;

            var useridAlreadyTaken = params.userid;
            params.userid = (Math.random() * 1000).toString().replace('.', '');
            socket.emit('userid-already-taken', useridAlreadyTaken, params.userid);
        }

        var decodedUserStr = new Buffer(params.userName, 'base64')
        var decodedUser = decodedUserStr.toString();

        socket.userid = params.userid;
        socket.username = decodedUser;
        socket.session = params.session;

        //main user list
        users[socket.id] = {
            id: socket.id,
            userName: socket.username,
            session: socket.session
        };

        listOfUsers[socket.userid] = {
            socket: socket,
            connectedWith: {},
            isPublic: false, // means: isPublicModerator
            extra: {},
            userName: socket.username,
            session: socket.session
        };

        socket.on('JoinMeeting', function(meetingID) {

            console.log('joining with socket id ' + socket.id + ' user ' + socket.username);
            socket.join(meetingID);
            //update user list with current meeting ID
            users[socket.id].meetingID = meetingID;

            //send a new list of users w/ session to view to the users in my meeting
            var tempList = _.where(users, { meetingID: meetingID });

            socket.broadcast.to(meetingID).emit('onJoinedMeeting', meetingID, socket.id, socket.username, socket.session, tempList);
            socket.emit('onSelfJoinedMeeting', meetingID, socket.id, socket.username, socket.session, tempList);
        });

        socket.on('LeaveMeeting', function() {
            var meetingID = users[socket.id].meetingID;

            delete users[socket.id];
            delete listOfUsers[socket.id];
            socket.broadcast.to(meetingID).emit('onUserLeftMeeting', meetingID, socket.id, socket.username, socket.session);
            socket.emit('onSelfLeftMeeting', meetingID, socket.id, socket.username, socket.session);
        });

        socket.on('SendMessageToMeeting', function(message, toUser) {
            var meetingID = users[socket.id].meetingID;

            if (toUser != "") {
                socket.broadcast.to(meetingID).emit('onMeetingMessageReceived', message, socket.username, socket.id, true);
            } else {
                //todo gsiry 9/19/2016
                //socket.broadcast.to(meetingID).emit('onMeetingMessageReceived', message, socket.username, socket.id, true);
            }
        });

        socket.on('extra-data-updated', function(extra) {
            try {
                if (!listOfUsers[socket.userid]) return;
                listOfUsers[socket.userid].extra = extra;

                for (var user in listOfUsers[socket.userid].connectedWith) {
                    listOfUsers[user].socket.emit('extra-data-updated', socket.userid, extra);
                }
            } catch (e) {}
        });

        socket.on('become-a-public-moderator', function() {
            try {
                if (!listOfUsers[socket.userid]) return;
                listOfUsers[socket.userid].isPublic = true;
            } catch (e) {}
        });

        socket.on('dont-make-me-moderator', function() {
            try {
                if (!listOfUsers[socket.userid]) return;
                listOfUsers[socket.userid].isPublic = false;
            } catch (e) {}
        });

        socket.on('get-public-moderators', function(userIdStartsWith, callback) {
            try {
                userIdStartsWith = userIdStartsWith || '';
                var allPublicModerators = [];
                for (var moderatorId in listOfUsers) {
                    if (listOfUsers[moderatorId].isPublic && moderatorId.indexOf(userIdStartsWith) === 0 && moderatorId !== socket.userid) {
                        var moderator = listOfUsers[moderatorId];
                        allPublicModerators.push({
                            userid: moderatorId,
                            extra: moderator.extra
                        });
                    }
                }

                callback(allPublicModerators);
            } catch (e) {}
        });

        socket.on('changed-uuid', function(newUserId, callback) {
            if (params.dontUpdateUserId) {
                delete params.dontUpdateUserId;
                return;
            }

            try {
                if (listOfUsers[socket.userid] && listOfUsers[socket.userid].socket.id == socket.userid) {
                    if (newUserId === socket.userid) return;

                    var oldUserId = socket.userid;
                    listOfUsers[newUserId] = listOfUsers[oldUserId];
                    listOfUsers[newUserId].socket.userid = socket.userid = newUserId;
                    delete listOfUsers[oldUserId];

                    callback();
                    return;
                }

                socket.userid = newUserId;
                listOfUsers[socket.userid] = {
                    socket: socket,
                    connectedWith: {},
                    isPublic: false,
                    extra: {}
                };

                callback();
            } catch (e) {}
        });

        socket.on('set-password', function(password) {
            try {
                if (listOfUsers[socket.userid]) {
                    listOfUsers[socket.userid].password = password;
                }
            } catch (e) {}
        });

        socket.on('disconnect-with', function(remoteUserId, callback) {
            try {
                if (listOfUsers[socket.userid] && listOfUsers[socket.userid].connectedWith[remoteUserId]) {
                    delete listOfUsers[socket.userid].connectedWith[remoteUserId];
                    socket.emit('user-disconnected', remoteUserId);
                }

                if (!listOfUsers[remoteUserId]) return callback();

                if (listOfUsers[remoteUserId].connectedWith[socket.userid]) {
                    delete listOfUsers[remoteUserId].connectedWith[socket.userid];
                    listOfUsers[remoteUserId].socket.emit('user-disconnected', socket.userid);
                }
                callback();
            } catch (e) {}
        });

        socket.on('close-entire-session', function(callback) {
            try {
                var connectedWith = listOfUsers[socket.userid].connectedWith;
                Object.keys(connectedWith).forEach(function(key) {
                    if (connectedWith[key] && connectedWith[key].emit) {
                        try {
                            connectedWith[key].emit('closed-entire-session', socket.userid, listOfUsers[socket.userid].extra);
                        } catch (e) {}
                    }
                });

                delete shiftedModerationControls[socket.userid];
                callback();
            } catch (e) {
                throw e;
            }
        });

        function onMessageCallback(message) {
            try {
                if (!listOfUsers[message.sender]) {
                    socket.emit('user-not-found', message.sender);
                    return;
                }

                if (!message.message.userLeft && !listOfUsers[message.sender].connectedWith[message.remoteUserId] && !!listOfUsers[message.remoteUserId]) {
                    listOfUsers[message.sender].connectedWith[message.remoteUserId] = listOfUsers[message.remoteUserId].socket;
                    listOfUsers[message.sender].socket.emit('user-connected', message.remoteUserId);

                    if (!listOfUsers[message.remoteUserId]) {
                        listOfUsers[message.remoteUserId] = {
                            socket: null,
                            connectedWith: {},
                            isPublic: false,
                            extra: {}
                        };
                    }

                    listOfUsers[message.remoteUserId].connectedWith[message.sender] = socket;

                    if (listOfUsers[message.remoteUserId].socket) {
                        listOfUsers[message.remoteUserId].socket.emit('user-connected', message.sender);
                    }
                }

                if (listOfUsers[message.sender].connectedWith[message.remoteUserId] && listOfUsers[socket.userid]) {
                    message.extra = listOfUsers[socket.userid].extra;
                    listOfUsers[message.sender].connectedWith[message.remoteUserId].emit(socketMessageEvent, message);
                }
            } catch (e) {}
        }

        var numberOfPasswordTries = 0;
        socket.on(socketMessageEvent, function(message, callback) {
            if (message.remoteUserId && message.remoteUserId === socket.userid) {
                // remoteUserId MUST be unique
                return;
            }

            try {
                if (message.remoteUserId && message.remoteUserId != 'system' && message.message.newParticipationRequest) {
                    if (listOfUsers[message.remoteUserId] && listOfUsers[message.remoteUserId].password) {
                        if (numberOfPasswordTries > 3) {
                            socket.emit('password-max-tries-over', message.remoteUserId);
                            return;
                        }

                        if (!message.password) {
                            numberOfPasswordTries++;
                            socket.emit('join-with-password', message.remoteUserId);
                            return;
                        }

                        if (message.password != listOfUsers[message.remoteUserId].password) {
                            numberOfPasswordTries++;
                            socket.emit('invalid-password', message.remoteUserId, message.password);
                            return;
                        }
                    }
                }

                if (message.message.shiftedModerationControl) {
                    if (!message.message.firedOnLeave) {
                        onMessageCallback(message);
                        return;
                    }
                    shiftedModerationControls[message.sender] = message;
                    return;
                }

                if (message.remoteUserId == 'system') {
                    if (message.message.detectPresence) {
                        if (message.message.userid === socket.userid) {
                            callback(false, socket.userid);
                            return;
                        }

                        callback(!!listOfUsers[message.message.userid], message.message.userid);
                        return;
                    }
                }

                if (!listOfUsers[message.sender]) {
                    listOfUsers[message.sender] = {
                        socket: socket,
                        connectedWith: {},
                        isPublic: false,
                        extra: {}
                    };
                }

                // if someone tries to join a person who is absent
                if (message.message.newParticipationRequest) {
                    var waitFor = 120; // 2 minutes
                    var invokedTimes = 0;
                    (function repeater() {
                        invokedTimes++;
                        if (invokedTimes > waitFor) {
                            socket.emit('user-not-found', message.remoteUserId);
                            return;
                        }

                        if (listOfUsers[message.remoteUserId] && listOfUsers[message.remoteUserId].socket) {
                            onMessageCallback(message);
                            return;
                        }

                        setTimeout(repeater, 1000);
                    })();

                    return;
                }

                onMessageCallback(message);
            } catch (e) {}
        });

        socket.on('disconnect', function() {
            try {
                var meetingID = users[this.id].meetingID;

                delete socket.namespace.sockets[this.id];
                delete users[this.id];
                delete listOfUsers[this.id];
                socket.broadcast.to(meetingID).emit('onUserLeftMeeting', meetingID, this.id, this.username, this.session);
                socket.emit('onSelfLeftMeeting', meetingID, this.id, this.username, this.session);
            } catch (e) {}

            try {
                var message = shiftedModerationControls[socket.userid];

                if (message) {
                    delete shiftedModerationControls[message.userid];
                    onMessageCallback(message);
                }
            } catch (e) {}

            try {
                // inform all connected users
                if (listOfUsers[socket.userid]) {
                    for (var s in listOfUsers[socket.userid].connectedWith) {
                        listOfUsers[socket.userid].connectedWith[s].emit('user-disconnected', socket.userid);

                        if (listOfUsers[s] && listOfUsers[s].connectedWith[socket.userid]) {
                            delete listOfUsers[s].connectedWith[socket.userid];
                            listOfUsers[s].socket.emit('user-disconnected', socket.userid);
                        }
                    }
                }
            } catch (e) {}

            delete listOfUsers[socket.userid];
        });

        if (socketCallback) {
            socketCallback(socket);
        }
    }
};