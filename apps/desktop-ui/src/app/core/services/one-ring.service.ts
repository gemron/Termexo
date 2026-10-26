import { Injectable } from '@angular/core';
import type {
  OneRingConnection,
  OneRingDoctor,
  OneRingSummary,
  OneRingWorkflow,
  OneRingCoordinatorRequest,
} from '../models/one-ring.models';
import { invoke } from './backend-bridge';

@Injectable({ providedIn: 'root' })
export class OneRingService {
  findCoordinator(request: OneRingCoordinatorRequest, terminalIds: string[]): Promise<string | null> {
    return invoke('find_one_ring_coordinator', { root: request.root, workflowId: request.workflowId,
      originalTerminalId: request.coordinatorTerminalId ?? null, terminalIds });
  }
  connection(): Promise<OneRingConnection | null> {
    return invoke('get_one_ring_connection');
  }
  doctor(): Promise<OneRingDoctor> {
    return invoke('inspect_one_ring', { operation: 'one_ring_doctor' });
  }
  list(): Promise<OneRingSummary[]> {
    return invoke('inspect_one_ring', { operation: 'one_ring_list' });
  }
  status(workflowId: string): Promise<OneRingWorkflow> {
    return invoke('inspect_one_ring', { operation: 'one_ring_status', workflowId });
  }
}
