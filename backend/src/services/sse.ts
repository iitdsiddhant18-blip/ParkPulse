import { Response } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db';

const lotClients = new Map<number, Set<Response>>();

export interface LotStreamPayload {
  lot_id: number;
  reason: string;
  timestamp: string;
  occupancy: {
    total_slots: number;
    available_slots: number;
    reserved_slots: number;
    occupied_slots: number;
    maintenance_slots: number;
    occupancy_pct: number;
  };
  slots: Array<{
    slot_id: number;
    lot_id: number;
    slot_number: string;
    slot_type: string;
    status: string;
  }>;
}

export async function buildLotStreamPayload(
  lotId: number,
  reason: string
): Promise<LotStreamPayload | null> {
  const [occRows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       lot_id,
       COALESCE(total_slots, 0)       AS total_slots,
       COALESCE(available_slots, 0)   AS available_slots,
       COALESCE(reserved_slots, 0)    AS reserved_slots,
       COALESCE(occupied_slots, 0)    AS occupied_slots,
       COALESCE(maintenance_slots, 0) AS maintenance_slots,
       COALESCE(occupancy_pct, 0)     AS occupancy_pct
     FROM v_lot_occupancy
     WHERE lot_id = ?`,
    [lotId]
  );

  if (occRows.length === 0) {
    return null;
  }

  const [slotRows] = await pool.execute<RowDataPacket[]>(
    `SELECT slot_id, lot_id, slot_number, slot_type, status
       FROM parking_slots
      WHERE lot_id = ?
      ORDER BY slot_number ASC, slot_id ASC`,
    [lotId]
  );

  const occ = occRows[0];
  return {
    lot_id: Number(lotId),
    reason,
    timestamp: new Date().toISOString(),
    occupancy: {
      total_slots: Number(occ.total_slots),
      available_slots: Number(occ.available_slots),
      reserved_slots: Number(occ.reserved_slots),
      occupied_slots: Number(occ.occupied_slots),
      maintenance_slots: Number(occ.maintenance_slots),
      occupancy_pct: Number(occ.occupancy_pct),
    },
    slots: slotRows.map((s) => ({
      slot_id: Number(s.slot_id),
      lot_id: Number(s.lot_id),
      slot_number: String(s.slot_number),
      slot_type: String(s.slot_type),
      status: String(s.status),
    })),
  };
}

export function addLotStreamClient(lotId: number, res: Response): void {
  let set = lotClients.get(lotId);
  if (!set) {
    set = new Set<Response>();
    lotClients.set(lotId, set);
  }
  set.add(res);
}

export function removeLotStreamClient(lotId: number, res: Response): void {
  const set = lotClients.get(lotId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) {
    lotClients.delete(lotId);
  }
}

export function writeSseEvent(res: Response, eventName: string, data: unknown): void {
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function broadcastLotUpdate(lotId: number, reason: string): Promise<void> {
  const clients = lotClients.get(lotId);
  if (!clients || clients.size === 0) {
    return;
  }

  const payload = await buildLotStreamPayload(lotId, reason);
  if (!payload) {
    return;
  }

  for (const client of Array.from(clients)) {
    try {
      writeSseEvent(client, 'slot_update', payload);
    } catch {
      removeLotStreamClient(lotId, client);
    }
  }
}

export async function broadcastAllLotsUpdate(reason: string): Promise<void> {
  for (const lotId of Array.from(lotClients.keys())) {
    await broadcastLotUpdate(lotId, reason);
  }
}
