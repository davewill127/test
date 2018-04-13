// Muaz Khan      - www.MuazKhan.com
// MIT License    - www.WebRTC-Experiment.com/licence

// 2017-12-31 updated by gaetan siry to work with the iConfRTC SDK 
// AVSPEED RTC Signaling Server
// info@avspeed.com

module.exports = exports = function(app, socketCallback) {
    var listOfUsers = {};
    var users = [];
    var shiftedModerationControls = {};
    var ScalableBroadcast;

    var io = require('socket.io');
    var _ = require('./underscore-min.js');


    try {
        io = io(app, {
            log: true,
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
        socket.userName = decodedUser;
        socket.session = params.session;

        //main user list
        users.push({
            id: socket.id,
            userName: socket.userName,
            session: socket.session
        });

        listOfUsers[socket.userid] = {
            socket: socket,
            connectedWith: {},
            isPublic: false, // means: isPublicModerator
            extra: {},
            userName: socket.userName,
            session: socket.session
        };

        socket.on('JoinMeeting', function(meetingId) {
            var user = users.filter(x => {return x.id === socket.id })[0];
            console.log('joining ' + meetingId + ' with socket id ' + socket.id + ' user ' + socket.userName);
            socket.join(meetingId);
            //update user list with current meeting ID

            user.meetingId = meetingId;

            console.log('just checking ..' + user.meetingId);

            //send a new list of users w/ session to view to the users in my meeting
            var tempList = users.filter(x => {return x.meetingId === meetingId });

            console.log('templist : ' + JSON.stringify(tempList, null, 4));
                
            io.to(meetingId).emit('onJoinedMeeting', meetingId, socket.id, socket.userName, socket.session, tempList);
            socket.emit('onSelfJoinedMeeting', meetingId, socket.id, socket.userName, socket.session, tempList);
        });

        socket.on('LeaveMeeting', function() {
            var user = users.filter(x => {return x.id === socket.id })[0];
            

            io.to(meetingId).emit('onUserLeftMeeting', user.meetingId, socket.id, socket.userName, socket.session);
            socket.emit('onSelfLeftMeeting', user.meetingId, socket.id, socket.userName, socket.session);

            socket.disconnect();
        });

        socket.on('SendMessageToMeeting', function(message, toUser) {
            var user = users.filter(x => {return x.id === socket.id })[0];
            

            console.log('user name is ' + socket.userName + ' meeting is ' + user.meetingId);
            if (toUser != "") {
                io.to(meetingId).emit('onMeetingMessageReceived', message, socket.userName, socket.id, true);
            } else {
                io.to(meetingId).emit('onMeetingMessageReceived', message, socket.userName, socket.id, false);
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
                var user = users.filter(x => {return x.id === socket.id })[0];
            
                console.log('disconnect has been triggered');
                console.log(users +' before ');
                
                console.log(userName + ' has left.');
                io.to(user.meetingId).emit('onUserLeftMeeting', user.meetingId, this.id, user.userName, this.session);
                socket.emit('onSelfLeftMeeting', user.meetingId, socket.id, user.userName, socket.session);

                console.log('about to delete sockets');
                console.log(JSON.stringify(users, null, 4));
                
                delete users[this.id];
                delete listOfUsers[this.id];
                delete socket.namespace.sockets[this.id];
                
                console.log(JSON.stringify(users, null, 4));   
                console.log(users +' after');
                
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