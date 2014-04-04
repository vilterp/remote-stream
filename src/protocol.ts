/// <reference path="typings/node/node.d.ts"/>
/// <reference path="reactive/core.ts"/>

// == TCP STUFF ====================================================================================

import net = require('net');

module RemoteStream.Channel {

  export class SocketChannel implements RemoteStream.TwoWayMessageChannel {

    incoming:Reactive.Stream<string>;

    constructor(public socket : net.Socket) {
      var controller = new Reactive.StreamController<string>();
      this.socket.setEncoding('utf8');
      this.socket.on('data', (data) => {
        controller.add(data);
      });
      this.incoming = controller.stream;
    }

    send(msg:string) {
      this.socket.write(msg);
    }

  }

}

module RemoteStream {

  // == CHANNEL ======================================================================================

  export interface TwoWayMessageChannel {

    // TODO: also for byte chunks
    incoming : Reactive.Stream<string>;
    send(msg : string);

  }

  // == MESSAGES =====================================================================================

  // Calls

  interface CallMessage {
    call_id : number;
    method : string;
    args : Array<any>;
  }

  interface ReturnMessage {
    call_id : number;
    value : any;
  }

  // Streams

  interface StreamMessage {
    stream_id : number;
  }

  interface StreamEventMessage extends StreamMessage {
    event : any;
  }

  interface StreamCloseMessage extends StreamMessage {
    reason : any;
  }

  // Futures

  interface FutureMessage {
    future_id : number;
  }

  interface FutureCompletedMessage extends FutureMessage {
    value : any;
  }

  interface FutureErrorMessage {
    error : any;
  }

  // embedded values

  interface NewStreamValue {
    __stream_id__ : number;
  }

  interface NewFutureValue {
    __future_id__ : number;
  }

  // == CONNECTION ===================================================================================

  export class Connection {

    nextCallId : number; // outgoing call
    nextStreamId : number; // returned stream
    nextFutureId : number; // returned future

    openCalls : { [id : number]: Reactive.Completer<any> }; // waiting for response
    openStreams : { [id : number]: Reactive.StreamController<any> }; // waiting for more events & close
    openFutures : { [id : number]: Reactive.Completer<any> }; // waiting for completion or error

    methods : { [name : string]: () => Function };

    constructor(public channel : TwoWayMessageChannel) {
      this.nextCallId = 0;
      this.nextStreamId = 0;
      this.nextFutureId = 0;

      this.openCalls = {};
      this.openStreams = {};
      this.openFutures = {};

      this.methods = {};

      this.channel.incoming.listen((str) => {
        var msg = JSON.parse(str);
        // TODO: should throw malformed message error on cast failure...
        if(msg instanceof ReturnMessage) {
          this.handleReturnMessage(<ReturnMessage>msg);
        } else if(msg instanceof StreamMessage) {
          this.handleStreamMessage(<StreamMessage>msg);
        } else if(msg instanceof FutureMessage) {
          this.handleFutureMessage(<FutureMessage>msg);
        } else if(msg instanceof CallMessage) {
          this.handleCallMessage(<CallMessage>msg);
        } else {
          throw new MalformedMessageError(str);
        }
      });
    }

    // TODO: check # args...
    call(method : string, args : Array<any>) : Reactive.Future<any> {
      var msg:CallMessage = {
        call_id: this.nextCallId,
        method: method,
        args: args
      };
      this.openCalls[this.nextCallId] = new Reactive.Completer<any>();
      this.channel.send(JSON.stringify(msg));
      this.nextCallId++;
      return null;
    }

    register(name : string, implementation : Function) {
      if(this.methods[name]) {
        throw "method already registered: " + name;
      }
      this.methods[name] = implementation;
    }

    // TODO: decode contained messages into streams, etc

