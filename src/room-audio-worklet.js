class TrackyPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
  }

  flush() {
    if (!this.offset) return;
    this.port.postMessage(this.buffer.slice(0, this.offset));
    this.offset = 0;
  }

  process(inputs, outputs) {
    const channel = inputs?.[0]?.[0];
    if (channel?.length) {
      let sourceOffset = 0;

      while (sourceOffset < channel.length) {
        const available = this.buffer.length - this.offset;
        const take = Math.min(available, channel.length - sourceOffset);
        this.buffer.set(
          channel.subarray(sourceOffset, sourceOffset + take),
          this.offset
        );
        this.offset += take;
        sourceOffset += take;

        if (this.offset === this.buffer.length) this.flush();
      }
    }

    const output = outputs?.[0]?.[0];
    if (output) output.fill(0);
    return true;
  }
}

registerProcessor('tracky-pcm-processor', TrackyPcmProcessor);
