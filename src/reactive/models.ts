

/* TODO

class ListModel {
    // TODO: changes stream, length

    constructor() {
        var decrs, incrs;
        this.list = [];
        this.additions = new EventStream();
        this.removals = new EventStream();
        this.mutations = new EventStream();
        incrs = this.additions.map((evt) => 1);
        decrs = this.removals.map((evt) => -1);
        this.length = EventStream.merge([incrs, decrs]).fold(0, (length, evt) => length + evt);
        this.empty = this.length.map((l) => l === 0);
    }

    public get(index) {
        if (index < 0) {
            return this.list[this.list.length + index];
        } else {
            return this.list[index];
        }
    }

    public add(index, value) {
        this.list.splice(index, 0, value);
        return this.additions.trigger_event({
            index: index,
            value: value
        });
    }

    public append(value) {
        return this.add(this.list.length, value);
    }

    public remove(index) {
        var removed;
        removed = this.list.splice(index, 1)[0];
        this.removals.trigger_event({
            index: index,
            removed: removed
        });
        return removed;
    }

    public mutate(index, value) {
        var old_value;
        old_value = this.list_index;
        this.list[index] = value;
        return this.mutations.trigger_event({
            index: index,
            old_value: old_value,
            new_value: value
        });
    }

    public destroy() {
        this.additions.trigger_close();
        this.removals.trigger_close();
        return this.mutations.trigger_close();
    }

    public map(func) {
        var mapped;
        mapped = new ListModel();
        this.additions.listen((evt) => mapped.add(evt.index, func(evt.index, evt.value)));
        this.removals.listen((evt) => mapped.remove(evt.index));
        this.mutations.listen((evt) => mapped.mutate(evt.index, func(evt.index, evt.new_value)));
        this.list.forEach((item) => mapped.append(item));
        return mapped;
    }

    public bind_as_child_nodes(parent) {
        this.removals.listen((evt) => parent.removeChild(evt.removed));
        this.mutations.listen((evt) => parent.replaceChild(evt.new_value, evt.old_value));
        return this.additions.listen(((evt) => {
            if (evt.index === parent.childNodes.length) {
                return parent.appendChild(evt.value);
            } else {
                return parent.insertBefore(evt.value, parent.childNodes[evt.index]);
            }
        }));
    }
}

*/