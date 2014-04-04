module Reactive {
    
    export class StreamController<A> {
        
        stream : Stream<A>;

        constructor() {
            this.stream = new Stream<A>();
        }

        add(evt : A) : void {
            this.stream.trigger_event(evt);
        }

        error(err : any) : void {
            this.stream.trigger_error(err);
        }

        close(reason : any) : void {
            this.stream.trigger_close(reason);
        }
        
    }
    
    export class Stream<A> {
        
        observers : Observer<A>[];
        closed : boolean;
        
        constructor() {
            this.observers = [];
            this.closed = false;
        }
    
        toString() {
            return "#<Stream>";
        }
    
        private add_observer(observer) : void {
            this.observers.push(observer);
        }
    
        // TODO: module-private?
        public remove_observer(observer) : void {
            var ind;
            ind = this.observers.indexOf(observer);
            if (ind != -1) {
                this.observers.splice(ind, 1);
            }
        }

        // TODO: these should really be module-private
        trigger_event(event) {
            if (!this.closed) {
                this.observers.map((observer) => observer.on_event(event));
            } else {
                throw 'closed';
            }
        }
    
        trigger_error(error) {
            if (!this.closed) {
                this.observers.map((observer) => observer.on_error(error));
            } else {
                throw 'closed';
            }
        }
    
        trigger_close(reason) {
            this.closed = true;
            return this.observers.map((observer) => observer.on_close(reason));
        }
    
        listen(event_cb : (A) => void,
               error_cb? : (any) => void,
               close_cb? : (any) => void) : Observer<A> {
            var observer = new Observer(this, event_cb, error_cb, close_cb);
            this.add_observer(observer);
            return observer;
        }
    
        map<B>(func : (A) => B) : Stream<B> {
            var controller = new StreamController<B>();
            this.listen(
                (event) => controller.add(func(event)),
                (error) => controller.error(error),
                (reason) => controller.close(reason)
            );
            return controller.stream;
        }

        distinct() : Stream<A> {
            var controller = new StreamController<A>();
            var lastEvent = null;
            this.listen(
                (event) => {
                    if(event !== lastEvent) {
                        lastEvent = event;
                        controller.add(event);
                    }
                },
                (err) => controller.error(err),
                (reason) => controller.close(reason)
            );
            return controller.stream;
        }
    
        filter(func : (A) => boolean) : Stream<A> {
            var controller = new StreamController<A>();
            this.listen(
                (event) => {
                    if (func(event)) {
                        controller.add(event);
                    }
                },
                (error) => controller.error(error),
                (reason) => controller.close(reason)
            );
            return controller.stream;
        }

        // TODO
//        fold(initial : B, func : (A, B) => B) : Signal<B> {
//            var signal;
//            signal = new Stream(initial);
//            this.listen((event) => signal.trigger_event(func(signal.value, event)), (error) => signal.trigger_error(error), (reason) => signal.trigger_close(reason));
//            return signal;
//        }

        /* TODO
        distinct() {
            var dist, last_evt;
            dist = new Stream(this.value);
            last_evt = this.value;
            this.listen(((event) => {
                if (event !== last_evt) {
                    last_evt = event;
                    return dist.trigger_event(event);
                }
            }), (error) => dist.trigger_error(error), (reason) => dist.trigger_close(close));
            return dist;
        }
    
        throttle(interval) {
            var last_time, throttled;
            last_time = new Date().getTime();
            throttled = new Stream(this.value);
            this.listen(((evt) => {
                var now;
                now = new Date().getTime();
                if (now >= last_time + interval) {
                    last_time = now;
                    return throttled.trigger_event(evt);
                }
            }), (error) => throttled.trigger_error(error), (reason) => throttled.trigger_close(reason));
            return throttled;
        }
        */
    
        log(name : string) : void {
            var repr = name ? name : this.toString();
            this.listen(
                (event) => console.log(repr + ':event:', event),
                (error) => console.log(repr + ':error:', error),
                (reason) => console.log(repr + ':close:', reason)
            );
        }

    }
    
    export class Observer<A> {
        
        constructor(public stream : Stream<A>,
                    public event_cb : (A) => void,
                    public error_cb? : (any) => void,
                    public close_cb? : (any) => void) {}
    
        toString() {
            return "#<Observer>";
        }
    
        on_event(event) : void {
            this.event_cb(event);
        }
    
        on_error(error) : void {
            if (this.error_cb) {
                this.error_cb(error);
            } else {
                throw error;
            }
        }
    
        on_close(reason) : void {
            if (this.close_cb) {
                this.close_cb(reason);
            }
        }

        unsubscribe() {
            this.stream.remove_observer(this);
        }

    }

    export class SignalController<T> {

        updates : StreamController<T>;
        signal : Signal<T>;

        constructor(initialValue : T) {
            this.updates = new StreamController<T>();
            this.signal = new Signal(initialValue, this.updates.stream);
        }

        update(newValue : T) : void {
            if(this.signal.value !== newValue) {
                this.signal.value = newValue;
                this.updates.add(newValue);
            }
        }

    }

    export class Signal<A> {

        constructor(public value : A, public updates : Stream<A>) {}

        /* TODO
        static fold<B>(initialValue : B, stream : Stream<A>, combiner : (A, B) => B) : Signal<B> {
            var controller = new SignalController(initialValue);
            stream.listen((evt) {
            var oldValue = controller.signal.value;
            controller.update(combiner(oldValue, evt));
            });
            return controller.signal;
        }
        */

        static constant<B>(value : B) : Signal<B> {
            return new Signal<B>(value, new StreamController<B>().stream);
        }

        static derived<B>(signals : Signal<any>[], comp : (values:Array<any>) => B) : Signal<B> {
            var recompute : () => any = () => comp.apply(this, [signals.map((s) => s.value)]);
            var controller = new SignalController(recompute());
            signals.forEach((signal) => {
                signal.updates.listen((_) =>
                    controller.update(recompute())
                );
            });
            return controller.signal;
        }

        static or(signals : Array<Signal<boolean>>):Signal<boolean> {
            return Signal.derived(signals, (values) => {
                // this is a fold...
                var val = false;
                for(var i=0; i < values.length; i++) {
                    val = val || values[i];
                }
                return val;
            });
        }

        map<B>(mapper : (A) => B) : Signal<B> {
            return Signal.derived([this], (values:A[]) => mapper(values[0]));
        }

        log(tag? : string) {
            if(tag == undefined) {
                tag = "<#Signal>";
            }
            console.log(tag + ':initial:', this.value);
            this.updates.log(tag);
        }

    }

    export class Completer<A> {

        future : Future<A>;

        constructor() {
            this.future = new Future<A>();
        }

        complete(value : A) : void {
            this.future.trigger(value);
        }

        error(err : any) : void {
            this.future.trigger_error(err);
        }

    }

    export class Future<A> {

        static all<B>(futures : Array<Future<B>>) : Future<Array<B>> {
            var comp = new Completer<Array<B>>();
            var completed = 0;
            var results = [];
            range(futures.length).forEach((i) => {
                results.push(null);
                futures[i].then(
                    (val) => {
                        results[i] = val;
                        completed++;
                        if(completed == futures.length) {
                            comp.complete(results);
                        }
                        return null
                    },
                    (err) => comp.error(err)
                );
            });
            return comp.future;
        }

        static immediate<B>(value : B) : Future<B> {
          var completer = new Completer<B>();
          setTimeout(() => {
            completer.complete(value);
          }, 0);
          return completer.future;
        }

        completed : boolean;
        value : A;
        observers : FutureObserver<A>[];

        constructor() {
            this.completed = false;
            this.observers = [];
        }

        trigger(value : A) {
            if(this.completed) {
                throw "already completed";
            } else {
                this.completed = true;
                this.value = value;
                this.observers.map((obs) => obs.on_complete(value));
            }
        }

        trigger_error(err : any) {
            if(this.completed) {
                throw "already completed";
            } else {
                this.completed = true;
                this.observers.map((obs) => {
                    if(obs.on_error) {
                        obs.on_error(err);
                    } else {
                        throw err;
                    }
                });
            }
        }

        then<B>(handler : (A) => Future<B>, err_handler? : (any) => void) {
            var comp = new Completer();
            // TODO: ...
            var on_error : (any) => void;
            if(err_handler) {
                on_error = err_handler;
            } else {
                on_error = (err) => comp.error(err);
            }
            this.observers.push(new FutureObserver(
                (value) => comp.complete(handler(value)),
                on_error
            ));
            return comp.future;
        }

        map<B>(fun : (A) => B) : Future<B> {
            var comp = new Completer<B>();
            this.then((value) => {
                comp.complete(fun(value));
                return null;
            });
            return comp.future;
        }

    }

    export class FutureObserver<A> {

        constructor(public on_complete : (A) => void, public on_error? : (any) => void) {}

    }


    /* TODO
    class Ticker extends Stream {
        // @interval: interval in milliseconds
    
        constructor(interval) {
            super();
            this.tick_num = 0;
            this.closed = false;
            this.paused = new Stream(false);
            this.tick();
        }
    
        toString() {
            return "#<Ticker>";
        }
    
        tick() {
            if (!this.closed && !this.paused.value) {
                this.trigger_event(this.tick_num);
                this.tick_num += 1;
                return setTimeout((() => this.tick()), this.interval);
            }
        }
    
        togglePaused() {
            this.paused.trigger_event(!this.paused.value);
            if (!this.paused.value) {
                return this.tick();
            }
        }
    
        trigger_close(...args) {
            var closed;
            closed = true;
            return .trigger_close();
        }
    }
    */

}

function range(num : number) {
    var result = [];
    for(var i=0; i < num; i++) {
        result.push(i);
    }
    return result;
}