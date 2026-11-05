'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Car, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiCreateVehicle, apiDeleteVehicle, apiGetVehicles } from '@/lib/api';
import { Vehicle, VehicleType } from '@/lib/types';

export default function VehiclesPage() {
  const { user, token } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [plateNumber, setPlateNumber] = useState<string>('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('CAR');
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadVehicles = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiGetVehicles(token);
      setVehicles(res.vehicles);
    } catch (err: any) {
      setMessage({ type: 'err', text: err?.message || 'Failed to load vehicles' });
    }
  }, [token]);

  useEffect(() => {
    loadVehicles();
  }, [loadVehicles]);

  const handleAddVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setMessage(null);
    try {
      await apiCreateVehicle(token, {
        plate_number: plateNumber,
        vehicle_type: vehicleType,
      });
      setPlateNumber('');
      setMessage({ type: 'ok', text: 'Vehicle added successfully!' });
      await loadVehicles();
    } catch (err: any) {
      setMessage({ type: 'err', text: err?.message || 'Could not add vehicle' });
    }
  };

  const handleDelete = async (vehicleId: number) => {
    if (!token) return;
    setMessage(null);
    try {
      await apiDeleteVehicle(token, vehicleId);
      setMessage({ type: 'ok', text: 'Vehicle removed.' });
      await loadVehicles();
    } catch (err: any) {
      setMessage({ type: 'err', text: err?.message || 'Cannot delete vehicle' });
    }
  };

  return (
    <div data-testid="vehicles-page" className="space-y-8">
      <div className="border-b border-editorial-border pb-6">
        <div className="text-xs font-bold uppercase tracking-wider text-editorial-muted">
          Fleet Registry · 3NF Vehicle Ownership
        </div>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-editorial-ink">
          My Registered Vehicles
        </h1>
        <p className="mt-1 text-xs text-editorial-muted">
          Database trigger <code className="font-mono">trg_resv_before_insert</code> verifies that
          your vehicle type matches the target parking slot type.
        </p>
      </div>

      {message && (
        <div
          className={`border p-3.5 text-xs font-bold ${
            message.type === 'ok'
              ? 'border-editorial-cobalt bg-editorial-cobalt/10 text-editorial-cobalt'
              : 'border-editorial-vermilion bg-editorial-vermilion/10 text-editorial-vermilion'
          }`}
        >
          {message.text}
        </div>
      )}

      {!user ? (
        <div className="border border-editorial-ink bg-editorial-surface p-10 text-center">
          <p className="text-sm font-semibold text-editorial-ink">
            Sign in to manage your vehicles.
          </p>
          <Link
            href="/login"
            className="mt-3 inline-block bg-editorial-vermilion px-4 py-2 text-xs font-bold uppercase text-white"
          >
            Sign In
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          <form
            onSubmit={handleAddVehicle}
            className="space-y-4 border border-editorial-border bg-editorial-surface p-6"
          >
            <h2 className="flex items-center gap-1.5 text-base font-bold text-editorial-ink">
              <Plus className="h-4 w-4 text-editorial-vermilion" />
              <span>Add New Vehicle</span>
            </h2>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-editorial-muted">
                License Plate Number
              </label>
              <input
                type="text"
                required
                minLength={4}
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
                placeholder="KA01AB1234"
                className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 font-mono text-sm uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-editorial-muted">
                Vehicle Type
              </label>
              <select
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value as VehicleType)}
                className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 text-sm font-bold"
              >
                <option value="CAR">CAR</option>
                <option value="BIKE">BIKE</option>
                <option value="SUV">SUV</option>
                <option value="EV">EV</option>
              </select>
            </div>
            <button
              type="submit"
              className="w-full bg-editorial-ink py-2.5 text-xs font-bold uppercase tracking-wider text-editorial-bg hover:bg-editorial-vermilion"
            >
              Register Vehicle
            </button>
          </form>

          <div className="space-y-3 md:col-span-2">
            {vehicles.map((v) => (
              <div
                key={v.vehicle_id}
                className="flex items-center justify-between border border-editorial-border bg-editorial-surface p-4"
              >
                <div className="flex items-center gap-4">
                  <div className="editorial-stamp border-editorial-cobalt text-editorial-cobalt">
                    {v.vehicle_type}
                  </div>
                  <div>
                    <div className="font-mono text-lg font-bold text-editorial-ink">
                      {v.plate_number}
                    </div>
                    <div className="text-xs text-editorial-muted">
                      Vehicle ID #{v.vehicle_id} · Registered {v.created_at}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(v.vehicle_id)}
                  className="inline-flex items-center gap-1 border border-editorial-vermilion bg-editorial-vermilion/10 px-3 py-1.5 text-xs font-bold text-editorial-vermilion hover:bg-editorial-vermilion hover:text-white"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
