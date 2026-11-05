'use client';

import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { ParkingLotSummary } from '@/lib/types';

interface LotMapCanvasProps {
  lots: ParkingLotSummary[];
  selectedLotId: number;
  onSelectLot: (lotId: number) => void;
}

export default function LotMapCanvas({
  lots,
  selectedLotId,
  onSelectLot,
}: LotMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialCenter: [number, number] =
      lots.length > 0
        ? [Number(lots[0].latitude), Number(lots[0].longitude)]
        : [12.9767, 77.5713];

    const map = L.map(containerRef.current, {
      center: initialCenter,
      zoom: 12,
      scrollWheelZoom: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    for (const lot of lots) {
      const isSelected = lot.lot_id === selectedLotId;
      const badgeBg = isSelected ? '#EE5335' : '#161514';
      const html = `
        <div style="
          background:${badgeBg};
          color:#F3ECE0;
          border:2px solid #FAF6EE;
          padding:4px 8px;
          font-family:'Space Grotesk',sans-serif;
          font-size:11px;
          font-weight:700;
          white-space:nowrap;
          box-shadow:0 4px 12px rgba(0,0,0,0.25);
        ">
          ${lot.available_slots}/${lot.total_slots} FREE · ₹${lot.min_hourly_rate ?? 10}/h
        </div>
      `;

      const icon = L.divIcon({
        className: 'parkpulse-editorial-marker',
        html,
        iconSize: [130, 30],
        iconAnchor: [65, 15],
      });

      const marker = L.marker([Number(lot.latitude), Number(lot.longitude)], { icon });
      marker.on('click', () => onSelectLot(lot.lot_id));
      marker.bindPopup(
        `<strong>${lot.name}</strong><br/>${lot.address}, ${lot.city}<br/>Available: ${lot.available_slots} / ${lot.total_slots} slots`
      );
      marker.addTo(layer);

      if (isSelected) {
        map.panTo([Number(lot.latitude), Number(lot.longitude)], { animate: true });
      }
    }
  }, [lots, selectedLotId, onSelectLot]);

  return (
    <div
      ref={containerRef}
      data-testid="leaflet-map-canvas"
      className="h-[460px] w-full border border-editorial-ink bg-editorial-surface"
    />
  );
}
