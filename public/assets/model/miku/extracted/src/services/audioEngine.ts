export class AudioEngine {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private isPlaying = false;
  private startTime = 0;
  private bpm = 120;

  init() {
    this.ctx = new AudioContext();
    this.gainNode = this.ctx.createGain();
    this.gainNode.connect(this.ctx.destination);
    this.gainNode.gain.value = 0.3;
  }

  private createOscillator(freq: number, type: OscillatorType, duration: number, time: number) {
    if (!this.ctx || !this.gainNode) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    
    g.gain.setValueAtTime(0.3, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    
    osc.connect(g);
    g.connect(this.gainNode);
    
    osc.start(time);
    osc.stop(time + duration);
  }

  async playDemo() {
    if (!this.ctx) this.init();
    if (!this.ctx || this.isPlaying) return;
    
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    
    console.log("AudioEngine: Starting playback...");
    this.isPlaying = true;
    this.startTime = this.ctx.currentTime;
    
    const beatLen = 60 / this.bpm;
    
    // Simple loop generation for 60 seconds
    for (let i = 0; i < 120; i++) {
      const t = this.startTime + i * beatLen;
      
      // Kick
      this.createOscillator(60, 'sine', 0.2, t);
      
      // Snare on 2 and 4
      if (i % 2 === 1) {
        this.createOscillator(200, 'square', 0.1, t);
      }
      
      // Hi-hat on every beat
      this.createOscillator(800, 'sine', 0.05, t + beatLen / 2);

      // Bass line
      const bassFreqs = [40, 45, 50, 35];
      this.createOscillator(bassFreqs[Math.floor(i / 4) % 4], 'sawtooth', beatLen, t);
    }
  }

  getCurrentTime() {
    if (!this.ctx || !this.isPlaying) return 0;
    return this.ctx.currentTime - this.startTime;
  }

  stop() {
    this.isPlaying = false;
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close();
    }
    this.ctx = null;
    this.gainNode = null;
  }
}

export const audioEngine = new AudioEngine();
