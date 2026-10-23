import { Injectable } from '@angular/core';
import type {
  OneRingConnection,
  OneRingDoctor,
  OneRingSummary,
  OneRingWorkflow,
} from '../models/one-ring.models';
import { invoke } from './backend-bridge';

@Injectable({ providedIn: 'root' })
export class OneRingService {
  connection(): Promise<OneRingConnection | null> {
    return invoke('get_one_ring_connection');
  }
  connect(connection: OneRingConnection): Promise<OneRingDoctor> {
    return invoke('connect_one_ring', { connection });
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