    private handleReturnMessage(msg : ReturnMessage) {
      var completer = this.openCalls[msg.call_id];
      if(!completer) {
        throw new NonexistentCallError(msg.call_id, msg);
      }
      completer.complete(this.decodeMessage(msg.value));
      delete this.openCalls[msg.call_id];
    }

    private handleStreamMessage(msg : StreamMessage) {
      var controller = this.openStreams[msg.stream_id];
      if(!controller) {
        throw new NonexistentStreamError(msg.stream_id, msg);
      }
      if(msg instanceof StreamEventMessage) { // I want pattern matching waahhhh
        controller.add(this.decodeMessage((<StreamEventMessage>msg).event));
      } else if(msg instanceof StreamCloseMessage) {
        controller.close((<StreamCloseMessage>msg).reason);
        delete this.openStreams[msg.stream_id];
      }
    }

    private handleFutureMessage(msg : FutureMessage) {
      var completer = this.openFutures[msg.future_id];
      if(!completer) {
        throw new NonexistentFutureError(msg.future_id, msg);
      }
      if(msg instanceof FutureCompletedMessage) {
        completer.complete(this.decodeMessage((<FutureCompletedMessage>msg).value));
      } else if(msg instanceof FutureErrorMessage) {
        completer.error((<FutureErrorMessage>msg).error);
      }
      delete this.openFutures[msg.future_id];
    }

    private handleCallMessage(msg : CallMessage) {
      var implementation = this.methods[msg.method];
      if(!implementation) {
        throw new NonexistentMethodError(msg.method, msg);
      }
      // TODO: make sure scoping, etc is right here...
      implementation.apply({}, msg.args).map((result) => {
        var encoded = this.encodeMessage(result);
        var retMsg : ReturnMessage = {
          call_id : msg.call_id,
          value : encoded
        };
        this.channel.send(JSON.stringify(retMsg));
      });
    }

    // TODO: better name. not exactly decoding
    private decodeMessage(msg : any) : any {
      if(!(msg instanceof Object)) {
        return msg;
      } else {
        if(msg instanceof NewFutureValue) {
          var nfv = <NewFutureValue>msg;
          var completer = new Reactive.Completer<any>();
          this.openFutures[nfv.__future_id__] = completer;
          return completer;
        } else if(msg instanceof NewStreamValue) {
          var nsv = <NewStreamValue>msg;
          var controller = new Reactive.StreamController<any>();
          this.openStreams[nsv.__stream_id__] = controller;
        } else {
          // TODO: avoid this copying...
          var new_msg = {};
          for(var prop in msg) {
            new_msg[prop] = this.decodeMessage(msg[prop]);
          }
          return new_msg;
        }
      }
    }

    private encodeMessage(msg : any) : any {
      if(!(msg instanceof Object)) {
        return msg;
      } else {
        if(msg instanceof Reactive.Future) {
          var res = {
            __future_id__: this.nextFutureId
          };
          this.nextFutureId++;
          return res;
        } else if(msg instanceof Reactive.Stream) {
          var res1 = {
            __stream_id__: this.nextStreamId
          }
          this.nextStreamId++;
          return res1;
        } else {
          var new_msg = {};
          for(var prop in msg) {
            new_msg[prop] = this.encodeMessage(msg[prop]);
          }
          return new_msg;
        }
      }
    }

  }

  // == ERRORS =======================================================================================

  class ProtocolError {
    constructor(public message : any) {}
  }

  export class NonexistentCallError extends ProtocolError {
    constructor(public call_id : number, message : any) {
      super(message);
    }
  }

  class NonexistentStreamError extends ProtocolError {
    constructor(public stream_id : number, message : any) {
      super(message);
    }
  }

  class NonexistentFutureError extends ProtocolError {
    constructor(public future_id : number, message : any) {
      super(message);
    }
  }

  class NonexistentMethodError extends ProtocolError {
    constructor(public method : string, message : any) {
      super(message);
    }
  }

  class MalformedMessageError extends ProtocolError {
    constructor(message : any) {
      super(message);
    }
  }

}
