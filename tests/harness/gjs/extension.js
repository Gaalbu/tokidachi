export class Extension {
    constructor(metadata = {}) {
        this.metadata = metadata;
        this.uuid = metadata.uuid ?? 'tokidachi@gaalbu.github.io';
        this.path = metadata.path ?? '/nonexistent';
    }
}
