import { describe, expect, it } from 'vitest';
import { RunEventBus, type WorkflowRunEvent } from '../../../src/workflow/runtime/events.js';

function makeEvent(runId: string, type: WorkflowRunEvent['type']): WorkflowRunEvent {
  return {
    id: '',
    type,
    runId,
    workflowId: 'wf-1',
    timestamp: new Date().toISOString(),
  };
}

describe('RunEventBus', () => {
  it('stores and replays event history', () => {
    const bus = new RunEventBus();
    bus.emit({ ...makeEvent('run-1', 'RUN_STARTED'), id: '' });
    bus.emit({ ...makeEvent('run-1', 'NODE_STARTED'), id: '' });
    bus.emit({ ...makeEvent('run-2', 'RUN_STARTED'), id: '' });

    expect(bus.history('run-1')).toHaveLength(2);
    expect(bus.history('run-1')[0]?.type).toBe('RUN_STARTED');
    expect(bus.history('run-1')[1]?.type).toBe('NODE_STARTED');
    expect(bus.history('run-2')).toHaveLength(1);
    expect(bus.history('run-3')).toHaveLength(0);
  });

  it('delivers events to subscribers in real time', () => {
    const bus = new RunEventBus();
    const received: WorkflowRunEvent[] = [];
    const unsubscribe = bus.subscribe('run-1', (event) => received.push(event));

    bus.emit({ ...makeEvent('run-1', 'RUN_STARTED'), id: '' });
    bus.emit({ ...makeEvent('run-1', 'NODE_COMPLETED'), id: '' });
    bus.emit({ ...makeEvent('run-2', 'RUN_STARTED'), id: '' });

    expect(received).toHaveLength(2);
    expect(received[0]?.type).toBe('RUN_STARTED');
    expect(received[1]?.type).toBe('NODE_COMPLETED');

    unsubscribe();
    bus.emit({ ...makeEvent('run-1', 'RUN_COMPLETED'), id: '' });
    expect(received).toHaveLength(2);
  });

  it('assigns sequential ids when missing', () => {
    const bus = new RunEventBus();
    bus.emit({ ...makeEvent('run-1', 'RUN_STARTED'), id: '' });
    bus.emit({ ...makeEvent('run-1', 'NODE_STARTED'), id: '' });

    const history = bus.history('run-1');
    expect(history[0]?.id).toBe('run-1-event-1');
    expect(history[1]?.id).toBe('run-1-event-2');
  });

  it('caps history at 200 events', () => {
    const bus = new RunEventBus();
    for (let i = 0; i < 210; i += 1)
      bus.emit({ ...makeEvent('run-1', 'NODE_STARTED'), id: '' });
    expect(bus.history('run-1')).toHaveLength(200);
  });

  it('clears history and listeners', () => {
    const bus = new RunEventBus();
    const received: WorkflowRunEvent[] = [];
    bus.subscribe('run-1', (event) => received.push(event));
    bus.emit({ ...makeEvent('run-1', 'RUN_STARTED'), id: '' });
    expect(bus.history('run-1')).toHaveLength(1);

    bus.clear('run-1');
    expect(bus.history('run-1')).toHaveLength(0);

    bus.emit({ ...makeEvent('run-1', 'NODE_STARTED'), id: '' });
    expect(bus.history('run-1')).toHaveLength(1);
    expect(received).toHaveLength(1);
  });

  it('preserves provided ids', () => {
    const bus = new RunEventBus();
    bus.emit({ ...makeEvent('run-1', 'RUN_STARTED'), id: 'custom-id' });
    expect(bus.history('run-1')[0]?.id).toBe('custom-id');
  });
});
