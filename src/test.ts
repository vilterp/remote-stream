/// <reference path="typings/node/node.d.ts"/>

import net = require('net');
import rs = require('./protocol');
import r = require('./reactive/core');

class TimerServer extends rs.RemoteStream.Connection {

  constructor(channel : rs.RemoteStream.TwoWayMessageChannel) {
    super(channel);
    this.register('ticks', (intervalMs:number) => {
      var tick = 0;
      var controller = new r.Reactive.StreamController<number>();
      setInterval(() => {
        controller.add(tick);
        tick++;
      }, intervalMs);
      return r.Reactive.Future.immediate(controller.stream);
    });
  }

}

var port = 8080;

if(process.argv[2] == 'server') {
  var serv = net.createServer((sock) => {
    var chan = new rs.RemoteStream.Channel.SocketChannel(sock);
    var conn = new TimerServer(chan);
  });
  serv.listen(port, () => {
    console.log('listening on', port);
  });
} else if(process.argv[2] == 'client') {
  var sock1 = net.createConnection(port, 'localhost');
  sock1.on('connect', () => {
    var chan1 = new rs.RemoteStream.Channel.SocketChannel(sock1);
    var conn1 = new rs.RemoteStream.Connection(chan1);
    conn1.call('ticks', [100]).map((stream) => {
      stream.listen(console.log);
    });
  });
}