import { TestBed } from '@angular/core/testing';
import { BrowserStorage } from '../storage/browser-storage';
import { APP_VERSION } from '../version';
import { AgentBridge } from './agent-bridge';
import { LayoutStore } from './layout.store';

describe('AgentBridge', () => {
  beforeEach(() => {
    delete window.legoTrackAgent;
    TestBed.configureTestingModule({
      providers: [{ provide: BrowserStorage, useValue: { read: () => null, write: () => undefined } }],
    });
  });

  afterEach(() => {
    delete window.legoTrackAgent;
  });

  it('publishes a browser helper that reports idle state', () => {
    TestBed.inject(AgentBridge);
    expect(window.legoTrackAgent?.version).toBe(APP_VERSION);
    expect(window.legoTrackAgent?.report().status).toBe('idle');
    expect(window.legoTrackAgent?.report().seed).toBe(1);
    expect(window.legoTrackAgent?.scenes).toEqual(['eval']);
  });

  it('forwards generate to the layout store', async () => {
    const store = TestBed.inject(LayoutStore);
    const report = store.agentReport();
    spyOn(store, 'runGeneration').and.resolveTo(report);
    TestBed.inject(AgentBridge);
    await window.legoTrackAgent?.generate({ seed: 90, parking: 2 });
    expect(store.runGeneration).toHaveBeenCalledWith({ seed: 90, parking: 2, increment: false });
  });

  it('writes the eval room and collection into the stores', () => {
    TestBed.inject(AgentBridge);
    const report = window.legoTrackAgent?.setup({ scene: 'eval', parking: 2 });
    expect(report?.collection['straight-16']).toBe(58);
    expect(report?.collection['curve-22']).toBe(97);
    expect(report?.collection['flex-track']).toBe(12);
    expect(report?.room.vertices).toBe(6);
    expect(report?.room.obstacles).toBe(1);
    expect(report?.parkingTarget).toBe(2);
  });
});
