class TrackyPcmProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const channel = inputs?.[0]?.[0];
    if (channel?.length) this.port.postMessage(channel.slice());

    const output = outputs?.[0]?.[0];
    if (output) output.fill(0);
    return true;
  }
}

registerProcessor('tracky-pcm-processor', TrackyPcmProcessor);
