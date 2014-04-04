/// <reference path="typings/node/node.d.ts"/>
/// <reference path="reactive/core.ts"/>

import net = require('net');
import r = require('./reactive/core');

// == TCP STUFF ====================================================================================

export module RemoteStream.Channel {

  export class SocketChannel implements RemoteStream.TwoWayMessageChannel {

    incoming:r.Reactive.Stream<string>;

    constructor(public socket : net.Socket) {
      var controller = new r.Reactive.StreamController<string>();
      this.socket.setEncoding('utf8');
      this.socket.on('data', (data) => {
        controller.add(data);
      });
      this.incoming = controller.stream;
    }

    send(msg : string) {
      this.socket.write(msg);
    }

  }

}

export module RemoteStream {

  // == CHANNEL ======================================================================================

  export interface TwoWayMessageChannel {

    // TODO: also for byte chunks
    incoming : r.Reactive.Stream<string>;
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

  interface FutureErrorMessage extends FutureMessage {
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

  // TODO: handle socket termination
  export class Connection {

    nextCallId : number; // outgoing call
    nextStreamId : number; // returned stream
    nextFutureId : number; // returned future

    openCalls : { [id : number]: r.Reactive.Completer<any> }; // waiting for response
    openStreams : { [id : number]: r.Reactive.StreamController<any> }; // waiting for more events & close
    openFutures : { [id : number]: r.Reactive.Completer<any> }; // waiting for completion or error

    methods : { [name : string]: Function };

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
        console.log(msg);
        // TODO: should throw malformed message error on cast failure...
        if(msg.hasOwnProperty('call_id') && msg.hasOwnProperty('value')) {
          this.handleReturnMessage(<ReturnMessage>msg);
        } else if(msg.hasOwnProperty('stream_id')) {
          this.handleStreamMessage(<StreamMessage>msg);
        } else if(msg.hasOwnProperty('future_id')) {
          this.handleFutureMessage(<FutureMessage>msg);
        } else if(msg.hasOwnProperty('method')) {
          this.handleCallMessage(<CallMessage>msg);
        } else {
          throw new MalformedMessageError(str);
        }
      });
    }

    // TODO: check # args...
    call(method : string, args : Array<any>) : r.Reactive.Future<any> {
      var msg:CallMessage = {
        call_id: this.nextCallId,
        method: method,
        args: args
      };
      var completer = new r.Reactive.Completer<any>();
      this.openCalls[this.nextCallId] = completer;
      this.channel.send(JSON.stringify(msg));
      this.nextCallId++;
      return completer.future;
    }

    // TODO: should probably allow returning normal values, not just futures
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
      if(msg.hasOwnProperty('event')) { // I want pattern matching waahhhh
        controller.add(this.decodeMessage((<StreamEventMessage>msg).event));
      } else if(msg.hasOwnProperty('reason')) {
        controller.close((<StreamCloseMessage>msg).reason);
        delete this.openStreams[msg.stream_id];
      }
    }

    private handleFutureMessage(msg : FutureMessage) {
      var completer = this.openFutures[msg.future_id];
      if(!completer) {
        throw new NonexistentFutureError(msg.future_id, msg);
      }
      if(msg.hasOwnProperty('value')) {
        completer.complete(this.decodeMessage((<FutureCompletedMessage>msg).value));
      } else if(msg.hasOwnProperty('error')) {
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
        if(msg.hasOwnProperty('__future_id__')) {
          var nfv = <NewFutureValue>msg;
          var completer = new r.Reactive.Completer<any>();
          this.openFutures[nfv.__future_id__] = completer;
          return completer.future;
        } else if(msg.hasOwnProperty('__stream_id__')) {
          var nsv = <NewStreamValue>msg;
          var controller = new r.Reactive.StreamController<any>();
          this.openStreams[nsv.__stream_id__] = controller;
          return controller.stream;
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
        if(msg instanceof r.Reactive.Future) {
          var res = {
            __future_id__: this.nextFutureId
          };
          this.transmitFuture(this.nextFutureId, <r.Reactive.Future<any>> msg);
          this.nextFutureId++;
          return res;
        } else if(msg instanceof r.Reactive.Stream) {
          var res1 = {
            __stream_id__: this.nextStreamId
          }
          this.transmitStream(this.nextStreamId, <r.Reactive.Stream<any>> msg);
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

    private transmitFuture(id : number, future : r.Reactive.Future<any>) {
      future.then(
        (value) => {
          var msg:FutureCompletedMessage = {
            future_id: id,
            value: value
          }
          this.channel.send(JSON.stringify(msg));
          return null;
        },
        (err) => {
          var msg:FutureErrorMessage = {
            future_id: id,
            error: err
          };
          this.channel.send(JSON.stringify(msg));
        }
      );
    }

    private transmitStream(id : number, stream : r.Reactive.Stream<any>) {
      stream.listen(
        (evt) => {
          var msg:StreamEventMessage = {
            stream_id: id,
            event: evt
          };
          this.channel.send(JSON.stringify(msg));
        },
        (reason) => {
          var msg:StreamCloseMessage = {
            stream_id: id,
            reason: reason
          };
          this.channel.send(JSON.stringify(msg));
        }
      );
    }

  }

  // == ERRORS =======================================================================================

  class ProtocolError {
    constructor(public message : any) {}
  }

  class NonexistentCallError extends ProtocolError {
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
