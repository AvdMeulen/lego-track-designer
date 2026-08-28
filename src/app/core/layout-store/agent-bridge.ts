import { effect, inject, Injectable } from '@angular/core';
import { APP_VERSION } from '../version';
import { LegoTrackAgent } from './agent-api';
import { AGENT_EVAL_SCENE } from './agent-scene';
import { LayoutStore } from './layout.store';

@Injectable({ providedIn: 'root' })
export class AgentBridge {
  private readonly store = inject(LayoutStore);

  constructor() {
    const agent: LegoTrackAgent = {
      version: APP_VERSION,
      scenes: [AGENT_EVAL_SCENE],
      report: () => this.store.agentReport(),
      setup: (options) => {
        this.store.applySetup(options);
        return this.store.agentReport();
      },
      generate: (options) => this.store.runGeneration({ ...options, increment: options?.seed == null }),
    };
    window.legoTrackAgent = agent;
    effect(() => {
      const status = this.store.generating() ? 'generating' : 'ready';
      document.documentElement.dataset['legoTrack'] = status;
      document.documentElement.dataset['legoTrackSeed'] = String(this.store.seed());
    });
  }
}
