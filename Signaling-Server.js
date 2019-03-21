/*
AVSPEED RTC Signaling Server
for use with the iConfRTC SDK
info@avspeed.com
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
Updated 2/13/2019 by Gaetan Siry
*/
module.exports = exports = function(app, socketCallback) {
    var listOfUsers = {};
    var users = {};
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
            'websocket'
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
        socket.isView = params.isView === 'true';

        //main user list
        users[socket.id] = {
            id: socket.id,
            userName: socket.username,
            session: socket.session,
            isView: socket.isView
            
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
            
            //join the room
            socket.join(meetingID);

            
            //update user list with current meeting ID
            users[socket.id].meetingID = meetingID;

             //send a new list of users w/ session to view to the users in my meeting
             var tempList = _.where(users, { meetingID: meetingID });


            socket.emit('onSelfJoinedMeeting', meetingID, socket.id, socket.username, socket.session, tempList);
            
            socket.broadcast.to(meetingID).emit('onJoinedMeeting', meetingID, socket.id, socket.username, socket.session, tempList);
            
        });

        socket.on('AddedVideo', function() {
            console.log('added video ' + socket.id + ' user ' + socket.username);
            var meetingID = users[socket.id].meetingID;
            socket.broadcast.to(meetingID).emit('onAddedVideo', meetingID, socket.username, socket.session, socket.id); 
        });

        socket.on('RemovedVideo', function() {
            console.log('removed video ' + socket.id + ' user ' + socket.username);
            var meetingID = users[socket.id].meetingID;
            socket.broadcast.to(meetingID).emit('onRemovedVideo', meetingID, socket.username, socket.session, socket.id); 
        });

        socket.on('ScreenSharing', function() {
            console.log('user ' + socket.username + ' sharing screen');   
            socket.broadcast.to(users[socket.id].meetingID ).emit('onScreenSharing', socket.id, socket.username, socket.session)
            
        });

        socket.on('MuteAudio', function() {
            console.log('audio muted user ' + socket.username);
            socket.broadcast.to(users[socket.id].meetingID).emit('onUserAudioMuted', socket.id, socket.username, socket.session);
        });

        socket.on('MuteVideo', function() {
            console.log('video muted user ' + socket.username);
            socket.broadcast.to(users[socket.id].meetingID).emit('onUserVideoMuted', socket.id, socket.username, socket.session);
        });

        socket.on('UnMuteAudio', function() {
            console.log('audio un-muted user ' + socket.username);
            socket.broadcast.to(users[socket.id].meetingID).emit('onUserAudioUnMuted', socket.id, socket.username, socket.session);
        });

        socket.on('UnMuteVideo', function() {
            console.log('video un-muted user ' + socket.username);
            socket.broadcast.to(users[socket.id].meetingID).emit('onUserVideoUnMuted', socket.id, socket.username, socket.session);
        });

        socket.on('LeaveMeeting', function() {

            var user = users[socket.id];
            io.to(user.meetingID).emit('onUserLeftMeeting', user.meetingID, socket.id, socket.username, socket.session);
            socket.emit('onSelfLeftMeeting', user.meetingID, socket.id, socket.username, socket.session);
            socket.notifiedleave = true;
            socket.disconnect();
        });

        socket.on('SendMessageToMeeting', function(message, toUser) {
            var user = users[socket.id];
            
            console.log('user name is ' + socket.username);
            if (toUser != "") {
                io.to(user.meetingID).emit('onMeetingMessageReceived', message, socket.username, socket.id, true);
            } else {
                io.to(user.meetingID).emit('onMeetingMessageReceived', message, socket.username, socket.id, false);
            }
        });

        // socket.on('extra-data-updated', function(extra) {
        //     try {
        //         if (!listOfUsers[socket.userid]) return;
        //         listOfUsers[socket.userid].extra = extra;

        //         for (var user in listOfUsers[socket.userid].connectedWith) {
        //             listOfUsers[user].socket.emit('extra-data-updated', socket.userid, extra);
        //         }
        //     } catch (e) {}
        // });

        // socket.on('become-a-public-moderator', function() {
        //     try {
        //         if (!listOfUsers[socket.userid]) return;
        //         listOfUsers[socket.userid].isPublic = true;
        //     } catch (e) {}
        // });

        // socket.on('dont-make-me-moderator', function() {
        //     try {
        //         if (!listOfUsers[socket.userid]) return;
        //         listOfUsers[socket.userid].isPublic = false;
        //     } catch (e) {}
        // });

        // socket.on('get-public-moderators', function(userIdStartsWith, callback) {
        //     try {
        //         userIdStartsWith = userIdStartsWith || '';
        //         var allPublicModerators = [];
        //         for (var moderatorId in listOfUsers) {
        //             if (listOfUsers[moderatorId].isPublic && moderatorId.indexOf(userIdStartsWith) === 0 && moderatorId !== socket.userid) {
        //                 var moderator = listOfUsers[moderatorId];
        //                 allPublicModerators.push({
        //                     userid: moderatorId,
        //                     extra: moderator.extra
        //                 });
        //             }
        //         }

        //         callback(allPublicModerators);
        //     } catch (e) {}
        // });

        // socket.on('changed-uuid', function(newUserId, callback) {
        //     if (params.dontUpdateUserId) {
        //         delete params.dontUpdateUserId;
        //         return;
        //     }

        //     try {
        //         if (listOfUsers[socket.userid] && listOfUsers[socket.userid].socket.id == socket.userid) {
        //             if (newUserId === socket.userid) return;

        //             var oldUserId = socket.userid;
        //             listOfUsers[newUserId] = listOfUsers[oldUserId];
        //             listOfUsers[newUserId].socket.userid = socket.userid = newUserId;
        //             delete listOfUsers[oldUserId];

        //             callback();
        //             return;
        //         }

        //         socket.userid = newUserId;
        //         listOfUsers[socket.userid] = {
        //             socket: socket,
        //             connectedWith: {},
        //             isPublic: false,
        //             extra: {}
        //         };

        //         callback();
        //     } catch (e) {}
        // });

        // socket.on('set-password', function(password) {
        //     try {
        //         if (listOfUsers[socket.userid]) {
        //             listOfUsers[socket.userid].password = password;
        //         }
        //     } catch (e) {}
        // });

        // socket.on('disconnect-with', function(remoteUserId, callback) {
        //     try {
        //         if (listOfUsers[socket.userid] && listOfUsers[socket.userid].connectedWith[remoteUserId]) {
        //             delete listOfUsers[socket.userid].connectedWith[remoteUserId];
        //             socket.emit('user-disconnected', remoteUserId);
        //         }

        //         if (!listOfUsers[remoteUserId]) return callback();

        //         if (listOfUsers[remoteUserId].connectedWith[socket.userid]) {
        //             delete listOfUsers[remoteUserId].connectedWith[socket.userid];
        //             listOfUsers[remoteUserId].socket.emit('user-disconnected', socket.userid);
        //         }
        //         callback();
        //     } catch (e) {}
        // });

        // socket.on('close-entire-session', function(callback) {
        //     try {
        //         var connectedWith = listOfUsers[socket.userid].connectedWith;
        //         Object.keys(connectedWith).forEach(function(key) {
        //             if (connectedWith[key] && connectedWith[key].emit) {
        //                 try {
        //                     connectedWith[key].emit('closed-entire-session', socket.userid, listOfUsers[socket.userid].extra);
        //                 } catch (e) {}
        //             }
        //         });

        //         delete shiftedModerationControls[socket.userid];
        //         callback();
        //     } catch (e) {
        //         throw e;
        //     }
        // });

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
                var user = users[this.id];

                console.info( user.userName + ' has left');

                if (!user.isView)
                {
                //do not notify twice
                    if (!socket.notifiedleave)
                    {
                        io.to(user.meetingID).emit('onUserLeftMeeting',  user.meetingID, this.id, user.userName,  user.session);
                        socket.emit('onSelfLeftMeeting', user.meetingID, this.id, user.userName, user.session);
                    }
                }

                delete users[this.id];
                delete listOfUsers[this.id];

                delete socket.namespace.sockets[this.id];
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