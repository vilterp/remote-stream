/// <reference path="./protocol.ts"/>

var net = require('net');

class TimerServer extends RemoteStream.Connection {

  constructor(channel : RemoteStream.TwoWayMessageChannel) {
    super(channel);
    this.register('ticks', (intervalMs:number) => {
      var tick = 0;
      var controller = new Reactive.StreamController<number>();
      setInterval(() => {
        controller.add(tick);
        tick++;
      }, intervalMs);
      return Reactive.Future.immediate(controller.stream);
    });
  }

}

var port = 8080;

if(process.argv[2] == 'server') {
  net.createServer((conn) => {
    var chan = new RemoteStream.SocketChannel(conn);
    var conn = new TimerServer(chan);
  }).listen(port, () => {
    console.log('listening on', port);
  });
} else if(process.argv[2] == 'client') {
  net.createConnection((conn) => {
    var chan = new RemoteStream.SocketChannel(conn);
    var conn = new RemoteStream.Connection(chan);
    conn.call('ticks', [100]).map((stream) => {
      stream.listen(console.log);
    });
  });
}