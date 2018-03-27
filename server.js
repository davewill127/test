// Muaz Khan      - www.MuazKhan.com
// MIT License    - www.WebRTC-Experiment.com/licence

// 2017-12-31 updated by gaetan siry to work with the iConfRTC SDK 
// AVSPEED RTC Signaling Server
// info@avspeed.com

console.log(process.argv);

var isUseHTTPs = !(!!process.env.PORT || !!process.env.IP);
console.log('https ' + isUseHTTPs);
isUseHTTPs = false;
var server = require(isUseHTTPs ? 'https' : 'http'),
    url = require('url'),
    path = require('path'),
    fs = require('fs');

function serverHandler(request, response) {
    var uri = url.parse(request.url).pathname,
        filename = path.join(process.cwd(), uri);

    var stats;

    try {
        stats = fs.lstatSync(filename);
    } catch (e) {
        response.writeHead(404, {
            'Content-Type': 'text/plain'
        });
        response.write('404 Not Found: ' + path.join('/', uri) + '\n');
        response.end();
        return;
    }

    fs.readFile(filename, 'binary', function(err, file) {
        if (err) {
            response.writeHead(500, {
                'Content-Type': 'text/plain'
            });
            response.write('404 Not Found: ' + path.join('/', uri) + '\n');
            response.end();
            return;
        }

        response.writeHead(200);
        response.write(file, 'binary');
        response.end();
    });
}

var app;

/*if (isUseHTTPs) {
    var options = {
        key: fs.readFileSync(path.join(__dirname, 'fake-keys/privatekey.pem')),
        cert: fs.readFileSync(path.join(__dirname, 'fake-keys/certificate.pem'))
    };
    app = server.createServer(options, serverHandler);
} else */

app = server.createServer(serverHandler);

app = app.listen(process.env.PORT || 8080, process.env.IP || "0.0.0.0", function() {
    var addr = app.address();
    //console.log('RTC Signaling Server listening on port ' + app.get('port'));
    console.log("AVSPEED RTC Signaling Server listening at ", addr.address + ":" + addr.port);
});

require('./underscore-min.js');

require('./Signaling-Server.js')(app, function(socket) {
    try {
        var params = socket.handshake.query;

        if (!params.socketCustomEvent) {
            params.socketCustomEvent = 'custom-message';
        }

        socket.on(params.socketCustomEvent, function(message) {
            try {
                console.log(message);
                socket.broadcast.emit(params.socketCustomEvent, message);
            } catch (e) {}
        });
    } catch (e) {}
});